# Que la escucha cuente en la cuenta

Cómo una canción escuchada en Star Music llega a «Reproducido recientemente», a
los minutos y a las estadísticas de la cuenta, y cómo se supo. Es una
integración con permiso (`PRODUCT.md`, "Consented integrations"): apagada por
defecto, se enciende en Ajustes → Cuenta → Conexiones.

## Por qué no contaba

Spotify no cuenta lo que suena: cuenta lo que el cliente le **reporta**. El
cliente de escritorio manda eventos por cada canción a un servicio interno.
librespot reproduce el audio y no manda ninguno, a propósito (ver «El precio»).

## La receta

Dos pedidos por canción, los dos en `spclient.wg.spotify.com`, con el token de
la cuenta (`login5`) y el client token, cuerpo en protobuf binario:

1. **`POST /gabo-receiver-service/v3/events/`** con un `PublishEventsRequest`
   (`gabito.proto`): un `EventEnvelope` llamado `RawCoreStream`, cuyo fragmento
   `message` es el `RawCoreStream` —qué sonó, el contexto, cuándo empezó,
   cuántos milisegundos sonó y por qué terminó— y cuyos otros fragmentos son los
   contextos del cliente (`context_client_id`, `context_installation_id`,
   `context_application_desktop`, `context_device_desktop`, `context_time`,
   `context_monotonic_clock`, `context_sdk`, `context_client_context_id`).
   **Un `200` no dice que entró**: los rechazos vienen adentro de la respuesta
   (`PublishEventsResponse.error`) y se leen.
2. **`POST /herodotus/spotify.resumption.v1.ResumePointRevisionService/CreateResumePointRevision`**
   con la canción y la hora de inicio en la lista `spotify:list:play-history:v1`.
   Es lo que lee «Reproducido recientemente» en los otros dispositivos.

El código está en `src-tauri/src/spclient/plays.rs` (el formato, con tests) y
en `spclient::report_play` (la red). Se llama desde el comando `record_play`,
el mismo que escribe el historial local, así que **la medida es una sola**:
tiempo con la música sonando, sin pausas, y sólo canciones de 30 segundos o
más, que es el umbral de la propia historia de Spotify.

## Lo que decide si la canción llega a la historia

Medido por dos proyectos, contra una cuenta real, y no por nosotros todavía:

- **librespot#1759** (cerrado sin mergear): el `RawCoreStream` sólo aparece en
  la historia con el **`audio_id`** del archivo (`AudioFilesExtensionResponse`,
  campo 4, pedido como metadata extendida `AUDIO_FILES`) en hexadecimal, y con
  la **versión del cliente de escritorio** (`1.2.96.518`) en
  `context_application_desktop`. Con la versión de librespot (`1.2.52`) y sin
  `audio_id`, el servicio contesta `200` y la canción no aparece.
- **materialfy#54** (mergeado el 20 de noviembre de 2026): la misma receta,
  más la entrada de `herodotus`. Tres canciones escuchadas enteras aparecieron
  en «Reproducido recientemente» del teléfono en minutos.

Los números de campo salen de los protos que librespot 0.8 trae extraídos del
cliente oficial y no compila (`RawCoreStream.proto`, `gabito.proto`,
`context_*.proto`, `audio_files_extension.proto`), más los campos nuevos de
`RawCoreStream` del cliente 1.2.96 que publica librespot#1759. El código de acá
está escrito de cero sobre esos números, no copiado.

**Diferencias con lo medido**, por si algo no llega:

- `controlling_device_brand` y `controlling_device_model` (campos 78 y 79)
  dicen `Star Music` y no `librespot`.
- No se mandan los `AudioSessionEvent` de apertura y cierre ni el
  `RawCoreStreamSegment` que manda materialfy: librespot#1759 llegó a la
  historia sin ellos.
- `reason_start` es siempre `clickrow`: la app no distingue todavía una canción
  que siguió sola de una que se eligió.

## Lo medido con esta app

**27 de noviembre de 2026**, con una cuenta Premium que suena por librespot, en
una build de desarrollo de `feat/report-plays`, Windows 11: seis canciones
escuchadas enteras, de 161 a 214 segundos. En el log, las seis:
`escuchas: reportada una canción de N s (audio_id: sí)`, un segundo después de
que terminó cada una, sin rechazos dentro de la respuesta del servicio de
eventos y con `200` en `herodotus`. Las canciones aparecieron en «Reproducido
recientemente» de la cuenta.

**Lo que no se midió todavía:**

- **Una canción cortada entre los 30 segundos y el final** (`reason_end` =
  `endplay`). librespot#626 cuenta que, hace años, el servicio sólo tomaba las
  que terminaban solas.
- **Si cuentan en los minutos y en las estadísticas**, y no sólo en la
  historia: eso se ve días después, no en el momento.

Cuando se midan, se anotan acá con la fecha.

## El precio

**Los eventos describen al cliente como el de escritorio.** Esa es la razón por
la que librespot no lo hace (discusión librespot#626, y el cierre de #1759). Si
Spotify empieza a filtrar por otra cosa, los reportes dejan de contar **en
silencio**, y la app no se rompe: un reporte que falla deja una línea en el log
y nada más. Por eso es una integración con permiso y apagada por defecto, y el
diálogo dice exactamente qué sale.

**Un intento por canción, sin cola.** Un reporte que no sale se pierde: una
cola que reintenta es una cola que puede mandar después de que la persona dijo
que no.

**Soloist no reporta.** Con Soloist suena el cliente oficial de Spotify, que
reporta sus canciones solo; reportarlas también acá las contaría dos veces.
