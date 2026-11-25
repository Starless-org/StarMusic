package app.starmusic.desktop

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  /** Once the person answers, the notification is drawn again: it may be allowed now. */
  private val askNotifications =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) {
      NowPlayingCenter.repost(this)
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // The foreground service is not started here: it starts with the music or
    // the login, and goes with them. See `NowPlayingCenter.keepAlive`.
    askForNotifications()
  }

  /**
   * **Declaring `POST_NOTIFICATIONS` in the manifest is not enough from Android
   * 13 on**: a fresh install starts with it denied, and only a dialog shown by
   * the app turns it on. Without it `NowPlayingCenter.post` has nothing to post
   * to, so the song never reached the notification shade or the lock screen —
   * the music played with the screen off and nothing said what it was.
   * Asked once at startup; a "no" is the person's answer and is not asked again
   * by this code (Android itself stops showing the dialog after two refusals).
   */
  private fun askForNotifications() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED
    if (!granted) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
  }

  /** Media keys go to the session's handler, not to the WebView. See `NowPlayingCenter.mediaButton`. */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean =
    NowPlayingCenter.mediaButton(event) || super.dispatchKeyEvent(event)

  override fun onWebViewCreate(webView: WebView) {
    NowPlayingCenter.attach(this, webView)
    webView.addJavascriptInterface(Bridge(), "StarMusicAndroid")
  }

  /** What the page asks of the activity. */
  inner class Bridge {
    /**
     * Going behind the other apps when the back button has nothing left to
     * close (`src/lib/back.ts`). Finishing the activity instead would run
     * `onDestroy`, which stops the service that keeps the music alive — "back"
     * on Home would stop the song.
     */
    @JavascriptInterface
    fun moveToBack() {
      runOnUiThread { moveTaskToBack(true) }
    }

    /**
     * The login opened the browser (`true`) or got its answer back (`false`).
     * While the browser is in front, the callback to `127.0.0.1:8989` needs the
     * network that Android takes from a background app. See `AuthGate.tsx`.
     */
    @JavascriptInterface
    fun holdForLogin(on: Boolean) = NowPlayingCenter.login(this@MainActivity, on)
  }

  override fun onDestroy() {
    NowPlayingCenter.detach()
    stopService(Intent(this, KeepAliveService::class.java))
    super.onDestroy()
  }
}
