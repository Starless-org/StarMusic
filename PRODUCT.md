# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Star Music ships as a Windows desktop app via Tauri. The interface is a local webview, not a website served over the network, and `web` is the closest value this schema offers. The design language is not per-OS and does not adapt, so the platform is not `adaptive`. macOS and Linux follow Windows; see Constraints.

## Stack

Tauri 2.12 (Rust) with librespot 0.8 as the backend, React 19 + Vite 8 + TypeScript 6 frontend, Bun as package manager, Biome for lint and format, Tailwind v4, Motion, TanStack Router and Query, Zustand for the player store.

Vite over Next.js is a settled decision, not an oversight. Tauri serves a local asset protocol with no server behind it, so SSR, React Server Components, edge middleware and API routes have nothing to render, and the `output: 'export'` fallback would remove routing and image optimization in exchange for nothing.

## Users

Primary: people who already pay for Spotify Premium and are frustrated with the official desktop client — it feels slow to start and heavy on resources. They arrive from a recommendation or their own search, already holding a Premium account.

They are not looking for a different music service. They want the same one that opens faster. They install once, log in, and use Star Music as a daily driver.

## Product Purpose

Star Music is an unofficial desktop client for Spotify Premium. It exists because the official client is slow and heavy, and because a desktop music player should open instantly and then get out of the way.

Success means: cold start under one second, a small memory footprint while playing, and an interface that feels designed rather than assembled. A user who installs Star Music and keeps using it daily has succeeded. A user who tries it once and returns to the official app has not.

## Positioning

Three claims a neighbouring client could not truthfully copy:

1. **Cold start under a second, with a small memory footprint.** Decoded audio goes straight to the system driver (rodio/cpal → WASAPI on Windows) and never passes through the webview, so the window is interactive before the session finishes negotiating with Spotify.
2. **An interface built for motion rather than adapted to it.** Transitions, crossfades and layout changes are designed as a system, not retrofitted screen by screen.
3. **Nothing leaves without your say-so.** Star Music reports usage data to nobody, including its author. The integrations that share your listening with a service you already use — your Spotify account, Discord — are off until you turn them on, and say exactly what they send before you do.

Explicitly not claimed: Star Music does not remove the algorithmic feed and does not replace cards with something else. The home feed stays.

## Operating Context

Desktop, Windows first, window around 1180×760 with a 900×600 minimum. The user is almost always doing something else at the same time — Star Music is a companion to another task, not the task. It should be startable, usable and dismissable without demanding attention.

Because it is a desktop window rather than a site, window-level affordances matter: media keys, quick search, and a player bar that is always present so the user never has to navigate somewhere to control playback.

## Capabilities and Constraints

Durable constraints that future work must preserve:

- **Spotify Premium is required.** librespot states this is permanent; free accounts will not be supported. Every surface that can set that expectation should.
- **The backend is reverse-engineered.** Spotify publishes no protocol specification. Assume a multi-day outage will eventually happen for reasons outside this project. All librespot calls sit behind a thin abstraction so a breakage is patched in one place rather than rippling through the app.
- **Installers are unsigned for now.** Windows SmartScreen and macOS Gatekeeper will warn. The first-run experience must prepare the user for that instead of surprising them. Signing is a later, budgeted decision.
- **Windows first.** macOS and Linux follow. Linux needs `libasound2-dev` at build time for the ALSA path.
- **Audio never travels through the webview.** Decoded PCM goes straight to the system driver. Any change that moves audio onto a webview API would break both the speed claim and the memory claim.

Undecided:

- Whether Star Music registers as a Spotify Connect device. If it does, it is a consented integration like the others (see below), not a default.
- Code-signing budget and timing.
- Domain and final logo.

## Brand Commitments

- Name: **Star Music**.
- Star Music is an unofficial third-party client. It must not use Spotify's name in branding, must not use the Spotify logo or wordmark, and must not imply endorsement or affiliation. The README carries the disclaimer.
- Nothing is yet committed about visual identity, palette or typography. Those are open until design work begins.

## Evidence on Hand

None. There are no testimonials, usage numbers, benchmarks, screenshots or press. Future work must not fabricate any of them.

The performance claims above are design targets, not measurements. Do not present them as verified results until they have actually been measured.

## Product Principles

1. **Fast is a feature, not an optimization.** Under a second to interactive is a requirement. Any change that adds work to startup must justify itself against that number.
2. **Designed, not assembled.** Type, spacing, color and motion are one system. Consistency is cheaper than novelty on every individual screen.
3. **Say no by default.** Analytics for the author is a product constraint, not a setting: adding it means retracting a stated promise. Anything else that leaves the machine is an integration the person turns on, one by one, and can turn off again.
4. **Surface the constraint, never hide it.** Premium-only and unsigned-installer are facts the user meets in the first minute. State them plainly instead of letting the user discover them.
5. **Bilingual from the first commit.** Spanish and English ship together. Copy is written so both read naturally, rather than writing one and translating the other.

### The crash report

**A crash report, and only a crash report.** Three conditions hold it inside the promise, and all three are load-bearing:

- **It needs a crash.** Star Music notices by asking the inverse question — did the previous session end cleanly? — because the deaths nobody can instrument from the inside (a hard abort, a driver fault, a process closed from the Task Manager) are the ones worth reporting.
- **It needs a click.** The app detects, builds the report, shows exactly what would leave the machine, and waits. There is no timer and no background upload. Promise 3 survives because nothing moves without someone asking.
- **It carries no personal data.** The log is scrubbed before it is shown on screen, not after, so there is no code path that can send the unscrubbed version: the Spotify account name, the Windows account name inside every path, anything shaped like a credential, and track identifiers all go.

Withdrawing it needs withdrawing the promise. Analytics is still off the table; this is a file someone hands over on purpose after their app has already died.

### Consented integrations

Some things only work if something leaves the machine: the minutes you listen counting on your Spotify account, Discord showing what you are playing. They are allowed, and only under four conditions, all load-bearing:

- **Off by default.** A fresh install sends nothing. No integration turns itself on, and none is switched on by an update.
- **A permission that says what, to whom and when.** Turning one on opens a dialog that names exactly what leaves (title, artist, cover, seconds heard…), who receives it (your Spotify account, Discord and the friends who see your status) and when (as each song starts and ends, while something plays). It also says what does not leave: nothing goes to Star Music or its author. "Allow" and "Not now" are the same size. If the person does not allow it, that integration does not exist for them; the rest of the app works the same.
- **Checked where the byte leaves.** The backend decides, not the switch in the webview (`consent.rs`). A grant carries the version of the text that was accepted; if an integration ever sends more, the version goes up and the person is asked again.
- **Revocable, at once.** Turning it off stops sending immediately and drops anything still waiting to go. Grants tied to the account (anything sent to Spotify) are dropped on sign-out, so another account on the same machine has to accept its own; the Discord grant belongs to the person on this machine and survives a sign-out, like the language.

Data goes from the person to a service the person chose, never to a server of Star Music. An integration that would send anything to the author is analytics, and is ruled out above.

The list of integrations is closed: one that is not here does not ship.

| Integration | What leaves | To whom |
|---|---|---|
| Plays on your account | Each song heard, with its context and the time really listened | Your Spotify account, through the session already signed in |
| Discord status | Title, artist, album, cover, progress and a public project link | The Discord app on this machine, and the people who see your status |
| Connect device (undecided) | That Star Music is a device, and what it plays | Your other devices on the same account |

**CarPlay and Android Auto are not on the list, and not by choice.** CarPlay needs an iOS app with Apple's CarPlay entitlement and Android Auto needs an Android app; a Windows desktop client can be neither. The road towards the car is the Connect device: a phone that sees Star Music can control it. If the Android app (`docs/android.md`) ships, Android Auto joins this list under the same four conditions. Until then, nothing may promise it.

### Library organisation stays local

Pinning and archiving playlists are per-account preferences on this device.
Pins have their own saved order, independent of the library's chosen sort.
They never modify the remote library or leave the machine. Archiving hides a
playlist from Star Music's shelves without removing it from an existing play queue;
the person can restore it from Archived playlists on Home or the phone's Library.
These preferences live beside settings, outside the credential directory, so
signing out does not erase them or apply them to another account.

### The listening history stays local

Home's "most played", "keep listening" and "your week" come from a history Star Music keeps **on this machine only** (`history.rs`, a `history.jsonl` next to `settings.json`). It never leaves the disk, so it reports to nobody and promise 3 stands. It records a song only after 30 seconds of real listening, keeps 120 days, and the person can switch it off or delete it from Settings.

It is not the same thing as "Plays on your account". That integration reports each play to Spotify as it happens, with its own permission; it never uploads `history.jsonl`, and turning one on or off does not touch the other. Sending the history file anywhere is ruled out like analytics.

## Accessibility & Inclusion

Not established with the user. Open questions: contrast targets, full keyboard operability of navigation and transport controls, and screen-reader labelling for player controls, search and dialogs. Do not assume a conformance level has been agreed.
