# Plan: personal Gemini studio on top of Open Generative AI

This is the plan written before the big changes. The README describes the finished result.

## What the Gemini docs changed compared to the brief

The live docs (ai.google.dev) are blocked from the build container, so the facts below come from Google's
own GitHub sources: the `@google/genai` 2.30.0 SDK types, the google-gemini/cookbook
`Get_started_Omni.ipynb` notebook, and the google-gemini/gemini-skills `gemini-omni-flash-api` and
`gemini-api-dev` skills.

| Brief | Docs (Oct 2026) | Decision |
| --- | --- | --- |
| Nano Banana Pro `gemini-3-pro-image-preview` | GA id is `gemini-3-pro-image` | use `gemini-3-pro-image` |
| Nano Banana 2 `gemini-3.1-flash-image-preview` | `gemini-3.1-flash-image` is deprecated and **shuts down 29 Oct 2026**. Its replacement is `gemini-nano-banana-2.1` (up to 14 reference images) | use `gemini-nano-banana-2.1` |
| Omni Flash `gemini-omni-1.1-flash` | confirmed; Interactions API, `POST /v1beta/interactions` | as briefed |
| Omni outputs | 360p / 720p (default) / 1080p / 4k, 16:9 or 9:16, duration 3–10 s | default 9:16 720p, with a 1080p option |
| Extend | 10 s per turn, **40 s total** | an Extend button that is disabled once the clip reaches 40 s |
| Image references for Omni | "up to 5 reference images" | the video studio attaches at most 5 character references |
| Response shape | SDK ≥ 2.0 uses `steps[]` with `model_output.content[]`; older docs show `outputs[]` | the parser accepts both |

## Keep

- The Next.js app router app and the `packages/studio` workspace (the UI lives there).
- The look of the upstream app: dark theme, Tailwind tokens, the sidebar shell.
- The features of Image Studio, Video Studio, AI Influencer Studio, the upload-history picker and
  generation history. They are rewritten for Google; the upstream versions were 2–3.5k lines of
  Muapi model-registry logic each.
- The MIT `LICENSE`, plus credit to upstream in the README.

## Delete

- Git submodules (Vibe-Workflow, Open-Poe-AI, Open-AI-Design-Agent) and the agents, workflow and app routes.
- The Audio, Clipping, Vibe Motion, Lip Sync, Recast, Cinema, Marketing, Workflow, Agent, Design Agent,
  Apps, MCP/CLI, Layers and Motion Control studios.
- The Electron app, local inference, the Vite/vanilla `src/` app, the Dockerfile, build scripts and tests
  for the fake local runner.
- `muapi.js`, the 35k-line `models.js` and all per-vendor model registries; the BYOK modal, Muapi proxy
  routes, the balance UI and Muapi CDN thumbnails.
- Muapi white-label and marketing copy and the "no content filters" messaging.
- The zh locale. The rewritten studios have no translations, so the i18n layer would be dead code.

## Add

- `lib/providers/`: a provider interface (`generateImage`, `generateVideo`, `editVideo`, `extendVideo`,
  `getStatus`) with `GoogleProvider` (raw `fetch`, with no SDK in the Worker) and `MockProvider`
  (`AI_PROVIDER=mock`, for clicking through the app without a key).
- Server routes under `app/api/*`. They are the only place the Gemini key is used (`GEMINI_API_KEY`
  secret).
- D1 tables `assets`, `characters`, `character_refs` and `generations`, with migrations in `migrations/`.
- R2 for every upload and output. Outputs are copied to R2 as soon as Google reports them done; reference
  images are uploaded to the Gemini Files API and the `files/…` URI is cached until it expires.
- Video jobs run as background interactions (`background: true`, `store: true`, `delivery: "uri"`). The
  browser polls `/api/generations/:id`, and the server fetches the interaction, waits for the output
  file to become `ACTIVE`, then streams it into R2. A cron sweep finalises jobs nobody is polling.
- A character library with a bible, 3–8 references and style notes. Selecting a character
  auto-attaches its references and prepends the bible; the final prompt is shown and editable.
- Gallery actions: favourite, Use as reference, Animate (to Video Studio as `<FIRST_FRAME>`), Edit and
  Extend.
- Prompt presets: single continuous shot, camera and lighting snippets, a 9:16 Reels preset.
- `config/pricing.json` with a cost estimate before each generation and a monthly total from D1.
- Single-user password login (a signed cookie, checked in middleware). Cloudflare Access is documented
  as an optional extra layer.
- Deployment to Cloudflare Workers through `@opennextjs/cloudflare`, with `wrangler.jsonc` defining
  D1, R2, a cron trigger and the secrets.
