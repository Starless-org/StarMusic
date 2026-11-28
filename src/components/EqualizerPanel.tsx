import { useEffect, useRef, useState } from "react";
import type { StringKey } from "../lib/i18n";
import {
  type EqualizerSettings,
  equalizerSettings,
  explain,
  setEqualizerSettings,
} from "../lib/spotify";

const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
// Closing and reopening Settings must wait for writes from the previous panel.
let pendingWrite = Promise.resolve();
const PRESETS: { id: string; label: StringKey; gains: number[] }[] = [
  { id: "flat", label: "eqFlat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "bass", label: "eqBass", gains: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0] },
  { id: "treble", label: "eqTreble", gains: [0, 0, 0, 0, 0, 0, 1, 2, 3, 4] },
  { id: "vocal", label: "eqVocal", gains: [-2, -2, -1, 0, 1, 3, 3, 1, 0, -1] },
  { id: "rock", label: "eqRock", gains: [3, 2, 1, -1, -2, -1, 1, 2, 3, 2] },
  { id: "acoustic", label: "eqAcoustic", gains: [1, 1, 0, 0, 1, 1, 2, 2, 1, 0] },
];

export function EqualizerPanel({
  t,
  soloist = false,
}: {
  t: Record<StringKey, string>;
  soloist?: boolean;
}) {
  const [settings, setSettings] = useState<EqualizerSettings | null>(null);
  const current = useRef<EqualizerSettings | null>(null);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void pendingWrite
      .then(() => equalizerSettings())
      .then((value) => {
        if (cancelled) return;
        current.current = value;
        setSettings(value);
        const saved = value.presets.find((preset) =>
          preset.gains.every((gain, i) => gain === value.gains[i]),
        );
        const builtin = PRESETS.find((preset) =>
          preset.gains.every((gain, i) => gain === value.gains[i]),
        );
        setSelected(saved ? `user:${saved.name}` : builtin ? `builtin:${builtin.id}` : "");
      })
      .catch((error) => {
        if (!cancelled) setError(explain(error));
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, []);

  const change = (next: EqualizerSettings) => {
    const request = ++revision.current;
    current.current = next;
    setSettings(next);
    setSaving(true);
    setError(null);
    // Full snapshots are serialized. A late disk response cannot overwrite
    // a newer slider position, and saving a profile includes all pending edits.
    pendingWrite = pendingWrite
      .then(() => setEqualizerSettings(next))
      .then((saved) => {
        if (alive.current && request === revision.current) {
          current.current = saved;
          setSettings(saved);
        }
      })
      .catch((error) => {
        if (alive.current && request === revision.current) setError(explain(error));
      })
      .finally(() => {
        if (alive.current && request === revision.current) setSaving(false);
      });
  };
  const choose = (value: string) => {
    const state = current.current;
    if (!state) return;
    const gains = value.startsWith("builtin:")
      ? PRESETS.find((preset) => `builtin:${preset.id}` === value)?.gains
      : state.presets.find((preset) => `user:${preset.name}` === value)?.gains;
    if (!gains) return;
    setSelected(value);
    change({ ...state, enabled: true, gains: [...gains] });
  };
  const save = () => {
    const state = current.current;
    const trimmed = name.trim();
    if (!state || !trimmed) return;
    if (state.presets.some((preset) => preset.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(t.eqNameTaken);
      return;
    }
    change({ ...state, presets: [...state.presets, { name: trimmed, gains: [...state.gains] }] });
    setSelected(`user:${trimmed}`);
    setName("");
  };
  const remove = () => {
    const state = current.current;
    if (!state || !selected.startsWith("user:")) return;
    change({
      ...state,
      presets: state.presets.filter((preset) => `user:${preset.name}` !== selected),
    });
    setSelected("");
  };
  return (
    <section
      className="@container mt-9 rounded-card border border-white/8 bg-white/4 p-4"
      aria-label={t.equalizer}
    >
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-[13.5px] font-semibold">{t.equalizer}</h3>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-muted">
          {t.eqEnable}
          <input
            type="checkbox"
            checked={settings?.enabled ?? false}
            disabled={!settings}
            onChange={(event) => {
              if (current.current) change({ ...current.current, enabled: event.target.checked });
            }}
            className="size-4 accent-accent"
          />
        </label>
      </div>
      <p className="mt-1 text-[12.5px] text-ink-muted">{t.eqHint}</p>
      {soloist && <p className="mt-2 text-[12.5px] text-warn-ink">{t.eqSoloist}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <select
          aria-label={t.eqPreset}
          value={selected}
          disabled={!settings}
          onChange={(event) => choose(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-pill border border-white/8 bg-night px-3 text-[13px]"
        >
          <option value="">{t.eqCustom}</option>
          <optgroup label={t.eqGeneral}>
            {PRESETS.map((preset) => (
              <option key={preset.id} value={`builtin:${preset.id}`}>
                {t[preset.label]}
              </option>
            ))}
          </optgroup>
          {(settings?.presets.length ?? 0) > 0 && (
            <optgroup label={t.eqSaved}>
              {settings?.presets.map((preset) => (
                <option key={preset.name} value={`user:${preset.name}`}>
                  {preset.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {selected.startsWith("user:") && (
          <button
            type="button"
            disabled={saving}
            onClick={remove}
            className="h-9 rounded-pill bg-white/8 px-3 text-[12px] hover:bg-white/12 disabled:opacity-40"
          >
            {t.eqDelete}
          </button>
        )}
      </div>
      <div className="mt-5 grid grid-cols-5 gap-x-2 gap-y-5 @lg:grid-cols-10">
        {FREQUENCIES.map((hz, index) => (
          <label key={hz} className="flex flex-col items-center gap-2">
            <output className="tabular whitespace-nowrap text-[11px] text-ink-muted">
              {(settings?.gains[index] ?? 0).toFixed(1)} dB
            </output>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={settings?.gains[index] ?? 0}
              disabled={!settings}
              aria-label={t.eqBand.replace("{hz}", String(hz))}
              aria-valuetext={`${settings?.gains[index] ?? 0} dB`}
              style={{
                writingMode: "vertical-lr",
                direction: "rtl",
                height: 120,
                width: 24,
                accentColor: "var(--color-accent)",
              }}
              onChange={(event) => {
                const state = current.current;
                if (!state) return;
                const gains = [...state.gains];
                gains[index] = Number(event.target.value);
                setSelected("");
                change({ ...state, gains });
              }}
            />
            <span className="tabular text-[11px] text-ink-muted">
              {hz >= 1000 ? `${hz / 1000}k` : hz}
            </span>
          </label>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-ink-muted">{t.eqHeadroom}</p>
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          type="text"
          value={name}
          maxLength={64}
          disabled={!settings}
          aria-label={t.eqName}
          placeholder={t.eqName}
          onChange={(event) => setName(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-pill border border-white/8 bg-white/4 px-3 text-[13px] outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!settings || !name.trim() || saving}
          className="h-9 rounded-pill bg-white/8 px-4 text-[13px] font-semibold hover:bg-white/12 disabled:opacity-40"
        >
          {t.eqSave}
        </button>
      </form>
      {saving && (
        <p role="status" className="mt-2 text-[12px] text-ink-muted">
          {t.eqSaving}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-warn-ink">
          {error}
        </p>
      )}
    </section>
  );
}
