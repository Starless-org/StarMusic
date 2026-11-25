import { Check, Eye, EyeOff, GripVertical, Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBack } from "../lib/back";
import type { HomeView, Shelf, ShelfId, TileId } from "../lib/homeLayout";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import { useSortable } from "../lib/useSortable";

type T = Record<StringKey, string>;

/** One tile of quick access, already resolved: what it shows and what it opens. */
export type QuickTileData = {
  id: TileId;
  title: string;
  subtitle?: string | null;
  art: ReactNode;
  onOpen: () => void;
  onPrefetch?: () => void;
  /** The playlist a right-click on the tile opens the menu of (lib/contextMenu.ts). */
  menuId?: string;
};

/**
 * Quick access: the tiles under the greeting, as rows with a name or as covers.
 *
 * **Editing is a mode, not a gesture.** Outside it a tap opens the list and a
 * drag scrolls Home, the way it always did; inside it a drag moves a tile, the
 * cross takes it out and the last tile adds one. A long-press would have been
 * one step shorter, but on the phone it is also how a scroll starts, and Home
 * would have reordered itself under a thumb that only wanted to go down.
 */
export function QuickAccess({
  t,
  tiles,
  view,
  editing,
  max,
  onReorder,
  onRemove,
  onAdd,
  snapshot,
}: {
  t: T;
  tiles: QuickTileData[];
  view: HomeView;
  editing: boolean;
  max: number;
  onReorder: (ids: TileId[]) => void;
  onRemove: (id: TileId) => void;
  onAdd: () => void;
  /**
   * Filled in by this component: call it right before the view changes, so the
   * tiles can morph from where they are to their new shape.
   */
  snapshot?: { current: (() => void) | null };
}) {
  const ids = useMemo(() => tiles.map((tile) => tile.id), [tiles]);
  const sortable = useSortable(ids, onReorder);
  const byId = new Map(tiles.map((tile) => [tile.id, tile]));
  const covers = view === "covers";

  // The pieces the view change moves, by tile: the surface behind it, the art
  // and the name.
  const parts = useRef(new Map<TileId, Parts>());
  const part = (id: TileId, key: keyof Parts) => (node: HTMLElement | null) => {
    const entry = parts.current.get(id) ?? {};
    if (node) entry[key] = node;
    else delete entry[key];
    parts.current.set(id, entry);
  };
  const before = useRef<Map<TileId, { surface: DOMRect; art: DOMRect }> | null>(null);

  // Where every tile is right now, the instant before the view changes. Read
  // off the screen, so a change in the middle of the last one starts from where
  // the tiles visibly are, not from where they were headed.
  if (snapshot) {
    snapshot.current = () => {
      const rects = new Map<TileId, { surface: DOMRect; art: DOMRect }>();
      for (const [id, { surface, art }] of parts.current) {
        if (surface && art) {
          rects.set(id, {
            surface: surface.getBoundingClientRect(),
            art: art.getBoundingClientRect(),
          });
        }
      }
      before.current = rects;
    };
  }

  /*
   * **The view change runs on the compositor.** Rows and covers are the same
   * tiles in another shape, so they morph instead of one grid replacing the
   * other. The first version did it with motion's `layout`, which computes
   * every frame in JavaScript, three boxes a tile, on the thread that was also
   * saving the layout and re-rendering Home: on the phone it ran at about 30
   * fps. This is the same move by hand —measure where each piece was, let it
   * take its new place, and animate the difference back to zero— with the Web
   * Animations API, whose transforms the compositor plays by itself.
   *
   * The surface and the art move separately: the art is square in both views,
   * so it only grows, and the surface is the one that stretches from a row to a
   * square. Neither is inside the other's transform, so the art is never
   * squashed. The name only fades in, after the move: a stretched line of text
   * reads as a glitch.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the view changes, and reads the snapshot taken just before.
  useLayoutEffect(() => {
    const from = before.current;
    before.current = null;
    if (!from || still()) return;
    const timing: KeyframeAnimationOptions = { duration: 380, easing: EASE_GLASS };
    for (const [id, { surface, art, name }] of parts.current) {
      const old = from.get(id);
      if (!old || !surface || !art) continue;
      for (const node of [surface, art]) {
        for (const running of node.getAnimations()) running.cancel();
      }
      invert(surface, old.surface, timing);
      invert(art, old.art, timing);
      name?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 200,
        delay: 180,
        fill: "backwards",
      });
    }
  }, [view]);

  return (
    <div
      className={
        covers
          ? "grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6"
          : "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
      }
    >
      {sortable.order.map((id) => {
        const tile = byId.get(id);
        if (!tile) return null;
        const lifted = sortable.dragging === id;
        // The surface is its own layer under the art and the name, which let
        // the pointer through to it: it is what the hand hovers, so it keeps
        // the glass's own hover.
        const surface = (
          <span
            ref={part(id, "surface")}
            aria-hidden="true"
            className={`surface-tile absolute inset-0 origin-top-left rounded-[14px] ${
              editing ? "ring-1 ring-white/18" : ""
            } ${lifted ? "shadow-[0_18px_40px_rgb(0_0_0/0.45)]" : ""}`}
          />
        );
        const art = (
          <span
            ref={part(id, "art")}
            className={`pointer-events-none relative block shrink-0 origin-top-left overflow-hidden ${
              covers ? "size-full rounded-[14px]" : "size-16 rounded-l-[14px]"
            }`}
          >
            {tile.art}
          </span>
        );
        const label = (
          <span ref={part(id, "name")} className="pointer-events-none relative min-w-0">
            <span className="block truncate text-[14px] font-semibold">{tile.title}</span>
            {tile.subtitle && (
              <span className="block truncate text-[12px] text-ink-muted">{tile.subtitle}</span>
            )}
          </span>
        );
        const shape = covers
          ? "block aspect-square"
          : `flex h-16 items-center gap-3.5 ${editing ? "pr-12" : "pr-4"}`;

        return (
          <motion.div
            key={id}
            ref={sortable.register(id)}
            // Only in the editor, where the order changes under a finger and
            // the others make room with a spring. The view change is the
            // compositor's (above), and two animations on one box would fight.
            layout={editing && !lifted}
            transition={SPRING}
            style={lifted ? { x: sortable.x, y: sortable.y, zIndex: 10 } : undefined}
            animate={{ scale: lifted ? 1.04 : 1 }}
            className="relative"
          >
            {editing ? (
              // A button that does nothing on a click: in the editor a tile is
              // something to move, by dragging it or with the arrow keys.
              <button
                type="button"
                aria-roledescription="sortable"
                aria-label={tile.title}
                aria-description={t.homeSectionsHint}
                onPointerDown={sortable.onPointerDown(id)}
                onKeyDown={(event) => {
                  if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    onRemove(id);
                    return;
                  }
                  sortable.onKeyDown(id)(event);
                }}
                className={`relative w-full cursor-grab touch-none select-none rounded-[14px] text-left active:cursor-grabbing ${shape}`}
              >
                {surface}
                {art}
                {!covers && label}
              </button>
            ) : (
              <button
                type="button"
                data-playlist-id={tile.menuId}
                onClick={tile.onOpen}
                onPointerEnter={tile.onPrefetch}
                onFocus={tile.onPrefetch}
                aria-label={covers ? tile.title : undefined}
                title={covers ? tile.title : undefined}
                className={`arrive relative w-full rounded-[14px] text-left ${shape}`}
              >
                {surface}
                {art}
                {!covers && label}
              </button>
            )}
            {editing && (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onRemove(id)}
                aria-label={t.removeQuickTile.replace("{name}", tile.title)}
                title={t.removeQuickTile.replace("{name}", tile.title)}
                // Inside the tile, not hanging off its corner: on the phone the
                // last column touches the screen's edge, and a cross that hung
                // out was cut in half there.
                className={`absolute z-20 grid size-7 place-items-center rounded-pill border border-eclipse bg-night text-ink shadow-[0_4px_12px_rgb(0_0_0/0.4)] ${
                  covers ? "top-1.5 right-1.5" : "top-1/2 right-3 -translate-y-1/2"
                }`}
              >
                <X className="size-3.5" strokeWidth={2.4} />
              </button>
            )}
          </motion.div>
        );
      })}

      {editing && tiles.length < max && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={t.addQuickTile}
          title={t.addQuickTile}
          className={`grid place-items-center rounded-[14px] border border-dashed border-white/24 text-ink-muted transition-colors duration-200 hover:border-white/40 hover:text-ink ${
            covers ? "aspect-square" : "h-16"
          }`}
        >
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <Plus className="size-5" strokeWidth={2} />
            {!covers && t.addQuickTile}
          </span>
        </button>
      )}
    </div>
  );
}

/** What the picker offers: everything that can be a tile, with its art. */
export type PickerOption = { id: TileId; title: string; art: ReactNode };

/**
 * The library, to add tiles to quick access from.
 *
 * **It stays open while you add.** Each row adds or takes out its tile and
 * shows which ones are in; picking three lists is three taps and one "Done",
 * not three trips through a dialog. Full is said at the top, and the rows that
 * cannot be added any more are dimmed rather than hidden.
 */
export function QuickAccessPicker({
  t,
  open,
  options,
  chosen,
  max,
  onToggle,
  onClose,
}: {
  t: T;
  open: boolean;
  options: PickerOption[];
  chosen: readonly TileId[];
  max: number;
  onToggle: (id: TileId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useBack(open, onClose);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? options.filter((option) => option.title.toLocaleLowerCase().includes(needle))
    : options;
  const full = chosen.length >= max;
  const count = t.quickAccessCount
    .replace("{count}", String(chosen.length))
    .replace("{max}", String(max));

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 sm:items-center sm:px-6"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t.addQuickTile}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={SPRING}
            className="glass-overlay flex max-h-[80vh] w-full max-w-[440px] flex-col gap-3 rounded-t-[18px] p-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:rounded-[18px]"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold tracking-tight">{t.addQuickTile}</h2>
                <p className="tabular mt-0.5 text-[12px] text-ink-muted">
                  {full ? t.quickAccessFull.replace("{max}", String(max)) : count}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-8 shrink-0 rounded-pill bg-white/10 px-4 text-[13px] font-semibold transition-colors duration-200 hover:bg-white/16"
              >
                {t.editHomeDone}
              </button>
            </div>

            <label className="flex items-center gap-2 rounded-[10px] bg-white/6 px-3 ring-accent/60 focus-within:ring-2">
              <Search className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />
              <input
                ref={input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.quickPickerSearch}
                aria-label={t.quickPickerSearch}
                className="min-w-0 flex-1 bg-transparent py-2.5 text-[13px] outline-none"
              />
            </label>

            <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
              {shown.length === 0 && (
                <li className="px-2 py-6 text-center text-[13px] text-ink-faint">
                  {t.quickPickerEmpty}
                </li>
              )}
              {shown.map((option) => {
                const added = chosen.includes(option.id);
                const blocked = !added && full;
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      aria-pressed={added}
                      disabled={blocked}
                      onClick={() => onToggle(option.id)}
                      className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors duration-200 hover:bg-white/6 disabled:opacity-35 disabled:hover:bg-transparent"
                    >
                      <span className="relative size-10 shrink-0 overflow-hidden rounded-[8px] bg-white/8">
                        {option.art}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                        {option.title}
                      </span>
                      <span
                        className={`grid size-7 shrink-0 place-items-center rounded-pill ${
                          added
                            ? "bg-accent text-on-accent"
                            : "border border-white/20 text-ink-muted"
                        }`}
                      >
                        {added ? (
                          <Check className="size-4" strokeWidth={2.4} />
                        ) : (
                          <Plus className="size-4" strokeWidth={2.2} />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Home's sections, while editing: one row each, to drag into order and to
 * show or hide. The sections themselves are not drawn while editing —dragging
 * a shelf of six covers would be a drag across half the screen— and come back
 * in the new order on "Done".
 */
export function ShelfEditor({
  t,
  shelves,
  names,
  onChange,
}: {
  t: T;
  shelves: Shelf[];
  names: Record<ShelfId, string>;
  onChange: (shelves: Shelf[]) => void;
}) {
  const ids = useMemo(() => shelves.map((shelf) => shelf.id), [shelves]);
  const byId = new Map(shelves.map((shelf) => [shelf.id, shelf]));
  const sortable = useSortable(ids, (order) =>
    onChange(order.map((id) => byId.get(id) ?? { id, hidden: false })),
  );

  return (
    <section aria-label={t.homeSections}>
      <h2 className="px-1 font-display text-[22px] font-semibold tracking-tight">
        {t.homeSections}
      </h2>
      <p className="mt-1 mb-3 px-1 text-[12.5px] text-ink-faint">{t.homeSectionsHint}</p>
      <ul className="flex flex-col gap-2">
        {sortable.order.map((id) => {
          const shelf = byId.get(id);
          if (!shelf) return null;
          const lifted = sortable.dragging === id;
          const name = names[id];
          return (
            <motion.li
              key={id}
              ref={sortable.register(id)}
              layout={lifted ? false : "position"}
              transition={SPRING}
              style={lifted ? { x: sortable.x, y: sortable.y, zIndex: 10 } : undefined}
              animate={{ scale: lifted ? 1.02 : 1 }}
              className="relative"
            >
              <div
                className={`surface-card flex h-14 items-center rounded-[14px] border border-white/8 pr-2 ${
                  lifted ? "shadow-[0_18px_40px_rgb(0_0_0/0.45)]" : ""
                }`}
              >
                {/* The handle is the row up to the eye: drag it, or arrows on it. */}
                <button
                  type="button"
                  aria-roledescription="sortable"
                  aria-label={name}
                  aria-description={t.homeSectionsHint}
                  onPointerDown={sortable.onPointerDown(id)}
                  onKeyDown={sortable.onKeyDown(id)}
                  className="flex h-full min-w-0 flex-1 cursor-grab touch-none items-center gap-3 pl-3 text-left select-none active:cursor-grabbing"
                >
                  <GripVertical className="size-5 shrink-0 text-ink-faint" strokeWidth={2} />
                  <span
                    className={`min-w-0 flex-1 truncate text-[14px] font-semibold ${
                      shelf.hidden ? "text-ink-faint line-through decoration-white/30" : ""
                    }`}
                  >
                    {name}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      shelves.map((item) =>
                        item.id === id ? { ...item, hidden: !item.hidden } : item,
                      ),
                    )
                  }
                  aria-pressed={!shelf.hidden}
                  aria-label={(shelf.hidden ? t.showSection : t.hideSection).replace(
                    "{name}",
                    name,
                  )}
                  title={(shelf.hidden ? t.showSection : t.hideSection).replace("{name}", name)}
                  className="grid size-10 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink"
                >
                  {shelf.hidden ? (
                    <EyeOff className="size-5" strokeWidth={2} />
                  ) : (
                    <Eye className="size-5" strokeWidth={2} />
                  )}
                </button>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}

/** The pieces of a tile that the view change moves. */
type Parts = { surface?: HTMLElement; art?: HTMLElement; name?: HTMLElement };

/** `--ease-glass`, for the Web Animations API, which does not read CSS variables. */
const EASE_GLASS = "cubic-bezier(0.32, 0.72, 0, 1)";

/** Motion off, in the app's settings or in the system's. */
function still(): boolean {
  return (
    document.documentElement.hasAttribute("data-still") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Plays `node` from the box `old` to the box it has now: the first frame puts
 * it back where it was, and the animation takes the difference to zero. Only a
 * transform, so the compositor plays it without the page's thread.
 */
function invert(node: HTMLElement, old: DOMRect, timing: KeyframeAnimationOptions) {
  const now = node.getBoundingClientRect();
  if (now.width === 0 || now.height === 0) return;
  const dx = old.left - now.left;
  const dy = old.top - now.top;
  const sx = old.width / now.width;
  const sy = old.height / now.height;
  const still = Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5;
  if (still && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
  node.animate(
    [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: "none" }],
    timing,
  );
}
