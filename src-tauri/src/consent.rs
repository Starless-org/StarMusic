//! Who allowed what to leave the machine.
//!
//! PRODUCT.md, "Consented integrations": nothing leaves without the person's
//! say-so, integration by integration, and nothing goes to the author. This
//! module is where "the person said yes" is written down and where every
//! integration asks before it sends a byte.
//!
//! **The question is asked where the request is made, not where the switch is
//! drawn.** The switch in Settings is the webview's idea of the grant, and the
//! webview can be behind: a lost event, an account that changed, a text whose
//! version went up. An integration that trusts the frontend not to call it
//! without a grant sends data nobody accepted the day the two disagree. So each
//! integration calls [`granted`] inside the function that sends, and the
//! commands here only ever hand the webview booleans.
//!
//! **A grant carries the version of the text that was accepted.** The dialog
//! says exactly what leaves. If an integration ever sends more than that, its
//! [`Integration::version`] goes up, every older grant stops counting, and the
//! person is asked again. A yes to one sentence is not a yes to the next one.
//!
//! **Two scopes, because two kinds of thing are being shared.** What goes to
//! Spotify is the account's: another account signed in on the same machine has
//! to accept its own, so those grants are dropped on sign-out. What goes to
//! Discord belongs to the person at this computer, like the language, and
//! survives a sign-out.
//!
//! Grants live in `settings.json`, under `%LOCALAPPDATA%`, which sign-out never
//! deletes (see `settings.rs`): the account-scoped ones are removed on purpose,
//! not by the directory going away.

use std::collections::BTreeMap;

/// Everything that may send data off this machine. The list is closed: one
/// that is not here does not ship (PRODUCT.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Integration {
    /// The plays heard here count on the account (`spclient/plays.rs`).
    SpotifyPlays,
    /// Discord shows what is playing (`discord.rs`).
    DiscordPresence,
    /// Other devices of the account see and control Star Music. Undecided in
    /// PRODUCT.md, so never available outside the preview below.
    ConnectDevice,
}

pub const ALL: [Integration; 3] = [
    Integration::SpotifyPlays,
    Integration::DiscordPresence,
    Integration::ConnectDevice,
];

impl Integration {
    /// The name the webview and `settings.json` use. Stable: a rename would
    /// silently drop every grant already written under the old one.
    pub fn id(self) -> &'static str {
        match self {
            Integration::SpotifyPlays => "spotify_plays",
            Integration::DiscordPresence => "discord_presence",
            Integration::ConnectDevice => "connect_device",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        ALL.into_iter().find(|i| i.id() == id)
    }

    /// The version of the permission text. **Raise it whenever the integration
    /// sends something the dialog did not name**, and update the dialog's text
    /// in `i18n.ts` in the same change.
    pub fn version(self) -> u32 {
        match self {
            Integration::SpotifyPlays => 1,
            Integration::DiscordPresence => 2,
            Integration::ConnectDevice => 1,
        }
    }

    /// Whether the grant belongs to the signed-in account (dropped on sign-out)
    /// rather than to the person at this computer.
    pub fn account_scoped(self) -> bool {
        match self {
            Integration::SpotifyPlays | Integration::ConnectDevice => true,
            Integration::DiscordPresence => false,
        }
    }

    /// Whether this build can do it at all.
    ///
    /// **A switch for something the app cannot do is a promise it cannot keep**,
    /// so Settings only draws the ones that are available. Each integration
    /// flips its own line when the code that sends exists.
    pub fn available(self) -> bool {
        if preview() {
            return true;
        }
        match self {
            Integration::SpotifyPlays => true,
            Integration::DiscordPresence => crate::discord::available(),
            Integration::ConnectDevice => false,
        }
    }
}

/// `STAR_MUSIC_CONSENT_PREVIEW=1` shows every integration in Settings, so the
/// section and its dialog can be looked at before any integration exists. Debug
/// builds only, like the probes: in a release build it compiles to `false`.
fn preview() -> bool {
    #[cfg(debug_assertions)]
    {
        std::env::var("STAR_MUSIC_CONSENT_PREVIEW").is_ok_and(|v| v == "1")
    }
    #[cfg(not(debug_assertions))]
    {
        false
    }
}

/// One yes, as it was given.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Grant {
    /// Seconds since the epoch. Kept so the record says when, not only whether.
    pub granted_at: i64,
    /// [`Integration::version`] at the moment of the yes.
    pub version: u32,
}

/// What the webview may know: whether each integration exists in this build and
/// whether it is on. Never the grant itself.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Status {
    pub id: &'static str,
    pub available: bool,
    pub granted: bool,
}

fn is_granted(grants: &BTreeMap<String, Grant>, integration: Integration) -> bool {
    grants
        .get(integration.id())
        .is_some_and(|grant| grant.version == integration.version())
}

/// **The question every integration asks before it sends.** Reads the file each
/// time on purpose: a cached answer is exactly how a revoke would fail to stop
/// the next request.
pub fn granted(integration: Integration) -> bool {
    is_granted(&crate::settings::load().consents, integration)
}

pub fn status() -> Vec<Status> {
    let grants = crate::settings::load().consents;
    ALL.into_iter()
        .map(|integration| Status {
            id: integration.id(),
            available: integration.available(),
            granted: is_granted(&grants, integration),
        })
        .collect()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Record a yes. Refuses an integration this build cannot do: the webview only
/// offers available ones, so a grant for anything else is a stale or forged call.
pub fn grant(integration: Integration) -> Result<(), String> {
    if !integration.available() {
        return Err("integration_unavailable".into());
    }
    let at = now();
    crate::settings::update_consents(|grants| {
        grants.insert(
            integration.id().to_string(),
            Grant {
                granted_at: at,
                version: integration.version(),
            },
        );
    });
    Ok(())
}

/// Take a yes back. Takes effect on the next [`granted`], which every
/// integration asks before each send.
///
/// **An integration that keeps anything waiting to go — a queue of plays, an
/// open pipe to Discord — has to drop it here too**, in the command that calls
/// this: a queue that empties after the "no" is a queue that sends after the "no".
pub fn revoke(integration: Integration) {
    crate::settings::update_consents(|grants| {
        grants.remove(integration.id());
    });
}

fn drop_account_scoped(grants: &mut BTreeMap<String, Grant>) {
    for integration in ALL.into_iter().filter(|i| i.account_scoped()) {
        grants.remove(integration.id());
    }
}

/// Sign-out: what was accepted for this account does not carry over to the next.
pub fn revoke_account_scoped() {
    crate::settings::update_consents(drop_account_scoped);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant_for(integration: Integration) -> Grant {
        Grant {
            granted_at: 1,
            version: integration.version(),
        }
    }

    #[test]
    fn nothing_is_granted_by_default() {
        let grants = BTreeMap::new();
        for integration in ALL {
            assert!(!is_granted(&grants, integration), "{}", integration.id());
        }
    }

    /// A yes to an older text does not cover what the integration sends now.
    #[test]
    fn an_old_version_of_a_grant_is_not_a_grant() {
        let mut grants = BTreeMap::new();
        let integration = Integration::DiscordPresence;
        grants.insert(
            integration.id().to_string(),
            Grant {
                granted_at: 1,
                version: integration.version() - 1,
            },
        );
        assert!(!is_granted(&grants, integration));
        grants.insert(integration.id().to_string(), grant_for(integration));
        assert!(is_granted(&grants, integration));
    }

    #[test]
    fn signing_out_revokes_account_grants_and_keeps_discord() {
        let mut grants = BTreeMap::new();
        for integration in ALL {
            grants.insert(integration.id().to_string(), grant_for(integration));
        }
        drop_account_scoped(&mut grants);
        assert!(!is_granted(&grants, Integration::SpotifyPlays));
        assert!(!is_granted(&grants, Integration::ConnectDevice));
        assert!(is_granted(&grants, Integration::DiscordPresence));
    }

    /// The id is what `settings.json` keys on: two integrations sharing one
    /// would share one grant.
    #[test]
    fn every_integration_has_an_id_of_its_own() {
        for (i, integration) in ALL.iter().enumerate() {
            assert_eq!(Integration::from_id(integration.id()), Some(*integration));
            assert!(ALL[i + 1..].iter().all(|other| other.id() != integration.id()));
        }
        assert_eq!(Integration::from_id("analytics"), None);
    }

    /// An integration is only offered once its code exists. Discord exists, but
    /// only in a build that carries its Application ID.
    #[test]
    fn no_integration_is_available_before_its_code_exists() {
        if preview() {
            return;
        }
        assert!(Integration::SpotifyPlays.available());
        assert!(!Integration::ConnectDevice.available());
        assert_eq!(Integration::DiscordPresence.available(), crate::discord::available());
    }
}
