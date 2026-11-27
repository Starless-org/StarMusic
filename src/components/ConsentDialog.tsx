import { Share2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import type { IntegrationId } from "../lib/spotify";

/** The words of each integration, by the prefix their keys share in `i18n.ts`. */
const COPY: Record<
  IntegrationId,
  { title: StringKey; what: StringKey; to: StringKey; when: StringKey }
> = {
  spotify_plays: {
    title: "consentSpotifyPlays",
    what: "consentSpotifyPlaysWhat",
    to: "consentSpotifyPlaysTo",
    when: "consentSpotifyPlaysWhen",
  },
  discord_presence: {
    title: "consentDiscordPresence",
    what: "consentDiscordPresenceWhat",
    to: "consentDiscordPresenceTo",
    when: "consentDiscordPresenceWhen",
  },
  connect_device: {
    title: "consentConnectDevice",
    what: "consentConnectDeviceWhat",
    to: "consentConnectDeviceTo",
    when: "consentConnectDeviceWhen",
  },
};

export function consentTitle(t: Record<StringKey, string>, id: IntegrationId): string {
  return t[COPY[id].title];
}

/**
 * The permission an integration needs before it sends anything.
 *
 * **What, to whom and when, in that order, before the buttons.** PRODUCT.md
 * holds integrations inside the promise only if the person reads what leaves
 * before saying yes, so the three answers are the dialog and the buttons come
 * after them. If an integration ever sends more than these lines say, its
 * version in `consent.rs` goes up and this text changes in the same commit.
 *
 * **"Allow" and "Not now" are the same size.** A big yes beside a small no is
 * the dialog nudging the answer, and the answer is the person's. Focus starts
 * on "Not now", so an Enter that was meant for something else does not grant
 * anything. Escape, the backdrop and "Not now" all mean no.
 *
 * Portalled to `body` for the same reason as `NewPlaylistDialog`: Settings is
 * glass, and a `backdrop-filter` ancestor turns `fixed` into `absolute`.
 */
export function ConsentDialog({
  t,
  integration,
  onAllow,
  onClose,
}: {
  t: Record<StringKey, string>;
  /** The integration being asked about; `null` keeps the dialog closed. */
  integration: IntegrationId | null;
  onAllow: (integration: IntegrationId) => void;
  onClose: () => void;
}) {
  const notNow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!integration) return;
    const id = setTimeout(() => notNow.current?.focus(), 40);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [integration, onClose]);

  const copy = integration ? COPY[integration] : null;
  const button = "h-9 flex-1 rounded-pill text-[13px] font-semibold transition-colors duration-200";

  return createPortal(
    <AnimatePresence>
      {integration && copy && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-6"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-title"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING}
            className="glass-overlay flex w-full max-w-[420px] flex-col gap-4 rounded-[18px] p-5"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-accent/15 text-accent-ink">
                <Share2 className="size-4" strokeWidth={2.2} />
              </span>
              <h2 id="consent-title" className="pt-1 text-[15px] font-semibold tracking-tight">
                {t[copy.title]}
              </h2>
            </div>

            <dl className="flex flex-col gap-3 text-[13px]">
              {(
                [
                  ["consentWhat", copy.what],
                  ["consentTo", copy.to],
                  ["consentWhen", copy.when],
                ] as const
              ).map(([label, text]) => (
                <div key={label}>
                  <dt className="text-[11.5px] font-semibold text-ink-muted">{t[label]}</dt>
                  <dd className="mt-0.5 leading-snug">{t[text]}</dd>
                </div>
              ))}
            </dl>

            <p className="text-[12px] leading-snug text-ink-muted">{t.consentPromise}</p>

            <div className="flex items-center gap-2">
              <button
                ref={notNow}
                type="button"
                onClick={onClose}
                className={`${button} bg-white/10 hover:bg-white/16`}
              >
                {t.consentNotNow}
              </button>
              <button
                type="button"
                onClick={() => onAllow(integration)}
                className={`${button} bg-accent text-on-accent`}
              >
                {t.consentAllow}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
