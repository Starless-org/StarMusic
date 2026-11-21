/**
 * The old landing address, now a signpost.
 *
 * The landing lives on the Starless site now, under `/star-music/`, with the
 * same files it had here (`star-music.png`, `star-music.svg`, …). So the path is
 * kept: `/` goes to the page, and `/star-music.png`, which link previews cached
 * as the share image, goes to the same image there. The query string is kept
 * too. A path that never existed here ends on the Starless 404, which is honest.
 *
 * 301, because the move is permanent: search engines carry the old address's
 * standing over to the new one.
 */
interface Env {
  TARGET: string;
}

export default {
  fetch(request: Request, env: Env): Response {
    const from = new URL(request.url);
    const to = new URL(from.pathname.replace(/^\/+/, ""), env.TARGET);
    to.search = from.search;
    return Response.redirect(to.toString(), 301);
  },
};
