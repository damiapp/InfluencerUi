"use client";

import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useStudio } from "./StudioContext.jsx";
import MediaPicker from "./MediaPicker.jsx";
import { Button, ErrorNote, Field, Panel, Spinner, TextArea, TextInput, cx } from "./ui.jsx";

const MIN_REFS = 3;
const MAX_REFS = 8;
const EMPTY = { id: null, name: "", bible: "", styleNotes: "", voiceDescription: "", voiceId: null, voicePreview: null, refs: [] };

export default function CharactersStudio() {
  const { characters, charactersLoaded, refreshCharacters, navigate, route, replaceParams, toast } = useStudio();
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [designing, setDesigning] = useState(false);

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
    saved.refs.map((r) => r.id).join() !== draft.refs.map((r) => r.id).join();

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const body = {
        name: draft.name,
        bible: draft.bible,
        styleNotes: draft.styleNotes,
        voiceDescription: draft.voiceDescription || "",
        refAssetIds: draft.refs.map((r) => r.id),
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
              <div className={cx("text-[11px]", c.refs.length < MIN_REFS ? "text-amber-300" : "text-muted")}>{c.refs.length} refs</div>
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
            </div>
          )}
        </div>

        <Field label="Name">
          <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Mia" />
        </Field>

        <Field label="Character bible" hint="prepended to every prompt">
          <TextArea
            rows={6}
            value={draft.bible}
            onChange={(e) => setDraft({ ...draft, bible: e.target.value })}
            placeholder="24-year-old woman. Oval face, light freckles across the nose, hazel-green eyes, thick straight brows. Copper-red chin-length bob with a side part. Small gold nose ring on the left nostril, tiny star tattoo behind the right ear."
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

        <Field label="Locked reference images" hint={`${draft.refs.length}/${MAX_REFS} · ${MIN_REFS}–${MAX_REFS} recommended`}>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {draft.refs.map((ref, i) => (
              <div key={ref.id} className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-white/10">
                <img src={ref.url} alt="" className="h-full w-full object-cover" />
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-bold text-white">{i + 1}</span>
                <div className="absolute inset-x-0 bottom-0 hidden justify-between bg-black/70 p-1 group-hover:flex">
                  <button type="button" onClick={() => moveRef(i, -1)} className="px-1 text-xs text-white" aria-label="Move left">
                    ◀
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, refs: d.refs.filter((r) => r.id !== ref.id) }))}
                    className="px-1 text-xs text-red-300"
                  >
                    Remove
                  </button>
                  <button type="button" onClick={() => moveRef(i, 1)} className="px-1 text-xs text-white" aria-label="Move right">
                    ▶
                  </button>
                </div>
              </div>
            ))}
            {draft.refs.length < MAX_REFS && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex aspect-[3/4] items-center justify-center rounded-lg border border-dashed border-white/20 text-2xl text-secondary hover:border-primary hover:text-primary"
              >
                ＋
              </button>
            )}
          </div>
          {draft.refs.length < MIN_REFS && (
            <p className="mt-2 text-xs text-amber-300">
              Add at least {MIN_REFS} clear references (front face, three-quarter, full body) for consistent results.
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted">
            Order matters: the first references carry the most weight. Image Studio sends all of them; Video Studio sends up to 5.
          </p>
        </Field>

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
        onConfirm={(assets) => setDraft((d) => ({ ...d, refs: [...d.refs, ...assets].slice(0, MAX_REFS) }))}
      />
    </div>
  );
}
