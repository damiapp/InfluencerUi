"use client";

import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useStudio } from "./StudioContext.jsx";
import MediaPicker from "./MediaPicker.jsx";
import ReferenceLibrary from "./ReferenceLibrary.jsx";
import BibleEditor from "./BibleEditor.jsx";
import { MAX_CHARACTER_REFS, RECOMMENDED_CHARACTER_REFS } from "../refs.js";
import { BIBLE_MODEL } from "../bible.js";
import { estimateCost, formatCost } from "../pricing.js";
import { Button, ErrorNote, Field, Panel, Spinner, TextArea, TextInput, cx } from "./ui.jsx";

const MAX_REFS = MAX_CHARACTER_REFS;
const EMPTY = { id: null, name: "", bible: "", styleNotes: "", voiceDescription: "", voiceId: null, voicePreview: null, bibleData: null, bibleVersion: 0, refs: [] };

// Reference list as the server stores it (order + tags), for dirty checks and saving.
const refPayload = (refs) => refs.map((r) => ({ assetId: r.id, angle: r.angle || null, expression: r.expression || null, lighting: r.lighting || null, primary: !!r.primary }));

export default function CharactersStudio() {
  const { characters, charactersLoaded, refreshCharacters, navigate, route, replaceParams, toast, pricing } = useStudio();
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [tagging, setTagging] = useState(false);

  // Select the character from ?id= or the first one.
  useEffect(() => {
    if (!charactersLoaded) return;
    const wanted = route.params.id ? characters.find((c) => c.id === route.params.id) : null;
    // Don't overwrite edits already made to this character while loading.
    if (wanted) setDraft((d) => (d.id === wanted.id ? d : wanted));
    // Keep anything typed into a new draft while the list was loading.
    else if (route.params.id === "new") setDraft((d) => (d.id ? EMPTY : d));
    else if (!draft.id && characters.length) setDraft(characters[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charactersLoaded, route.params.id]);

  const select = (character) => {
    setDraft(character || EMPTY);
    setError("");
    replaceParams({ id: character?.id || "new" });
  };

  const saved = characters.find((c) => c.id === draft.id);
  const dirty =
    !saved ||
    saved.name !== draft.name ||
    saved.bible !== draft.bible ||
    saved.styleNotes !== draft.styleNotes ||
    (saved.voiceDescription || "") !== (draft.voiceDescription || "") ||
    JSON.stringify(refPayload(saved.refs)) !== JSON.stringify(refPayload(draft.refs));
  const refsDirty = !!saved && JSON.stringify(refPayload(saved.refs)) !== JSON.stringify(refPayload(draft.refs));

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const body = {
        name: draft.name,
        bible: draft.bible,
        styleNotes: draft.styleNotes,
        voiceDescription: draft.voiceDescription || "",
        refs: refPayload(draft.refs),
      };
      const character = draft.id ? await api.updateCharacter(draft.id, body) : await api.createCharacter(body);
      await refreshCharacters();
      setDraft(character);
      replaceParams({ id: character.id });
      toast(`Saved ${character.name}`, "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const designVoice = async () => {
    setDesigning(true);
    setError("");
    try {
      const character = await api.designVoice(draft.id, draft.voiceDescription);
      await refreshCharacters();
      setDraft((d) => ({ ...d, voiceDescription: character.voiceDescription, voiceId: character.voiceId, voicePreview: character.voicePreview }));
      toast(`Designed ${character.name}'s voice`, "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setDesigning(false);
    }
  };

  const autoTag = async () => {
    setTagging(true);
    setError("");
    try {
      const character = await api.autoTagRefs(draft.id);
      await refreshCharacters();
      setDraft((d) => ({ ...d, refs: character.refs }));
      toast(`Tagged ${character.refs.length} references`, "success");
    } catch (err) {
      setError(err.message);
    } finally {
      setTagging(false);
    }
  };

  const remove = async () => {
    if (!draft.id || !window.confirm(`Delete ${draft.name}? Generated images and videos stay in the gallery.`)) return;
    try {
      await api.deleteCharacter(draft.id);
      const list = await refreshCharacters();
      select(list?.[0] || null);
    } catch (err) {
      setError(err.message);
    }
  };

  const moveRef = (index, delta) => {
    setDraft((d) => {
      const refs = [...d.refs];
      const target = index + delta;
      if (target < 0 || target >= refs.length) return d;
      [refs[index], refs[target]] = [refs[target], refs[index]];
      return { ...d, refs };
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 lg:flex-row">
      <Panel className="custom-scrollbar w-full shrink-0 space-y-2 overflow-y-auto p-3 lg:w-64">
        <Button variant="primary" className="w-full" onClick={() => select(null)}>
          ＋ New character
        </Button>
        {!charactersLoaded && <Spinner className="text-secondary" />}
        {characters.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => select(c)}
            className={cx("flex w-full items-center gap-3 rounded-xl p-2 text-left transition", draft.id === c.id ? "bg-white/10" : "hover:bg-white/[0.05]")}
          >
            {c.refs[0] ? (
              <img src={c.refs[0].url} alt="" className="h-10 w-10 rounded-lg object-cover" />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-white/10" />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{c.name}</div>
              <div className={cx("text-[11px]", c.refs.length < RECOMMENDED_CHARACTER_REFS ? "text-amber-300" : "text-muted")}>
                {c.refs.length} refs{c.bibleVersion ? ` · bible v${c.bibleVersion}` : ""}
              </div>
            </div>
          </button>
        ))}
      </Panel>

      <Panel className="custom-scrollbar flex-1 space-y-5 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">{draft.id ? draft.name || "Untitled" : "New character"}</h2>
          {draft.id && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => navigate("image", { character: draft.id })}>
                Use in Image Studio
              </Button>
              <Button size="sm" onClick={() => navigate("video", { character: draft.id })}>
                Use in Video Studio
              </Button>
              <Button size="sm" variant="primary" onClick={() => navigate("shoot", { character: draft.id })}>
                Shoot
              </Button>
            </div>
          )}
        </div>

        <Field label="Name">
          <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Mia" />
        </Field>

        <Field label="Extra notes" hint={draft.bibleData?.prompt_paragraph ? "added after the bible as “Notes: …”" : "used as the bible until one is generated"}>
          <TextArea
            rows={3}
            value={draft.bible}
            onChange={(e) => setDraft({ ...draft, bible: e.target.value })}
            placeholder="Anything the generated bible should not cover, e.g. always wears her grandmother's silver ring."
          />
        </Field>

        <Field label="Default style notes" hint="appended as “Style: …”">
          <TextArea
            rows={2}
            value={draft.styleNotes}
            onChange={(e) => setDraft({ ...draft, styleNotes: e.target.value })}
            placeholder="Natural iPhone photo look, warm film tones, minimal makeup."
          />
        </Field>

        <Field label="Voice" hint="used for spoken lines and voiceovers">
          <TextArea
            rows={3}
            value={draft.voiceDescription || ""}
            onChange={(e) => setDraft({ ...draft, voiceDescription: e.target.value })}
            placeholder="24-year-old woman, warm slightly husky alto, soft London accent, relaxed pace, bright and playful, a small laugh at the end of sentences."
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={designVoice} disabled={!draft.id || designing || (draft.voiceDescription || "").trim().length < 10}>
              {designing ? <Spinner /> : "🎙"} {draft.voiceId ? "Re-design voice" : "Design voice"}
            </Button>
            {draft.voicePreview && <audio key={draft.voicePreview.url} src={draft.voicePreview.url} controls className="h-8" />}
            {draft.voiceId && <span className="font-mono text-[11px] text-muted">{draft.voiceId}</span>}
          </div>
          <p className="mt-1 text-[11px] text-muted">
            The description is added word-for-word to every video line she speaks (close, not exact). “Design voice” also creates a
            stored Gemini voice for voiceovers, which sounds identical every time. Re-designing creates a new voice; saved
            voiceovers keep their audio.
          </p>
        </Field>

        <Field label="Reference library" hint={`${draft.refs.length}/${MAX_REFS} · ★ primary (max 3) is always sent first`}>
          <ReferenceLibrary refs={draft.refs} onChange={(refs) => setDraft((d) => ({ ...d, refs }))} onAdd={() => setPickerOpen(true)} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={autoTag} disabled={!draft.id || tagging || refsDirty || !draft.refs.length}>
              {tagging ? <Spinner /> : "🏷"} Auto-tag angles, expressions & lighting
            </Button>
            <span className="text-[11px] text-muted">
              {refsDirty
                ? "Save the reference changes first."
                : `${BIBLE_MODEL} · ≈ ${formatCost(estimateCost(pricing, { kind: "text", model: BIBLE_MODEL, inputImages: draft.refs.length, outputTokens: 60 * draft.refs.length }))} · you can correct every tag by hand`}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            Each generation sends the best subset within the model&apos;s limit: primaries first, then the most varied angles,
            expressions and lighting (Nano Banana up to 14, Omni up to 5). The studios show which ones were sent.
          </p>
        </Field>

        {draft.id && saved && (
          <Field label="Character bible" hint="auto-written from the references · versioned">
            <BibleEditor
              character={saved}
              unsavedRefs={refsDirty}
              onChanged={(character) => {
                refreshCharacters();
                setDraft((d) => ({ ...d, bibleData: character.bibleData, bibleVersion: character.bibleVersion }));
              }}
            />
          </Field>
        )}

        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-2">
          <Button variant="primary" onClick={save} disabled={saving || !draft.name.trim() || !dirty}>
            {saving ? <Spinner /> : null} {draft.id ? "Save changes" : "Create character"}
          </Button>
          {draft.id && (
            <Button variant="danger" onClick={remove}>
              Delete
            </Button>
          )}
        </div>
      </Panel>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        max={MAX_REFS - draft.refs.length}
        excludeIds={draft.refs.map((r) => r.id)}
        title="Add reference images"
        onConfirm={(assets) => setDraft((d) => ({ ...d, refs: [...d.refs, ...assets.map((a) => ({ ...a, primary: false }))].slice(0, MAX_REFS) }))}
      />
    </div>
  );
}
