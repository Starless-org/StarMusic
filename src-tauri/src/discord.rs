//! "Listening to Star Music" in the person's Discord status, when they allow it.
//!
//! One of the consented integrations (PRODUCT.md): off by default, asked with a
//! dialog, checked here right before every write, and stopped at once when the
//! person takes it back.
//!
//! **Nothing goes over the network from here.** The Discord app on this
//! computer listens on a local named pipe (`\\.\pipe\discord-ipc-0` … `-9`);
//! Star Music writes to that pipe and Discord itself publishes the status. The
//! protocol is a frame —opcode and length as little-endian `u32`, then JSON— and
//! two commands: a handshake with the Application ID, and `SET_ACTIVITY`.
//!
//! **The Application ID is compiled in, and without it there is no
//! integration.** It is created by the maintainer in Discord's developer portal
//! with the name "Star Music"; that name is what Discord shows above the song.
//! The header icon is set in that portal. The activity uses the project's
//! public PNG for its artwork badge. The Application ID is public.
//! A build without it reports the integration as unavailable and Settings does
//! not draw the switch. As with `STAR_MUSIC_REPORT_RELAY`, an Actions variable
//! that does not exist arrives as an empty string, so empty counts as missing.
//!
//! **What it shows is what the Windows media card shows**: the same
//! `NowPlaying` that `media_session` gets, so there is one answer to "what is
//! playing" and not a second path from the webview that could disagree. The
//! progress comes from the position the webview sends, which is the one that is
//! heard (see the crossfade trap in AGENTS.md), and it is taken when the song
//! or the play state changes: a seek inside a song does not move it.
//!
//! **Paused is nothing.** The status is cleared on pause and comes back on
//! play: the dialog promises "while something plays".
//!
//! **No work at startup.** The thread starts the first time there is both a
//! grant and something to show. Discord not running is the normal case for most
//! people, so a failed connection is retried quietly every
//! [`RECONNECT_EVERY`], and only a change of state goes to the log.

use std::sync::Mutex;
use std::sync::mpsc::Sender;

use serde_json::{Value, json};

use crate::consent::{self, Integration};
use crate::media_keys::NowPlaying;

const APP_ID: Option<&str> = option_env!("STAR_MUSIC_DISCORD_APP_ID");

fn app_id() -> Option<&'static str> {
    APP_ID.map(str::trim).filter(|id| !id.is_empty())
}

/// Whether this build can show a Discord status: an Application ID, and a
/// platform where the pipe is written. Windows first, like the rest of the app;
/// Linux and macOS use a Unix socket and are not done yet.
pub fn available() -> bool {
    cfg!(windows) && app_id().is_some()
}

/// A pinned public copy of the icon shipped by this project. Discord accepts
/// external images, so a missing Developer Portal asset does not hide the badge.
const FALLBACK_IMAGE: &str =
    "https://raw.githubusercontent.com/Starless-org/StarMusic/50adffbc3c77e21c7d49203c5fac6293ee624b2d/src-tauri/icons/icon.png";

/// Discord rejects text fields shorter than 2 or longer than 128 characters.
const TEXT_MIN: usize = 2;
const TEXT_MAX: usize = 128;
/// And image URLs longer than 256.
const IMAGE_MAX: usize = 256;

/// Discord allows five `SET_ACTIVITY` every twenty seconds; one every four
/// keeps inside that however fast the person skips. The latest one waits and
/// wins: a skipped song never needs to be shown.
const MIN_GAP: std::time::Duration = std::time::Duration::from_secs(4);
const RECONNECT_EVERY: std::time::Duration = std::time::Duration::from_secs(15);

enum Message {
    Show(Option<NowPlaying>),
    /// The person took the permission back: clear the status and close the pipe.
    Stop,
}

/// Lives in Tauri's state. `last` is kept whether or not the person allowed
/// it, so that a grant shows the song that is already playing instead of
/// waiting for the next one.
#[derive(Default)]
pub struct DiscordState {
    last: Mutex<Option<NowPlaying>>,
    worker: Mutex<Option<Sender<Message>>>,
}

impl DiscordState {
    /// What is playing changed. Forwarded only with a grant: without one there
    /// is not even a thread.
    pub fn update(&self, now: Option<NowPlaying>) {
        if let Ok(mut last) = self.last.lock() {
            *last = now.clone();
        }
        if available() && consent::granted(Integration::DiscordPresence) {
            self.send(Message::Show(now));
        }
    }

    /// The person just allowed it: show what is already playing.
    pub fn granted(&self) {
        let now = self.last.lock().ok().and_then(|last| last.clone());
        self.update(now);
    }

    /// The person took it back. The worker clears the status before closing,
    /// and every write it might still have queued asks for the grant first.
    pub fn stop(&self) {
        if let Ok(worker) = self.worker.lock()
            && let Some(tx) = worker.as_ref()
        {
            let _ = tx.send(Message::Stop);
        }
    }

    fn send(&self, message: Message) {
        let Ok(mut worker) = self.worker.lock() else {
            return;
        };
        if worker.is_none() {
            *worker = spawn();
        }
        if let Some(tx) = worker.as_ref()
            && tx.send(message).is_err()
        {
            // The thread is gone (it never panics on purpose, but a dead
            // channel must not keep swallowing updates).
            *worker = None;
        }
    }
}

#[cfg(windows)]
fn spawn() -> Option<Sender<Message>> {
    let (tx, rx) = std::sync::mpsc::channel();
    match std::thread::Builder::new()
        .name("discord".into())
        .spawn(move || pipe::run(rx))
    {
        Ok(_) => Some(tx),
        Err(e) => {
            log::warn!("discord: no se pudo arrancar el hilo: {e}");
            None
        }
    }
}

#[cfg(not(windows))]
fn spawn() -> Option<Sender<Message>> {
    None
}

/// A text field as Discord accepts it, or `None` to leave the field out.
fn fit(text: &str) -> Option<String> {
    let text = text.trim();
    let count = text.chars().count();
    if count < TEXT_MIN {
        return None;
    }
    if count <= TEXT_MAX {
        return Some(text.to_string());
    }
    // Cut by characters, never bytes: titles are full of accents and a byte
    // cut panics inside a character (the `BODY_LIMIT` trap in AGENTS.md).
    let mut cut: String = text.chars().take(TEXT_MAX - 1).collect();
    cut.push('…');
    Some(cut)
}

/// The activity for what is playing, or `None` when nothing is: nothing
/// loaded, or paused.
fn activity(now: Option<&NowPlaying>, at_ms: i64) -> Option<Value> {
    let now = now.filter(|now| now.playing)?;
    let details = fit(&now.title)?;

    let mut activity = json!({
        // 2 is "Listening to": the status reads "Listening to Star Music".
        "type": 2,
        "details": details,
    });
    if let Some(state) = fit(&now.artist) {
        activity["state"] = json!(state);
    }

    let image = now
        .artwork
        .as_deref()
        .filter(|url| url.starts_with("https://") && url.len() <= IMAGE_MAX)
        .unwrap_or(FALLBACK_IMAGE);
    activity["assets"] = json!({ "large_image": image });
    if image != FALLBACK_IMAGE {
        activity["assets"]["small_image"] = json!(FALLBACK_IMAGE);
        activity["assets"]["small_text"] = json!(crate::paths::APP_DIR);
    }
    if let Some(album) = fit(&now.album) {
        activity["assets"]["large_text"] = json!(album);
    }

    // The DJ has no duration, and a bar with no end is worse than no bar.
    if now.duration_ms > 0.0 {
        let start = at_ms - now.position_ms.max(0.0) as i64;
        activity["timestamps"] = json!({ "start": start, "end": start + now.duration_ms as i64 });
    }
    Some(activity)
}

/// One frame of the pipe protocol.
fn frame(opcode: u32, payload: &Value) -> Vec<u8> {
    let body = payload.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&opcode.to_le_bytes());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

fn set_activity(activity: Option<Value>, nonce: u64) -> Value {
    json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": activity },
        "nonce": nonce.to_string(),
    })
}

#[cfg(windows)]
mod pipe {
    use std::fs::File;
    use std::io::{Read, Write};
    use std::sync::mpsc::{Receiver, RecvTimeoutError};
    use std::time::{Duration, Instant};

    use serde_json::{Value, json};

    use super::{MIN_GAP, Message, RECONNECT_EVERY, activity, app_id, frame, set_activity};
    use crate::consent::{self, Integration};

    const HANDSHAKE: u32 = 0;
    const FRAME: u32 = 1;
    const CLOSE: u32 = 2;
    /// A reply is a few hundred bytes; anything this big is not Discord.
    const REPLY_MAX: usize = 64 * 1024;

    struct Pipe {
        file: File,
        nonce: u64,
    }

    impl Pipe {
        fn open() -> Option<Pipe> {
            let id = app_id()?;
            let file = (0..10).find_map(|i| {
                std::fs::OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(format!(r"\\.\pipe\discord-ipc-{i}"))
                    .ok()
            })?;
            let mut pipe = Pipe { file, nonce: 0 };
            pipe.write(HANDSHAKE, &json!({ "v": 1, "client_id": id }))
                .ok()?;
            match pipe.read() {
                Ok((FRAME, _)) => Some(pipe),
                Ok((CLOSE, reply)) => {
                    // A wrong or deleted Application ID: Discord says why.
                    log::warn!("discord: rechazó la conexión: {reply}");
                    None
                }
                _ => None,
            }
        }

        fn write(&mut self, opcode: u32, payload: &Value) -> std::io::Result<()> {
            self.file.write_all(&frame(opcode, payload))?;
            self.file.flush()
        }

        /// Every command gets a reply, and an unread reply fills the pipe:
        /// each write is followed by its read.
        fn read(&mut self) -> std::io::Result<(u32, Value)> {
            let mut header = [0u8; 8];
            self.file.read_exact(&mut header)?;
            let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
            let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
            if len > REPLY_MAX {
                return Err(std::io::Error::other("respuesta demasiado grande"));
            }
            let mut body = vec![0u8; len];
            self.file.read_exact(&mut body)?;
            Ok((opcode, serde_json::from_slice(&body).unwrap_or(Value::Null)))
        }

        fn set(&mut self, activity: Option<Value>) -> std::io::Result<()> {
            self.nonce += 1;
            self.write(FRAME, &set_activity(activity, self.nonce))?;
            let (opcode, reply) = self.read()?;
            if opcode == CLOSE {
                return Err(std::io::Error::other(reply.to_string()));
            }
            if reply.get("evt").and_then(Value::as_str) == Some("ERROR") {
                // Discord refused this activity (a field it did not like). The
                // pipe is fine; the next song gets another chance.
                log::warn!("discord: no aceptó el estado: {}", reply["data"]);
            }
            Ok(())
        }
    }

    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    pub(super) fn run(rx: Receiver<Message>) {
        let mut pipe: Option<Pipe> = None;
        // What should be on the status, and whether Discord has it yet.
        let mut wanted: Option<Value> = None;
        let mut dirty = false;
        let mut last_sent: Option<Instant> = None;
        let mut next_connect = Instant::now();

        loop {
            let wait = if !dirty {
                Duration::from_secs(3600)
            } else {
                let throttle = last_sent
                    .map(|at| (at + MIN_GAP).saturating_duration_since(Instant::now()))
                    .unwrap_or_default();
                let reconnect = if pipe.is_none() {
                    next_connect.saturating_duration_since(Instant::now())
                } else {
                    Duration::ZERO
                };
                throttle.max(reconnect)
            };

            match rx.recv_timeout(wait) {
                Ok(Message::Show(now)) => {
                    wanted = activity(now.as_ref(), now_ms());
                    dirty = true;
                    continue_if_more(&rx, &mut wanted, &mut dirty, &mut pipe);
                }
                Ok(Message::Stop) => {
                    if let Some(mut open) = pipe.take() {
                        // Clearing removes data, it does not send any: no grant
                        // needed, and it is the whole point of the stop.
                        let _ = open.set(None);
                        log::info!("discord: estado borrado, permiso retirado");
                    }
                    wanted = None;
                    dirty = false;
                    continue;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }

            if !dirty {
                continue;
            }
            if last_sent.is_some_and(|at| at.elapsed() < MIN_GAP) {
                continue;
            }
            // The gate, where the byte leaves (AGENTS.md).
            if !consent::granted(Integration::DiscordPresence) {
                if let Some(mut open) = pipe.take() {
                    let _ = open.set(None);
                }
                wanted = None;
                dirty = false;
                continue;
            }
            if pipe.is_none() {
                if wanted.is_none() {
                    // Nothing to show and nobody listening: Discord already
                    // shows nothing.
                    dirty = false;
                    continue;
                }
                if Instant::now() < next_connect {
                    continue;
                }
                pipe = Pipe::open();
                if pipe.is_some() {
                    log::info!("discord: conectado");
                } else {
                    next_connect = Instant::now() + RECONNECT_EVERY;
                    continue;
                }
            }
            if let Some(open) = pipe.as_mut() {
                match open.set(wanted.clone()) {
                    Ok(()) => {
                        dirty = false;
                        last_sent = Some(Instant::now());
                    }
                    Err(e) => {
                        // Discord closed: retry on the next round, the status
                        // still wanted.
                        log::info!("discord: se cerró la conexión: {e}");
                        pipe = None;
                        next_connect = Instant::now() + RECONNECT_EVERY;
                    }
                }
            }
        }
    }

    /// Take whatever else is already waiting before writing: a burst of skips
    /// is one status, the last one.
    fn continue_if_more(
        rx: &Receiver<Message>,
        wanted: &mut Option<Value>,
        dirty: &mut bool,
        pipe: &mut Option<Pipe>,
    ) {
        while let Ok(message) = rx.try_recv() {
            match message {
                Message::Show(now) => {
                    *wanted = activity(now.as_ref(), now_ms());
                    *dirty = true;
                }
                Message::Stop => {
                    if let Some(mut open) = pipe.take() {
                        let _ = open.set(None);
                    }
                    *wanted = None;
                    *dirty = false;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song() -> NowPlaying {
        NowPlaying {
            title: "Duvet".into(),
            artist: "bôa".into(),
            album: "Twilight".into(),
            artwork: Some("https://i.scdn.co/image/abc".into()),
            playing: true,
            position_ms: 30_000.0,
            duration_ms: 200_000.0,
        }
    }

    #[test]
    fn a_frame_is_opcode_length_and_json() {
        let bytes = frame(1, &json!({ "a": 1 }));
        assert_eq!(&bytes[..4], &1u32.to_le_bytes());
        assert_eq!(&bytes[4..8], &7u32.to_le_bytes());
        assert_eq!(&bytes[8..], br#"{"a":1}"#);
    }

    #[test]
    fn the_activity_says_what_the_media_card_says() {
        let activity = activity(Some(&song()), 1_000_000).unwrap();
        assert_eq!(activity["type"], 2);
        assert_eq!(activity["details"], "Duvet");
        assert_eq!(activity["state"], "bôa");
        assert_eq!(
            activity["assets"]["large_image"],
            "https://i.scdn.co/image/abc"
        );
        assert_eq!(activity["assets"]["large_text"], "Twilight");
        assert_eq!(activity["timestamps"]["start"], 970_000);
        assert_eq!(activity["timestamps"]["end"], 1_170_000);
    }

    /// The dialog promises "while something plays".
    #[test]
    fn paused_or_nothing_clears_the_status() {
        let mut paused = song();
        paused.playing = false;
        assert!(activity(Some(&paused), 0).is_none());
        assert!(activity(None, 0).is_none());
    }

    /// The DJ talking: a name, no artist, no cover, no length.
    #[test]
    fn the_dj_shows_without_a_bar() {
        let dj = NowPlaying {
            title: "DJ".into(),
            artist: String::new(),
            album: String::new(),
            artwork: None,
            playing: true,
            position_ms: 0.0,
            duration_ms: 0.0,
        };
        let activity = activity(Some(&dj), 0).unwrap();
        assert!(activity.get("state").is_none());
        assert!(activity.get("timestamps").is_none());
        assert_eq!(activity["assets"]["large_image"], FALLBACK_IMAGE);
        assert!(activity["assets"].get("large_text").is_none());
    }

    /// Accented titles are the norm here: the cut is by characters.
    #[test]
    fn a_long_title_is_cut_without_splitting_a_character() {
        let long = "é".repeat(300);
        let cut = fit(&long).unwrap();
        assert_eq!(cut.chars().count(), TEXT_MAX);
        assert!(cut.ends_with('…'));
        assert_eq!(fit(" a "), None);
    }

    #[test]
    fn a_cover_discord_would_refuse_falls_back_to_the_icon() {
        let mut long = song();
        long.artwork = Some(format!("https://{}", "a".repeat(300)));
        assert_eq!(
            activity(Some(&long), 0).unwrap()["assets"]["large_image"],
            FALLBACK_IMAGE
        );
        let mut plain = song();
        plain.artwork = Some("http://insecure".into());
        assert_eq!(
            activity(Some(&plain), 0).unwrap()["assets"]["large_image"],
            FALLBACK_IMAGE
        );
    }

    /// The webview sends camelCase, as it always has for the phone; a rename
    /// that missed would leave every song without a progress bar, silently.
    #[test]
    fn the_position_arrives_from_the_webview() {
        let now: NowPlaying = serde_json::from_value(json!({
            "title": "Duvet", "artist": "bôa", "album": "Twilight", "artwork": null,
            "playing": true, "loading": false, "seekable": true,
            "positionMs": 1500.5, "durationMs": 200000
        }))
        .unwrap();
        assert_eq!(now.position_ms, 1500.5);
        assert_eq!(now.duration_ms, 200_000.0);
    }

    #[test]
    fn an_empty_app_id_is_no_app_id() {
        assert_eq!(Some("").map(str::trim).filter(|id| !id.is_empty()), None);
    }

    #[test]
    fn the_app_icon_is_a_badge_over_the_original_album_cover() {
        let rendered = activity(Some(&song()), 0).unwrap();
        assert_eq!(
            rendered["assets"]["large_image"],
            "https://i.scdn.co/image/abc"
        );
        assert_eq!(rendered["assets"]["small_image"], FALLBACK_IMAGE);
        assert_eq!(rendered["assets"]["small_text"], crate::paths::APP_DIR);
        let mut without_cover = song();
        without_cover.artwork = None;
        let fallback = activity(Some(&without_cover), 0).unwrap();
        assert_eq!(fallback["assets"]["large_image"], FALLBACK_IMAGE);
        assert!(fallback["assets"].get("small_image").is_none());
    }
}
