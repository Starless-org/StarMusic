/**
 * The widths the person gave the library and the queue.
 *
 * A width is the person's, like the theme or the accent: it survives a restart
 * and a sign-out. It lives in the webview's storage, which is under
 * `%LOCALAPPDATA%`, and not in `%APPDATA%\Star Music`, which signing out wipes.
 */
export const PANEL_MIN = 240;
export const PANEL_MAX = 480;

const KEY = "star-music:panel-widths";

export type PanelWidths = { library: number; queue: number };

function clampWidth(value: unknown): number {
  // `Number(null)` is 0, so an absent or broken value falls back to the minimum,
  // which is also the width the panels had before they could be resized.
  const width = Number(value);
  return Number.isFinite(width)
    ? Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(width)))
    : PANEL_MIN;
}

export function storedPanelWidths(): PanelWidths {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return { library: clampWidth(saved?.library), queue: clampWidth(saved?.queue) };
  } catch {
    return { library: PANEL_MIN, queue: PANEL_MIN };
  }
}

export function savePanelWidths(widths: PanelWidths): void {
  window.localStorage.setItem(
    KEY,
    JSON.stringify({ library: clampWidth(widths.library), queue: clampWidth(widths.queue) }),
  );
}
