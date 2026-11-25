//! How Home is arranged, per account: which tiles are in quick access and in
//! what order, which shelves show and in what order, and how the tiles look.
//!
//! It lives next to `library_organisation.rs` and for the same reason: it is
//! the person's choice, it has to survive a sign-out (`%APPDATA%` does not, see
//! `AGENTS.md`), and two accounts on one machine arrange Home differently.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

static WRITES: Mutex<()> = Mutex::new(());

/// The most tiles quick access holds. Agreed with the person who asked for it:
/// two long rows on the phone, and quick access stays quick.
pub const QUICK_MAX: usize = 12;

/// The shelves Home can show, in the order a new account sees them. A shelf id
/// the app does not know (from a newer or older version) is dropped on read.
pub const SHELVES: [&str; 5] = [
    "keepListening",
    "mostPlayed",
    "yourWeek",
    "yourPlaylists",
    "madeForYou",
];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Shelf {
    pub id: String,
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum View {
    #[default]
    Rows,
    Covers,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct HomeLayout {
    /// `None` until the person arranges quick access: until then the app fills
    /// it by itself (the saved songs, the DJ, the lists heard last). Each entry is
    /// `liked`, `dj`, or a playlist's 22-character id.
    #[serde(default)]
    pub quick: Option<Vec<String>>,
    #[serde(default)]
    pub shelves: Vec<Shelf>,
    #[serde(default)]
    pub view: View,
}

type Accounts = BTreeMap<String, HomeLayout>;

fn path() -> Result<std::path::PathBuf, String> {
    crate::settings::settings_path()
        .and_then(|path| path.parent().map(|parent| parent.join("home-layout.json")))
        .ok_or_else(|| "command_failed".to_string())
}

fn read(path: &Path) -> Result<Accounts, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "command_failed".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Accounts::default()),
        Err(_) => Err("command_failed".to_string()),
    }
}

fn valid_tile(id: &str) -> bool {
    id == "liked"
        || id == "dj"
        || (id.len() == 22 && id.bytes().all(|byte| byte.is_ascii_alphanumeric()))
}

/// Every shelf once, in the saved order, with the ones the saved layout does not
/// mention appended in their default place: a shelf added in a later version
/// shows up instead of being hidden by a layout that never heard of it.
fn normalise(layout: &mut HomeLayout) {
    let mut seen = BTreeSet::new();
    let mut shelves: Vec<Shelf> = layout
        .shelves
        .drain(..)
        .filter(|shelf| SHELVES.contains(&shelf.id.as_str()) && seen.insert(shelf.id.clone()))
        .collect();
    for id in SHELVES {
        if !seen.contains(id) {
            shelves.push(Shelf { id: id.to_string(), hidden: false });
        }
    }
    layout.shelves = shelves;
    if let Some(quick) = layout.quick.as_mut() {
        let mut seen = BTreeSet::new();
        quick.retain(|id| valid_tile(id) && seen.insert(id.clone()));
        quick.truncate(QUICK_MAX);
    }
}

pub fn load(account: &str) -> Result<HomeLayout, String> {
    let _guard = WRITES.lock().map_err(|_| "command_failed".to_string())?;
    load_at(&path()?, account)
}

fn load_at(path: &Path, account: &str) -> Result<HomeLayout, String> {
    let mut layout = read(path)?.remove(account).unwrap_or_default();
    normalise(&mut layout);
    Ok(layout)
}

pub fn save(account: &str, layout: HomeLayout) -> Result<HomeLayout, String> {
    let _guard = WRITES.lock().map_err(|_| "command_failed".to_string())?;
    save_at(&path()?, account, layout)
}

fn save_at(path: &Path, account: &str, mut layout: HomeLayout) -> Result<HomeLayout, String> {
    if account.is_empty() || account.len() > 256 {
        return Err("bad_id".to_string());
    }
    // Refused rather than trimmed: a page that sends thirteen tiles or a made-up
    // id has a bug, and saving a silently different layout would hide it.
    if let Some(quick) = &layout.quick {
        if quick.len() > QUICK_MAX || !quick.iter().all(|id| valid_tile(id)) {
            return Err("bad_id".to_string());
        }
    }
    normalise(&mut layout);
    let mut accounts = read(path)?;
    accounts.insert(account.to_string(), layout.clone());
    write(path, &accounts)?;
    Ok(layout)
}

fn write(path: &Path, accounts: &Accounts) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "command_failed".to_string())?;
    std::fs::create_dir_all(parent).map_err(|_| "command_failed".to_string())?;
    // A sibling first, then a rename: an interrupted write must not lose Home.
    let pending = path.with_extension("json.pending");
    let bytes = serde_json::to_vec_pretty(&accounts).map_err(|_| "command_failed".to_string())?;
    std::fs::write(&pending, bytes).map_err(|_| "command_failed".to_string())?;
    std::fs::rename(pending, path).map_err(|_| "command_failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let id = std::process::id();
        let dir = std::env::temp_dir().join(format!("star-music-home-{name}-{id}"));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("home-layout.json")
    }

    const LIST: &str = "37i9dQZF1DXcBWIGoYBM5M";

    #[test]
    fn a_new_account_gets_every_shelf_and_an_automatic_quick_access() {
        let layout = load_at(&temp("new"), "someone").unwrap();
        assert_eq!(layout.quick, None);
        assert_eq!(layout.view, View::Rows);
        let ids: Vec<_> = layout.shelves.iter().map(|shelf| shelf.id.as_str()).collect();
        assert_eq!(ids, SHELVES);
        assert!(layout.shelves.iter().all(|shelf| !shelf.hidden));
    }

    #[test]
    fn a_saved_layout_comes_back_for_its_account_only() {
        let path = temp("round");
        let layout = HomeLayout {
            quick: Some(vec!["dj".into(), LIST.into(), "liked".into()]),
            shelves: vec![Shelf { id: "yourWeek".into(), hidden: true }],
            view: View::Covers,
        };
        save_at(&path, "a", layout).unwrap();
        let back = load_at(&path, "a").unwrap();
        let expected = vec!["dj".to_string(), LIST.to_string(), "liked".to_string()];
        assert_eq!(back.quick, Some(expected));
        assert_eq!(back.view, View::Covers);
        assert_eq!(back.shelves[0], Shelf { id: "yourWeek".into(), hidden: true });
        assert_eq!(back.shelves.len(), SHELVES.len());
        assert_eq!(load_at(&path, "b").unwrap().quick, None);
    }

    #[test]
    fn thirteen_tiles_or_a_made_up_id_are_refused() {
        let path = temp("refuse");
        let thirteen = HomeLayout {
            quick: Some(vec!["liked".into(); 13]),
            ..Default::default()
        };
        assert_eq!(save_at(&path, "a", thirteen), Err("bad_id".to_string()));
        let made_up = HomeLayout {
            quick: Some(vec!["../x".into()]),
            ..Default::default()
        };
        assert_eq!(save_at(&path, "a", made_up), Err("bad_id".to_string()));
    }

    #[test]
    fn unknown_and_repeated_shelves_are_dropped_on_read() {
        let mut layout = HomeLayout {
            shelves: vec![
                Shelf { id: "madeForYou".into(), hidden: false },
                Shelf { id: "podcasts".into(), hidden: false },
                Shelf { id: "madeForYou".into(), hidden: true },
            ],
            ..Default::default()
        };
        normalise(&mut layout);
        assert_eq!(layout.shelves[0].id, "madeForYou");
        assert!(!layout.shelves[0].hidden);
        assert_eq!(layout.shelves.len(), SHELVES.len());
        assert!(layout.shelves.iter().all(|shelf| shelf.id != "podcasts"));
    }
}
