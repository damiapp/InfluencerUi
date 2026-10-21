"use client";

import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatCost } from "../pricing.js";
import { StudioProvider, useStudio } from "./StudioContext.jsx";
import ShootStudio from "./ShootStudio.jsx";
import ImageStudio from "./ImageStudio.jsx";
import VideoStudio from "./VideoStudio.jsx";
import InfluencerStudio from "./InfluencerStudio.jsx";
import CharactersStudio from "./CharactersStudio.jsx";
import Gallery from "./Gallery.jsx";
import { cx } from "./ui.jsx";

const icon = (d) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const TABS = [
  {
    id: "shoot",
    label: "Shoot → Animate",
    component: ShootStudio,
    icon: icon(<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>),
  },
  {
    id: "image",
    label: "Image Studio",
    component: ImageStudio,
    icon: icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>),
  },
  {
    id: "video",
    label: "Video Studio",
    component: VideoStudio,
    icon: icon(<><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></>),
  },
  {
    id: "influencer",
    label: "AI Influencer",
    component: InfluencerStudio,
    icon: icon(<><path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8-5-3.6-5 3.6 1.9-5.8L4 8.8h6.1z" /></>),
  },
  {
    id: "characters",
    label: "Characters",
    component: CharactersStudio,
    icon: icon(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  },
  {
    id: "gallery",
    label: "Gallery",
    component: Gallery,
    icon: icon(<><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>),
  },
];

function Toasts() {
  const { toasts } = useStudio();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "animate-fade-in-up rounded-xl border px-4 py-3 text-sm shadow-3xl backdrop-blur",
            t.type === "error" ? "border-red-500/30 bg-red-950/90 text-red-200" : t.type === "success" ? "border-emerald-500/30 bg-emerald-950/90 text-emerald-200" : "border-white/10 bg-neutral-900/90 text-white",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const { route, navigate, stats } = useStudio();
  const [visited, setVisited] = useState({});
  const active = route.tab;

  useEffect(() => {
    if (active) setVisited((v) => (v[active] ? v : { ...v, [active]: true }));
  }, [active]);

  const currency = stats?.pricing?.currency || "USD";
  const isMock = stats?.provider === "mock";

  return (
    <div className="flex h-screen flex-col bg-app-bg text-white md:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/[0.06] bg-panel-bg p-2 md:w-56 md:flex-col md:border-b-0 md:border-r md:p-3">
        <div className="hidden px-2 pb-4 pt-1 md:block">
          <div className="text-sm font-bold tracking-tight">Influencer Studio</div>
          <div className="text-[11px] text-muted">Gemini API</div>
        </div>
        {TABS.map((tab) => (
          <a
            key={tab.id}
            href={`/studio/${tab.id}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(tab.id);
            }}
            className={cx(
              "flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
              active === tab.id ? "bg-white/10 text-white" : "text-secondary hover:bg-white/[0.05] hover:text-white",
            )}
          >
            {tab.icon}
            <span className="whitespace-nowrap">{tab.label}</span>
          </a>
        ))}
        <div className="hidden flex-1 md:block" />
        <div className="hidden space-y-2 rounded-xl border border-white/[0.06] p-3 text-xs md:block">
          <div className="text-secondary">This month (est.)</div>
          <div className="text-lg font-semibold">{stats ? formatCost(stats.month.total, currency) : "…"}</div>
          <div className="text-muted">{stats ? `${stats.month.count} generations` : ""}</div>
        </div>
        {stats?.auth?.includes("password") && (
          <button
            type="button"
            onClick={() => api.logout().finally(() => (window.location.href = "/login"))}
            className="hidden rounded-xl px-3 py-2 text-left text-xs text-muted hover:text-white md:block"
          >
            Sign out
          </button>
        )}
      </nav>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {isMock && (
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
            Mock provider: placeholder images and clips, no Gemini calls, no cost. Set GEMINI_API_KEY to use Google.
          </div>
        )}
        {stats && !stats.auth?.length && !isMock && (
          <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-1.5 text-xs text-red-200">
            No login is configured. Set APP_PASSWORD or Cloudflare Access before exposing this app.
          </div>
        )}
        <div className="min-h-0 flex-1 p-3 md:p-5">
          {TABS.map(({ id, component: Component }) =>
            visited[id] || active === id ? (
              <div key={id} className={cx("h-full", active === id ? "block" : "hidden")}>
                <Component />
              </div>
            ) : null,
          )}
        </div>
      </main>
      <Toasts />
    </div>
  );
}

export default function StudioShell() {
  return (
    <StudioProvider>
      <Shell />
    </StudioProvider>
  );
}
