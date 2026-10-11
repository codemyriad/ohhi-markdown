use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use tauri::ipc::CapabilityBuilder;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_webkit_renderer();
    tauri::Builder::default()
        // Order matters: persisted-scope needs the fs plugin's scope, and
        // granted-folders mirrors what persisted-scope restored.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(granted_folders())
        .setup(|app| {
            // The update feed and the relaunch into an update are desktop
            // only. A build with no `plugins.updater.endpoints` (every local
            // build; CI injects the team feed) still loads the plugin: its
            // check rejects, which the web layer reads as "no update feed".
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            #[cfg(not(desktop))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The folders the user granted, readable with their dot-entries.
///
/// The webview's fs scope is the app's own data plus whatever the user picked
/// (`pickVaultFolder` passes `recursive: true`, so the dialog plugin adds the
/// folder to the fs plugin's runtime scope; persisted-scope saves it and
/// restores it on the next launch). The fs plugin builds that runtime scope
/// with Tauri's default matching, which on Unix never lets `**` match a name
/// starting with `.` — and ignores `plugins.fs.requireLiteralLeadingDot`. A
/// granted vault would then refuse its own `.ohhi/` and `.obsidian/`, and its
/// listing would fail on the first `.DS_Store`.
///
/// So every pattern in the runtime scope is copied into a runtime capability's
/// `fs:scope`, which the fs plugin matches with the config's flag (false). The
/// patterns are already glob-escaped, and capability scope paths are parsed
/// as globs, so they carry over as they are. Only Rust adds them: the webview
/// can grant nothing (the grant file is denied to it, see
/// `capabilities/default.json`).
fn granted_folders<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("granted-folders")
        .setup(|app, _api| {
            let mirrored: Arc<Mutex<HashSet<String>>> = Arc::default();
            mirror_grants(app, &mirrored);
            let app_ = app.clone();
            app.fs_scope().listen(move |event| {
                if let tauri::fs::Event::PathAllowed(_) = event {
                    mirror_grants(&app_, &mirrored);
                }
            });
            Ok(())
        })
        .build()
}

fn mirror_grants<R: Runtime>(app: &AppHandle<R>, mirrored: &Mutex<HashSet<String>>) {
    let mut seen = mirrored.lock().unwrap();
    let fresh: Vec<serde_json::Value> = app
        .fs_scope()
        .allowed_patterns()
        .into_iter()
        .map(|p| p.as_str().to_owned())
        .filter(|p| seen.insert(p.clone()))
        .map(|p| serde_json::json!({ "path": p }))
        .collect();
    if fresh.is_empty() {
        return;
    }
    let grant = CapabilityBuilder::new(format!("granted-folders-{}", seen.len()))
        .window("main")
        .permission_scoped("fs:scope", fresh, Vec::<serde_json::Value>::new());
    if let Err(err) = app.add_capability(grant) {
        eprintln!("granted-folders: could not widen the fs scope: {err}");
    }
}

/// WebKitGTK's DMA-BUF renderer draws the note's text at a heavier weight
/// than the loaded face on at least one Wayland + AMD setup (Chris's, Ubuntu
/// 24.04, WebKitGTK 2.52): the woff2 loads and computes to 400, yet the
/// glyphs render bold. `WEBKIT_DISABLE_DMABUF_RENDERER=1` fixes it, so the
/// app sets it before the first webview exists. It costs the webview its
/// GPU-composited path, which a text editor does not need. Set
/// `OHHI_WEBKIT_DMABUF=1` to keep WebKit's default (to test whether a newer
/// WebKitGTK still needs the workaround). Linux only; the variable means
/// nothing elsewhere. See docs/desktop-builds.md.
fn configure_webkit_renderer() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("OHHI_WEBKIT_DMABUF").is_none()
            && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        {
            // SAFETY-equivalent note: called before any thread or webview is
            // spawned, which is the one moment setting process env is sound.
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}
