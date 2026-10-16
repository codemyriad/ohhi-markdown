# Android

Oh hi markdown on an Android phone is a Tauri 2 mobile target of
`apps/desktop`: the same Rust crate, the same web app (`apps/web/dist`) in the
Android System WebView. The Gradle project Tauri generated lives in
`apps/desktop/src-tauri/gen/android` and is committed. It is the project, not
a build artefact; its own `.gitignore` keeps the build output out. iOS, and
the CI workflow that builds both, are in [`mobile-builds.md`](mobile-builds.md).

This is the first version (slice MO1). It builds a **debug APK** on a
developer machine and runs it on a phone or the emulator. There is no store
listing, release signing or CI build yet.

## What the first version does

- **A vault on this phone.** The welcome offers *Start a vault on this phone*.
  The vault lives in the webview's private storage (OPFS, the same adapter a
  browser vault uses), inside the app's data. It survives restarts and
  reinstalls over the top, and goes when the app is uninstalled or its data
  is cleared.
- **Join by link.** *Add a folder someone shared with you* and *Bring your
  vault from another device* work as they do in a browser: the share or
  device link is pasted, and the vault arrives in the phone's storage.
- **The phone UI.** The small-screen shell (`apps/web/src/lib/small-screen.svelte.ts`,
  below 40rem): the navigator as a drawer, the format bar scrolling above the
  keyboard, the word count as a chip.
- **Inside the system bars.** Android 15+ draws every app edge to edge, and
  the System WebView does not report the status bar, navigation bar or
  keyboard as CSS `env(safe-area-inset-*)`. So `MainActivity.kt` pads the
  webview by the system bars, the display cutout and the keyboard (IME): the
  shell's top bar sits below the clock, and a note being typed stays above
  the keyboard. (iOS gets the same from the web side: `viewport-fit=cover` in
  `index.html` and the body padded by `env(safe-area-inset-*)` in
  `apps/web/src/app.css`; on Android those insets are 0, because the native
  padding already applied.)
- **No zoom on a field.** On a touch screen a text field's font is at least
  16px (`app.css`), the size below which iOS zooms the page into a focused
  field and leaves it panned. Android does not zoom, but gets the same sizes.
- **No storage nag.** Settings › Sync & devices says "Storage on this phone"
  and how much the app uses; the browser's "may clear this site's storage"
  reminder and its "use the desktop app" advice never show in the phone app.

How the web app knows: `isMobile()` in `apps/web/src/lib/platform.ts` is
Tauri plus an Android or iOS user agent, and `isDesktop()` is Tauri and not
mobile. The desktop-only switches read `isDesktop()`, so on a phone the
manager takes the browser's path (`manager.svelte.ts`, `foldersOnDisk`).
Plain `isTauri()` stays where every Tauri build is alike: the app version over
IPC, and share links, which point at the team host, never at the webview's
own `http://tauri.localhost`.

## What it does not do

- **No folders on disk.** No folder picker and no *Open a folder of notes*:
  the vault is not a folder another app (or an agent) can read. A folder of
  files needs the desktop app.
- **No updater.** The updater and process plugins are desktop only
  (`Cargo.toml` target table; their permissions live in
  `src-tauri/capabilities/desktop.json`, limited to Linux, macOS and Windows,
  because a mobile build refuses a permission whose plugin it lacks).
  Settings › About says the phone app does not update itself: install the
  newer APK over the old one, which keeps the vaults.
- **No storage prompt.** The browser asks to keep its storage
  (`navigator.storage.persist()`); the Android WebView refuses every time, so
  the phone app never asks and never warns. Its storage goes only with the
  app's data.
- **No Outside agents, no skills farm, no `~/.config/ohhi`.** These need a
  disk another program reads.

## Toolchain

Everything is in the home directory; nothing needs root.

| Piece | Where | Version |
| --- | --- | --- |
| Android SDK | `~/Android/Sdk` | platforms 35 and 36, build-tools 35.0.1, platform-tools, emulator |
| Command-line tools (`sdkmanager`, `avdmanager`) | `~/Android/Sdk/cmdline-tools/latest` | 19.0 (`commandlinetools-linux-13114758`) |
| NDK | `~/Android/Sdk/ndk/27.2.12479018` | r27c |
| JDK with `javac` | `~/Android/jdk-21` | Temurin 21 |
| Rust targets | rustup | `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android` |

Ubuntu's `openjdk-21-jre-headless` has no `javac`, and Gradle stops with
*"does not provide the required capabilities: [JAVA_COMPILER]"*. Any JDK 17+
works; the env script prefers `~/Android/jdk-21` when it has one.

To set it up on a new machine:

```sh
# command-line tools (sdkmanager) into the SDK
mkdir -p ~/Android/Sdk/cmdline-tools && cd ~/Android/Sdk/cmdline-tools
curl -LO https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip commandlinetools-linux-13114758_latest.zip && mv cmdline-tools latest

# a JDK with javac (Temurin 21), if `javac -version` finds none
curl -L "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" | tar -xz -C ~/Android
mv ~/Android/jdk-21* ~/Android/jdk-21

cd <repo>/apps/desktop
yes | sh scripts/android-env.sh sdkmanager --licenses
sh scripts/android-env.sh sdkmanager "ndk;27.2.12479018" "platforms;android-36" "build-tools;35.0.1" "platform-tools" "emulator"
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

### The env script

`apps/desktop/scripts/android-env.sh` sets `ANDROID_HOME`, `NDK_HOME` (pinned
to 27.2.12479018, so a second NDK installed later does not change the build),
`JAVA_HOME` and `PATH` for one shell, and never globally. Source it
(`. scripts/android-env.sh`), or put it in front of one command:

```sh
sh scripts/android-env.sh pnpm exec tauri android build --debug --apk
```

Export any of the variables (or `OHHI_NDK_VERSION`) before it to override it.

## Commands

All of them run in `apps/desktop`, after a web build (`cd apps/web && rushx build`),
because the APK embeds `apps/web/dist`.

```sh
# a debug APK for a phone (arm64)
sh scripts/android-env.sh pnpm exec tauri android build --debug --apk --target aarch64

# for the x86_64 emulator
sh scripts/android-env.sh pnpm exec tauri android build --debug --apk --target x86_64

# every ABI in one APK (what `rushx android:build` runs)
rushx android:build
```

The APK is `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
A debug APK for one ABI is about 130 MB, nearly all of it the Rust library's
debug symbols; a release build strips them.

Gradle downloads itself and its dependencies on the first build
(`~/.gradle`), about two minutes.

### On the emulator

```sh
emulator -list-avds
emulator -avd Medium_Phone_API_36 -no-window -no-audio -gpu swiftshader_indirect &
adb wait-for-device
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n md.ohhi/.MainActivity
adb exec-out screencap -p > shot.png
```

Headless needs KVM (`/dev/kvm` readable by you). `adb logcat | grep -E
'chromium|Tauri|RustStdout'` shows the webview console and the Rust side.

### On a phone

Turn on USB debugging (Settings › About phone, tap *Build number* seven
times; then Developer options › USB debugging), plug it in, and `adb install
-r` the aarch64 APK.

`rushx android:dev` runs `tauri android dev` against the Vite dev server
(start `rushx dev` in `apps/web` first: `beforeDevCommand` is empty, as on the
desktop) and installs a dev build on the connected phone or emulator. Tauri
forwards port 5173 over adb, so `localhost` works on the device. The dev
build's page is `http://localhost:5173`, a different origin from the APK's
`http://tauri.localhost`, so it sees none of the APK's vaults (and the other
way round).

## Identity

The application id is `md.ohhi` (`identifier` in `tauri.conf.json`, the same
on every target), with the app label *Oh hi markdown*. A debug build has the
same id as a store build would: an `applicationIdSuffix ".debug"` in
`app/build.gradle.kts` does not survive, because `tauri android build`
rewrites that file from the config and drops it.

## Known issues

- **A guide replaces the app.** A guide link opens the bundled page in the
  same webview: Android's Back returns to the app, which reloads and reopens
  the vault. No note is lost (every edit is already in storage), but the
  open tabs' scroll positions are.
- **Desktop wording in places.** The welcome, the vault list and Settings
  › About say "this phone"; other places still say "this browser" (Settings
  › Customise, the share and device-link dialogs, Remove's warning), the
  vault row says "this site uses 0 kB", and the new-tab page and navigator
  name keyboard shortcuts (Ctrl+N) a phone does not have.
- **The first tap after hiding the keyboard** with Back can be taken by the
  editor rather than the button under it (seen once on the drawer toggle).
- **Opening Settings from the drawer** leaves the drawer open over it.
- **The emulator image's WebView is old** (128). A phone's WebView updates
  through the Play Store; what was checked here was checked on 128.
- **Debug APKs only.** No release keystore, no store listing; CI
  (`mobile.yml`, [mobile-builds.md](mobile-builds.md)) makes an arm64 debug
  APK on every app push to `main`.
- **`gen/android` is behind the CLI's template.** The project was generated
  by `@tauri-apps/cli` 2.11 (Gradle 8.14.3, AGP 8.11, Kotlin 1.9.25,
  compileSdk 36, `Theme.MaterialComponents`); the 2.12.3 CLI's `tauri android
  init` writes Gradle 9.6.1, AGP 9.3.1, Kotlin 2.2.10, compileSdk 37,
  `Theme.Material3`, the configuration cache, and a `buildSrc` that uses
  `ExecOperations` (Gradle 9 drops `project.exec` at execution time). The
  committed project still builds and runs with the 2.12 CLI (checked
  2026-10-16, Tauri 2.12.4), so it was kept as is. Regenerate it the next time
  the Android project is reworked (release signing is the natural moment):
  move `gen/android` aside, `tauri android init --ci`, then carry over
  `MainActivity.kt`'s inset code, `strings.xml`'s labels, `.gitignore`'s
  `.kotlin/` line and `rushx icon`'s icons, and bump `ANDROID_PLATFORM` in
  `mobile.yml` to the new compileSdk.
