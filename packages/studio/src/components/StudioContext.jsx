"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

const StudioContext = createContext(null);

export const TAB_IDS = ["image", "video", "influencer", "characters", "gallery"];

function readRoute() {
  if (typeof window === "undefined") return { tab: "image", params: {} };
  const segments = window.location.pathname.split("/").filter(Boolean);
  const tab = TAB_IDS.includes(segments[1]) ? segments[1] : "image";
  return { tab, params: Object.fromEntries(new URLSearchParams(window.location.search)) };
}

export function StudioProvider({ children }) {
  // null until the URL has been read on the client, so no studio mounts for the wrong tab.
  const [route, setRoute] = useState({ tab: null, params: {} });
  const [stats, setStats] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [charactersLoaded, setCharactersLoaded] = useState(false);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    setRoute(readRoute());
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((tab, params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""));
    const search = new URLSearchParams(clean).toString();
    window.history.pushState(null, "", `/studio/${tab}${search ? `?${search}` : ""}`);
    setRoute({ tab, params: clean });
  }, []);

  /** Update the current URL's query without adding history entries. */
  const replaceParams = useCallback((params) => {
    setRoute((current) => {
      const next = { ...current.params, ...params };
      Object.keys(next).forEach((k) => (next[k] == null || next[k] === "") && delete next[k]);
      const search = new URLSearchParams(next).toString();
      window.history.replaceState(null, "", `/studio/${current.tab}${search ? `?${search}` : ""}`);
      return { ...current, params: next };
    });
  }, []);

  const toast = useCallback((message, type = "info") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((list) => [...list.slice(-3), { id, message, type }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), type === "error" ? 9000 : 4500);
  }, []);

  const refreshStats = useCallback(() => api.stats().then(setStats).catch(() => {}), []);
  const refreshCharacters = useCallback(
    () =>
      api
        .listCharacters()
        .then((list) => {
          setCharacters(list);
          setCharactersLoaded(true);
          return list;
        })
        .catch((err) => toast(err.message, "error")),
    [toast],
  );

  useEffect(() => {
    refreshStats();
    refreshCharacters();
  }, [refreshStats, refreshCharacters]);

  const value = useMemo(
    () => ({
      route,
      navigate,
      replaceParams,
      stats,
      pricing: stats?.pricing || null,
      refreshStats,
      characters,
      charactersLoaded,
      refreshCharacters,
      setCharacters,
      toast,
      toasts,
    }),
    [route, navigate, replaceParams, stats, refreshStats, characters, charactersLoaded, refreshCharacters, toast, toasts],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside StudioProvider");
  return ctx;
}

/** Poll unfinished generations until they settle. */
export function usePolling(generations, onUpdate, intervalMs = 4000) {
  const pendingIds = generations.filter((g) => g.status === "running" || g.status === "finalizing").map((g) => g.id).join(",");
  useEffect(() => {
    if (!pendingIds) return undefined;
    let cancelled = false;
    const timer = setInterval(async () => {
      for (const id of pendingIds.split(",")) {
        try {
          const updated = await api.getGeneration(id);
          if (!cancelled) onUpdate(updated);
        } catch {
          // keep polling; transient errors are expected while a job runs
        }
      }
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pendingIds, onUpdate, intervalMs]);
}
