"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { DEFAULT_VIDEO_MODEL, getModel } from "../models.js";
import { DEFAULT_EXTEND_PROMPT, buildDialogueLines, buildEditPrompt, buildVideoPrompt } from "../prompt.js";
import { estimateCost, formatCost } from "../pricing.js";
import { usePolling, useStudio } from "./StudioContext.jsx";
import MediaPicker from "./MediaPicker.jsx";
import VoiceoverPanel from "./VoiceoverPanel.jsx";
import {
  CharacterPicker,
  CostLine,
  FinalPromptEditor,
  GenerationActions,
  GenerationDetails,
  GenerationMedia,
  PresetBar,
} from "./parts.jsx";
import { Button, ErrorNote, Field, Label, Panel, Segmented, Spinner, TextArea, TextInput, Thumb, Toggle, cx } from "./ui.jsx";

const OP_LABEL = { generate: "Original", edit: "Edit", extend: "Extend", voiceover: "Voiceover" };
const assetFromId = (id) => (id ? { id, kind: "image", url: `/api/media/${id}` } : null);
const isPending = (g) => g && (g.status === "running" || g.status === "finalizing");

function FrameSlot({ label, asset, onPick, onClear, disabled }) {
  return (
    <div className={cx("flex-1", disabled && "pointer-events-none opacity-40")}>
      <Label>{label}</Label>
      {asset ? (
        <Thumb asset={asset} className="aspect-[9/16] w-full" onRemove={onClear} />
      ) : (
        <button
          type="button"
          onClick={onPick}
          className="flex aspect-[9/16] w-full items-center justify-center rounded-lg border border-dashed border-white/20 text-xs text-secondary hover:border-primary hover:text-primary"
        >
          ＋ Image
        </button>
      )}
    </div>
  );
}

export default function VideoStudio() {
  const { route, replaceParams, characters, pricing, refreshStats, toast } = useStudio();
  const model = getModel(DEFAULT_VIDEO_MODEL);

  // New clip settings
  const [characterId, setCharacterId] = useState(null);
  const [excludedRefIds, setExcludedRefIds] = useState([]);
  const [extraRefs, setExtraRefs] = useState([]);
  const [firstFrame, setFirstFrame] = useState(null);
  const [lastFrame, setLastFrame] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [dialogue, setDialogue] = useState("");
  const [override, setOverride] = useState(null);
  const [aspectRatio, setAspectRatio] = useState(model.defaultAspectRatio);
  const [resolution, setResolution] = useState(model.defaultResolution);
  const [duration, setDuration] = useState(model.defaultDurationSeconds);
  const [picker, setPicker] = useState(null); // 'first' | 'last' | 'refs'
  const [busy, setBusy] = useState(null); // 'generate' | 'edit' | 'extend'
  const [error, setError] = useState("");

  // Current clip and its version chain
  const [clip, setClip] = useState(null);
  const [chain, setChain] = useState([]);
  const [recent, setRecent] = useState([]);
  const [editPrompt, setEditPrompt] = useState("");
  const [keepSame, setKeepSame] = useState(true);
  const [extendPrompt, setExtendPrompt] = useState(DEFAULT_EXTEND_PROMPT);
  const [extendWithRefs, setExtendWithRefs] = useState(true);
  const [extendDialogue, setExtendDialogue] = useState("");

  // Deep links: ?firstFrame=<assetId>&character=<id>&clip=<generationId>
  useEffect(() => {
    if (route.params.firstFrame) setFirstFrame(assetFromId(route.params.firstFrame));
    if (route.params.character) setCharacterId(route.params.character);
  }, [route.params.firstFrame, route.params.character]);

  const loadClip = useCallback(
    async (id) => {
      try {
        const generation = await api.getGeneration(id);
        setClip(generation);
        setChain(await api.listGenerations({ rootId: generation.rootId, limit: 50 }));
      } catch (err) {
        toast(err.message, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    if (route.params.clip) loadClip(route.params.clip);
  }, [route.params.clip, loadClip]);

  useEffect(() => {
    api.listGenerations({ kind: "video", limit: 24 }).then(setRecent).catch(() => {});
  }, []);

  const applyUpdate = useCallback((updated) => {
    const swap = (list) => list.map((g) => (g.id === updated.id ? updated : g));
    setClip((c) => (c?.id === updated.id ? updated : c));
    setChain(swap);
    setRecent(swap);
    if (updated.status === "completed") refreshStats();
    if (updated.status === "failed") toast(updated.error || "Video generation failed", "error");
  }, [refreshStats, toast]);

  const pendingList = useMemo(() => {
    const map = new Map();
    [clip, ...chain, ...recent].filter(isPending).forEach((g) => map.set(g.id, g));
    return [...map.values()];
  }, [clip, chain, recent]);
  usePolling(pendingList, applyUpdate);

  // ── New clip prompt ──────────────────────────────────────────────────────
  const character = characters.find((c) => c.id === characterId) || null;
  const characterRefs = (character?.refs || []).filter((r) => !excludedRefIds.includes(r.id)).slice(0, model.maxReferenceImages);
  const extras = extraRefs.slice(0, Math.max(0, model.maxReferenceImages - characterRefs.length));
  const referenceAssetIds = [...characterRefs, ...extras].map((a) => a.id);
  const effectiveLast = firstFrame ? lastFrame : null;

  const built = useMemo(
    () =>
      buildVideoPrompt({
        character,
        hasFirstFrame: !!firstFrame,
        hasLastFrame: !!effectiveLast,
        characterRefCount: characterRefs.length,
        extraRefCount: extras.length,
        prompt,
        dialogue,
      }),
    [character, firstFrame, effectiveLast, characterRefs.length, extras.length, prompt, dialogue],
  );
  const finalPrompt = override ?? built;
  const inputImages = referenceAssetIds.length + (firstFrame ? 1 : 0) + (effectiveLast ? 1 : 0);
  const estimate = estimateCost(pricing, { kind: "video", model: model.id, resolution, durationSeconds: duration, inputImages });

  const changeCharacter = (id) => {
    setCharacterId(id);
    setExcludedRefIds([]);
    replaceParams({ character: id });
  };

  const showClip = (generation, newChain) => {
    setClip(generation);
    if (newChain) setChain(newChain);
    replaceParams({ clip: generation.id, firstFrame: null });
  };

  const generate = async () => {
    setBusy("generate");
    setError("");
    try {
      const generation = await api.generateVideo({
        operation: "generate",
        model: model.id,
        prompt,
        finalPrompt,
        characterId,
        firstFrameAssetId: firstFrame?.id || null,
        lastFrameAssetId: effectiveLast?.id || null,
        referenceAssetIds,
        characterRefCount: characterRefs.length,
        aspectRatio,
        resolution,
        durationSeconds: duration,
      });
      if (generation.status === "failed") setError(generation.error);
      setRecent((list) => [generation, ...list]);
      showClip(generation, [generation]);
      refreshStats();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  // ── Edit / extend the selected clip ──────────────────────────────────────
  const clipTotal = clip?.totalDurationSeconds || clip?.durationSeconds || 0;
  const clipReady = clip?.status === "completed";
  const clipCharacter = characters.find((c) => c.id === clip?.characterId) || null;
  const extendRefs = extendWithRefs ? (clipCharacter?.refs || []).slice(0, model.maxReferenceImages) : [];
  // Voiceover versions are muxed locally and have no Gemini interaction to continue.
  const isVoiceover = clip?.operation === "voiceover";
  const canEdit = clipReady && !isVoiceover && clipTotal <= model.maxEditSeconds;
  const canExtend = clipReady && !isVoiceover && clipTotal + model.extendStepSeconds <= model.maxTotalSeconds;
  const editFinal = buildEditPrompt(editPrompt, keepSame);
  const extendFinal = [
    extendPrompt.trim(),
    ...buildDialogueLines(clipCharacter, extendDialogue),
    extendRefs.length ? `Keep ${clipCharacter.name} consistent with ${extendRefs.map((_, i) => `<IMAGE_REF_${i}>`).join(" ")}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const clipResolution = clip?.settings?.resolution || model.defaultResolution;
  const editEstimate = estimateCost(pricing, { kind: "video", model: model.id, resolution: clipResolution, durationSeconds: clipTotal });
  const extendEstimate = estimateCost(pricing, {
    kind: "video",
    model: model.id,
    resolution: clipResolution,
    durationSeconds: model.extendStepSeconds,
    inputImages: extendRefs.length,
  });

  const continueClip = async (operation) => {
    setBusy(operation);
    setError("");
    try {
      const body =
        operation === "edit"
          ? { operation, parentId: clip.id, prompt: editPrompt, finalPrompt: editFinal, keepEverythingElse: keepSame }
          : {
              operation,
              parentId: clip.id,
              prompt: extendPrompt,
              finalPrompt: extendFinal,
              referenceAssetIds: extendRefs.map((r) => r.id),
              characterRefCount: extendRefs.length,
            };
      const generation = await api.generateVideo(body);
      if (generation.status === "failed") setError(generation.error);
      setRecent((list) => [generation, ...list]);
      showClip(generation, [...chain, generation]);
      if (operation === "edit") setEditPrompt("");
      if (operation === "extend") setExtendDialogue("");
      refreshStats();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 xl:flex-row">
      {/* ── New clip ─────────────────────────────────────────────────── */}
      <Panel className="custom-scrollbar w-full shrink-0 space-y-4 overflow-y-auto p-4 xl:w-[400px]">
        <div>
          <h2 className="text-sm font-semibold text-white">New clip · {model.name}</h2>
          <p className="text-[11px] text-muted">{model.id} · Interactions API</p>
        </div>

        <CharacterPicker value={characterId} onChange={changeCharacter} />
        {character && character.refs.length > 0 && (
          <Field label="Character refs sent" hint={`max ${model.maxReferenceImages} for video`}>
            <div className="flex flex-wrap gap-1.5">
              {character.refs.map((ref) => {
                const included = characterRefs.some((r) => r.id === ref.id);
                return (
                  <button
                    key={ref.id}
                    type="button"
                    onClick={() => setExcludedRefIds((ids) => (ids.includes(ref.id) ? ids.filter((i) => i !== ref.id) : [...ids, ref.id]))}
                    className={cx("h-12 w-12 overflow-hidden rounded-md border-2 transition", included ? "border-primary" : "border-transparent opacity-35")}
                    title={included ? "Sent as reference (click to skip)" : "Skipped (click to include)"}
                  >
                    <img src={ref.url} alt="" className="h-full w-full object-cover" />
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <div className="flex gap-3">
          <FrameSlot label="First frame" asset={firstFrame} onPick={() => setPicker("first")} onClear={() => { setFirstFrame(null); replaceParams({ firstFrame: null }); }} />
          <FrameSlot label="Last frame" asset={lastFrame} onPick={() => setPicker("last")} onClear={() => setLastFrame(null)} disabled={!firstFrame} />
          <div className="flex-1">
            <Label>Extra refs</Label>
            <div className="grid grid-cols-2 gap-1">
              {extras.map((asset) => (
                <Thumb key={asset.id} asset={asset} className="aspect-square" onRemove={() => setExtraRefs((l) => l.filter((a) => a.id !== asset.id))} />
              ))}
              {referenceAssetIds.length < model.maxReferenceImages && (
                <button type="button" onClick={() => setPicker("refs")} className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-white/20 text-secondary hover:border-primary hover:text-primary">
                  ＋
                </button>
              )}
            </div>
          </div>
        </div>

        <Field label="Prompt">
          <TextArea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="She turns to the camera, smiles and brushes her hair behind her ear…" />
        </Field>
        <Field label="Dialogue" hint={character?.voiceDescription ? `voice: ${character.name}'s description` : "optional"}>
          <TextArea rows={2} value={dialogue} onChange={(e) => setDialogue(e.target.value)} placeholder="What she says on camera, e.g. Morning! Come get coffee with me." />
          {dialogue.trim() && /no dialogue/i.test(prompt) && (
            <p className="mt-1 text-[11px] text-amber-300">The prompt says “No dialogue” — remove that preset so she speaks this line.</p>
          )}
          {dialogue.trim() && !character?.voiceDescription && (
            <p className="mt-1 text-[11px] text-amber-300">Add a Voice description to the character so her voice stays similar between clips.</p>
          )}
        </Field>
        <PresetBar
          kind="video"
          prompt={prompt}
          onPrompt={setPrompt}
          onSettings={(s) => {
            if (s.aspectRatio && model.aspectRatios.includes(s.aspectRatio)) setAspectRatio(s.aspectRatio);
          }}
        />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Aspect">
            <Segmented value={aspectRatio} onChange={setAspectRatio} options={model.aspectRatios.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="Resolution">
            <Segmented value={resolution} onChange={setResolution} options={model.resolutions.map((r) => ({ value: r, label: r }))} />
          </Field>
        </div>
        <Field label="Duration" hint={`${duration} s`}>
          <input
            type="range"
            min={model.minDurationSeconds}
            max={model.maxDurationSeconds}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
        </Field>

        <FinalPromptEditor built={built} override={override} onOverride={setOverride} />
        <ErrorNote>{error}</ErrorNote>
        <CostLine estimate={estimate} />
        <Button variant="primary" size="lg" className="w-full" disabled={!!busy || !finalPrompt.trim()} onClick={generate}>
          {busy === "generate" ? <Spinner /> : "▶"} Generate {duration}s clip
        </Button>
      </Panel>

      {/* ── Current clip ─────────────────────────────────────────────── */}
      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {clip ? (
            <>
              <Panel className="flex items-center justify-center overflow-hidden p-2">
                <GenerationMedia
                  generation={clip}
                  controls
                  className={cx("max-h-[62vh] w-auto rounded-xl", clip.settings?.aspectRatio === "16:9" ? "aspect-video w-full" : "aspect-[9/16] h-[62vh]")}
                />
              </Panel>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <GenerationActions generation={clip} onChange={applyUpdate} />
                <span className="text-xs text-secondary">
                  {OP_LABEL[clip.operation]} · {clipTotal}s total · {clip.settings?.resolution}
                </span>
              </div>

              {chain.length > 1 && (
                <div>
                  <Label>Versions</Label>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {chain.map((g, i) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => showClip(g)}
                        className={cx("shrink-0 rounded-lg border px-3 py-2 text-left text-xs", g.id === clip.id ? "border-primary bg-primary/10 text-white" : "border-white/10 text-secondary hover:text-white")}
                      >
                        <div className="font-semibold">
                          {i + 1}. {OP_LABEL[g.operation]}
                        </div>
                        <div>{isPending(g) ? "running…" : g.status === "failed" ? "failed" : `${g.totalDurationSeconds}s`}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <Panel className="space-y-2 p-3">
                  <Label hint={canEdit ? null : isVoiceover ? "edit the version before" : clipReady ? `clips ≤ ${model.maxEditSeconds}s only` : "wait for the clip"}>Edit this clip</Label>
                  <TextArea rows={2} value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} placeholder="Make her jacket red" />
                  <Toggle checked={keepSame} onChange={setKeepSame} label="Append “Keep everything else the same.”" />
                  {editPrompt && <p className="font-mono text-[11px] text-muted">→ {editFinal}</p>}
                  <CostLine estimate={editEstimate} />
                  <Button className="w-full" disabled={!canEdit || !editPrompt.trim() || !!busy} onClick={() => continueClip("edit")}>
                    {busy === "edit" ? <Spinner /> : "✎"} Edit
                  </Button>
                </Panel>
                <Panel className="space-y-2 p-3">
                  <Label hint={`${clipTotal}s → ${Math.min(clipTotal + model.extendStepSeconds, model.maxTotalSeconds)}s of ${model.maxTotalSeconds}s`}>
                    Extend +{model.extendStepSeconds}s
                  </Label>
                  <TextArea rows={2} value={extendPrompt} onChange={(e) => setExtendPrompt(e.target.value)} />
                  <TextInput value={extendDialogue} onChange={(e) => setExtendDialogue(e.target.value)} placeholder="New spoken line (optional)" />
                  {clipCharacter?.refs.length > 0 && (
                    <Toggle checked={extendWithRefs} onChange={setExtendWithRefs} label={`Re-attach ${clipCharacter.name}'s refs`} />
                  )}
                  <CostLine estimate={extendEstimate} />
                  <Button className="w-full" disabled={!canExtend || !extendPrompt.trim() || !!busy} onClick={() => continueClip("extend")}>
                    {busy === "extend" ? <Spinner /> : "⇥"} Extend
                  </Button>
                  {clipReady && !canExtend && (
                    <p className="text-[11px] text-muted">{isVoiceover ? "Extend the version before the voiceover." : "Maximum length reached."}</p>
                  )}
                </Panel>
              </div>

              {clipReady && !isVoiceover && (
                <VoiceoverPanel
                  key={clip.id}
                  clip={clip}
                  clipCharacter={clipCharacter}
                  onCreated={(generation) => {
                    setRecent((list) => [generation, ...list]);
                    showClip(generation, [...chain, generation]);
                  }}
                />
              )}

              <Panel className="p-3">
                <GenerationDetails generation={clip} />
              </Panel>
            </>
          ) : (
            <div className="flex min-h-[300px] flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-muted">
              Generate a clip, or pick one from the recent list. Use “Animate” on any image to start from it.
            </div>
          )}
        </div>

        <div className="w-full shrink-0 lg:w-44">
          <Label>Recent clips</Label>
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
            {recent.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  showClip(g);
                  loadClip(g.id);
                }}
                className={cx("overflow-hidden rounded-lg border text-left", clip?.id === g.id ? "border-primary" : "border-white/10")}
              >
                <GenerationMedia generation={g} className="aspect-[9/16] w-full" />
                <div className="truncate px-1.5 py-1 text-[10px] text-secondary">
                  {OP_LABEL[g.operation]} · {g.totalDurationSeconds}s · {formatCost(g.costEstimate)}
                </div>
              </button>
            ))}
            {!recent.length && <p className="text-xs text-muted">None yet.</p>}
          </div>
        </div>
      </div>

      <MediaPicker
        open={!!picker}
        onClose={() => setPicker(null)}
        max={picker === "refs" ? Math.max(1, model.maxReferenceImages - referenceAssetIds.length) : 1}
        title={picker === "first" ? "First frame" : picker === "last" ? "Last frame" : "Reference images"}
        excludeIds={picker === "refs" ? referenceAssetIds : []}
        onConfirm={(assets) => {
          if (picker === "first") setFirstFrame(assets[0]);
          else if (picker === "last") setLastFrame(assets[0]);
          else setExtraRefs((l) => [...l, ...assets]);
        }}
      />
    </div>
  );
}
