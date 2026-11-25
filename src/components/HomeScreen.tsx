import { Check, LayoutGrid, LayoutList, Lock, Pencil, Play as PlayIcon, Radio } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, type ReactNode, useRef, useState } from "react";
import { useBack } from "../lib/back";
import { type ShelfId, type TileId, useHomeLayout } from "../lib/homeLayout";
import { addTile, QUICK_MAX, removeTile, shownTiles } from "../lib/homeLayoutModel";
import type { StringKey } from "../lib/i18n";
import { useLibraryOrganisation } from "../lib/libraryOrganisation";
import { SPRING } from "../lib/motion";
import { type Artist, type HomeStats, isDjCard, type Play, type Playlist } from "../lib/spotify";
import { isMobile } from "../lib/version";
import { ArchivedPlaylists } from "./ArchivedPlaylists";
import { DjArtwork } from "./DjArtwork";
import {
  type PickerOption,
  QuickAccess,
  QuickAccessPicker,
  type QuickTileData,
  ShelfEditor,
} from "./HomeEditor";
import { LikedCover } from "./LikedCover";
import { cardImage, MediaCard } from "./MediaCard";

type HomeScreenProps = {
  t: Record<StringKey, string>;
  /** Already in the order the rail chose — see `App.tsx`, which sorts once. */
  playlists: Playlist[];
  loading: boolean;
  /** The one message that says why an empty grid is empty and not just empty. */
  error: string | null;
  onOpenPlaylist: (playlist: Playlist) => void;
  /** The saved songs, which are not a playlist and open by their own door. */
  onOpenLiked: () => void;
  /** `${n} canciones`, already formatted — the card's second line. */
  playlistCount: (playlist: Playlist) => string;
  onPrefetch?: (playlist: Playlist) => void;
  /**
   * The account's DJ, which is not a playlist and does not open like one.
   *
   * Clicking it starts it, the way the client it mirrors does: the DJ is a
   * session that plays, not a page that lists.
   */
  onPlayDj: (playlist: Playlist) => void;
  /** The DJ is on its way. */
  djBusy: boolean;
  /** The DJ could not be read, and the card says so. */
  djUnavailable: boolean;
  /** The local listening history (`history.rs`), or null while it loads. */
  stats: HomeStats | null;
  userName: string | null;
  /** Play a song from the history, as a station: it keeps going with similar ones. */
  onPlayTrack: (play: Play) => void;
  onOpenArtist: (artist: Artist) => void;
};

/** How many playlists "Tus playlists" shows before "Ver todas". */
const PLAYLIST_ROW = 6;

/** The grey ramp of the logo's bars, light to dark: the week's chart reuses it. */
const RAMP = ["#DAD7DD", "#C4C1C8", "#A8A5AD", "#8C8992", "#706E77", "#55535C", "#3A3941"];

function greeting(t: Record<StringKey, string>, hour: number): string {
  if (hour >= 6 && hour < 12) return t.greetingMorning;
  if (hour >= 12 && hour < 20) return t.greetingAfternoon;
  return t.greetingNight;
}

function minutesLabel(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

const artistNames = (play: Play) => play.artists.map((artist) => artist.name).join(", ");

/**
 * The screen you land on: a place to decide what to listen to next.
 *
 * **It is organised from the most likely click down.** A greeting and six quick
 * tiles (the saved songs, the DJ, and the lists heard most recently), then what
 * was playing, then the most played, then the week, then the library. The full
 * grid of playlists used to be the whole screen; it is the last section now and
 * shows one row until it is asked for more.
 *
 * **The history sections come from this machine, not from Spotify.** The
 * recommendation engine and "recently played" were reachable only through the
 * Web API that stopped serving apps like this one. `history.rs` keeps what was
 * heard on this computer and nowhere else, which is why the section says so
 * under its title: PRODUCT.md promises zero telemetry, and a history that never
 * leaves the disk keeps the promise. Before anything was heard, those sections
 * are one card that says how they fill in.
 *
 * **There are no category tabs** (Música, Podcasts…): nothing this app reads can
 * fill them, and a tab that always says "nothing here" is worse than no tab.
 */
export function HomeScreen({
  t,
  playlists,
  loading,
  error,
  onOpenPlaylist,
  onOpenLiked,
  playlistCount,
  onPrefetch,
  onPlayDj,
  djBusy,
  djUnavailable,
  stats,
  userName,
  onPlayTrack,
  onOpenArtist,
}: HomeScreenProps) {
  const [tab, setTab] = useState<"songs" | "artists">("songs");
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  /** Quick access's "where is everything now", taken right before the view changes. */
  const quickSnapshot = useRef<(() => void) | null>(null);
  const { layout, save } = useHomeLayout();
  // The phone's back button leaves the editor the way it closes any layer.
  useBack(editing && !picking, () => setEditing(false));

  /**
   * Split by who made it, because that is the one distinction the data supports.
   * Spotify stamps its own playlists with itself as the owner, which is how the DJ
   * ends up on the "made for you" shelf. Filtered, never sorted: the rail's order holds.
   */
  const madeForYou = playlists.filter((playlist) => playlist.owner?.display_name === "spotify");
  const yours = playlists.filter((playlist) => playlist.owner?.display_name !== "spotify");
  const byId = new Map(playlists.map((playlist) => [playlist.id, playlist]));
  const organisation = useLibraryOrganisation();
  const dj = madeForYou.find(isDjCard) ?? null;

  if (loading && playlists.length === 0) {
    return (
      <p className="surface-card rounded-card border border-white/8 px-5 py-6 text-center text-[13px] text-ink-faint">
        {t.loading}
      </p>
    );
  }

  const hello = greeting(t, new Date().getHours());

  // Quick tiles: the saved songs, the DJ, then the lists heard last, then the rail's order.
  const quickIds: string[] = [];
  for (const playlist of playlists) {
    if (!isDjCard(playlist) && organisation.preference(playlist.id).pinned)
      quickIds.push(playlist.id);
  }
  for (const play of stats?.recent ?? []) {
    const id = play.context?.id;
    if (id && id !== "liked" && byId.has(id) && !quickIds.includes(id)) quickIds.push(id);
  }
  for (const playlist of yours) {
    if (!quickIds.includes(playlist.id)) quickIds.push(playlist.id);
  }
  // Until the person arranges quick access it fills itself, as it always did:
  // six tiles. Once arranged, it is theirs, and the app no longer adds to it.
  const automatic: TileId[] = [
    "liked",
    ...(dj ? ["dj"] : []),
    ...quickIds.slice(0, dj ? 4 : 5).filter((id) => byId.has(id)),
  ];
  const tileIds: TileId[] = layout.quick
    ? shownTiles(layout.quick, (id) => byId.has(id), Boolean(dj))
    : automatic;

  /** What a tile id draws and opens, or null for one that no longer resolves. */
  const tileFor = (id: TileId): QuickTileData | null => {
    if (id === "liked") {
      return {
        id,
        title: t.likedSongs,
        // The compact heart is drawn for a 64px row; a cover gets the full one.
        art: layout.view === "covers" ? <LikedCover /> : <LikedCover compact />,
        onOpen: onOpenLiked,
      };
    }
    if (id === "dj") {
      if (!dj) return null;
      return {
        id,
        title: dj.name,
        subtitle: djUnavailable ? t.djUnavailable : djBusy ? t.loading : null,
        art: <DjArtwork />,
        onOpen: () => onPlayDj(dj),
      };
    }
    const playlist = byId.get(id);
    if (!playlist) return null;
    return {
      id,
      title: playlist.name,
      menuId: playlist.id,
      art: <PlaylistArt playlist={playlist} />,
      onOpen: () => onOpenPlaylist(playlist),
      onPrefetch: onPrefetch ? () => onPrefetch(playlist) : undefined,
    };
  };
  const tiles = tileIds.map(tileFor).filter((tile): tile is QuickTileData => tile !== null);

  /** Every change to quick access is a saved layout from then on. */
  const saveTiles = (quick: TileId[]) => save({ ...layout, quick });
  const pickerOptions: PickerOption[] = [
    { id: "liked", title: t.likedSongs, art: <LikedCover compact /> },
    ...(dj ? [{ id: "dj" as TileId, title: dj.name, art: <DjArtwork /> }] : []),
    ...playlists
      .filter((playlist) => !isDjCard(playlist))
      .map((playlist) => ({
        id: playlist.id as TileId,
        title: playlist.name,
        art: <PlaylistArt playlist={playlist} />,
      })),
  ];

  const hasHistory = Boolean(stats?.has_history);
  const shownPlaylists = showAll ? yours : yours.slice(0, PLAYLIST_ROW);
  const weekTotal = (stats?.week_minutes ?? []).reduce((sum, minutes) => sum + minutes, 0);
  const weekMax = Math.max(1, ...(stats?.week_minutes ?? [0]));
  const topArtist = stats?.top_artists[0] ?? null;
  const favourite = stats?.top_tracks[0]?.play ?? null;
  const streak = stats?.streak_days ?? 0;

  // Each shelf on its own, so Home can draw them in the order the person chose
  // and skip the ones they hid (`home_layout.rs`). Null when it has nothing to show.
  const keepListeningShelf =
    hasHistory && stats && stats.recent.length > 0 ? (
      <section aria-label={t.keepListening}>
        <h2 className="mb-3 px-1 font-display text-[22px] font-semibold tracking-tight">
          {t.keepListening}
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {stats.recent.map((play) => {
            const source = play.context?.id;
            const playlist = source && source !== "liked" ? byId.get(source) : undefined;
            const subtitle = `${play.name} · ${artistNames(play)}`;
            if (source === "liked") {
              return (
                <MediaCard
                  key={`liked-${play.track_id}`}
                  title={t.likedSongs}
                  subtitle={subtitle}
                  art={<LikedCover />}
                  playLabel={t.openPlaylist}
                  onOpen={onOpenLiked}
                />
              );
            }
            if (playlist) {
              return (
                <MediaCard
                  key={playlist.id}
                  menuId={playlist.id}
                  title={playlist.name}
                  subtitle={subtitle}
                  imageUrl={cardImage(playlist.images)}
                  playLabel={t.openPlaylist}
                  onOpen={() => onOpenPlaylist(playlist)}
                  onPrefetch={onPrefetch ? () => onPrefetch(playlist) : undefined}
                />
              );
            }
            return (
              <MediaCard
                key={`track-${play.track_id}`}
                title={play.name}
                subtitle={artistNames(play)}
                imageUrl={play.image}
                playLabel={t.play}
                onPlay={() => onPlayTrack(play)}
                onOpen={() => onPlayTrack(play)}
              />
            );
          })}
        </div>
      </section>
    ) : null;
  const mostPlayedShelf =
    hasHistory && stats ? (
      <section aria-label={t.mostPlayed} className="min-w-0">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <h2 className="font-display text-[22px] font-semibold tracking-tight">
              {t.mostPlayed}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-faint">
              <Lock className="size-3.5" strokeWidth={2} />
              {t.mostPlayedNote}
            </p>
          </div>
          <div
            role="tablist"
            aria-label={t.mostPlayed}
            className="surface-chip flex gap-1 rounded-pill p-1"
          >
            {(["songs", "artists"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`h-8 rounded-pill px-4 text-[12.5px] font-semibold transition-colors duration-200 ${
                  tab === key ? "bg-white/14 text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {key === "songs" ? t.tabSongs : t.tabArtists}
              </button>
            ))}
          </div>
        </div>
        <ol className="surface-card overflow-hidden rounded-card border border-white/8">
          {tab === "songs"
            ? stats.top_tracks.map(({ play, plays }, index) => (
                <li key={play.track_id} className={index > 0 ? "border-t border-white/8" : ""}>
                  <button
                    type="button"
                    onClick={() => onPlayTrack(play)}
                    className="group grid w-full grid-cols-[28px_40px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left transition-colors duration-200 hover:bg-white/6"
                  >
                    <span className="tabular text-right text-[13px] text-ink-faint">
                      {index + 1}
                    </span>
                    <span className="relative size-10 overflow-hidden rounded-[8px] bg-white/8">
                      {play.image && (
                        <img
                          src={play.image}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      )}
                      <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        <PlayIcon className="size-4 fill-current" strokeWidth={0} />
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-semibold">
                        {play.name}
                      </span>
                      <span className="block truncate text-[12.5px] text-ink-muted">
                        {artistNames(play)}
                      </span>
                    </span>
                    <span className="tabular text-[12px] text-ink-faint">
                      {plays} {t.playsShort}
                    </span>
                  </button>
                </li>
              ))
            : stats.top_artists.map((artist, index) => (
                <li key={artist.id} className={index > 0 ? "border-t border-white/8" : ""}>
                  <button
                    type="button"
                    onClick={() => onOpenArtist({ id: artist.id, name: artist.name })}
                    className="grid w-full grid-cols-[28px_40px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left transition-colors duration-200 hover:bg-white/6"
                  >
                    <span className="tabular text-right text-[13px] text-ink-faint">
                      {index + 1}
                    </span>
                    <span className="size-10 overflow-hidden rounded-pill bg-white/8">
                      {artist.image && (
                        <img
                          src={artist.image}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      )}
                    </span>
                    <span className="truncate text-[13.5px] font-semibold">{artist.name}</span>
                    <span className="tabular text-[12px] text-ink-faint">
                      {artist.plays} {t.playsShort}
                    </span>
                  </button>
                </li>
              ))}
        </ol>
      </section>
    ) : null;
  const yourWeekShelf =
    hasHistory && stats ? (
      <section
        aria-label={t.yourWeek}
        className="surface-card flex flex-col gap-5 rounded-card border border-white/8 p-6"
      >
        <h2 className="font-display text-[20px] font-semibold tracking-tight">{t.yourWeek}</h2>
        <div>
          <p className="tabular text-[40px] leading-none font-medium tracking-tight">
            {minutesLabel(weekTotal)}
          </p>
          <p className="mt-1.5 text-[12.5px] text-ink-muted">{t.weekListened}</p>
        </div>
        <div className="grid h-24 grid-cols-7 items-end gap-2" aria-hidden="true">
          {stats.week_minutes.map((minutes, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: seven fixed days, Monday first.
              key={index}
              className="flex h-full flex-col items-center justify-end gap-1.5"
            >
              <span
                className="w-full max-w-[18px] rounded-pill"
                style={{
                  height: `${Math.max(4, Math.round((minutes / weekMax) * 72))}px`,
                  background: index === stats.today_index ? "var(--color-accent)" : RAMP[index],
                  opacity: index > stats.today_index ? 0.25 : 1,
                }}
              />
              <span className="tabular text-[11px] text-ink-faint">{t.weekdaysShort[index]}</span>
            </div>
          ))}
        </div>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-[12px] text-ink-muted">{t.artistOfMonth}</dt>
            <dd className="mt-1 truncate text-[14px] font-semibold">{topArtist?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink-muted">{t.streak}</dt>
            <dd className="tabular mt-1 text-[14px] font-semibold">
              {streak} {streak === 1 ? t.day : t.days}
            </dd>
          </div>
        </dl>
        {favourite && (
          <button
            type="button"
            onClick={() => onPlayTrack(favourite)}
            className="flex h-11 items-center justify-center gap-2 rounded-pill bg-accent px-5 text-[14px] font-semibold text-on-accent transition-transform duration-150 active:scale-[0.97]"
          >
            <Radio className="size-4 shrink-0" strokeWidth={2} />
            <span className="truncate">
              {t.radioOf} {favourite.name}
            </span>
          </button>
        )}
      </section>
    ) : null;
  const yourPlaylistsShelf =
    yours.length > 0 ? (
      <section aria-label={t.yourPlaylists}>
        <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
          <h2 className="font-display text-[22px] font-semibold tracking-tight">
            {t.yourPlaylists}
          </h2>
          {yours.length > PLAYLIST_ROW && (
            <button
              type="button"
              onClick={() => setShowAll((open) => !open)}
              className="text-[13px] font-semibold text-ink-muted transition-colors duration-200 hover:text-ink"
            >
              {showAll ? t.seeLess : `${t.seeAll} (${yours.length})`}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {shownPlaylists.map((playlist) => (
            <MediaCard
              key={playlist.id}
              menuId={playlist.id}
              title={playlist.name}
              subtitle={playlistCount(playlist)}
              imageUrl={cardImage(playlist.images)}
              playLabel={t.openPlaylist}
              onOpen={() => onOpenPlaylist(playlist)}
              onPrefetch={onPrefetch ? () => onPrefetch(playlist) : undefined}
            />
          ))}
        </div>
      </section>
    ) : null;
  // Only drawn when it has something besides the DJ, which quick access offers
  // and the rail lists. An empty shelf with a heading is a promise the app
  // cannot keep.
  const madeForYouShelf = madeForYou.some((playlist) => !isDjCard(playlist)) ? (
    <section aria-label={t.madeForYou}>
      <h2 className="mb-3 px-1 font-display text-[22px] font-semibold tracking-tight">
        {t.madeForYou}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {madeForYou
          .filter((playlist) => !isDjCard(playlist))
          .map((playlist) => (
            <MediaCard
              key={playlist.id}
              menuId={playlist.id}
              title={playlist.name}
              subtitle={playlistCount(playlist)}
              imageUrl={cardImage(playlist.images)}
              playLabel={t.openPlaylist}
              onOpen={() => onOpenPlaylist(playlist)}
              onPrefetch={onPrefetch ? () => onPrefetch(playlist) : undefined}
            />
          ))}
      </div>
    </section>
  ) : null;

  const shelfNodes: Record<ShelfId, ReactNode> = {
    keepListening: keepListeningShelf,
    mostPlayed: mostPlayedShelf,
    yourWeek: yourWeekShelf,
    yourPlaylists: yourPlaylistsShelf,
    madeForYou: madeForYouShelf,
  };
  const shelfNames: Record<ShelfId, string> = {
    keepListening: t.keepListening,
    mostPlayed: t.mostPlayed,
    yourWeek: t.yourWeek,
    yourPlaylists: t.yourPlaylists,
    madeForYou: t.madeForYou,
  };
  // "Lo más escuchado" and "Tu semana" sit side by side on a wide window, as
  // they always did, whenever the person keeps them next to each other.
  const visibleShelves = layout.shelves.filter((shelf) => !shelf.hidden && shelfNodes[shelf.id]);
  const arranged: ReactNode[] = [];
  for (let index = 0; index < visibleShelves.length; index++) {
    const id = visibleShelves[index].id;
    const next = visibleShelves[index + 1]?.id;
    if (id === "mostPlayed" && next === "yourWeek") {
      arranged.push(
        <div
          key="stats"
          className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
        >
          {shelfNodes.mostPlayed}
          {shelfNodes.yourWeek}
        </div>,
      );
      index++;
    } else if (id === "yourWeek" && next === "mostPlayed") {
      arranged.push(
        <div
          key="stats"
          className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]"
        >
          {shelfNodes.yourWeek}
          {shelfNodes.mostPlayed}
        </div>,
      );
      index++;
    } else {
      arranged.push(<Fragment key={id}>{shelfNodes[id]}</Fragment>);
    }
  }

  return (
    <div className="flex flex-col gap-11 pb-4">
      <ArchivedPlaylists t={t} />
      {error && playlists.length === 0 && (
        <div className="surface-card rounded-card border border-white/8 px-5 py-4">
          <p className="text-[13px] font-semibold">{t.libraryUnavailableTitle}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{error}</p>
        </div>
      )}

      {/*
        The rise only, and each tile fades in by itself (`arrive`). This section
        used to fade too, and a parent below opacity 1 is a backdrop root: going
        Home showed the tiles with the picture sharp through them, and they
        snapped to frosted when the fade ended.
      */}
      <motion.section
        initial={{ y: 10 }}
        animate={{ y: 0 }}
        transition={SPRING}
        aria-label={t.quickAccess}
      >
        {/*
            On the phone the Settings gear sits at the top right of Home, on the
            line of this title: a long name ran under it. The title stops short
            of the gear and is a size down.

            **The name goes on its own line.** "Buenas tardes, Shordan" on one
            line broke wherever the width ran out —sometimes after the comma,
            sometimes not at all— so the greeting read as one long label. The
            break is chosen instead: the greeting, and under it the person.
        */}
        <h1
          className={`mb-5 px-1 font-display leading-tight font-semibold tracking-tight ${
            isMobile() ? "pr-12 text-[28px]" : "text-[34px]"
          }`}
        >
          {userName ? (
            <>
              {hello},<span className="block">{userName}.</span>
            </>
          ) : (
            hello
          )}
        </h1>
        {/*
          The view switch and the editor's door share one row under the
          greeting: both are about the tiles right below them.
        */}
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          {editing ? (
            <p className="tabular text-[12.5px] text-ink-muted">
              {t.quickAccessCount
                .replace("{count}", String(tiles.length))
                .replace("{max}", String(QUICK_MAX))}
            </p>
          ) : (
            <div title={t.homeView} className="surface-chip relative flex gap-1 rounded-pill p-1">
              {/*
                One pill, under whichever view is chosen, sliding between them.

                **A CSS transition, not motion's \`layoutId\`.** The \`layoutId\`
                pill was computed in JavaScript frame by frame, on the same
                thread that was saving the layout, re-rendering Home and
                morphing every tile at that very moment: on the phone it ran at
                about 30 fps. A CSS \`transform\` transition runs on the
                compositor, which none of that work can hold up. 44px is one
                button (40) plus the gap (4).
              */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1 left-1 h-8 w-10 rounded-pill bg-white/14 transition-transform duration-300 ease-[var(--ease-glass)] will-change-transform motion-reduce:transition-none"
                style={{ transform: `translateX(${layout.view === "covers" ? 44 : 0}px)` }}
              />
              {(["rows", "covers"] as const).map((view) => {
                const Icon = view === "rows" ? LayoutList : LayoutGrid;
                const name = view === "rows" ? t.homeViewRows : t.homeViewCovers;
                return (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={layout.view === view}
                    aria-label={name}
                    title={name}
                    onClick={() => {
                      if (layout.view === view) return;
                      quickSnapshot.current?.();
                      save({ ...layout, view });
                    }}
                    className={`relative grid h-8 w-10 place-items-center rounded-pill transition-colors duration-200 ${
                      layout.view === view ? "text-ink" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    <Icon className="relative size-4" strokeWidth={2} />
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => setEditing((open) => !open)}
            aria-pressed={editing}
            className={`flex h-9 items-center gap-2 rounded-pill px-4 text-[13px] font-semibold transition-colors duration-200 ${
              editing ? "bg-accent text-on-accent" : "surface-chip text-ink-muted hover:text-ink"
            }`}
          >
            {editing ? (
              <Check className="size-4" strokeWidth={2.4} />
            ) : (
              <Pencil className="size-4" strokeWidth={2} />
            )}
            {editing ? t.editHomeDone : t.editHome}
          </button>
        </div>
        <QuickAccess
          t={t}
          tiles={tiles}
          view={layout.view}
          editing={editing}
          max={QUICK_MAX}
          onReorder={saveTiles}
          onRemove={(id) => saveTiles(removeTile(tileIds, id))}
          onAdd={() => setPicking(true)}
          snapshot={quickSnapshot}
        />
        <QuickAccessPicker
          t={t}
          open={picking}
          options={pickerOptions}
          chosen={tileIds}
          max={QUICK_MAX}
          onToggle={(id) =>
            saveTiles(tileIds.includes(id) ? removeTile(tileIds, id) : addTile(tileIds, id))
          }
          onClose={() => setPicking(false)}
        />
      </motion.section>

      {stats && !hasHistory && (
        <section className="rounded-card border border-dashed border-white/14 bg-white/3 px-7 py-7">
          <h2 className="font-display text-[22px] font-semibold tracking-tight">
            {t.historyStartsTitle}
          </h2>
          <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-ink-muted">
            {t.historyStartsBody}
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink-faint">
            <Lock className="size-3.5" strokeWidth={2} />
            {t.historySettingHint}
          </p>
        </section>
      )}

      {editing ? (
        <ShelfEditor
          t={t}
          shelves={layout.shelves}
          names={shelfNames}
          onChange={(shelves) => save({ ...layout, shelves })}
        />
      ) : (
        arranged
      )}
    </div>
  );
}

/** A playlist's cover, filling its square: the tile's art and the picker's. */
function PlaylistArt({ playlist }: { playlist: Playlist }) {
  const image = cardImage(playlist.images);
  return image ? (
    <img src={image} alt="" className="size-full object-cover" loading="lazy" />
  ) : (
    <span className="block size-full bg-white/8" />
  );
}
