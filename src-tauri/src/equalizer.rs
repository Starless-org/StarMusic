//! Local music EQ. PCM stays in Rust and each crossfade deck owns its filter history.
use librespot_playback::{NUM_CHANNELS, SAMPLE_RATE};
use serde::{Deserialize, Serialize};
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicU64, Ordering},
};
use std::time::Duration;

pub const FREQUENCIES: [f64; 10] = [
    31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Preset {
    pub name: String,
    pub gains: [f64; 10],
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Settings {
    pub enabled: bool,
    pub gains: [f64; 10],
    pub presets: Vec<Preset>,
}

impl Settings {
    fn validate(&self) -> Result<(), String> {
        let valid = |gains: &[f64; 10]| {
            gains
                .iter()
                .all(|gain| gain.is_finite() && (-12.0..=12.0).contains(gain))
        };
        if !valid(&self.gains) {
            return Err("eq_invalid".into());
        }
        let mut names = std::collections::BTreeSet::new();
        for preset in &self.presets {
            if preset.name.trim().is_empty()
                || preset.name.chars().count() > 64
                || preset.name != preset.name.trim()
                || !valid(&preset.gains)
                || !names.insert(preset.name.to_lowercase())
            {
                return Err("eq_invalid".into());
            }
        }
        Ok(())
    }
}

struct Stored {
    settings: Settings,
    bank: Bank,
}
static STORE: OnceLock<Mutex<Stored>> = OnceLock::new();
static REVISION: AtomicU64 = AtomicU64::new(0);

fn path() -> Result<std::path::PathBuf, String> {
    crate::settings::settings_path()
        .and_then(|path| path.parent().map(|parent| parent.join("equalizer.json")))
        .ok_or_else(|| "command_failed".into())
}

fn store() -> &'static Mutex<Stored> {
    STORE.get_or_init(|| {
        let settings = path()
            .ok()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
            .filter(|settings| settings.validate().is_ok())
            .unwrap_or_default();
        let bank = Bank::new(&settings);
        Mutex::new(Stored { settings, bank })
    })
}

pub fn load() -> Result<Settings, String> {
    store()
        .lock()
        .map(|stored| stored.settings.clone())
        .map_err(|_| "command_failed".into())
}

pub fn save(settings: Settings) -> Result<Settings, String> {
    settings.validate()?;
    let mut stored = store().lock().map_err(|_| "command_failed".to_string())?;
    write(&path()?, &settings)?;
    // Publish only after persistence succeeds. Audio never waits on disk.
    let audio_changed =
        stored.settings.enabled != settings.enabled || stored.settings.gains != settings.gains;
    if audio_changed {
        stored.bank = Bank::new(&settings);
    }
    stored.settings = settings.clone();
    if audio_changed {
        REVISION.fetch_add(1, Ordering::Release);
    }
    Ok(settings)
}

fn write(path: &std::path::Path, settings: &Settings) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "command_failed".to_string())?;
    std::fs::create_dir_all(parent).map_err(|_| "command_failed".to_string())?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(settings).map_err(|_| "command_failed".to_string())?;
    let mut file = std::fs::File::create(&temporary).map_err(|_| "command_failed".to_string())?;
    std::io::Write::write_all(&mut file, &bytes).map_err(|_| "command_failed".to_string())?;
    file.sync_all().map_err(|_| "command_failed".to_string())?;
    drop(file);
    std::fs::rename(temporary, path).map_err(|_| "command_failed".to_string())
}

#[derive(Clone, Copy)]
struct Coefficients {
    b: [f64; 3],
    a: [f64; 2],
}

impl Coefficients {
    fn peak(hz: f64, gain: f64) -> Self {
        // RBJ peaking EQ, Q = sqrt(2), at librespot's native sample rate.
        let amplitude = 10f64.powf(gain / 40.0);
        let omega = std::f64::consts::TAU * hz / f64::from(SAMPLE_RATE);
        let alpha = omega.sin() / (2.0 * std::f64::consts::SQRT_2);
        let a0 = 1.0 + alpha / amplitude;
        Self {
            b: [
                (1.0 + alpha * amplitude) / a0,
                -2.0 * omega.cos() / a0,
                (1.0 - alpha * amplitude) / a0,
            ],
            a: [-2.0 * omega.cos() / a0, (1.0 - alpha / amplitude) / a0],
        }
    }
    fn magnitude(&self, omega: f64) -> f64 {
        let real_b = self.b[0] + self.b[1] * omega.cos() + self.b[2] * (2.0 * omega).cos();
        let imag_b = -self.b[1] * omega.sin() - self.b[2] * (2.0 * omega).sin();
        let real_a = 1.0 + self.a[0] * omega.cos() + self.a[1] * (2.0 * omega).cos();
        let imag_a = -self.a[0] * omega.sin() - self.a[1] * (2.0 * omega).sin();
        ((real_b * real_b + imag_b * imag_b) / (real_a * real_a + imag_a * imag_a)).sqrt()
    }
}

#[derive(Clone)]
struct Bank {
    coefficients: [Coefficients; 10],
    history: [[[f64; 2]; 10]; 2],
    gain: f64,
    bypass: bool,
}

impl Bank {
    fn new(settings: &Settings) -> Self {
        let coefficients =
            std::array::from_fn(|i| Coefficients::peak(FREQUENCIES[i], settings.gains[i]));
        let bypass = !settings.enabled || settings.gains.iter().all(|gain| *gain == 0.0);
        // Measure the combined response, not the largest slider. Adjacent
        // filters overlap. One extra dB leaves room for transient overshoot.
        let peak = if bypass {
            1.0
        } else {
            (0..2048)
                .map(|i| {
                    let hz = 10.0 * (f64::from(SAMPLE_RATE) / 20.0).powf(f64::from(i) / 2047.0);
                    coefficients
                        .iter()
                        .map(|filter| {
                            filter.magnitude(std::f64::consts::TAU * hz / f64::from(SAMPLE_RATE))
                        })
                        .product::<f64>()
                })
                .fold(1.0f64, f64::max)
        };
        Self {
            coefficients,
            history: [[[0.0; 2]; 10]; 2],
            gain: if bypass {
                1.0
            } else {
                10f64.powf(-1.0 / 20.0) / peak
            },
            bypass,
        }
    }
    fn sample(&mut self, sample: f32, channel: usize) -> f32 {
        if self.bypass {
            return sample;
        }
        let mut value = f64::from(sample) * self.gain;
        for (filter, history) in self.coefficients.iter().zip(&mut self.history[channel]) {
            let output = filter.b[0] * value + history[0];
            history[0] = filter.b[1] * value - filter.a[0] * output + history[1];
            history[1] = filter.b[2] * value - filter.a[1] * output;
            // Avoid denormal floating-point work after audio falls silent.
            for state in history {
                if state.abs() < 1e-24 {
                    *state = 0.0;
                }
            }
            value = output;
        }
        value as f32
    }
}

pub struct Processor {
    revision: u64,
    bank: Bank,
    old: Option<Bank>,
    ramp: usize,
}

impl Processor {
    pub fn new() -> Arc<Mutex<Self>> {
        let stored = store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Arc::new(Mutex::new(Self {
            revision: REVISION.load(Ordering::Acquire),
            bank: stored.bank.clone(),
            old: None,
            ramp: 0,
        }))
    }
    fn process(&mut self, samples: &mut [f32]) {
        let revision = REVISION.load(Ordering::Acquire);
        if revision != self.revision
            && let Some(store) = STORE.get()
            && let Ok(stored) = store.try_lock()
        {
            self.old = Some(self.bank.clone());
            self.bank = stored.bank.clone();
            self.ramp = 0;
            self.revision = revision;
        }
        let ramp_frames = SAMPLE_RATE as usize / 100;
        if self.bank.bypass && self.old.is_none() {
            return;
        }
        for frame in samples.chunks_exact_mut(usize::from(NUM_CHANNELS)) {
            let mix = (self.ramp as f32 / ramp_frames as f32).min(1.0);
            for (channel, sample) in frame.iter_mut().enumerate() {
                let next = self.bank.sample(*sample, channel);
                let output = if let Some(old) = &mut self.old {
                    old.sample(*sample, channel) * (1.0 - mix) + next * mix
                } else {
                    next
                };
                *sample = output.clamp(-1.0, 1.0);
            }
            if self.old.is_some() {
                self.ramp += 1;
                if self.ramp >= ramp_frames {
                    self.old = None;
                }
            }
        }
    }
}

/// Filter a packet when it reaches the output, so queued audio also hears an
/// EQ adjustment. History spans packets and belongs to one stereo deck.
pub struct Packet {
    samples: Vec<f32>,
    position: usize,
    processor: Arc<Mutex<Processor>>,
}
impl Packet {
    pub fn new(samples: &[f32], processor: Arc<Mutex<Processor>>) -> Self {
        Self {
            samples: samples.to_vec(),
            position: 0,
            processor,
        }
    }
}
impl Iterator for Packet {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        if self.position == 0
            && let Ok(mut processor) = self.processor.lock()
        {
            processor.process(&mut self.samples);
        }
        let sample = self.samples.get(self.position).copied()?;
        self.position += 1;
        Some(sample)
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        let length = self.samples.len() - self.position;
        (length, Some(length))
    }
}
impl rodio::Source for Packet {
    fn current_span_len(&self) -> Option<usize> {
        Some(self.samples.len() - self.position)
    }
    fn channels(&self) -> u16 {
        NUM_CHANNELS as u16
    }
    fn sample_rate(&self) -> u32 {
        SAMPLE_RATE
    }
    fn total_duration(&self) -> Option<Duration> {
        Some(Duration::from_secs_f64(
            self.samples.len() as f64 / NUM_CHANNELS as f64 / f64::from(SAMPLE_RATE),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_and_flat_eq_are_bit_exact_bypasses() {
        let mut bank = Bank::new(&Settings::default());
        assert_eq!(bank.sample(0.25, 0), 0.25);
        let mut flat = Bank::new(&Settings {
            enabled: true,
            ..Default::default()
        });
        assert_eq!(flat.sample(-0.123, 1), -0.123);
    }
    #[test]
    fn channels_have_separate_filter_history() {
        let mut bank = Bank::new(&Settings {
            enabled: true,
            gains: [6.0; 10],
            ..Default::default()
        });
        bank.sample(0.5, 0);
        for _ in 0..1000 {
            assert_eq!(bank.sample(0.0, 1), 0.0);
        }
    }

    #[test]
    fn filter_history_survives_packet_boundaries() {
        let settings = Settings {
            enabled: true,
            gains: [3.0; 10],
            ..Default::default()
        };
        let make = || Processor {
            revision: REVISION.load(Ordering::Acquire),
            bank: Bank::new(&settings),
            old: None,
            ramp: 0,
        };
        let samples: Vec<f32> = (0..2048).map(|i| (i as f32 * 0.1).sin() * 0.2).collect();
        let mut expected = samples.clone();
        make().process(&mut expected);
        let processor = Arc::new(Mutex::new(make()));
        let mut actual: Vec<f32> = Packet::new(&samples[..1024], processor.clone()).collect();
        actual.extend(Packet::new(&samples[1024..], processor));
        assert_eq!(actual, expected);
    }

    #[test]
    fn disabled_processing_preserves_samples_outside_the_unit_range() {
        let mut processor = Processor {
            revision: REVISION.load(Ordering::Acquire),
            bank: Bank::new(&Settings::default()),
            old: None,
            ramp: 0,
        };
        let mut samples = [1.1, -1.1];
        processor.process(&mut samples);
        assert_eq!(samples, [1.1, -1.1]);
    }
    #[test]
    fn bass_preset_boosts_bass_relative_to_midrange_with_headroom() {
        let bank = Bank::new(&Settings {
            enabled: true,
            gains: [6.0, 5.0, 3.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            ..Default::default()
        });
        let response = |hz| {
            bank.coefficients
                .iter()
                .map(|filter| filter.magnitude(std::f64::consts::TAU * hz / f64::from(SAMPLE_RATE)))
                .product::<f64>()
                * bank.gain
        };
        assert!(response(62.0) > response(1000.0) * 1.5);
        assert!(response(62.0) < 1.0);
    }
    #[test]
    fn invalid_gains_and_duplicate_names_are_rejected() {
        let mut settings = Settings::default();
        settings.gains[0] = f64::NAN;
        assert!(settings.validate().is_err());
        settings.gains[0] = 13.0;
        assert!(settings.validate().is_err());
        settings.gains[0] = 0.0;
        settings.presets = vec![
            Preset {
                name: "Bass".into(),
                gains: [0.0; 10],
            },
            Preset {
                name: "bass".into(),
                gains: [0.0; 10],
            },
        ];
        assert!(settings.validate().is_err());
    }
    #[test]
    fn profiles_round_trip_and_replace_atomically() {
        let directory = std::env::temp_dir().join(format!("star-music-eq-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("equalizer.json");
        let mut settings = Settings::default();
        settings.presets.push(Preset {
            name: "Mi EQ".into(),
            gains: [2.0; 10],
        });
        write(&path, &settings).unwrap();
        settings.enabled = true;
        write(&path, &settings).unwrap();
        let restored: Settings = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(restored.enabled);
        assert_eq!(restored.presets[0].name, "Mi EQ");
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
