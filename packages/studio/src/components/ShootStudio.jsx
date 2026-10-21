"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { getModel } from "../models.js";
import { SINGLE_SHOT_TEXT, buildImagePrompt, buildVideoPrompt } from "../prompt.js";
import { primaryRefs, selectRefs } from "../refs.js";
import { estimateCost, formatCost } from "../pricing.js";
import { useStudio } from "./StudioContext.jsx";
import { CharacterPicker, CostLine, FinalPromptEditor, GenerationDetails, GenerationMedia, PresetBar, SentRefs, UseAsReferenceButton } from "./parts.jsx";
import { Button, ErrorNote, Field, Label, Modal, Panel, Segmented, Spinner, TextArea, Toggle, cx } from "./ui.jsx";

const SHOOT_MODEL = "gemini-3-pro-image";
const ANIMATE_MODEL = "gemini-omni-1.1-flash";
const TEST = { resolution: "360p", durationSeconds: 4 };
const FINAL_RESOLUTION = "720p";
const isPending = (g) => g && (g.status === "running" || g.status === "finalizing");

function StageBar({ stage }) {
  const steps = [
    ["1", "Shoot", ["approve", "animate", "testing", "tested", "test failed", "rendering final", "done", "final failed"]],
    ["2", "Approve", ["animate", "testing", "tested", "test failed", "rendering final", "done", "final failed"]],
    ["3", "Animate", ["done"]],
  ];
  return (
    <div className="flex items-center gap-2 text-xs">
      {steps.map(([n, label, doneIn], i) => (
        <div key={n} className="flex items-center gap-2">
          {i > 0 && <span className="text-muted">→</span>}
          <span className={cx("rounded-full px-2 py-0.5 font-semibold", doneIn.includes(stage) ? "bg-primary/20 text-primary" : "bg-white/5 text-secondary")}>
            {n}. {label}
          </span>
        </div>
      ))}
      <span className="ml-2 text-muted">{stage}</span>
    </div>
  );
}

/** Read-only run summary, also used by the gallery's detail view. */
export function PipelineSummary({ data, onApprove, approving }) {
  const { run, stills, videos, totalCost } = data;
  const approvedId = run.settings?.approvedStillId;
  const [detail, setDetail] = useState(null);
  const label = (v) => (v.id === run.settings?.finalVideoId ? "Final" : v.id === run.settings?.testVideoId ? "Test" : "Earlier take");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StageBar stage={run.settings?.stage} />
        <span className="text-xs text-secondary">
          Run total: <span className="font-semibold text-white">{formatCost(totalCost)}</span>
        </span>
      </div>
      <div>
        <Label hint={`${stills.length} variants · Nano Banana Pro`}>Stills</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stills.map((still) => {
            const approved = still.id === approvedId;
            return (
              <div key={still.id} className={cx("overflow-hidden rounded-xl border-2 bg-card-bg", approved ? "border-emerald-400" : "border-transparent")}>
                <button type="button" className="relative block w-full" onClick={() => setDetail(still)}>
                  <GenerationMedia generation={still} className="aspect-[9/16] w-full" />
                  {approved && <span className="absolute left-2 top-2 rounded-full bg-emerald-400 px-2 text-[10px] font-bold text-black">APPROVED</span>}
                </button>
                <div className="flex flex-wrap gap-1 p-1.5">
                  {onApprove && !approved && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={still.status !== "completed" || still.blocked || approving}
                      onClick={() => onApprove(still)}
                      title={still.blocked ? "Blocked by Google — cannot be animated" : "Approve this still for animation"}
                    >
                      ✓ Approve
                    </Button>
                  )}
                  {still.status === "completed" && still.output && <UseAsReferenceButton assetId={still.output.id} defaultCharacterId={still.characterId} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {videos.length > 0 && (
        <div>
          <Label>Videos</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            {[...videos].reverse().map((video) => (
              <div key={video.id} className="space-y-1 rounded-xl border border-white/10 bg-card-bg p-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">
                    {label(video)} · {video.settings?.resolution} · {video.durationSeconds}s
                  </span>
                  <span className="text-muted">{formatCost(video.costEstimate)}</span>
                </div>
                <GenerationMedia generation={video} controls className="aspect-[9/16] max-h-[420px] w-full rounded-lg" />
                <button type="button" onClick={() => setDetail(video)} className="text-[11px] text-primary hover:underline">
                  Details · interaction id
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Details" wide>
        {detail && (
          <div className="grid gap-5 md:grid-cols-[1fr,340px]">
            <GenerationMedia generation={detail} controls className="max-h-[70vh] w-full rounded-xl object-contain" />
            <GenerationDetails generation={detail} />
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function ShootStudio() {
  const { route, replaceParams, characters, pricing, refreshStats, toast } = useStudio();
  const shootModel = getModel(SHOOT_MODEL);
  const [characterId, setCharacterId] = useState(null);
  const [excludedRefIds, setExcludedRefIds] = useState([]);
  const [scene, setScene] = useState("");
  const [override, setOverride] = useState(null);
  const [variants, setVariants] = useState(4);
  const [data, setData] = useState(null); // current run
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(null); // 'shoot' | 'approve' | 'test' | 'final'
  const [error, setError] = useState("");
  const [motion, setMotion] = useState("");
  const [singleShot, setSingleShot] = useState(true);
  const [mode, setMode] = useState("test");
  const [finalDuration, setFinalDuration] = useState(TEST.durationSeconds);
  const [sameAsTest, setSameAsTest] = useState(true);
  const [motionOverride, setMotionOverride] = useState(null);

  const loadRuns = useCallback(() => api.listGenerations({ kind: "pipeline", limit: 12 }).then(setRuns).catch(() => {}), []);
  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const openRun = useCallback(
    async (id) => {
      try {
        const run = await api.getPipeline(id);
        setData(run);
        setCharacterId(run.run.characterId);
        setScene(run.run.settings?.scenePrompt || "");
        if (run.run.settings?.motionPrompt) setMotion(run.run.settings.motionPrompt.replace(SINGLE_SHOT_TEXT, "").trim());
      } catch (err) {
        toast(err.message, "error");
      }
    },
    [toast],
  );

  useEffect(() => {
    if (route.params.run) openRun(route.params.run);
    else if (route.params.character) setCharacterId(route.params.character);
  }, [route.params.run, route.params.character, openRun]);

  // Poll while a video of this run is rendering.
  const pending = data?.videos?.some(isPending);
  useEffect(() => {
    if (!pending || !data) return undefined;
    const timer = setInterval(async () => {
      try {
        const fresh = await api.getPipeline(data.run.id);
        setData(fresh);
        if (!fresh.videos.some(isPending)) {
          refreshStats();
          loadRuns();
          const failed = fresh.videos.find((v) => v.status === "failed" && !data.videos.find((o) => o.id === v.id && o.status === "failed"));
          if (failed) toast(failed.blocked ? `Blocked by Google: ${failed.error}` : failed.error, "error");
        }
      } catch {
        // keep polling
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [pending, data, refreshStats, loadRuns, toast]);

  // ── Step 1: shoot ───────────────────────────────────────────────────────
  const character = characters.find((c) => c.id === characterId) || null;
  const shootRefs = selectRefs(character?.refs || [], shootModel.maxReferenceImages, { exclude: excludedRefIds });
  const builtShoot = useMemo(
    () => buildImagePrompt({ character, characterRefCount: shootRefs.length, prompt: scene }),
    [character, shootRefs.length, scene],
  );
  const shootPrompt = override ?? builtShoot;
  const shootEstimate = estimateCost(pricing, { kind: "image", model: SHOOT_MODEL, imageSize: "2K", count: variants, inputImages: shootRefs.length });
  const runCharacterMatches = data && data.run.characterId === characterId;

  const shoot = async (intoCurrent) => {
    setBusy("shoot");
    setError("");
    try {
      const body = { characterId, scenePrompt: scene, finalPrompt: shootPrompt, variants, referenceAssetIds: shootRefs.map((r) => r.id), aspectRatio: "9:16", imageSize: "2K" };
      const result = intoCurrent ? await api.shootMore(data.run.id, body) : await api.createPipeline(body);
      setData(result);
      replaceParams({ run: result.run.id, character: null });
      const blocked = result.stills.filter((s) => s.blocked);
      if (blocked.length) setError(`Google blocked ${blocked.length} of the variants: ${blocked[0].error}`);
      loadRuns();
      refreshStats();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  // ── Step 2: approve ─────────────────────────────────────────────────────
  const approve = async (still) => {
    setBusy("approve");
    setError("");
    try {
      setData(await api.approveStill(data.run.id, still.id));
      loadRuns();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  // ── Step 3: animate ─────────────────────────────────────────────────────
  const approved = data?.stills.find((s) => s.id === data.run.settings?.approvedStillId) || null;
  const runCharacter = characters.find((c) => c.id === data?.run.characterId) || null;
  const animateRefs = primaryRefs(runCharacter?.refs || [], 2);
  const motionText = [motion.trim(), singleShot ? SINGLE_SHOT_TEXT : ""].filter(Boolean).join(" ");
  const builtMotion = useMemo(
    () => buildVideoPrompt({ character: runCharacter, hasFirstFrame: true, characterRefCount: animateRefs.length, prompt: motionText }),
    [runCharacter, animateRefs.length, motionText],
  );
  const test = data?.videos.find((v) => v.id === data.run.settings?.testVideoId) || null;
  const reuseTest = mode === "final" && test && sameAsTest;
  const animatePrompt = reuseTest ? test.finalPrompt : motionOverride ?? builtMotion;
  const animateEstimate = estimateCost(pricing, {
    kind: "video",
    model: ANIMATE_MODEL,
    resolution: mode === "test" ? TEST.resolution : FINAL_RESOLUTION,
    durationSeconds: mode === "test" ? TEST.durationSeconds : finalDuration,
    inputImages: 1 + animateRefs.length,
  });

  const animate = async () => {
    setBusy(mode);
    setError("");
    try {
      const result = await api.animatePipeline(data.run.id, {
        mode,
        motionPrompt: motionText,
        finalPrompt: reuseTest ? undefined : animatePrompt,
        singleShot: false, // already folded into motionText
        durationSeconds: mode === "final" ? finalDuration : TEST.durationSeconds,
        sameAsTest: reuseTest,
      });
      setData(result);
      const video = result.videos.at(-1);
      if (video?.status === "failed") setError(video.blocked ? `Blocked by Google: ${video.error}` : video.error);
      if (mode === "test") setMode("final");
      refreshStats();
      loadRuns();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 xl:flex-row">
      <Panel className="custom-scrollbar w-full shrink-0 space-y-4 overflow-y-auto p-4 xl:w-[400px]">
        <div>
          <h2 className="text-sm font-semibold text-white">1 · Shoot</h2>
          <p className="text-[11px] text-muted">Nano Banana Pro · bible + auto-selected refs · 9:16 · 2K</p>
        </div>
        <CharacterPicker
          value={characterId}
          onChange={(id) => {
            setCharacterId(id);
            setExcludedRefIds([]);
          }}
          sent={shootRefs}
          excluded={excludedRefIds}
          budget={shootModel.maxReferenceImages}
          onToggleRef={(id) => setExcludedRefIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]))}
        />
        <Field label="Scene">
          <TextArea rows={4} value={scene} onChange={(e) => setScene(e.target.value)} placeholder="Sitting at a sunny café terrace in Lisbon, reading a book, candid moment…" />
        </Field>
        <PresetBar kind="image" prompt={scene} onPrompt={setScene} />
        <Field label="Variants">
          <Segmented value={variants} onChange={setVariants} options={[2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
        </Field>
        <FinalPromptEditor built={builtShoot} override={override} onOverride={setOverride} />
        <CostLine estimate={shootEstimate} />
        <div className="flex gap-2">
          <Button variant="primary" size="lg" className="flex-1" disabled={!!busy || !character || !scene.trim()} onClick={() => shoot(false)}>
            {busy === "shoot" ? <Spinner /> : "📷"} Shoot {variants} variants
          </Button>
          {runCharacterMatches && (
            <Button size="lg" disabled={!!busy || !scene.trim()} onClick={() => shoot(true)} title="Add variants to the open run">
              + into run
            </Button>
          )}
        </div>
        {runs.length > 0 && (
          <div>
            <Label>Recent runs</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    replaceParams({ run: r.id });
                    openRun(r.id);
                  }}
                  className={cx("overflow-hidden rounded-lg border text-left", data?.run.id === r.id ? "border-primary" : "border-white/10")}
                  title={`${r.prompt} · ${r.settings?.stage}`}
                >
                  <GenerationMedia generation={r} className="aspect-[9/16] w-full" />
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto">
        <ErrorNote>{error}</ErrorNote>
        {!data ? (
          <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-muted">
            Pick a character and describe a scene. You’ll approve one of the variants, test-animate it cheaply at 360p, then render the final at 720p.
          </div>
        ) : (
          <>
            <Panel className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-white">2 · Approve one still</h2>
              <PipelineSummary data={data} onApprove={approve} approving={busy === "approve"} />
            </Panel>

            <Panel className={cx("space-y-3 p-4", !approved && "opacity-50")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-white">3 · Animate</h2>
                <span className="text-[11px] text-muted">Gemini Omni Flash · 9:16 · ×1</span>
              </div>
              {!approved ? (
                <p className="text-xs text-muted">Approve a still first — only approved stills can be animated.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-secondary">
                    <span>Sending:</span>
                    <SentRefs ids={[approved.output.id]} /> <span>&lt;FIRST_FRAME&gt;</span>
                    <SentRefs ids={animateRefs.map((r) => r.id)} />
                    <span>{animateRefs.map((_, i) => `<IMAGE_REF_${i}>`).join(" ")}</span>
                  </div>
                  <Field label="Motion">
                    <TextArea rows={3} value={motion} onChange={(e) => setMotion(e.target.value)} placeholder="She looks up from the book, smiles at the camera and tucks her hair behind her ear." disabled={reuseTest} />
                  </Field>
                  <Toggle checked={singleShot} onChange={setSingleShot} label="Single continuous shot" />
                  <Segmented
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "test", label: "Test · 360p · 4s" },
                      { value: "final", label: `Final · 720p` },
                    ]}
                  />
                  {mode === "final" && (
                    <div className="flex flex-wrap items-center gap-4 text-xs text-secondary">
                      {test && <Toggle checked={sameAsTest} onChange={setSameAsTest} label="Same inputs as the test" />}
                      <label className="flex items-center gap-2">
                        Length
                        <select value={finalDuration} onChange={(e) => setFinalDuration(Number(e.target.value))} className="h-8 rounded-lg border border-white/10 bg-black/40 px-2 text-white">
                          {[4, 5, 6, 8, 10].map((n) => (
                            <option key={n} value={n}>
                              {n}s
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  {reuseTest ? (
                    <pre className="whitespace-pre-wrap rounded-xl bg-black/40 p-2 font-mono text-[11px] text-white/60">{test.finalPrompt}</pre>
                  ) : (
                    <FinalPromptEditor built={builtMotion} override={motionOverride} onOverride={setMotionOverride} />
                  )}
                  <CostLine estimate={animateEstimate} />
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full"
                    disabled={!!busy || pending || (!reuseTest && !motion.trim())}
                    onClick={animate}
                  >
                    {busy === "test" || busy === "final" ? <Spinner /> : "▶"} {mode === "test" ? "Run test (360p · 4s)" : "Render final (720p)"}
                  </Button>
                  {pending && <p className="text-[11px] text-muted">Rendering… you can leave this page; it finishes in the background.</p>}
                </>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
