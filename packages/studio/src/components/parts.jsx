"use client";

import { useState } from "react";
import { api } from "../api.js";
import { appendSnippet, presetsFor } from "../prompt.js";
import { formatCost } from "../pricing.js";
import { getModel } from "../models.js";
import { useStudio } from "./StudioContext.jsx";
import { Button, Field, Label, Select, TextArea, cx } from "./ui.jsx";

export function CharacterPicker({ value, onChange }) {
  const { characters, navigate } = useStudio();
  const selected = characters.find((c) => c.id === value);
  return (
    <Field label="Character" hint={selected ? `${selected.refs.length} locked refs` : null}>
      <div className="flex gap-2">
        <Select
          value={value || ""}
          onChange={(v) => onChange(v || null)}
          options={[{ value: "", label: "No character" }, ...characters.map((c) => ({ value: c.id, label: c.name }))]}
        />
        {!characters.length && (
          <Button size="md" onClick={() => navigate("characters")}>
            Create
          </Button>
        )}
      </div>
      {selected && (
        <div className="mt-2 flex items-center gap-1.5">
          {selected.refs.map((ref) => (
            <img key={ref.id} src={ref.url} alt="" className="h-10 w-10 rounded-md border border-white/10 object-cover" />
          ))}
          {selected.refs.length < 3 && <span className="ml-1 text-[11px] text-amber-300">Add at least 3 refs for consistency</span>}
        </div>
      )}
    </Field>
  );
}

export function PresetBar({ kind, prompt, onPrompt, onSettings }) {
  const presets = presetsFor(kind);
  const groups = [...new Set(presets.map((p) => p.group))];
  return (
    <div className="space-y-1.5">
      {groups.map((group) => (
        <div key={group} className="flex flex-wrap items-center gap-1">
          <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted">{group}</span>
          {presets
            .filter((p) => p.group === group)
            .map((preset) => {
              const active = prompt.includes(preset.text);
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.text}
                  onClick={() => {
                    onPrompt(active ? prompt.replace(preset.text, "").replace(/\s{2,}/g, " ").trim() : appendSnippet(prompt, preset.text));
                    if (!active && preset.settings) onSettings?.(preset.settings);
                  }}
                  className={cx(
                    "rounded-md border px-2 py-0.5 text-[11px] font-medium transition",
                    active ? "border-primary/60 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.1]",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/** Shows the exact prompt that will be sent; editing it overrides the auto-built one. */
export function FinalPromptEditor({ built, override, onOverride }) {
  const [open, setOpen] = useState(true);
  const edited = override != null;
  return (
    <div className="rounded-xl border border-white/10 bg-black/30">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} className="text-[11px] font-semibold uppercase tracking-wider text-secondary hover:text-white">
          {open ? "▾" : "▸"} Final prompt {edited && <span className="ml-1 rounded bg-amber-400/20 px-1 normal-case text-amber-300">edited</span>}
        </button>
        {edited && (
          <button type="button" onClick={() => onOverride(null)} className="text-[11px] text-primary hover:underline">
            Reset to auto
          </button>
        )}
      </div>
      {open && (
        <div className="px-3 pb-3">
          <TextArea rows={6} value={edited ? override : built} onChange={(e) => onOverride(e.target.value)} className="font-mono text-xs" />
          {edited && override.trim() !== built.trim() && (
            <p className="mt-1 text-[11px] text-muted">Your edits are kept even if you change the prompt or character above.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function CostLine({ estimate, label = "Estimated cost" }) {
  const { stats } = useStudio();
  const currency = stats?.pricing?.currency || "USD";
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-secondary">
        {label}: <span className="font-semibold text-white">{formatCost(estimate, currency)}</span>
      </span>
      {stats && <span className="text-muted">This month: {formatCost(stats.month.total, currency)}</span>}
    </div>
  );
}

export function GenerationMedia({ generation, className, controls = false }) {
  const output = generation.output;
  if (generation.status === "failed") {
    return (
      <div className={cx("flex items-center justify-center bg-red-500/5 p-4 text-center text-xs text-red-300", className)}>
        {generation.error || "Failed"}
      </div>
    );
  }
  if (!output) {
    return (
      <div className={cx("flex flex-col items-center justify-center gap-2 bg-white/[0.03] text-xs text-secondary", className)}>
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        {generation.kind === "video" ? "Generating video…" : "Generating…"}
      </div>
    );
  }
  if (generation.kind === "video") {
    return <video key={output.url} src={output.url} className={cx("bg-black object-contain", className)} controls={controls} loop playsInline muted={!controls} />;
  }
  return <img src={output.url} alt={generation.prompt} className={cx("object-cover", className)} loading="lazy" />;
}

export function UseAsReferenceButton({ assetId, size = "sm" }) {
  const { characters, refreshCharacters, toast } = useStudio();
  const [open, setOpen] = useState(false);
  const add = async (character) => {
    setOpen(false);
    try {
      await api.addCharacterRef(character.id, assetId);
      await refreshCharacters();
      toast(`Added to ${character.name}'s references`, "success");
    } catch (err) {
      toast(err.message, "error");
    }
  };
  return (
    <div className="relative">
      <Button size={size} onClick={() => setOpen(!open)} title="Add this image to a character's references">
        Use as reference
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 min-w-[180px] rounded-xl border border-white/10 bg-neutral-900 p-1 shadow-3xl">
          {characters.length === 0 && <p className="px-3 py-2 text-xs text-muted">No characters yet</p>}
          {characters.map((c) => (
            <button key={c.id} type="button" onClick={() => add(c)} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-white hover:bg-white/10">
              {c.name} <span className="text-muted">({c.refs.length}/8)</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GenerationActions({ generation, onChange, compact = false }) {
  const { navigate, toast } = useStudio();
  const done = generation.status === "completed" && generation.output;
  const toggleFavorite = async () => {
    try {
      onChange?.(await api.setFavorite(generation.id, !generation.favorite));
    } catch (err) {
      toast(err.message, "error");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant={generation.favorite ? "primary" : "secondary"} onClick={toggleFavorite} title="Favorite">
        {generation.favorite ? "★" : "☆"}
        {!compact && " Favorite"}
      </Button>
      {done && generation.kind === "image" && (
        <>
          <UseAsReferenceButton assetId={generation.output.id} />
          <Button size="sm" onClick={() => navigate("video", { firstFrame: generation.output.id, character: generation.characterId })}>
            ▶ Animate
          </Button>
        </>
      )}
      {done && generation.kind === "video" && (
        <Button size="sm" onClick={() => navigate("video", { clip: generation.id })}>
          Edit / Extend
        </Button>
      )}
      {done && (
        <a href={`${generation.output.url}?download=1`} className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold text-secondary hover:bg-white/[0.06] hover:text-white">
          ⤓
        </a>
      )}
    </div>
  );
}

export function GenerationDetails({ generation }) {
  const model = getModel(generation.model);
  const rows = [
    ["Model", model?.name || generation.model],
    ["Operation", generation.operation],
    ["Settings", Object.entries(generation.settings || {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}: ${v}`).join(" · ")],
    ["Duration", generation.kind === "video" ? `${generation.durationSeconds ?? "?"} s (clip total ${generation.totalDurationSeconds ?? "?"} s)` : null],
    ["Estimated cost", generation.costEstimate != null ? formatCost(generation.costEstimate) : null],
    ["Interaction id", generation.interactionId],
    ["Provider", generation.provider],
    ["Created", new Date(generation.createdAt).toLocaleString()],
  ].filter(([, v]) => v);
  return (
    <div className="space-y-3 text-xs">
      <div>
        <Label>Prompt</Label>
        <p className="whitespace-pre-wrap text-white/80">{generation.prompt || "—"}</p>
      </div>
      <div>
        <Label>Final prompt sent</Label>
        <pre className="whitespace-pre-wrap rounded-lg bg-black/40 p-2 font-mono text-[11px] text-white/70">{generation.finalPrompt}</pre>
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-secondary">{k}</dt>
            <dd className="break-all text-white/80">{v}</dd>
          </div>
        ))}
      </dl>
      {generation.error && <p className="text-red-300">{generation.error}</p>}
    </div>
  );
}
