package app.starmusic.desktop

import android.app.Notification
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.KeyEvent
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.media.AudioAttributesCompat
import androidx.media.AudioFocusRequestCompat
import androidx.media.AudioManagerCompat
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * What Android shows of the music outside the app: the lock screen, the media
 * notification, the headset buttons — and the wake lock that lets the next
 * song load with the screen off.
 *
 * **The page decides, Kotlin only shows.** What is playing comes from the
 * page through `MainActivity`'s bridge (`mediaSession` in `src/lib/spotify.ts`,
 * the same answer Windows' media card gets), and a press on the lock screen
 * goes back to the page as a media key: what "next" means —the queue, the DJ,
 * the radio— lives in `App.tsx`, and a second copy of it here would drift.
 *
 * **The wake lock is the bug it fixes.** With the screen off Android suspends
 * the processor whenever nothing holds it awake, and the audio output only
 * holds it while it plays. A song ends, the output goes quiet, and the phone
 * fell asleep between "the song ended" and "the next one arrived": the next
 * song stayed loading until somebody woke the screen. The lock is held while
 * something plays or loads, and kept for a while after — the end of a song
 * reports "not playing" a moment before the page asks for the next one.
 *
 * **Android expects a music app to share the speaker, and the app has to say
 * so itself.** Nothing in librespot's output asks for the audio focus, so a
 * phone call or another app's video played on top of the song. The session
 * asks for it when something starts playing, pauses on a loss and comes back
 * after a short one (a call, a navigation prompt). And when the headphones go
 * —a cable pulled, a Bluetooth headset switched off— Android announces that
 * the sound is about to move to the speaker (`ACTION_AUDIO_BECOMING_NOISY`):
 * the music pauses there, instead of following the person out loud.
 */
object NowPlayingCenter {
  const val CHANNEL = "playback"
  const val NOTIFICATION_ID = 1

  /** How long the processor stays awake after the music stops saying it plays. */
  private const val LINGER_MS = 30_000L
  /** A ceiling in case nothing ever says stop; every change of song renews it. */
  private const val HOLD_MS = 60 * 60 * 1000L

  private data class Now(
    val title: String,
    val artist: String,
    val album: String,
    val artwork: String?,
    val playing: Boolean,
    val loading: Boolean,
    val positionMs: Long,
    val durationMs: Long,
    /** Off while the DJ talks: a voice has no bar to drag. */
    val seekable: Boolean,
  )

  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private var session: MediaSessionCompat? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var webView: WebView? = null
  private var now: Now? = null
  private var artUrl: String? = null
  private var art: Bitmap? = null
  private val release = Runnable { wakeLock?.takeIf { it.isHeld }?.release() }

  private var audio: AudioManager? = null
  private var focusRequest: AudioFocusRequestCompat? = null
  /** Held from the first play until the music stops for good or someone else takes it. */
  private var focused = false
  /** A short loss paused the music, so getting the focus back resumes it. */
  private var resumeOnGain = false

  private val onFocus = AudioManager.OnAudioFocusChangeListener { change ->
    when (change) {
      AudioManager.AUDIOFOCUS_LOSS -> {
        // Someone else's music: it is theirs now, and nothing brings ours back.
        focused = false
        resumeOnGain = false
        if (now?.playing == true) key("pause")
      }
      AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
        // A call or a voice prompt: pause, and pick it up when it ends.
        if (now?.playing == true) {
          resumeOnGain = true
          key("pause")
        }
      }
      AudioManager.AUDIOFOCUS_GAIN -> {
        if (resumeOnGain && now?.playing == false) key("play")
        resumeOnGain = false
      }
      // CAN_DUCK: Android lowers a media stream by itself from 8.0 on.
    }
  }

  /** The headphones are gone and the sound is about to come out of the speaker. */
  private val noisy = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action != AudioManager.ACTION_AUDIO_BECOMING_NOISY) return
      resumeOnGain = false
      if (now?.playing == true) key("pause")
    }
  }
  /** Where the receiver was registered, to unregister it from the same place. */
  private var noisyIn: Context? = null

  /** What the page calls, as `window.StarMusicMedia`. */
  private class Bridge(private val context: Context) {
    /** `NowPlaying` as JSON, or "null". See `mediaSession` in `src/lib/spotify.ts`. */
    @JavascriptInterface
    fun nowPlaying(json: String) = update(context, json)
  }

  fun attach(context: Context, view: WebView) {
    webView = view
    view.addJavascriptInterface(Bridge(context.applicationContext), "StarMusicMedia")
    if (session != null) return
    val app = context.applicationContext
    session = MediaSessionCompat(app, "Star Music").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = key("play")
        override fun onPause() = key("pause")
        override fun onSkipToNext() = key("next")
        override fun onSkipToPrevious() = key("previous")
        override fun onSeekTo(pos: Long) = seek(pos)
      })
    }
    wakeLock = app.getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Star Music:playback")
      .apply { setReferenceCounted(false) }
    audio = app.getSystemService(AudioManager::class.java)
    focusRequest = AudioFocusRequestCompat.Builder(AudioManagerCompat.AUDIOFOCUS_GAIN)
      .setAudioAttributes(
        AudioAttributesCompat.Builder()
          .setUsage(AudioAttributesCompat.USAGE_MEDIA)
          .setContentType(AudioAttributesCompat.CONTENT_TYPE_MUSIC)
          .build()
      )
      .setOnAudioFocusChangeListener(onFocus, main)
      .build()
    // A system broadcast still arrives with NOT_EXPORTED; what that flag closes
    // is the door to other apps sending a fake one.
    ContextCompat.registerReceiver(
      app,
      noisy,
      IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    noisyIn = app
  }

  fun detach() {
    main.removeCallbacks(release)
    release.run()
    abandonFocus()
    noisyIn?.let { runCatching { it.unregisterReceiver(noisy) } }
    noisyIn = null
    session?.run {
      isActive = false
      release()
    }
    session = null
    webView = null
  }

  /**
   * A media key that reached the activity instead of the session.
   *
   * **With the app on screen, Android gives the keys to the focused window**,
   * and the focused window is the WebView, which swallows them: a headset's
   * play/pause did nothing while the app was open, and worked the moment it
   * was not. The activity hands them here first. Both halves of the press
   * are consumed, and only the first `down` acts.
   */
  fun mediaButton(event: KeyEvent): Boolean {
    val name = when (event.keyCode) {
      KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
      KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
      KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_HEADSETHOOK ->
        if (now?.playing == true) "pause" else "play"
      KeyEvent.KEYCODE_MEDIA_NEXT -> "next"
      KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "previous"
      else -> return false
    }
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) key(name)
    return true
  }

  /** A button outside the app: handed to the page as the media key it is. */
  fun key(name: String, positionMs: Long? = null) {
    val view = webView ?: return
    val args = if (positionMs == null) "'$name'" else "'$name',$positionMs"
    main.post {
      view.evaluateJavascript("window.__starMusicMediaKey&&window.__starMusicMediaKey($args)", null)
    }
  }

  /**
   * The bar on the lock screen or in the notification was dragged.
   *
   * The page does the seek, like the bar inside the app. But the session's own
   * state moves right away: until the page's answer arrives, the lock screen
   * would draw the bar back where it was, under the person's finger.
   */
  private fun seek(positionMs: Long) {
    val n = now ?: return
    if (!n.seekable) return
    val at = positionMs.coerceIn(0, n.durationMs)
    now = n.copy(positionMs = at)
    session?.setPlaybackState(state(now!!))
    key("seek", at)
  }

  /** Draws the notification again, e.g. after the person allowed notifications. */
  fun repost(context: Context) {
    val app = context.applicationContext
    main.post { post(app) }
  }

  private fun requestFocus() {
    if (focused) return
    val request = focusRequest ?: return
    val manager = audio ?: return
    focused = AudioManagerCompat.requestAudioFocus(manager, request) ==
      AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    // Refused only while a call is on: the music has no place there.
    if (!focused) key("pause")
  }

  private fun abandonFocus() {
    resumeOnGain = false
    if (!focused) return
    focused = false
    val request = focusRequest ?: return
    audio?.let { AudioManagerCompat.abandonAudioFocusRequest(it, request) }
  }

  /** From the bridge, on the WebView's thread: `NowPlaying` as JSON, or "null". */
  fun update(context: Context, json: String) {
    val parsed = parse(json)
    val app = context.applicationContext
    main.post { show(app, parsed) }
  }

  private fun parse(json: String): Now? {
    if (json == "null") return null
    return runCatching {
      val o = JSONObject(json)
      Now(
        title = o.optString("title"),
        artist = o.optString("artist"),
        album = o.optString("album"),
        artwork = if (o.isNull("artwork")) null else o.optString("artwork"),
        playing = o.optBoolean("playing"),
        loading = o.optBoolean("loading"),
        positionMs = o.optLong("positionMs"),
        durationMs = o.optLong("durationMs"),
        seekable = o.optBoolean("seekable") && o.optLong("durationMs") > 0,
      )
    }.getOrNull()
  }

  private fun show(context: Context, next: Now?) {
    now = next
    val session = session ?: return
    if (next == null) {
      session.isActive = false
      abandonFocus()
      awake(false)
      post(context)
      return
    }

    // A pause keeps the focus: the person may press play again in a minute,
    // and giving it up would let any notification sound take it. It goes when
    // nothing is left to play, or when another app takes it.
    if (next.playing) {
      resumeOnGain = false
      requestFocus()
    }
    session.setPlaybackState(state(next))
    session.isActive = true
    awake(next.playing || next.loading)

    if (next.artwork != artUrl) {
      artUrl = next.artwork
      art = null
      next.artwork?.let { url ->
        io.execute {
          val bitmap = runCatching { URL(url).openStream().use(BitmapFactory::decodeStream) }.getOrNull()
          main.post {
            if (artUrl != url) return@post
            art = bitmap
            metadata()
            post(context)
          }
        }
      }
    }
    metadata()
    post(context)
  }

  private fun state(n: Now): PlaybackStateCompat {
    var actions = PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
      PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
      PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
    // Without it the lock screen still draws the bar, but only to look at:
    // a finger on it does nothing.
    if (n.seekable) actions = actions or PlaybackStateCompat.ACTION_SEEK_TO
    return PlaybackStateCompat.Builder()
      .setActions(actions)
      .setState(
        when {
          n.playing -> PlaybackStateCompat.STATE_PLAYING
          n.loading -> PlaybackStateCompat.STATE_BUFFERING
          else -> PlaybackStateCompat.STATE_PAUSED
        },
        n.positionMs,
        if (n.playing) 1f else 0f,
        SystemClock.elapsedRealtime(),
      )
      .build()
  }

  private fun metadata() {
    val n = now ?: return
    session?.setMetadata(
      MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, n.title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, n.artist)
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, n.album)
        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, n.durationMs)
        .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art)
        .build()
    )
  }

  private fun awake(on: Boolean) {
    main.removeCallbacks(release)
    if (on) wakeLock?.acquire(HOLD_MS) else main.postDelayed(release, LINGER_MS)
  }

  /** Replaces the keep-alive notification: it is the same one, now with the song. */
  private fun post(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    runCatching { manager.notify(NOTIFICATION_ID, notification(context)) }
  }

  fun notification(context: Context): Notification {
    val open = PendingIntent.getActivity(
      context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
    )
    val builder = NotificationCompat.Builder(context, CHANNEL)
      // The mark without its plate: the status bar draws only the shape.
      .setSmallIcon(R.mipmap.ic_launcher_foreground)
      .setContentIntent(open)
      .setOngoing(true)
      .setSilent(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
    val n = now
    val token = session?.sessionToken
    if (n == null || token == null) {
      return builder
        .setContentTitle(context.getString(R.string.app_name))
        .setContentText(context.getString(R.string.keepalive_text))
        .build()
    }
    return builder
      .setContentTitle(n.title)
      .setContentText(n.artist)
      .setLargeIcon(art)
      .addAction(
        android.R.drawable.ic_media_previous,
        context.getString(R.string.media_previous),
        action(context, "previous", 1),
      )
      .addAction(
        if (n.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
        context.getString(if (n.playing) R.string.media_pause else R.string.media_play),
        action(context, if (n.playing) "pause" else "play", 2),
      )
      .addAction(
        android.R.drawable.ic_media_next,
        context.getString(R.string.media_next),
        action(context, "next", 3),
      )
      .setStyle(
        androidx.media.app.NotificationCompat.MediaStyle()
          .setMediaSession(token)
          .setShowActionsInCompactView(0, 1, 2)
      )
      .build()
  }

  /**
   * The notification's buttons, for the Android versions that still draw them
   * (before 13 the controls are the notification's; from 13 they come from the
   * session, and these go unused).
   */
  private fun action(context: Context, key: String, code: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      code,
      Intent(context, MediaActionReceiver::class.java).putExtra("key", key),
      PendingIntent.FLAG_IMMUTABLE,
    )
}

/** The notification's buttons arrive here and go to the page as media keys. */
class MediaActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    intent.getStringExtra("key")?.let(NowPlayingCenter::key)
  }
}
