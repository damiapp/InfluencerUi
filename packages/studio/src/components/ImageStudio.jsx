"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, getModel } from "../models.js";
import { buildImagePrompt } from "../prompt.js";
import { selectRefs } from "../refs.js";
import { estimateCost } from "../pricing.js";
import { useStudio } from "./StudioContext.jsx";
import MediaPicker from "./MediaPicker.jsx";
import {
  CharacterPicker,
  CostLine,
  FinalPromptEditor,
  GenerationActions,
  GenerationDetails,
  GenerationMedia,
  PresetBar,
} from "./parts.jsx";
import { Button, ErrorNote, Field, Modal, Panel, Segmented, Select, Spinner, TextArea, Thumb } from "./ui.jsx";

export default function ImageStudio() {
  const { route, replaceParams, characters, pricing, refreshStats, toast } = useStudio();
  const [modelId, setModelId] = useState(DEFAULT_IMAGE_MODEL);
  const model = getModel(modelId);
  const [characterId, setCharacterId] = useState(null);
  const [extraRefs, setExtraRefs] = useState([]);
  const [excludedRefIds, setExcludedRefIds] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [override, setOverride] = useState(null);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [imageSize, setImageSize] = useState(model.defaultImageSize);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [detail, setDetail] = useState(null);

  // Deep links: ?character=<id>&ref=<assetId>
  useEffect(() => {
    if (route.params.character) setCharacterId(route.params.character);
    if (route.params.ref) setExtraRefs([{ id: route.params.ref, kind: "image", url: `/api/media/${route.params.ref}` }]);
  }, [route.params.character, route.params.ref]);

  useEffect(() => {
    api.listGenerations({ kind: "image", limit: 30 }).then(setResults).catch((err) => toast(err.message, "error"));
  }, [toast]);

  const character = characters.find((c) => c.id === characterId) || null;
  // Extra refs (outfits, products) keep their slots; the character gets the
  // best varied subset of her library in the rest of the model's limit.
  const extras = extraRefs.slice(0, model.maxReferenceImages - 1);
  const characterBudget = model.maxReferenceImages - extras.length;
  const characterRefs = selectRefs(character?.refs || [], characterBudget, { exclude: excludedRefIds });
  const referenceAssetIds = [...characterRefs, ...extras].map((a) => a.id);

  const built = useMemo(
    () => buildImagePrompt({ character, characterRefCount: characterRefs.length, extraRefCount: extras.length, prompt }),
    [character, characterRefs.length, extras.length, prompt],
  );
  const finalPrompt = override ?? built;
  const estimate = estimateCost(pricing, { kind: "image", model: modelId, imageSize, count, inputImages: referenceAssetIds.length });

  const changeModel = (id) => {
    const next = getModel(id);
    setModelId(id);
    if (!next.imageSizes.includes(imageSize)) setImageSize(next.defaultImageSize);
    if (!next.aspectRatios.includes(aspectRatio)) setAspectRatio("9:16");
  };

  const changeCharacter = (id) => {
    setCharacterId(id);
    setExcludedRefIds([]);
    replaceParams({ character: id });
  };

  const updateResult = useCallback((updated) => {
    setResults((list) => list.map((g) => (g.id === updated.id ? updated : g)));
    setDetail((d) => (d?.id === updated.id ? updated : d));
  }, []);

  const generate = async () => {
    setBusy(true);
    setPending(count);
    setError("");
    try {
      const generations = await api.generateImage({
        model: modelId,
        prompt,
        finalPrompt,
        characterId,
        referenceAssetIds,
        characterRefCount: characterRefs.length,
        aspectRatio,
        imageSize,
        count,
      });
      setResults((list) => [...generations, ...list]);
      const failed = generations.filter((g) => g.status === "failed");
      if (failed.length) setError(failed[0].error || "Generation failed");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setPending(0);
      refreshStats();
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 lg:flex-row">
      <Panel className="custom-scrollbar w-full shrink-0 space-y-4 overflow-y-auto p-4 lg:w-[400px]">
        <Field label="Model">
          <Select value={modelId} onChange={changeModel} options={IMAGE_MODELS.map((m) => ({ value: m.id, label: `${m.name} · ${m.id}` }))} />
          <p className="mt-1 text-[11px] text-muted">{model.description}</p>
        </Field>

        <CharacterPicker
          value={characterId}
          onChange={changeCharacter}
          sent={characterRefs}
          excluded={excludedRefIds}
          budget={characterBudget}
          onToggleRef={(id) => setExcludedRefIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]))}
        />

        <Field label="Extra references" hint={`${referenceAssetIds.length}/${model.maxReferenceImages} images sent`}>
          <div className="flex flex-wrap gap-1.5">
            {extras.map((asset) => (
              <Thumb key={asset.id} asset={asset} className="h-14 w-14" onRemove={() => setExtraRefs((l) => l.filter((a) => a.id !== asset.id))} />
            ))}
            {referenceAssetIds.length < model.maxReferenceImages && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-white/20 text-xl text-secondary hover:border-primary hover:text-primary"
              >
                ＋
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted">Outfits, products or locations. The character&apos;s own refs are attached automatically.</p>
        </Field>

        <Field label="Prompt">
          <TextArea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Sitting in a sunlit Paris café, holding a cappuccino, candid smile…" />
        </Field>
        <PresetBar kind="image" prompt={prompt} onPrompt={setPrompt} onSettings={(s) => s.aspectRatio && setAspectRatio(s.aspectRatio)} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Aspect ratio">
            <Select value={aspectRatio} onChange={setAspectRatio} options={model.aspectRatios.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="Images">
            <Segmented value={count} onChange={setCount} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
          </Field>
        </div>
        <Field label="Resolution">
          <Segmented value={imageSize} onChange={setImageSize} options={model.imageSizes.map((s) => ({ value: s, label: s }))} />
        </Field>

        <FinalPromptEditor built={built} override={override} onOverride={setOverride} />

        <ErrorNote>{error}</ErrorNote>
        <CostLine estimate={estimate} />
        <Button variant="primary" size="lg" className="w-full" disabled={busy || !finalPrompt.trim()} onClick={generate}>
          {busy ? <Spinner /> : "✦"} Generate {count > 1 ? `${count} images` : "image"}
        </Button>
      </Panel>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        {results.length === 0 && !pending ? (
          <div className="flex h-full min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-muted">
            Your images will appear here.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: pending }, (_, i) => (
              <div key={`p${i}`} className="flex aspect-[3/4] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
                <Spinner className="h-6 w-6 text-primary" />
              </div>
            ))}
            {results.map((g) => (
              <div key={g.id} className="group overflow-hidden rounded-xl border border-white/[0.07] bg-card-bg">
                <button type="button" className="block w-full" onClick={() => setDetail(g)}>
                  <GenerationMedia generation={g} className="aspect-[3/4] w-full" />
                </button>
                <div className="p-2">
                  <GenerationActions generation={g} onChange={updateResult} compact />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        max={Math.max(1, model.maxReferenceImages - referenceAssetIds.length)}
        excludeIds={referenceAssetIds}
        title="Add reference images"
        onConfirm={(assets) => setExtraRefs((l) => [...l, ...assets])}
      />

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Image" wide>
        {detail && (
          <div className="grid gap-5 md:grid-cols-[1fr,320px]">
            <GenerationMedia generation={detail} className="max-h-[70vh] w-full rounded-xl object-contain" />
            <div className="space-y-4">
              <GenerationActions generation={detail} onChange={updateResult} />
              <GenerationDetails generation={detail} />
              <Button
                size="sm"
                onClick={() => {
                  setPrompt(detail.prompt);
                  setDetail(null);
                }}
              >
                Reuse prompt
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
