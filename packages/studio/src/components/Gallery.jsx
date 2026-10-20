"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { usePolling, useStudio } from "./StudioContext.jsx";
import { GenerationActions, GenerationDetails, GenerationMedia } from "./parts.jsx";
import { Button, Modal, Segmented, Select, Spinner, cx } from "./ui.jsx";

const PAGE = 40;

export default function Gallery() {
  const { characters, toast, refreshStats } = useStudio();
  const [filter, setFilter] = useState("all");
  const [characterId, setCharacterId] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [detail, setDetail] = useState(null);

  const params = useCallback(
    (before) => ({
      kind: filter === "image" || filter === "video" ? filter : null,
      favorite: filter === "favorites",
      characterId: characterId || null,
      before,
      limit: PAGE,
    }),
    [filter, characterId],
  );

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const list = await api.listGenerations(params());
      setItems(list);
      setHasMore(list.length === PAGE);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [params, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Finish any jobs that completed while no tab was polling (e.g. after a reload).
  useEffect(() => {
    api
      .sweep()
      .then(({ results }) => {
        if (results?.some((r) => r.status === "completed" || r.status === "failed")) {
          load({ silent: true });
          refreshStats();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    const more = await api.listGenerations(params(last.createdAt));
    setItems((list) => [...list, ...more]);
    setHasMore(more.length === PAGE);
  };

  const update = useCallback((updated) => {
    setItems((list) => list.map((g) => (g.id === updated.id ? updated : g)));
    setDetail((d) => (d?.id === updated.id ? updated : d));
  }, []);
  usePolling(items, update);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-md">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "image", label: "Images" },
              { value: "video", label: "Videos" },
              { value: "favorites", label: "★ Favorites" },
            ]}
          />
        </div>
        <div className="w-56">
          <Select
            value={characterId}
            onChange={setCharacterId}
            options={[{ value: "", label: "All characters" }, ...characters.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => load()}>
          ↻ Refresh
        </Button>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-secondary">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-60 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-muted">Nothing here yet.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {items.map((g) => (
                <div key={g.id} className="overflow-hidden rounded-xl border border-white/[0.07] bg-card-bg">
                  <button type="button" className="relative block w-full" onClick={() => setDetail(g)}>
                    <GenerationMedia generation={g} className="aspect-[3/4] w-full" />
                    <span className={cx("absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase", g.kind === "video" ? "bg-fuchsia-500/80 text-white" : "bg-black/60 text-white")}>
                      {g.kind === "video" ? `${g.operation === "generate" ? "video" : g.operation} · ${g.totalDurationSeconds}s` : "image"}
                    </span>
                    {g.favorite && <span className="absolute right-2 top-2 text-amber-300">★</span>}
                  </button>
                  <div className="space-y-1.5 p-2">
                    <p className="line-clamp-2 text-[11px] text-white/60">{g.prompt || g.finalPrompt}</p>
                    <GenerationActions generation={g} onChange={update} compact />
                  </div>
                </div>
              ))}
            </div>
            {hasMore && (
              <div className="mt-4 flex justify-center">
                <Button onClick={loadMore}>Load more</Button>
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.kind === "video" ? "Video" : "Image"} wide>
        {detail && (
          <div className="grid gap-5 md:grid-cols-[1fr,320px]">
            <GenerationMedia generation={detail} controls className="max-h-[70vh] w-full rounded-xl object-contain" />
            <div className="space-y-4">
              <GenerationActions generation={detail} onChange={update} />
              <GenerationDetails generation={detail} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
