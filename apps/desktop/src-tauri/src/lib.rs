#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_webkit_renderer();
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
