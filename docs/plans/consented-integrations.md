# Plan: integraciones con consentimiento

> Plan para que lo ejecute un agente (Sonnet). Está escrito para leerse de arriba
> abajo y ejecutarse por fases. Cada fase termina en un PR propio contra `develop`.
> Antes de empezar, leé `AGENTS.md`, `PRODUCT.md`, `DESIGN.md` y cargá el skill
> `.agent/skills/star-music/SKILL.md`.

## Qué cambia y por qué

Hasta hoy la promesa era **cero datos fuera de la máquina** (PRODUCT.md, promesa 3;
AGENTS.md, reglas 2 y 3). La regla nueva:

> **Nada sale de la máquina sin un permiso explícito de la persona, integración por
> integración.** Cada integración que manda datos afuera está **apagada por
> defecto**, muestra antes de activarse exactamente qué sale, a quién y cuándo, y
> sólo funciona si la persona acepta. Si no acepta, esa función no existe para ella.
> Se puede revocar en cualquier momento y deja de mandar en el acto.

Para qué existe la excepción:

1. **Que los minutos escuchados cuenten en la cuenta de Spotify** (historial,
   "reproducido recientemente", estadísticas, Wrapped).
2. **Mostrar lo que suena en Discord** (Rich Presence).
3. **Que la app se vea desde otros dispositivos** (Spotify Connect), que es el
   camino real hacia el auto, el teléfono y los parlantes. Ver "CarPlay" abajo.

Lo que **no** cambia:

- **Analítica para el autor sigue prohibida.** Las integraciones mandan los datos
  de la persona al servicio que *ella* eligió; nunca a un servidor de Star Music.
  No se agrega ningún endpoint propio que reciba datos de uso.
- El reporte de crash sigue igual (ya era con clic).
- El historial local (`history.rs`) sigue local. No se sube a ningún lado.
- La regla de no usar el nombre/logo de Spotify en la marca sigue igual.
- El backend sigue siendo la frontera de confianza: **el permiso se comprueba en
  Rust**, no en el frontend. El frontend nunca decide si algo sale.

### Interpretación a confirmar con el usuario

"Si no acepta no funciona" se interpreta como **la integración** no funciona, no
la app entera. La app sigue reproduciendo sin ningún permiso concedido. Si el
usuario quiere lo contrario (no poder usar la app sin aceptar), **parar y
preguntar** antes de la Fase 1: contradice "Say no by default" y cambia el primer
minuto de la app.

### CarPlay

CarPlay **no aplica** a una app de escritorio de Windows: exige una app de iOS con
el entitlement de CarPlay de Apple (y Android Auto, una app de Android). No hay
nada que implementar acá hoy. Lo que sí acerca al auto es la **Fase 4 (Connect)**:
con la app registrada como dispositivo Connect, el teléfono la ve y la controla. El
día que exista la app de Android (`docs/android.md`), Android Auto entra como una
integración más bajo este mismo modelo de permisos. Dejar esto escrito en
`PRODUCT.md` para que nadie lo prometa.

## Orden de las fases

| Fase | PR | Rama | Depende de |
|---|---|---|---|
| 0 | Reglas nuevas en los documentos — **hecha (#182)** | `feat/consented-integrations` | — |
| 1 | Infraestructura de permisos + sección en Ajustes — **hecha (#183)** | `feat/consent-infrastructure` | 0 |
| 2 | Discord Rich Presence — **hecha; falta el Application ID** | `feat/discord-presence` | 1 |
| 3 | Reportar reproducciones a la cuenta — **hecha y medida el 27/11/2026** (`docs/reportar-reproducciones.md`) | `feat/report-plays` | 1 |
| 4 | Dispositivo Connect | `feat/connect-device` | 1 + **decisión del usuario** |

Fases 2 y 3 son independientes entre sí una vez mergeada la 1.

---

## Fase 0 — Reescribir las reglas

Rama: `feat/consented-integrations` (ya creada desde `develop`). Sólo documentos.

### `PRODUCT.md`

- **Positioning, claim 3**: de "Zero telemetry" a algo como **"Nothing leaves
  without your say-so."** Star Music reports usage data to nobody, its author
  included; integrations that share your listening with services you choose
  (your Spotify account, Discord) are off until you turn them on, and say exactly
  what they send.
- **Product Principles, 3 ("Say no by default")**: mantener el espíritu —
  defaults en "no"—, reemplazar "Zero telemetry is a product constraint, not a
  setting" por: analytics to the author stays ruled out; anything else that
  leaves the machine is an opt-in integration, per integration, revocable.
- **Nueva sección "Consented integrations"** (al lado de "The one carve-out"):
  las cuatro condiciones que la sostienen —apagado por defecto; pantalla de
  permiso que dice qué, a quién y cuándo; comprobado en el backend; revocable con
  efecto inmediato— y la lista de integraciones vigentes. Una integración nueva se
  agrega a esa lista o no existe.
- **"The listening history is not telemetry"**: aclarar que el historial local
  sigue sin salir; la integración de Spotify manda reproducciones *al momento*, no
  sube `history.jsonl`.
- **Undecided → "Whether Star Music registers as a Spotify Connect device"**:
  dejarlo como pendiente de decisión, enlazado a la Fase 4.
- Agregar la nota de CarPlay/Android Auto (ver arriba).

### `AGENTS.md`

- **Regla 2** → "**Nada sale sin permiso.** Analítica para el autor: nunca.
  Integraciones con servicios que elige la persona: apagadas por defecto, con
  pantalla de permiso, comprobadas en Rust (`consent.rs`), revocables. El log
  sigue opt-in." 
- **Regla 3** hoy dice "Nada de telemetría, ni de nombre de Spotify": dejar sólo la
  parte del nombre/logo de Spotify en la marca, y que la telemetría la cubra la 2.
- En el **Mapa**, agregar `consent.rs`, `discord.rs`, `scrobble.rs` (o el nombre
  que salga de la Fase 3) a medida que existan.
- Nueva trampa: **"Un permiso se comprueba donde sale el byte, no donde se dibuja
  el interruptor"** (el frontend puede estar desincronizado; el backend no manda
  nada si `consent::granted(..)` es falso).

### Otros

- Comentarios en `src-tauri/src/history.rs` (encabezado) y en
  `settings.rs::history_enabled` que dicen "no es la telemetría que PRODUCT.md
  descarta": ajustarlos al lenguaje nuevo sin cambiar el comportamiento.
- `README.md`: si menciona "cero telemetría", actualizarlo con la misma frase que
  PRODUCT.md (buscar con `grep -rn -i "telemetr" README.md docs .agent`).
- `.agent/skills/star-music/` : buscar referencias a la regla vieja y alinearlas.

Commit: `docs(product): allow consented integrations alongside the no-analytics rule`.
PR a `develop`.

---

## Fase 1 — Infraestructura de permisos

Rama: `feat/consent-infrastructure` desde `develop` (con la Fase 0 mergeada).

### Backend: `src-tauri/src/consent.rs` (nuevo)

```rust
pub enum Integration { SpotifyPlays, DiscordPresence, ConnectDevice }

pub struct Grant {
    pub granted_at: i64,   // unix seconds
    pub version: u32,      // versión del texto de permiso aceptado
}
```

- `fn granted(i: Integration) -> bool`: verdadero sólo si hay `Grant` **y**
  `grant.version == current_version(i)`. Si en el futuro una integración manda
  algo más, se sube su versión y se vuelve a preguntar.
- `fn grant(i)`, `fn revoke(i)`.
- **Dónde se guarda:** en `settings.json` (`%LOCALAPPDATA%\Star Music`, ver la
  trampa de `%APPDATA%` en AGENTS.md), campo nuevo en `Settings`:
  `#[serde(default)] pub consents: HashMap<String, Grant>`.
- **Alcance por integración:**
  - `SpotifyPlays` y `ConnectDevice` son **de la cuenta**: se revocan al cerrar
    sesión (llamar `consent::revoke_account_scoped()` desde el mismo lugar donde
    hoy corren `keycheck::clear` y `soloist::forget`). Otra cuenta en la misma
    máquina tiene que aceptar de nuevo.
  - `DiscordPresence` es **de la persona en esta máquina**: sobrevive al cierre de
    sesión, como el idioma.
- Al revocar, emitir un evento interno para que el módulo de esa integración se
  apague **en el acto** (Discord: limpiar la actividad y cerrar el pipe; Spotify:
  dejar de encolar eventos y descartar los pendientes).

Comandos Tauri (en `lib.rs`, `async` si tocan disco/red):

- `consent_status() -> HashMap<String, bool>` — el frontend sólo recibe booleanos.
- `consent_grant(integration: String)`
- `consent_revoke(integration: String)`

Tests en `consent.rs` (`cargo test --lib`):

- `nothing_is_granted_by_default`
- `an_old_version_of_a_grant_is_not_a_grant`
- `signing_out_revokes_account_grants_and_keeps_discord`

### Frontend

- `src/lib/spotify.ts` (o un `src/lib/consent.ts` nuevo): hooks de React Query
  sobre los tres comandos.
- **Ajustes → sección nueva "Conexiones" / "Connections"** en `SettingsPanel.tsx`,
  siguiendo su estilo (es la referencia visual). Una fila por integración, con un
  interruptor.
- **Activar no es un clic en el interruptor: abre un diálogo de permiso.** El
  diálogo (glass-overlay, como los otros diálogos) dice, para cada integración:
  - **Qué sale** (lista concreta: título, artista, carátula, segundos escuchados…).
  - **A quién** (tu cuenta de Spotify / Discord, y por Discord, tus amigos).
  - **Cuándo** (al empezar y terminar cada canción / mientras suena).
  - **Qué no sale** (nada va a Star Music ni a su autor).
  - Dos botones: "Permitir" y "Ahora no". Cerrar el diálogo = "Ahora no".
- Apagar el interruptor revoca sin diálogo.
- **Todo el texto en `src/lib/i18n.ts`, ES y EN a la vez**, escritos para que los
  dos lean natural. Revisar `DESIGN.md` para tono y componentes.

Commit(s): `feat(consent): add per-integration consent stored in settings`,
`feat(settings): add a connections section with a consent dialog`.

---

## Fase 2 — Discord Rich Presence

Rama: `feat/discord-presence`.

### Cómo funciona Discord

El cliente de Discord de escritorio escucha en un named pipe local
(`\\.\pipe\discord-ipc-0` … `-9`). Se manda un handshake con un **Application ID**
y después `SET_ACTIVITY`. No hay red propia: lo publica el cliente de Discord.

### Requisito externo (pedírselo al usuario, no inventarlo)

- **Un Application ID de Discord**, creado por el mantenedor en
  <https://discord.com/developers/applications>, con nombre "Star Music" y el ícono
  de la app subido como asset (`star_music`). El ID es público (no es secreto),
  pero **no lo crees vos ni pongas uno de ejemplo**: pedíselo al usuario y
  compilalo con `option_env!("STAR_MUSIC_DISCORD_APP_ID")`. Si falta o está vacío
  (ver la trampa de `option_env!` con `Some("")` en AGENTS.md), la fila de Discord
  en Ajustes se muestra deshabilitada con una línea que lo explica.

### Backend: `src-tauri/src/discord.rs` (nuevo)

- Evaluar el crate `discord-rich-presence` (pequeño, sin runtime async). Si trae
  dependencias pesadas, implementar el IPC a mano: son ~150 líneas (frame =
  `op:u32 LE` + `len:u32 LE` + JSON).
- **La fuente de datos ya existe**: el comando `media_session` en `lib.rs` recibe
  `Option<media_keys::NowPlaying>` (título, artista, álbum, carátula, playing) para
  la tarjeta de Windows y la bandeja. Agregar ahí una tercera llamada
  `discord::update(now.clone())`. **No crear un segundo camino** desde el frontend:
  una sola fuente de "qué suena".
- `discord::update` no hace nada si `!consent::granted(DiscordPresence)`.
- Actividad:
  - `type: 2` (Listening), `details` = título, `state` = artista,
  - `assets.large_image` = URL de la carátula (`i.scdn.co`, Discord acepta URLs
    externas) con fallback al asset `star_music`, `large_text` = álbum,
  - timestamps `start`/`end` con la posición y duración **que se oyen** (ver la
    trampa de la posición del decoder vs. la cola en AGENTS.md: usar la que ve la
    webview, no la del decoder),
  - en pausa: limpiar la actividad (o `state` "En pausa" sin timestamps; elegir uno
    y documentarlo).
  - **Nunca el nombre "Spotify"** en ningún campo (regla de marca).
- Hilo propio con reconexión: si Discord no está abierto, reintentar cada ~15 s sin
  loguear en cada intento. Throttle: Discord limita `SET_ACTIVITY` a ~5 cada 20 s;
  coalescer actualizaciones (última gana).
- No puede sumar trabajo al arranque: conectar recién cuando hay permiso **y** algo
  suena.
- Revocar → `CLEAR_ACTIVITY` + cerrar el pipe.
- DJ hablando: usar el nombre del DJ y la frase como `state`, igual que la barra.

Tests: el encoding del frame y el armado de la actividad (sin pipe real).

Commit: `feat(discord): show what is playing in Discord when the person allows it`.

**Lo que se decidió al hacerla:**

- IPC escrito a mano (sin crate): ~200 líneas, sin dependencias nuevas.
- En pausa, el estado **se borra** (no "En pausa" sin tiempos): el diálogo dice
  "mientras suena algo".
- La posición se envía cuando cambia la canción, el play/pausa o la posición
  se aparta más de un segundo de su avance esperado. Así los saltos actualizan
  Discord sin enviar cada tick del reproductor. Hasta cinco cambios en una
  ventana de veinte segundos salen sin una espera fija; si se agota ese cupo,
  queda pendiente el estado más reciente.
- Las transiciones de carga no se publican en Discord. El backend descarta
  actividades equivalentes, tolerando un segundo de variación del reloj, y
  agrupa los cambios de posición durante 250 ms. Pausar no espera esa agrupación.
  Los cinco envíos por veinte segundos son el presupuesto conservador de la
  app; falta medir por separado el límite que aplica el cliente de Discord.
- El DJ hablando muestra su nombre, sin artista, sin portada y sin barra.
- Sólo Windows por ahora; Linux y macOS usan un socket Unix.
- Falta: crear la aplicación en el portal de Discord y cargar su ID como la
  variable del repositorio `STAR_MUSIC_DISCORD_APP_ID`. Sin ella, la integración
  no aparece en Ajustes.

---

## Fase 3 — Que lo escuchado cuente en la cuenta

Rama: `feat/report-plays`. **Esta fase empieza con una medición, no con código de
producto.** Es la cultura del repo (`docs/jam.md`, `docs/escribir-playlists.md`):
un camino real se mide, no se adivina.

### Por qué hoy no cuenta

La app usa el `Player` de librespot directo, sin `Spirc` (librespot-connect está en
`Cargo.toml` pero no se usa en `src/`). Spotify arma el historial y los minutos a
partir de eventos que el cliente le manda (el servicio de eventos, conocido como
`gabo-receiver-service`) y/o del estado de Connect. Ninguno de los dos sale hoy.

### Paso 3.1 — Sonda (sólo debug)

Crear la sonda `STAR_MUSIC_SP_PLAYS=1`, con el mismo patrón que las otras
(`#[cfg(debug_assertions)]`, ver `spclient/probe.rs`). Medir dos candidatos y
anotar el resultado en un documento nuevo **`docs/reportar-reproducciones.md`**,
con lo que se probó, lo que contestó y lo que se descartó:

- **A. Servicio de eventos.** `POST /gabo-receiver-service/v3/events` (y la
  variante `public/v3/events`) en `spclient.wg.spotify.com`, cuerpo protobuf
  (`PublishEventsRequest` con `EventEnvelope`s). Buscar los protos en
  `librespot-protocol` 0.8 primero; si no están, sacarlos del cliente de escritorio
  con `scripts/proto-dump.ts`, como se hizo con el jam. Eventos candidatos:
  `RawCoreStream` / `TrackTransition` / `AudioSessionEvent` (confirmar nombres en
  los descriptores, no de memoria). Usar el token de la cuenta, como `client-tts`.
- **B. Estado de Connect.** Arrancar un `Spirc` de librespot-connect con el player
  existente (sin crear otro player: ver la trampa de WASAPI) y comprobar si las
  reproducciones aparecen en el historial sólo con eso.

**Criterio de éxito, medido:** reproducir 3 canciones completas (>30 s) y una
saltada en <30 s desde Star Music; en ≤10 min las 3 aparecen en "Reproducido
recientemente" del cliente oficial (en otro dispositivo) y la saltada se comporta
como en el cliente oficial. Anotar tiempos. Si ninguno de los dos funciona,
**parar, escribir lo medido en el documento y avisar**; no seguir a ciegas.

**Límites que no se cruzan** (ya están en AGENTS.md): nada de PlayPlay/Widevine,
nada de una segunda identidad o client id propio (regla 7). Todo por la sesión de
librespot ya autenticada.

### Paso 3.2 — Implementación

Con el camino medido:

- Módulo nuevo (`src-tauri/src/scrobble.rs` o nombre acorde), detrás de la capa de
  `spclient`: ninguna llamada a librespot fuera de su módulo.
- **Engancharlo a los eventos del player en `playback.rs`** (`Playing`, `Paused`,
  `EndOfTrack`, cambio de pista), no a `record_play` del frontend: el backend sabe
  cuánto sonó de verdad. Contar **ms realmente oídos** (pausas y seeks restan), y
  respetar el umbral que use Spotify (el que se mida; no reutilizar
  `MIN_LISTENED_MS` sin comprobar).
- Gate: `consent::granted(SpotifyPlays)` en el punto exacto donde sale el request.
- **Cola en disco** para no perder reproducciones sin red: archivo pequeño en
  `%LOCALAPPDATA%\Star Music`, reintento con backoff, y se **descarta entera** al
  revocar o cerrar sesión. Sólo contiene lo pendiente; no es un segundo historial.
- HTTP en Rust y nunca `reqwest::blocking` en un comando async (trampa conocida).
- **Soloist:** fuera de alcance en esta fase. Dejarlo escrito en el documento. Si
  se tocara, va a la lista cerrada de puntos de contacto de Soloist en AGENTS.md.
- Crossfade: la canción que sale se reporta con lo que realmente se oyó hasta el
  fundido.
- DJ y radio: se reportan como reproducciones normales con su contexto (`context_uri`
  del DJ / estación), si el protocolo lo pide.

Tests: el contador de ms oídos (pausa, seek, crossfade, skip), la cola que se vacía
al revocar.

Commits: `feat(probe): measure how plays reach the account`,
`feat(playback): report listened plays to the account with consent`.

**Lo que se decidió al hacerla** (detalle en `docs/reportar-reproducciones.md`):

- No hizo falta una sonda para encontrar la puerta: la receta ya estaba medida
  contra una cuenta real por librespot#1759 y materialfy#54 (`RawCoreStream` a
  `gabo-receiver-service` más la entrada de `herodotus`). Lo que falta es
  medirla con esta app.
- La medida sale de `record_play`, la misma que escribe el historial local, y
  no de los eventos de `playback.rs`: una sola respuesta a "cuánto se escuchó".
  Por eso sólo se reportan canciones de 30 segundos o más.
- Sin cola en disco: un intento por canción, como decía el ROADMAP.
- Con Soloist activo no se reporta (el cliente oficial ya lo hace); es un punto
  de contacto nuevo y quedó en la lista de AGENTS.md.

---

## Fase 4 — Dispositivo Connect (requiere decisión)

`PRODUCT.md` tiene esto como **"Undecided"**. **No empezar sin que el usuario lo
decida explícitamente.** Si lo aprueba:

- Usar `librespot-connect` (`Spirc`) con el `Player` y el mixer existentes. **Un
  solo player** (WASAPI) y respetar `tauri-plugin-single-instance`.
- Integración `ConnectDevice` con su propio permiso: "otros dispositivos de tu
  cuenta van a ver y controlar Star Music".
- Conflicto a resolver: con Connect, el teléfono puede mandar cola/pista; la cola
  hoy vive en `App.tsx`. Definir quién manda antes de codear y escribirlo.
- Si la Fase 3 terminó usando Spirc (opción B), esta fase es en buena parte
  exponer y permisar lo que ya existe.

---

## Reglas de ejecución (para cada fase)

- **Rama propia desde `develop`**, `type/short-description` en inglés. Nunca
  commitear ni empujar a `develop` o `main`. PR a `develop`.
- Commits `tipo(scope): …` en inglés, cuerpo con el porqué en inglés.
  **Sin `Co-Authored-By`, sin `Claude-Session`, sin "Generated with Claude Code".**
- Antes de cada PR: `bun run lint`, `bun run typecheck`, `bun run version`,
  `cd src-tauri && cargo check && cargo test --lib`, y `bun run test`.
- **No correr builds** (`bunx vite build`, `bun run app:build`, `cargo build`) sin
  preguntar. `bun run app` para probar en vivo sí, pero avisando.
- Si se toca UI: captura antes y después en el PR.
- Notas de versión **dos veces**: `CHANGELOG.md` bajo `## [Sin publicar]` y
  `src/lib/changelog.ts`, en los dos idiomas.
- Todo texto de usuario por `src/lib/i18n.ts`, ES y EN juntos.
- Comentarios con el porqué; no borrar los que existen "porque algo falló en vivo".
- Si algo de este plan choca con lo que se mide, gana lo medido: corregir el plan
  en este archivo en el mismo PR y decirlo.

## Preguntas abiertas para el usuario

1. ¿"Si no acepta no funciona" es la integración o la app entera? (el plan asume la
   integración).
2. Application ID de Discord (lo crea el mantenedor).
3. ¿Star Music se registra como dispositivo Connect? (Fase 4).
4. ¿Otras integraciones en el mismo modelo, p. ej. Last.fm? Fuera de alcance salvo
   que se pida.
