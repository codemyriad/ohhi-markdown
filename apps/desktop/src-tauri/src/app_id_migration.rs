//! The one-time move from the old app identifier's folders to the new one's.
//!
//! The identifier was `md.ohhi.desktop` until 2026-10-16 and is `md.ohhi`
//! since (one id on every target, desktop and mobile). Every per-app folder
//! is named after it, so a desktop install updated across the rename would
//! start empty: no vault list, no relay tokens (the webview's localStorage
//! and IndexedDB live in the app-data folder on Linux, under
//! `~/Library/WebKit/<id>` on macOS), no durable stores, no folder grants
//! (`.persisted-scope`).
//!
//! So on launch, before any other plugin reads its files and before the
//! window exists, each old folder is copied to the new name when the new one
//! is missing or empty. The copy goes to a temporary sibling first and is
//! renamed into place, so a crash halfway leaves the new folder absent and
//! the next launch tries again. The old folder is never deleted or changed:
//! an older build still opens it, and it is the fallback if the copy is
//! wrong. See docs/desktop-builds.md (What lands where).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri::path::BaseDirectory;
use tauri::plugin::TauriPlugin;
use tauri::{Manager, Runtime};

/// The identifier every desktop build before 2026-10-16 used.
pub const OLD_IDENTIFIER: &str = "md.ohhi.desktop";

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Copied: the old folder's contents are now under the new name.
    Copied,
    /// No old folder (or an empty one): a fresh install, nothing to carry.
    NoOld,
    /// The new folder already has something in it: never overwritten.
    NewInUse,
}

/// Copy `old` to `new` when `new` is missing or empty and `old` has
/// something in it. `old` is only read.
pub fn migrate_dir(old: &Path, new: &Path) -> io::Result<Outcome> {
    if !has_entries(old)? {
        return Ok(Outcome::NoOld);
    }
    if has_entries(new)? {
        return Ok(Outcome::NewInUse);
    }
    let parent = new.parent().ok_or_else(|| io::Error::other("the new folder has no parent"))?;
    fs::create_dir_all(parent)?;
    let staging = sibling(new, ".migrating");
    if staging.exists() {
        fs::remove_dir_all(&staging)?; // a copy a crash interrupted
    }
    copy_tree(old, &staging)?;
    if new.exists() {
        fs::remove_dir(new)?; // empty, checked above
    }
    fs::rename(&staging, new)?;
    Ok(Outcome::Copied)
}

fn has_entries(dir: &Path) -> io::Result<bool> {
    match fs::read_dir(dir) {
        Ok(mut entries) => Ok(entries.next().is_some()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(err),
    }
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

/// Files, folders and symlinks (as links, not followed), permissions kept.
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir(to)?;
    fs::set_permissions(to, fs::metadata(from)?.permissions())?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if kind.is_symlink() {
            copy_link(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn copy_link(from: &Path, to: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(fs::read_link(from)?, to)
}

#[cfg(not(unix))]
fn copy_link(from: &Path, to: &Path) -> io::Result<()> {
    fs::copy(from, to).map(|_| ())
}

/// The old and new folder of each kind the app keeps, resolved by Tauri's
/// path resolver: the base directory of each kind, joined with the old and
/// the current identifier. Folders shared by two kinds (Linux's data and
/// local data are both `~/.local/share`) appear once.
fn folder_pairs<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<(PathBuf, PathBuf)> {
    let id = app.config().identifier.clone();
    let mut pairs: Vec<(PathBuf, PathBuf)> = Vec::new();
    for base in [BaseDirectory::Data, BaseDirectory::LocalData, BaseDirectory::Config] {
        if let (Ok(old), Ok(new)) = (app.path().resolve(OLD_IDENTIFIER, base), app.path().resolve(&id, base)) {
            if !pairs.iter().any(|(_, n)| *n == new) {
                pairs.push((old, new));
            }
        }
    }
    // WKWebView keeps a bundle's website data (localStorage, IndexedDB)
    // under ~/Library/WebKit/<bundle id>, outside the app-data folder.
    #[cfg(target_os = "macos")]
    if let (Ok(old), Ok(new)) = (
        app.path().resolve(format!("Library/WebKit/{OLD_IDENTIFIER}"), BaseDirectory::Home),
        app.path().resolve(format!("Library/WebKit/{id}"), BaseDirectory::Home),
    ) {
        pairs.push((old, new));
    }
    pairs
}

/// Register FIRST: plugins set up in the order they are added, and the fs
/// and persisted-scope plugins read the app-data folder in theirs.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("app-id-migration")
        .setup(|app, _api| {
            if app.config().identifier == OLD_IDENTIFIER {
                return Ok(());
            }
            for (old, new) in folder_pairs(app) {
                match migrate_dir(&old, &new) {
                    Ok(Outcome::Copied) => {
                        eprintln!("app-id-migration: copied {} to {} (the old folder is kept)", old.display(), new.display())
                    }
                    Ok(_) => {}
                    Err(err) => eprintln!(
                        "app-id-migration: could not copy {} to {}: {err} (the old folder is untouched)",
                        old.display(),
                        new.display()
                    ),
                }
            }
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn scratch() -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "ohhi-app-id-migration-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn seed_old(root: &Path) -> PathBuf {
        let old = root.join(OLD_IDENTIFIER);
        fs::create_dir_all(old.join("stores/room-1")).unwrap();
        fs::write(old.join(".persisted-scope"), "{\"allowed_paths\":[\"/home/u/vault\"]}").unwrap();
        fs::write(old.join("stores/room-1/lca.bin"), [1u8, 2, 3]).unwrap();
        old
    }

    #[test]
    fn copies_the_old_folder_when_the_new_one_is_missing_and_keeps_the_old() {
        let root = scratch();
        let old = seed_old(&root);
        let new = root.join("md.ohhi");
        assert_eq!(migrate_dir(&old, &new).unwrap(), Outcome::Copied);
        assert_eq!(fs::read(new.join("stores/room-1/lca.bin")).unwrap(), vec![1, 2, 3]);
        assert!(fs::read_to_string(new.join(".persisted-scope")).unwrap().contains("/home/u/vault"));
        assert!(old.join("stores/room-1/lca.bin").exists(), "the old folder is never touched");
        assert!(!root.join("md.ohhi.migrating").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn an_empty_new_folder_counts_as_missing() {
        let root = scratch();
        let old = seed_old(&root);
        let new = root.join("md.ohhi");
        fs::create_dir_all(&new).unwrap();
        assert_eq!(migrate_dir(&old, &new).unwrap(), Outcome::Copied);
        assert!(new.join(".persisted-scope").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn never_overwrites_a_new_folder_in_use() {
        let root = scratch();
        let old = seed_old(&root);
        let new = root.join("md.ohhi");
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("mine"), "x").unwrap();
        assert_eq!(migrate_dir(&old, &new).unwrap(), Outcome::NewInUse);
        assert!(!new.join(".persisted-scope").exists());
        // …so a second launch after a copy is a no-op too.
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_fresh_install_has_nothing_to_carry() {
        let root = scratch();
        let new = root.join("md.ohhi");
        assert_eq!(migrate_dir(&root.join(OLD_IDENTIFIER), &new).unwrap(), Outcome::NoOld);
        assert!(!new.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_copy_a_crash_interrupted_is_redone() {
        let root = scratch();
        let old = seed_old(&root);
        let new = root.join("md.ohhi");
        fs::create_dir_all(root.join("md.ohhi.migrating/half")).unwrap();
        assert_eq!(migrate_dir(&old, &new).unwrap(), Outcome::Copied);
        assert!(!new.join("half").exists());
        assert!(new.join("stores/room-1/lca.bin").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
