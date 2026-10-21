"use client";

import { ANGLES, EXPRESSIONS, LIGHTINGS, MAX_CHARACTER_REFS, MAX_PRIMARY_REFS, RECOMMENDED_CHARACTER_REFS } from "../refs.js";
import { cx } from "./ui.jsx";

const selectClass = "h-6 w-full rounded border border-white/10 bg-black/60 px-1 text-[10px] text-white outline-none focus:border-primary";

/**
 * Editable, tagged reference grid (up to 20). Each ref carries angle,
 * expression, lighting and a primary star (max 3 primaries).
 */
export default function ReferenceLibrary({ refs, onChange, onAdd }) {
  const primaries = refs.filter((r) => r.primary).length;
  const update = (id, patch) => onChange(refs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (index, delta) => {
    const next = [...refs];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div>
      <datalist id="ref-expressions">
        {EXPRESSIONS.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5">
        {refs.map((ref, i) => (
          <div key={ref.id} className={cx("overflow-hidden rounded-lg border bg-black/30", ref.primary ? "border-amber-400/70" : "border-white/10")}>
            <div className="group relative aspect-[3/4]">
              <img src={ref.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-bold text-white">{i + 1}</span>
              <button
                type="button"
                title={ref.primary ? "Primary (always sent first)" : primaries >= MAX_PRIMARY_REFS ? `Max ${MAX_PRIMARY_REFS} primaries` : "Mark as primary"}
                disabled={!ref.primary && primaries >= MAX_PRIMARY_REFS}
                onClick={() => update(ref.id, { primary: !ref.primary })}
                className={cx(
                  "absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-sm disabled:opacity-30",
                  ref.primary ? "bg-amber-400 text-black" : "bg-black/70 text-white/70 hover:text-amber-300",
                )}
              >
                ★
              </button>
              <div className="absolute inset-x-0 bottom-0 hidden justify-between bg-black/75 p-1 group-hover:flex">
                <button type="button" onClick={() => move(i, -1)} className="px-1 text-xs text-white" aria-label="Move left">
                  ◀
                </button>
                <button type="button" onClick={() => onChange(refs.filter((r) => r.id !== ref.id))} className="px-1 text-xs text-red-300">
                  Remove
                </button>
                <button type="button" onClick={() => move(i, 1)} className="px-1 text-xs text-white" aria-label="Move right">
                  ▶
                </button>
              </div>
            </div>
            <div className="space-y-1 p-1">
              <select value={ref.angle || ""} onChange={(e) => update(ref.id, { angle: e.target.value || null })} className={selectClass} aria-label="Angle">
                <option value="">angle…</option>
                {ANGLES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
              <input
                list="ref-expressions"
                value={ref.expression || ""}
                onChange={(e) => update(ref.id, { expression: e.target.value || null })}
                placeholder="expression…"
                className={selectClass}
                aria-label="Expression"
              />
              <select value={ref.lighting || ""} onChange={(e) => update(ref.id, { lighting: e.target.value || null })} className={selectClass} aria-label="Lighting">
                <option value="">lighting…</option>
                {LIGHTINGS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
        {refs.length < MAX_CHARACTER_REFS && (
          <button
            type="button"
            onClick={onAdd}
            className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/20 text-secondary hover:border-primary hover:text-primary"
          >
            <span className="text-2xl">＋</span>
            <span className="text-[11px]">Add photos</span>
          </button>
        )}
      </div>
      {refs.length < RECOMMENDED_CHARACTER_REFS && (
        <p className="mt-2 text-xs text-amber-300">
          {RECOMMENDED_CHARACTER_REFS}–{MAX_CHARACTER_REFS} references work best: mix front, three-quarter, profile and full-body shots with
          different expressions and lighting.
        </p>
      )}
    </div>
  );
}
