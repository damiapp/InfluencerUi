"use client";

import { useState } from "react";
import { api } from "../api.js";
import { DEFAULT_SPEECH_MODEL } from "../models.js";
import { estimateCost } from "../pricing.js";
import { estimateSpeechSeconds } from "../prompt.js";
import { muxVoiceover } from "../voiceoverMux.js";
import { useStudio } from "./StudioContext.jsx";
import { CostLine } from "./parts.jsx";
import { Button, ErrorNote, Label, Panel, Segmented, Spinner, TextArea, TextInput } from "./ui.jsx";

const ORIGINAL_VOLUME = [
  { value: 0, label: "Mute" },
  { value: 0.2, label: "20%" },
  { value: 0.5, label: "50%" },
  { value: 1, label: "100%" },
];

/**
 * Exact-voice voiceover: the script is spoken by Gemini TTS with the
 * character's stored voice, then muxed onto the clip in the browser and saved
 * as a new "Voiceover" version.
 */
export default function VoiceoverPanel({ clip, clipCharacter, onCreated }) {
  const { characters, pricing, refreshStats, navigate, toast } = useStudio();
  const [characterId, setCharacterId] = useState(clipCharacter?.id || "");
  const [script, setScript] = useState("");
  const [style, setStyle] = useState("");
  const [originalVolume, setOriginalVolume] = useState(0.2);
  const [voiceStart, setVoiceStart] = useState(0.3);
  const [stage, setStage] = useState(null); // 'speech' | 'mix' | 'upload'
  const [progress, setProgress] = useState(0);
  const [lastSpeech, setLastSpeech] = useState(null);
  const [error, setError] = useState("");

  const voiced = characters.filter((c) => c.voiceId);
  const character = characters.find((c) => c.id === (characterId || clipCharacter?.id)) || null;
  const clipLength = clip.totalDurationSeconds || clip.durationSeconds || 0;
  const seconds = estimateSpeechSeconds(script);
  const estimate = estimateCost(pricing, { kind: "audio", model: DEFAULT_SPEECH_MODEL, durationSeconds: seconds });
  const tooLong = clipLength && seconds + voiceStart > clipLength;

  const create = async () => {
    setError("");
    try {
      setStage("speech");
      // Reuse the last audio if only the mix settings changed.
      let speech = lastSpeech;
      if (!speech || speech.prompt !== script.trim() || speech.settings?.style !== (style.trim() || undefined) || speech.characterId !== character.id) {
        speech = await api.generateSpeech({ characterId: character.id, text: script, style });
        refreshStats();
        if (speech.status !== "completed") throw new Error(speech.error || "Speech generation failed");
        setLastSpeech(speech);
      }
      setStage("mix");
      setProgress(0);
      const result = await muxVoiceover({
        videoUrl: clip.output.url,
        speechUrl: speech.output.url,
        originalVolume,
        voiceStart,
        onProgress: setProgress,
      });
      if (result.voiceTruncated) toast("The voiceover is longer than the clip and was cut off. Extend the clip or shorten the script.", "error");
      setStage("upload");
      const generation = await api.saveVoiceover(clip.id, {
        blob: result.blob,
        speechGenerationId: speech.id,
        mix: { originalVolume, voiceStart, audioCodec: result.audioCodec },
      });
      onCreated(generation);
      toast("Voiceover version saved", "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setStage(null);
    }
  };

  return (
    <Panel className="space-y-2 p-3">
      <Label hint="exact same voice every time">Voiceover (character voice)</Label>
      {voiced.length === 0 ? (
        <p className="text-xs text-muted">
          No character has a designed voice yet.{" "}
          <button type="button" className="text-primary hover:underline" onClick={() => navigate("characters", { id: clipCharacter?.id })}>
            Design one in Characters
          </button>
          .
        </p>
      ) : (
        <>
          <select
            value={character?.id || ""}
            onChange={(e) => setCharacterId(e.target.value)}
            className="h-9 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-primary"
          >
            <option value="" disabled className="bg-neutral-900">
              Choose a voice
            </option>
            {voiced.map((c) => (
              <option key={c.id} value={c.id} className="bg-neutral-900">
                {c.name}
              </option>
            ))}
          </select>
          <TextArea rows={3} value={script} onChange={(e) => setScript(e.target.value)} placeholder="Okay, real talk — this is the best matcha in Lisbon." />
          <TextInput value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Delivery, e.g. excited, slightly breathless" />
          <div className="grid grid-cols-[auto,1fr] items-center gap-x-3 gap-y-2 text-xs text-secondary">
            <span>Clip audio</span>
            <Segmented value={originalVolume} onChange={setOriginalVolume} options={ORIGINAL_VOLUME} />
            <span>Start at</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={Math.max(0, clipLength - 1)}
                step={0.1}
                value={voiceStart}
                onChange={(e) => setVoiceStart(Number(e.target.value))}
                className="flex-1 accent-cyan-400"
              />
              <span className="w-10 text-right">{voiceStart.toFixed(1)}s</span>
            </div>
          </div>
          {script.trim() && (
            <p className={tooLong ? "text-[11px] text-amber-300" : "text-[11px] text-muted"}>
              ≈ {seconds}s of speech{tooLong ? ` — longer than the ${clipLength}s clip; it will be cut off` : ""}
            </p>
          )}
          <p className="text-[11px] text-muted">Best for voiceover or off-camera lines; her lips won’t move to it. Generate the clip with “No dialogue”.</p>
          <ErrorNote>{error}</ErrorNote>
          <CostLine estimate={estimate} />
          <Button className="w-full" disabled={!character || !script.trim() || !!stage || !clip.output} onClick={create}>
            {stage ? <Spinner /> : "🎙"}{" "}
            {stage === "speech" ? "Generating voice…" : stage === "mix" ? `Mixing ${Math.round(progress * 100)}%` : stage === "upload" ? "Saving…" : "Add voiceover"}
          </Button>
        </>
      )}
    </Panel>
  );
}
