# Dónde vive la landing / Where the landing lives

La landing de Star Music ya no vive en este repo. Está en el sitio de Starless,
en el repo [`Starless-org/Starless`](https://github.com/Starless-org/Starless),
bajo la ruta `/star-music/`: su página, sus textos en inglés y español, sus
logos y la guía de su diseño (`docs/star-music/`) se mudaron allá tal cual.

The Star Music landing no longer lives in this repo. It is part of the Starless
site, in [`Starless-org/Starless`](https://github.com/Starless-org/Starless),
under `/star-music/`. Its page, its English and Spanish text, its logos and its
design notes (`docs/star-music/`) moved there unchanged.

## Por qué / Why

Starless reúne las landings de todas sus apps en un solo sitio, cada una en su
ruta. Los enlaces de descarga de la landing consultan la última release de
GitHub al cargar, así que no depende de la versión de la app y puede
publicarse desde otro repo.

## Lo que queda acá: la dirección vieja / What is left here: the old address

`https://star-music.bairovillar.workers.dev` sigue respondiendo, con una
redirección permanente (301) a la landing nueva. Así no se rompen los enlaces
ya compartidos ni las tarjetas que los chats guardaron.

| | |
| --- | --- |
| Código | `landing-redirect/src/index.ts`: conserva la ruta y la query (`/star-music.png` → `…/star-music/star-music.png`) |
| Destino | `TARGET` en `landing-redirect/wrangler.jsonc` |
| Quién publica | `.github/workflows/landing.yml`, en cada push a `main` que toque `landing-redirect/` |

Cuando el sitio de Starless tenga su dominio (`starless.cl`), se cambia
`TARGET` a `https://starless.cl/star-music/`.

## Lo que necesita el workflow / What the workflow needs

Los mismos dos secretos del repo de antes: `CLOUDFLARE_ACCOUNT_ID` y
`CLOUDFLARE_API_TOKEN` (plantilla *Edit Cloudflare Workers*).

A mano, desde `landing-redirect/`: `bunx wrangler deploy`.
