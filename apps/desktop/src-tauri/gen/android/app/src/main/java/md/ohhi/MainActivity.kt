package md.ohhi

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    keepWebviewInsideTheSafeArea()
  }

  /**
   * Android 15+ draws every app edge to edge (targetSdk 35+), so the webview
   * would sit under the status bar, the navigation bar and the keyboard, and
   * the Android System WebView does not report those as CSS
   * `env(safe-area-inset-*)`. Pad the content view by the system bars, the
   * display cutout and the keyboard instead: the page lays out in what is
   * left, and a note being typed stays above the keyboard
   * (docs/mobile-android.md).
   */
  private fun keepWebviewInsideTheSafeArea() {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val safe = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
