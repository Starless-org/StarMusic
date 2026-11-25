/**
 * How Home is arranged: the pure half, with no React and no backend, so the
 * rules can be tested (`homeLayout.test.ts`). The same rules are enforced in
 * Rust (`home_layout.rs`), which is the one that writes the file.
 */

/** The most tiles quick access holds — the same number as `QUICK_MAX` in Rust. */
export const QUICK_MAX = 12;

/** The shelves Home can show, in the order a new account sees them. */
export const SHELVES = [
  "keepListening",
  "mostPlayed",
  "yourWeek",
  "yourPlaylists",
  "madeForYou",
] as const;
export type ShelfId = (typeof SHELVES)[number];

export type Shelf = { id: ShelfId; hidden: boolean };
export type HomeView = "rows" | "covers";

/** A quick access tile: the saved songs, the DJ, or a playlist by its id. */
export type TileId = "liked" | "dj" | (string & {});

export type HomeLayout = {
  /** `null` until the person arranges it: the app fills it by itself until then. */
  quick: TileId[] | null;
  shelves: Shelf[];
  view: HomeView;
};

export const DEFAULT_LAYOUT: HomeLayout = {
  quick: null,
  shelves: SHELVES.map((id) => ({ id, hidden: false })),
  view: "rows",
};

const isShelf = (id: unknown): id is ShelfId => SHELVES.includes(id as ShelfId);
const isTile = (id: unknown): id is TileId =>
  typeof id === "string" && (id === "liked" || id === "dj" || /^[A-Za-z0-9]{22}$/.test(id));

/**
 * Every shelf once, in the saved order, and the ones the saved layout does not
 * mention appended where they belong by default: a shelf a later version adds
 * shows up instead of staying hidden behind a layout that never heard of it.
 */
export function normaliseHomeLayout(saved: Partial<HomeLayout> | null | undefined): HomeLayout {
  const seen = new Set<ShelfId>();
  const shelves: Shelf[] = [];
  for (const shelf of saved?.shelves ?? []) {
    if (!isShelf(shelf?.id) || seen.has(shelf.id)) continue;
    seen.add(shelf.id);
    shelves.push({ id: shelf.id, hidden: Boolean(shelf.hidden) });
  }
  for (const id of SHELVES) if (!seen.has(id)) shelves.push({ id, hidden: false });

  const quick = Array.isArray(saved?.quick)
    ? [...new Set(saved.quick.filter(isTile))].slice(0, QUICK_MAX)
    : null;
  return { quick, shelves, view: saved?.view === "covers" ? "covers" : "rows" };
}

/** `items` with the one at `from` moved to `to`; the rest keep their order. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The tiles quick access shows, only the ones that still exist.
 *
 * A playlist that was deleted or unfollowed is not drawn. It stays in the saved
 * layout until quick access next changes —a library that is still loading is
 * not a deleted playlist— and the next save, which starts from what is drawn,
 * lets it go. The DJ only shows for an account that has one.
 */
export function shownTiles(
  quick: readonly TileId[],
  exists: (id: string) => boolean,
  hasDj: boolean,
): TileId[] {
  return quick.filter((id) => id === "liked" || (id === "dj" ? hasDj : exists(id)));
}

/** `quick` with `id` at the end, unless it is already there or the row is full. */
export function addTile(quick: readonly TileId[], id: TileId): TileId[] {
  if (quick.includes(id) || quick.length >= QUICK_MAX) return [...quick];
  return [...quick, id];
}

export function removeTile(quick: readonly TileId[], id: TileId): TileId[] {
  return quick.filter((tile) => tile !== id);
}
