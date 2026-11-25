import { House, Library, Search } from "lucide-react";
import type { StringKey } from "../lib/i18n";

export type MobileTab = "navHome" | "navSearch" | "navLibrary";

type MobileTabBarProps = {
  t: Record<StringKey, string>;
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
};

const TABS: { key: MobileTab; label: StringKey; Icon: typeof House }[] = [
  { key: "navHome", label: "navHome", Icon: House },
  { key: "navSearch", label: "navSearch", Icon: Search },
  { key: "navLibrary", label: "tabLibrary", Icon: Library },
];

/**
 * The phone's navigation, where the thumb is.
 *
 * Floating glass at the bottom with the 12px inset of the phone (DESIGN.md, "The
 * phone"): three tabs and no more. Settings is not one of them —it opens a few
 * times in the life of the app— and lives as a gear on Home.
 *
 * The bottom inset adds the system's gesture bar, which on an edge-to-edge
 * window sits on top of the page.
 *
 * **The tab you are on has a pill, and the pill travels.** One element moved by
 * a CSS transform, like the switch on Home: the compositor plays it, so it
 * stays smooth while the page under it is mounting. The icon of the tab that
 * becomes active gives a small pop, keyed so it plays once per arrival.
 */
export function MobileTabBar({ t, active, onSelect }: MobileTabBarProps) {
  const at = Math.max(
    0,
    TABS.findIndex((tab) => tab.key === active),
  );
  return (
    <nav className="glass fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 grid h-16 grid-cols-3 rounded-card p-1.5">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1.5 bottom-1.5 left-1.5 w-[calc((100%-12px)/3)] rounded-[14px] bg-white/10 transition-transform duration-[380ms] ease-[var(--ease-glass)]"
        style={{ transform: `translateX(${at * 100}%)` }}
      />
      {TABS.map(({ key, label, Icon }) => {
        const on = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-current={on ? "page" : undefined}
            className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-[color,transform] duration-200 active:scale-[0.94] ${
              on ? "text-ink" : "text-ink-faint"
            }`}
          >
            <Icon
              key={on ? "on" : "off"}
              className={`size-5 ${on ? "tab-pop" : ""}`}
              strokeWidth={on ? 2.4 : 2}
            />
            {t[label]}
          </button>
        );
      })}
    </nav>
  );
}
