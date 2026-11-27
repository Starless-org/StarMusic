//! Lo que se le manda a Spotify para que una canción escuchada acá cuente en
//! la cuenta: el formato, sin red. La red vive en `spclient::report_play`.
//!
//! Son **dos pedidos por canción**, y los dos hacen falta:
//!
//! - `POST /gabo-receiver-service/v3/events/` con un `PublishEventsRequest`
//!   (`gabito.proto`): el evento `RawCoreStream` —qué sonó, desde dónde, cuánto
//!   de verdad— envuelto en los contextos del cliente. Es lo que cuentan los
//!   minutos y las estadísticas.
//! - `POST /herodotus/spotify.resumption.v1.ResumePointRevisionService/CreateResumePointRevision`
//!   con la entrada de `spotify:list:play-history:v1`: es lo que lee
//!   «Reproducido recientemente» en los otros dispositivos.
//!
//! **De dónde salió, y qué no es adivinar** (detalle en
//! `docs/reportar-reproducciones.md`): los números de campo son los de los
//! protos que librespot 0.8 trae extraídos del cliente oficial y no compila
//! (`RawCoreStream.proto`, `gabito.proto`, `context_*.proto`,
//! `audio_files_extension.proto`), más los campos nuevos de `RawCoreStream` del
//! cliente 1.2.96. La receta la midieron dos proyectos contra una cuenta real:
//! librespot#1759 y materialfy#54. Lo que los dos encontraron es lo que decide
//! si la canción llega a la historia, y por eso está fijado acá:
//!
//! - **El `audio_id` del archivo** (`AudioFilesExtensionResponse`, campo 4,
//!   pedido como metadata extendida `AUDIO_FILES`), en hexadecimal. Sin él, el
//!   servicio acepta el evento y no lo guarda.
//! - **La versión del cliente de escritorio** en los contextos (`1.2.96.518`).
//!   Con la de librespot (`1.2.52`) pasa lo mismo: `200`, y nada en la historia.
//!
//! **El precio, escrito para que nadie lo descubra después:** el evento
//! describe al cliente como el de escritorio. Es la razón por la que librespot
//! no lo hace, y es la razón por la que esto es una integración con permiso,
//! apagada por defecto (PRODUCT.md). Si Spotify empieza a filtrar por otra
//! cosa, los reportes dejan de contar en silencio y la app no se rompe.

use protobuf::CodedOutputStream;

/// La versión del cliente de escritorio que el servicio de historia acepta.
/// Medido por librespot#1759 con la 1.2.96.518; separada de la que anuncia la
/// sesión (`vendor/librespot-core/src/version.rs`) porque son dos preguntas.
pub const REPORTING_VERSION: &str = "1.2.96.518";
pub const REPORTING_VERSION_CODE: i64 = 129_600_518;
const REPORTING_CORE_VERSION: i64 = 6_005_400_000_002_005;
/// La versión del SDK de eventos, como la escribe el cliente de escritorio.
const SDK_VERSION: &str =
    "0.9.4-rl-essopt-loginsend-onlinesend-bcdsend-heartbeat300.0s/30.0s-modern-payload125kB-batch100";

pub const EVENTS_PATH: &str = "/gabo-receiver-service/v3/events/";
pub const HISTORY_PATH: &str =
    "/herodotus/spotify.resumption.v1.ResumePointRevisionService/CreateResumePointRevision";
const PLAY_HISTORY: &str = "spotify:list:play-history:v1";

/// Una canción escuchada en esta computadora, como la mide el historial
/// local (`history::Play`): tiempo con la música sonando, sin pausas.
#[derive(Debug, Clone, PartialEq)]
pub struct Heard {
    /// `spotify:track:…`
    pub uri: String,
    /// `spotify:playlist:…`, `spotify:user:…:collection`, o vacío.
    pub context_uri: String,
    pub ms_played: i64,
    /// Milisegundos desde la época.
    pub started_ms: i64,
    pub ended_ms: i64,
    /// Duración de la canción; 0 si no se sabe.
    pub duration_ms: i64,
}

impl Heard {
    /// Terminó sola o la cortaron. A tres segundos del final cuenta como
    /// terminada: el crossfade y el redondeo se comen eso.
    pub fn finished(&self) -> bool {
        self.duration_ms > 0 && self.ms_played >= self.duration_ms - 3_000
    }

    fn reason_end(&self) -> &'static str {
        if self.finished() { "trackdone" } else { "endplay" }
    }

    fn context(&self) -> &str {
        if self.context_uri.is_empty() { &self.uri } else { &self.context_uri }
    }
}

/// El archivo que sonó: su id (20 bytes), cómo se llama su formato y el
/// `audio_id` que la historia exige.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Audio {
    pub file_id: Vec<u8>,
    pub format: String,
    pub audio_id: Vec<u8>,
}

/// Lo que es de esta ejecución de la app y no de una canción.
pub struct Run {
    /// 20 bytes al azar: el cliente de escritorio numera sus eventos dentro de
    /// una secuencia, y la secuencia es de la ejecución.
    pub sequence_id: [u8; 20],
    pub app_session: [u8; 16],
}

/// Quién manda: lo que la sesión sabe de sí misma.
pub struct Client<'a> {
    /// Hexadecimal, como lo da `Session::client_id`.
    pub client_id: &'a str,
    pub device_id: &'a str,
}

fn encode(write: impl FnOnce(&mut CodedOutputStream) -> protobuf::Result<()>) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut stream = CodedOutputStream::vec(&mut out);
        // Escribir en un `Vec` no falla.
        let _ = write(&mut stream).and_then(|()| stream.flush());
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len() / 2)
        .filter_map(|i| u8::from_str_radix(text.get(i * 2..i * 2 + 2)?, 16).ok())
        .collect()
}

/// El tipo de contexto, como lo escribe el cliente: `playlist`, `collection`,
/// `track`…
fn source(uri: &str) -> &str {
    if uri.starts_with("spotify:user:") && uri.ends_with(":collection") {
        return "collection";
    }
    uri.split(':').nth(1).unwrap_or("unknown")
}

/// `RawCoreStream`, con los números de campo del cliente 1.2.96.
pub fn raw_core_stream(heard: &Heard, audio: &Audio, playback_id: &[u8; 16], app_session: &[u8; 16]) -> Vec<u8> {
    let context = heard.context();
    let played = heard.ms_played.clamp(0, i64::from(i32::MAX)) as i32;
    encode(|out| {
        out.write_bytes(1, playback_id)?;
        out.write_bytes(2, &[0; 16])?;
        out.write_string(3, "")?;
        if !audio.file_id.is_empty() {
            out.write_bytes(4, &audio.file_id)?;
        }
        out.write_string(5, "audio")?;
        out.write_string(9, source(context))?;
        out.write_string(10, "clickrow")?;
        out.write_string(11, source(context))?;
        out.write_string(12, heard.reason_end())?;
        out.write_int64(13, heard.started_ms)?;
        out.write_int32(14, played)?;
        out.write_int32(15, played)?;
        for field in [16, 17, 19, 40, 46, 50, 51, 67] {
            out.write_int32(field, 0)?;
        }
        out.write_bool(20, false)?;
        if !audio.format.is_empty() {
            out.write_string(22, &audio.format)?;
        }
        out.write_string(23, context)?;
        out.write_string(24, &heard.uri)?;
        out.write_string(25, "")?;
        out.write_bool(26, false)?;
        out.write_bool(27, false)?;
        out.write_string(28, "context")?;
        out.write_string(29, "unknown")?;
        out.write_string(32, "none")?;
        out.write_int64(37, REPORTING_CORE_VERSION)?;
        out.write_string(38, "full")?;
        out.write_bool(39, true)?;
        out.write_bool(42, false)?;
        out.write_bool(43, false)?;
        out.write_string(44, "local")?;
        out.write_string(45, "boombox")?;
        out.write_bytes(53, &rand::random::<[u8; 16]>())?;
        out.write_int64(56, heard.ended_ms)?;
        out.write_string(59, &hex(app_session))?;
        if !audio.audio_id.is_empty() {
            out.write_bytes(63, hex(&audio.audio_id).as_bytes())?;
        }
        out.write_string(69, "boombox")?;
        out.write_string(71, "context-player")?;
        out.write_string(78, "Star Music")?;
        out.write_string(79, "Star Music")?;
        out.write_string(80, "computer")
    })
}

fn fragment(name: &str, data: &[u8]) -> Vec<u8> {
    encode(|out| {
        out.write_string(1, name)?;
        out.write_bytes(2, data)
    })
}

fn platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "osx",
        _ => "linux",
    }
}

/// Un `EventEnvelope` con los contextos que manda el cliente de escritorio.
fn envelope(client: &Client, run: &Run, sequence: i64, name: &str, message: &[u8], at_ms: i64, clock_ms: i64) -> Vec<u8> {
    let installation: Vec<u8> = unhex(client.device_id).into_iter().take(16).collect();
    let fragments = [
        fragment("message", message),
        fragment("context_client_id", &encode(|out| out.write_bytes(1, &unhex(client.client_id)))),
        fragment("context_installation_id", &encode(|out| out.write_bytes(1, &installation))),
        fragment(
            "context_application_desktop",
            &encode(|out| {
                out.write_string(1, REPORTING_VERSION)?;
                out.write_int64(2, REPORTING_VERSION_CODE)?;
                out.write_bytes(3, &run.app_session)
            }),
        ),
        fragment(
            "context_device_desktop",
            &encode(|out| {
                out.write_string(1, platform())?;
                out.write_string(4, client.device_id)
            }),
        ),
        fragment("context_time", &encode(|out| out.write_int64(1, at_ms))),
        fragment(
            "context_monotonic_clock",
            &encode(|out| {
                out.write_int64(1, 1)?;
                out.write_int64(2, clock_ms)
            }),
        ),
        fragment(
            "context_sdk",
            &encode(|out| {
                out.write_string(1, SDK_VERSION)?;
                out.write_string(2, "cpp")
            }),
        ),
        fragment("context_client_context_id", &[]),
    ];
    encode(|out| {
        out.write_string(2, name)?;
        for fragment in &fragments {
            out.write_bytes(3, fragment)?;
        }
        out.write_bytes(4, &run.sequence_id)?;
        out.write_int64(5, sequence)
    })
}

/// El cuerpo de `EVENTS_PATH`: un `PublishEventsRequest` con un evento.
pub fn publish_request(client: &Client, run: &Run, sequence: i64, heard: &Heard, audio: &Audio, clock_ms: i64) -> Vec<u8> {
    let playback_id: [u8; 16] = rand::random();
    let message = raw_core_stream(heard, audio, &playback_id, &run.app_session);
    let event = envelope(client, run, sequence, "RawCoreStream", &message, heard.ended_ms, clock_ms);
    encode(|out| out.write_bytes(1, &event))
}

/// El cuerpo de `HISTORY_PATH`: la canción y cuándo empezó, en la lista de la
/// historia. El usuario lo saca el servicio del token.
pub fn history_request(heard: &Heard) -> Vec<u8> {
    let snapshot = encode(|out| out.write_string(6, &heard.uri));
    let time = encode(|out| {
        out.write_int64(1, heard.started_ms.div_euclid(1000))?;
        out.write_int32(2, (heard.started_ms.rem_euclid(1000) * 1_000_000) as i32)
    });
    let revision = encode(|out| {
        out.write_bytes(2, &snapshot)?;
        out.write_bytes(3, &time)
    });
    encode(|out| {
        out.write_string(2, PLAY_HISTORY)?;
        out.write_bytes(4, &revision)
    })
}

/// Recorre un mensaje campo por campo: `(número, tipo, valor)`. Los varints
/// vuelven como sus bytes en little-endian. Lo usan la lectura de respuestas y
/// los tests.
fn fields(message: &[u8]) -> Vec<(u32, u32, Vec<u8>)> {
    let mut input = protobuf::CodedInputStream::from_bytes(message);
    let mut out = Vec::new();
    while let Ok(Some(tag)) = input.read_raw_tag_or_eof() {
        let value = match tag & 7 {
            0 => match input.read_raw_varint64() {
                Ok(v) => v.to_le_bytes().to_vec(),
                Err(_) => break,
            },
            1 => match input.read_raw_little_endian64() {
                Ok(v) => v.to_le_bytes().to_vec(),
                Err(_) => break,
            },
            2 => match input.read_bytes() {
                Ok(v) => v,
                Err(_) => break,
            },
            5 => match input.read_raw_little_endian32() {
                Ok(v) => v.to_le_bytes().to_vec(),
                Err(_) => break,
            },
            _ => break,
        };
        out.push((tag >> 3, tag & 7, value));
    }
    out
}

fn field(message: &[u8], number: u32) -> Option<Vec<u8>> {
    fields(message).into_iter().find(|(n, _, _)| *n == number).map(|(_, _, v)| v)
}

fn varint(bytes: &[u8]) -> u64 {
    let mut le = [0u8; 8];
    le[..bytes.len().min(8)].copy_from_slice(&bytes[..bytes.len().min(8)]);
    u64::from_le_bytes(le)
}

/// El `audio_id` de una respuesta `AudioFilesExtensionResponse` (campo 4).
pub fn audio_id(response: &[u8]) -> Vec<u8> {
    field(response, 4).unwrap_or_default()
}

/// Los rechazos de un `PublishEventsResponse`: `(índice, transitorio, motivo)`.
/// **Un `200` no dice que el evento entró**: el rechazo viene adentro.
pub fn rejections(response: &[u8]) -> Vec<(u64, bool, u64)> {
    fields(response)
        .into_iter()
        .filter(|(n, _, _)| *n == 1)
        .map(|(_, _, error)| {
            let get = |n| field(&error, n).map(|v| varint(&v)).unwrap_or(0);
            (get(1), get(2) != 0, get(3))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn heard() -> Heard {
        Heard {
            uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC".into(),
            context_uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M".into(),
            ms_played: 212_000,
            started_ms: 1_790_000_000_250,
            ended_ms: 1_790_000_212_250,
            duration_ms: 213_000,
        }
    }

    fn audio() -> Audio {
        Audio { file_id: vec![7; 20], format: "Vorbis 320 kbps".into(), audio_id: vec![0xab; 16] }
    }

    #[test]
    fn a_play_names_the_song_its_context_and_the_time_heard() {
        let message = raw_core_stream(&heard(), &audio(), &[1; 16], &[2; 16]);
        assert_eq!(field(&message, 24).unwrap(), b"spotify:track:4uLU6hMCjMI75M1A2tKUQC");
        assert_eq!(field(&message, 23).unwrap(), b"spotify:playlist:37i9dQZF1DXcBWIGoYBM5M");
        assert_eq!(field(&message, 9).unwrap(), b"playlist");
        assert_eq!(field(&message, 12).unwrap(), b"trackdone");
        assert_eq!(varint(&field(&message, 14).unwrap()), 212_000);
        assert_eq!(varint(&field(&message, 13).unwrap()), 1_790_000_000_250);
        assert_eq!(field(&message, 4).unwrap(), [7; 20]);
        assert_eq!(field(&message, 22).unwrap(), b"Vorbis 320 kbps");
    }

    /// Sin el `audio_id` en hexadecimal, la historia no guarda la canción.
    #[test]
    fn the_audio_id_travels_in_hex() {
        let message = raw_core_stream(&heard(), &audio(), &[1; 16], &[2; 16]);
        assert_eq!(field(&message, 63).unwrap(), b"abababababababababababababababab".to_vec());
        let none = raw_core_stream(&heard(), &Audio::default(), &[1; 16], &[2; 16]);
        assert!(field(&none, 63).is_none());
    }

    #[test]
    fn a_skip_ends_as_endplay_and_a_song_with_no_context_is_its_own() {
        let skipped = Heard { ms_played: 40_000, context_uri: String::new(), ..heard() };
        let message = raw_core_stream(&skipped, &audio(), &[1; 16], &[2; 16]);
        assert_eq!(field(&message, 12).unwrap(), b"endplay");
        assert_eq!(field(&message, 23).unwrap(), b"spotify:track:4uLU6hMCjMI75M1A2tKUQC");
        assert_eq!(field(&message, 9).unwrap(), b"track");
        assert_eq!(source("spotify:user:someone:collection"), "collection");
    }

    /// La versión de escritorio es la que decide si la canción llega a la historia.
    #[test]
    fn the_envelope_carries_the_desktop_version_and_the_sequence() {
        let run = Run { sequence_id: [9; 20], app_session: [3; 16] };
        let client = Client { client_id: "65b708073fc0480ea92a077233ca87bd", device_id: "aabbccdd" };
        let request = publish_request(&client, &run, 7, &heard(), &audio(), 1234);
        let event = field(&request, 1).unwrap();
        assert_eq!(field(&event, 2).unwrap(), b"RawCoreStream");
        assert_eq!(field(&event, 4).unwrap(), [9; 20]);
        assert_eq!(varint(&field(&event, 5).unwrap()), 7);
        let fragments: Vec<Vec<u8>> =
            fields(&event).into_iter().filter(|(n, _, _)| *n == 3).map(|(_, _, v)| v).collect();
        let app = fragments
            .iter()
            .find(|f| field(f, 1).unwrap() == b"context_application_desktop")
            .unwrap();
        let app = field(app, 2).unwrap();
        assert_eq!(field(&app, 1).unwrap(), REPORTING_VERSION.as_bytes());
        let client_id = fragments.iter().find(|f| field(f, 1).unwrap() == b"context_client_id").unwrap();
        assert_eq!(field(&field(client_id, 2).unwrap(), 1).unwrap()[0], 0x65);
    }

    #[test]
    fn the_history_entry_names_the_song_and_when_it_started() {
        let request = history_request(&heard());
        assert_eq!(field(&request, 2).unwrap(), b"spotify:list:play-history:v1");
        let revision = field(&request, 4).unwrap();
        assert_eq!(field(&field(&revision, 2).unwrap(), 6).unwrap(), b"spotify:track:4uLU6hMCjMI75M1A2tKUQC");
        let time = field(&revision, 3).unwrap();
        assert_eq!(varint(&field(&time, 1).unwrap()), 1_790_000_000);
        assert_eq!(varint(&field(&time, 2).unwrap()), 250_000_000);
    }

    #[test]
    fn a_rejection_is_read_from_inside_a_200() {
        // error { index: 0, transient: true, reason: 7 }
        assert_eq!(rejections(&[0x0a, 0x06, 0x08, 0x00, 0x10, 0x01, 0x18, 0x07]), [(0, true, 7)]);
        assert!(rejections(&[]).is_empty());
    }

    #[test]
    fn the_audio_id_is_field_four_of_the_extension() {
        // files { … } (campo 1), audio_id (campo 4) = 0xab 0xcd
        assert_eq!(audio_id(&[0x0a, 0x00, 0x22, 0x02, 0xab, 0xcd]), [0xab, 0xcd]);
        assert!(audio_id(&[]).is_empty());
    }
}
