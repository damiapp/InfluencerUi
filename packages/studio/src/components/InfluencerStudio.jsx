"use client";

import { useMemo, useState } from "react";
import { api } from "../api.js";
import { IMAGE_MODELS, getModel } from "../models.js";
import { estimateCost } from "../pricing.js";
import { useStudio } from "./StudioContext.jsx";
import { CostLine, GenerationMedia, UseAsReferenceButton } from "./parts.jsx";
import { Button, ErrorNote, Field, Panel, Segmented, Select, Spinner, TextArea, TextInput, cx } from "./ui.jsx";

// Trait picker for designing a new influencer. Each pick contributes a phrase
// to the portrait prompt and to the draft character bible.
const TRAITS = [
  { id: "gender", label: "Gender", options: [["woman", "Woman"], ["man", "Man"], ["non-binary person", "Non-binary"]] },
  { id: "age", label: "Age", options: [["in her early twenties|in his early twenties|in their early twenties", "Early 20s"], ["in her late twenties|in his late twenties|in their late twenties", "Late 20s"], ["in her thirties|in his thirties|in their thirties", "30s"], ["in her forties|in his forties|in their forties", "40s"]] },
  { id: "ethnicity", label: "Heritage", options: [["East Asian", "East Asian"], ["South Asian", "South Asian"], ["Southeast Asian", "Southeast Asian"], ["Black", "Black"], ["Latina/Latino", "Latin"], ["Middle Eastern", "Middle Eastern"], ["Scandinavian", "Scandinavian"], ["Mediterranean", "Mediterranean"], ["Slavic", "Slavic"], ["mixed heritage", "Mixed"]] },
  { id: "face", label: "Face", options: [["oval face with high cheekbones", "Oval, high cheekbones"], ["heart-shaped face with a soft jawline", "Heart-shaped"], ["round face with full cheeks", "Round"], ["angular face with a defined jawline", "Angular"], ["square face with strong brows", "Square"]] },
  { id: "eyes", label: "Eyes", options: [["warm brown eyes", "Brown"], ["deep dark brown eyes", "Dark brown"], ["hazel-green eyes", "Hazel"], ["striking blue eyes", "Blue"], ["grey eyes", "Grey"], ["emerald green eyes", "Green"], ["amber eyes", "Amber"]] },
  { id: "hairColor", label: "Hair colour", options: [["jet-black hair", "Black"], ["dark brown hair", "Dark brown"], ["chestnut hair", "Chestnut"], ["honey-blonde hair", "Honey blonde"], ["platinum-blonde hair", "Platinum"], ["copper-red hair", "Copper"], ["pastel pink hair", "Pastel pink"], ["silver hair", "Silver"]] },
  { id: "hairStyle", label: "Hair style", options: [["long and straight", "Long straight"], ["long soft waves", "Long waves"], ["a chin-length bob", "Bob"], ["tight natural curls", "Curls"], ["a sleek high ponytail", "Ponytail"], ["a pixie cut", "Pixie"], ["box braids", "Braids"], ["a short textured crop", "Short crop"]] },
  { id: "skin", label: "Skin details", options: [["clear natural skin texture", "Natural"], ["light freckles across the nose", "Freckles"], ["a small beauty mark above the lip", "Beauty mark"], ["sun-kissed glowing skin", "Sun-kissed"], ["dewy glass skin", "Dewy"]] },
  { id: "signature", label: "Signature detail", options: [["", "None"], ["a small gold nose ring", "Nose ring"], ["delicate layered gold necklaces", "Gold necklaces"], ["a tiny star tattoo behind the ear", "Tiny tattoo"], ["round tortoiseshell glasses", "Glasses"], ["bold red lipstick", "Red lips"], ["gap-toothed smile", "Gap-tooth smile"]] },
  { id: "body", label: "Build", options: [["slim build", "Slim"], ["athletic toned build", "Athletic"], ["curvy build", "Curvy"], ["petite frame", "Petite"], ["tall model build", "Tall"]] },
  { id: "niche", label: "Niche / vibe", options: [["fashion and streetwear", "Fashion"], ["fitness and wellness", "Fitness"], ["travel and lifestyle", "Travel"], ["beauty and skincare", "Beauty"], ["tech and gaming", "Tech"], ["food and cooking", "Food"]] },
];

const PORTRAIT_STYLES = [
  ["ref-sheet", "Reference portrait", "Clean head-and-shoulders reference portrait, facing the camera, neutral expression, soft even studio light, plain light-grey background, sharp focus on the face."],
  ["three-quarter", "Three-quarter", "Three-quarter view portrait turned slightly to the side, soft smile, soft window light, plain background."],
  ["full-body", "Full body", "Full-body photo standing, relaxed pose, simple outfit, plain studio background, even lighting."],
  ["candid", "Candid selfie", "Candid smartphone selfie in a bright cafe, natural light, authentic social media look."],
];

function pronounPick(value, gender) {
  const variants = value.split("|");
  if (variants.length === 1) return value;
  return gender === "woman" ? variants[0] : gender === "man" ? variants[1] : variants[2];
}

export default function InfluencerStudio() {
  const { characters, refreshCharacters, refreshStats, pricing, navigate, toast } = useStudio();
  const [picks, setPicks] = useState(() => Object.fromEntries(TRAITS.map((t) => [t.id, t.options[0][0]])));
  const [extra, setExtra] = useState("");
  const [styleId, setStyleId] = useState("ref-sheet");
  const [modelId, setModelId] = useState(IMAGE_MODELS[0].id);
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const model = getModel(modelId);

  const bible = useMemo(() => {
    const p = (id) => pronounPick(picks[id] || "", picks.gender);
    const parts = [
      `${p("ethnicity")} ${p("gender")} ${p("age")}`.replace(/\s+/g, " ").trim() + ".",
      `${p("face")[0].toUpperCase()}${p("face").slice(1)}, ${p("eyes")}.`,
      `${p("hairColor")[0].toUpperCase()}${p("hairColor").slice(1)}, worn ${p("hairStyle")}.`,
      `${p("skin")[0].toUpperCase()}${p("skin").slice(1)}${p("signature") ? `, ${p("signature")}` : ""}.`,
      `${p("body")[0].toUpperCase()}${p("body").slice(1)}.`,
      `Content niche: ${p("niche")}.`,
      extra.trim(),
    ];
    return parts.filter(Boolean).join(" ");
  }, [picks, extra]);

  const style = PORTRAIT_STYLES.find((s) => s[0] === styleId);
  const prompt = `Photorealistic photo of a social media influencer. ${bible}\n${style[2]}`;
  const estimate = estimateCost(pricing, { kind: "image", model: modelId, imageSize: "2K", count });

  const shuffle = () => setPicks(Object.fromEntries(TRAITS.map((t) => [t.id, t.options[Math.floor(Math.random() * t.options.length)][0]])));

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      const generations = await api.generateImage({ model: modelId, prompt: bible, finalPrompt: prompt, aspectRatio: "3:4", imageSize: "2K", count });
      setResults((list) => [...generations, ...list]);
      const failed = generations.find((g) => g.status === "failed");
      if (failed) setError(failed.error);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      refreshStats();
    }
  };

  const toggleChosen = (g) => {
    if (!g.output) return;
    setChosen((list) => (list.includes(g.output.id) ? list.filter((id) => id !== g.output.id) : [...list, g.output.id].slice(0, 8)));
  };

  const saveCharacter = async () => {
    setSaving(true);
    try {
      const character = await api.createCharacter({ name: name.trim(), bible, styleNotes: "", refAssetIds: chosen });
      await refreshCharacters();
      toast(`Created ${character.name}`, "success");
      navigate("characters", { id: character.id });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 lg:flex-row">
      <Panel className="custom-scrollbar w-full shrink-0 space-y-4 overflow-y-auto p-4 lg:w-[420px]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Design a new influencer</h2>
            <p className="text-[11px] text-muted">Pick traits, generate portraits, keep the best as locked references.</p>
          </div>
          <Button size="sm" onClick={shuffle}>
            ⤮ Shuffle
          </Button>
        </div>

        {TRAITS.map((trait) => (
          <div key={trait.id}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-secondary">{trait.label}</div>
            <div className="flex flex-wrap gap-1">
              {trait.options.map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setPicks((p) => ({ ...p, [trait.id]: value }))}
                  className={cx(
                    "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                    picks[trait.id] === value ? "border-primary/60 bg-primary/15 text-primary" : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.1]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <Field label="Extra details">
          <TextArea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Dimples when smiling, slightly crooked left eyebrow…" />
        </Field>
        <Field label="Shot">
          <Select value={styleId} onChange={setStyleId} options={PORTRAIT_STYLES.map(([value, label]) => ({ value, label }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Model">
            <Select value={modelId} onChange={setModelId} options={IMAGE_MODELS.map((m) => ({ value: m.id, label: m.name }))} />
          </Field>
          <Field label="Images">
            <Segmented value={count} onChange={setCount} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
          </Field>
        </div>
        <Field label="Prompt preview">
          <pre className="whitespace-pre-wrap rounded-xl bg-black/40 p-2 font-mono text-[11px] text-white/60">{prompt}</pre>
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <CostLine estimate={estimate} />
        <Button variant="primary" size="lg" className="w-full" onClick={generate} disabled={busy}>
          {busy ? <Spinner /> : "✦"} Generate {count} portrait{count > 1 ? "s" : ""} · {model.name}
        </Button>
      </Panel>

      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {results.length > 0 && (
          <Panel className="flex flex-wrap items-end gap-3 p-4">
            <Field label="Save selected as a new character" className="min-w-[200px] flex-1">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Character name" />
            </Field>
            <Button variant="primary" disabled={!name.trim() || !chosen.length || saving} onClick={saveCharacter}>
              {saving ? <Spinner /> : null} Create with {chosen.length} ref{chosen.length === 1 ? "" : "s"}
            </Button>
            <p className="w-full text-[11px] text-muted">
              Click portraits to select them. The trait description becomes the character bible; you can refine both in Characters.
              {characters.length > 0 && " Or use “Use as reference” to add a portrait to an existing character."}
            </p>
          </Panel>
        )}
        {results.length === 0 && !busy ? (
          <div className="flex min-h-[300px] flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-muted">
            Portraits will appear here.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {busy && Array.from({ length: count }, (_, i) => (
              <div key={`p${i}`} className="flex aspect-[3/4] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
                <Spinner className="h-6 w-6 text-primary" />
              </div>
            ))}
            {results.map((g) => {
              const selected = g.output && chosen.includes(g.output.id);
              return (
                <div key={g.id} className={cx("overflow-hidden rounded-xl border-2 bg-card-bg", selected ? "border-primary" : "border-transparent")}>
                  <button type="button" className="relative block w-full" onClick={() => toggleChosen(g)}>
                    <GenerationMedia generation={g} className="aspect-[3/4] w-full" />
                    {selected && <span className="absolute right-2 top-2 rounded-full bg-primary px-2 text-xs font-bold text-black">✓</span>}
                  </button>
                  {g.output && (
                    <div className="p-2">
                      <UseAsReferenceButton assetId={g.output.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
