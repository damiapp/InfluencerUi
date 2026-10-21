"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { BIBLE_FIELDS, BIBLE_MODEL, bibleFieldValue, countWords, emptyBible, normalizeBible, setBibleField } from "../bible.js";
import { estimateCost, formatCost } from "../pricing.js";
import { useStudio } from "./StudioContext.jsx";
import { Button, ErrorNote, Label, Spinner, TextArea, cx } from "./ui.jsx";

/**
 * Auto-written character bible: generated from all references with a
 * multimodal Gemini model (structured JSON), editable, versioned. Only
 * regenerated when the button is clicked.
 */
export default function BibleEditor({ character, unsavedRefs, onChanged }) {
  const { pricing, refreshStats, toast } = useStudio();
  const [draft, setDraft] = useState(() => normalizeBible(character.bibleData || emptyBible()));
  const [versions, setVersions] = useState([]);
  const [busy, setBusy] = useState(null); // 'generate' | 'save' | 'restore'
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(normalizeBible(character.bibleData || emptyBible()));
  }, [character.id, character.bibleVersion, character.bibleData]);

  useEffect(() => {
    api.bibleHistory(character.id).then(setVersions).catch(() => setVersions([]));
  }, [character.id, character.bibleVersion]);

  const current = useMemo(() => normalizeBible(character.bibleData || emptyBible()), [character.bibleData]);
  const edited = JSON.stringify(draft) !== JSON.stringify(current);
  const words = countWords(draft.prompt_paragraph);
  const estimate = estimateCost(pricing, { kind: "text", model: BIBLE_MODEL, inputImages: character.refs.length });

  const run = async (kind, fn) => {
    setBusy(kind);
    setError("");
    try {
      const result = await fn();
      setVersions(result.versions);
      onChanged(result.character);
      refreshStats();
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const generate = () =>
    run("generate", () => api.generateBible(character.id)).then((r) => r && toast(`Bible v${r.character.bibleVersion} written from ${character.refs.length} references`, "success"));
  const save = () => run("save", () => api.saveBible(character.id, draft)).then((r) => r && toast(`Saved bible v${r.character.bibleVersion}`, "success"));
  const restore = (version) => run("restore", () => api.restoreBible(character.id, version));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={generate} disabled={!!busy || !character.refs.length || unsavedRefs}>
          {busy === "generate" ? <Spinner /> : "✦"} {character.bibleVersion ? "Regenerate bible" : "Generate bible"}
        </Button>
        <span className="text-[11px] text-muted">
          {BIBLE_MODEL} reads all {character.refs.length} references · ≈ {formatCost(estimate)}
          {unsavedRefs && " · save the reference changes first"}
        </span>
        {character.bibleVersion > 0 && <span className="ml-auto text-[11px] text-secondary">current: v{character.bibleVersion}</span>}
      </div>

      {character.bibleVersion === 0 && !edited ? (
        <p className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-muted">
          No bible yet. Generate one from the references, or fill in the fields by hand and save.
        </p>
      ) : null}

      <div>
        <Label hint={<span className={cx(words && (words < 60 || words > 90) && "text-amber-300")}>{words} words · 60–90</span>}>
          Prompt paragraph (prepended to every prompt)
        </Label>
        <TextArea rows={4} value={draft.prompt_paragraph} onChange={(e) => setDraft({ ...draft, prompt_paragraph: e.target.value })} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {BIBLE_FIELDS.map((field) => (
          <div key={field.key} className={field.list ? "sm:col-span-1" : ""}>
            <Label hint={field.list ? "one per line" : null}>{field.label}</Label>
            <TextArea
              rows={field.list ? 3 : 1}
              value={bibleFieldValue(draft, field)}
              onChange={(e) => setDraft(setBibleField(draft, field, e.target.value))}
              className={cx("text-xs", field.key === "never_change" && "border-amber-400/30")}
            />
          </div>
        ))}
      </div>

      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={!!busy || !edited || !draft.prompt_paragraph.trim()}>
          {busy === "save" ? <Spinner /> : null} Save as new version
        </Button>
        {edited && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(current)}>
            Discard edits
          </Button>
        )}
      </div>

      {versions.length > 0 && (
        <div>
          <Label>History</Label>
          <div className="space-y-1">
            {versions.map((v) => (
              <div key={v.id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1 text-[11px]">
                <span className={cx("font-semibold", v.version === character.bibleVersion ? "text-primary" : "text-white")}>v{v.version}</span>
                <span className="text-secondary">{v.source}</span>
                <span className="text-muted">{new Date(v.createdAt).toLocaleString()}</span>
                {v.costEstimate != null && <span className="text-muted">{formatCost(v.costEstimate)}</span>}
                <span className="min-w-0 flex-1 truncate text-muted">{v.data?.prompt_paragraph}</span>
                {v.version !== character.bibleVersion && (
                  <button type="button" disabled={!!busy} onClick={() => restore(v.version)} className="text-primary hover:underline disabled:opacity-40">
                    Restore
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
