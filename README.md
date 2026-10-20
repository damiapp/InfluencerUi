# Influencer Studio

A private, single-user AI studio for consistent AI-influencer content. You design a character, generate on-model images
with her locked references, animate them into vertical 9:16 clips, then edit and extend the clips. Everything calls
Google's Gemini API directly and is stored in your own Cloudflare account.

- **Image Studio**: Nano Banana Pro (`gemini-3-pro-image`) and Nano Banana 2.1 (`gemini-nano-banana-2.1`), up to
  14 reference images, any supported aspect ratio, 1K/2K/4K.
- **Video Studio**: Gemini Omni Flash (`gemini-omni-1.1-flash`) through the Interactions API. Defaults to 9:16 at
  720p with a 1080p option. Supports `<FIRST_FRAME>`, `<LAST_FRAME>` and `<IMAGE_REF_N>` role tags, multi-turn
  **Edit** (`previous_interaction_id`, with an optional "Keep everything else the same.") and **Extend**
  (+10 s per step, up to 40 s).
- **Voice**: each character gets a voice description, which is added word for word to every line she speaks
  in Omni (close but not identical between clips). **Design voice** also creates a stored Gemini voice
  (Voice Design), and **Voiceover** speaks a script in that exact voice with Gemini TTS and mixes it onto a clip
  as a new version, so the voice is identical every time.
- **AI Influencer**: a trait picker for designing a new person. It generates portraits and saves the best ones as a
  character.
- **Characters**: each character has a name, a bible (face, hair, signature details), 3–8 locked reference images
  and default style notes. Selecting a character auto-attaches the references and prepends the bible. The final
  prompt is always shown and editable before you generate.
- **Gallery**: every generation with its prompt, final prompt, model, settings, interaction id and cost. Items can
  be favourited, used as a reference, animated (sent to Video Studio as `<FIRST_FRAME>`), edited or extended.
- **Cost**: an estimate before every generation and a running monthly total, from `config/pricing.json`.
- **Storage**: metadata in Cloudflare D1, and all media in R2. Outputs are copied to R2 as soon as Google
  finishes them, because Google deletes generated files after about 48 h.
- **Security**: the Gemini key exists only as a server-side secret. The app sits behind a password login and/or
  Cloudflare Access.

> Based on [Open Generative AI](https://github.com/Anil-matcha/Open-Generative-AI) (formerly "Open Higgsfield AI")
> by Anil Matcha and contributors, MIT licensed. Its UI design and studio structure were the starting point. The
> Muapi integration, the other studios, the desktop app and local inference were removed. See `LICENSE` and
> `docs/PLAN.md`.

## Quick start (local, no API key needed)

Requires Node.js 20+ and npm only. Nothing is installed system-wide: Wrangler, Miniflare and Next.js are project
dependencies, so this works on SteamOS / an immutable root filesystem.

```bash
npm install
cp .dev.vars.example .dev.vars        # AI_PROVIDER=mock by default
npm run db:migrate:local              # creates the local D1 database in .wrangler/state
npm run dev                           # http://localhost:3000
```

With `AI_PROVIDER=mock` the app makes no Gemini calls and costs nothing. Images are placeholder SVGs and videos are
a bundled 3-second test clip, which is enough to click through every flow. When you have a key, set
`GEMINI_API_KEY=...` and `AI_PROVIDER=google` in `.dev.vars`, then restart `npm run dev`.

Local D1 and R2 data live in `.wrangler/state/` (git-ignored). `rm -rf .wrangler/state` resets everything.

### Tests

```bash
npm test     # prompt builder, pricing, GoogleProvider against a fake Gemini REST server, auth
```

## Configuration

| Name | Where | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | secret | Gemini API key from [AI Studio](https://aistudio.google.com/apikey). Paid tier recommended: Omni has no free tier, and stored interactions (needed for Edit/Extend) are kept for 55 days on paid and 1 day on free. |
| `AI_PROVIDER` | var | `google` (production) or `mock`. If unset, Google is used when a key exists; otherwise mock (dev only). |
| `APP_PASSWORD` | secret | Single-user login password. |
| `SESSION_SECRET` | secret | Long random string used to sign the login cookie. If unset, a key derived from the password is used. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | var | Optional. When both are set, every request must carry a valid Cloudflare Access JWT for that application. |
| `GEMINI_API_REVISION` | var | Optional. Value of the `Api-Revision` header (default `2026-05-20`; `none` to omit it). |
| `GEMINI_VIDEO_BACKGROUND` | var | Optional. `false` turns off background interactions for video (requests then block until done). |

Locally all of these go in `.dev.vars`. In production, use `npx wrangler secret put NAME` for secrets and `vars` in
`wrangler.jsonc` for the rest. **In production the app refuses all requests until `APP_PASSWORD` or Cloudflare
Access is configured**, because every generation costs money.

Prices live in [`config/pricing.json`](config/pricing.json) and are per output image or per output second of video.
They are estimates. Check them against <https://ai.google.dev/gemini-api/docs/pricing> and edit the file. The
monthly total is the sum of the stored estimates for the current UTC month.

## Deploying to Cloudflare Workers

The app runs on Cloudflare Workers via the [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare). That is
the supported way to run a Next.js App Router app with server routes on Workers, and it gives direct D1/R2 bindings.
Cloudflare Pages is not a better fit, because the API routes need the Node.js-compatible Workers runtime anyway.

The Workers **Paid** plan ($5/month) is recommended. Video downloads and reference uploads are streamed, but image
outputs arrive as base64 and decoding a 4K image needs more than the free plan's 10 ms of CPU.

All commands use `npx`, so nothing is installed globally:

```bash
npx wrangler login

# 1. D1: create the database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create influencer-studio
npm run db:migrate:remote

# 2. R2: the bucket name must match wrangler.jsonc (r2_buckets[0].bucket_name)
npx wrangler r2 bucket create influencer-studio-media

# 3. Secrets
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put APP_PASSWORD
npx wrangler secret put SESSION_SECRET      # e.g. output of: openssl rand -hex 32

# 4. Build and deploy
npm run deploy
```

`npm run preview` builds the Worker and runs it locally in `workerd` (the real runtime) on http://localhost:8787,
using `.dev.vars` and the local D1/R2 state.

### Database migrations

Migrations are plain SQL in `migrations/`. Add a new numbered file (`0002_….sql`) and apply it:

```bash
npm run db:migrate:local     # local .wrangler state
npm run db:migrate:remote    # production D1
```

### R2

The bucket is private. The browser never gets R2 or Google URLs; it only sees `/api/media/<assetId>`, which streams
from R2 behind the login and supports `Range` requests for video seeking. Keys look like
`generations/2026-10/ast_….mp4` and `uploads/2026-10/ast_….png`.

### Cron

`worker.js` wraps the OpenNext worker and adds a `scheduled` handler (every 10 min, see `triggers` in
`wrangler.jsonc`). It finalises video jobs that finished while no browser tab was polling, so their output still
reaches R2 before Google deletes it. The gallery runs the same sweep when it opens.

### Cloudflare Access (optional, recommended)

To put Cloudflare's login in front of the app as well as, or instead of, the password:

1. Zero Trust dashboard → Access → Applications → Add → Self-hosted. Add your Worker's hostname (custom domain or
   `*.workers.dev`) and a policy that allows only your email.
2. Copy the application's **AUD tag** and your team domain (`<team>.cloudflareaccess.com`).
3. Set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` (as `vars` or secrets). The middleware then verifies the
   `Cf-Access-Jwt-Assertion` signature, audience, issuer and expiry on every request.

## How it works

```
browser ──► Next.js (OpenNext on Workers)
             ├─ middleware.js           password cookie / Cloudflare Access check
             ├─ app/api/*               JSON routes; only place the Gemini key is used
             ├─ lib/generations.js      validate → provider → D1 → R2
             ├─ lib/providers/
             │    provider.js           interface: generateImage, generateVideo, editVideo, extendVideo, getStatus, fetchOutput
             │    google.js             Interactions API + Files API (plain fetch)
             │    mock.js               offline provider for development
             ├─ D1 (DB)                 assets, characters, character_refs, generations
             └─ R2 (MEDIA)              every upload and output
packages/studio/                        React UI (studios, picker, prompt builder, models, pricing)
```

**Gemini calls.** All calls go to `POST https://generativelanguage.googleapis.com/v1beta/interactions`:

- Images: `input` holds the reference images, then the text; `response_format: {type: "image", aspect_ratio,
  image_size}`. References are uploaded once to the Files API, and the `files/…` URI is cached on the asset until
  it expires.
- Video: `response_format: {type: "video", delivery: "uri", aspect_ratio, resolution, duration}` with
  `store: true` and `background: true`. Images are ordered first frame, last frame, then references. Role tags
  come from `packages/studio/src/prompt.js`; when frames and references are mixed, the explicit
  `[# Sources …] [# References …]` declaration is used.
- Edit and extend send `previous_interaction_id` with a short prompt. Every interaction id is saved on its
  generation row.
- `GET /v1beta/interactions/{id}` is polled until it completes. Then `GET /v1beta/files/{name}` is polled until
  the state is `ACTIVE`, and `…:download?alt=media` is streamed into R2.

**Adding another provider.** Implement the methods in `lib/providers/provider.js`, register the provider in
`lib/providers/index.js`, and add its models to `packages/studio/src/models.js` and prices to
`config/pricing.json`.

## Voice and audio

Gemini Omni generates the clip's sound together with the picture: speech, ambience and music, all from the
prompt. In Video Studio:

- **Dialogue** turns a line into `Ava says to the camera: "…"`, followed by `Voice: <the character's voice
  description>` and `No other dialogue or voiceover.` Omni cannot take a stored voice, so the voice is
  described in the same words every time. It stays close across clips and is most stable within one
  generate → extend chain. The Extend box takes a new spoken line as well.
- **Sound presets**: no music, natural ambience, calm or upbeat music.
- **Voiceover (character voice)**: for a voice that is exactly the same every time. In Characters, **Design voice**
  calls Gemini Voice Design (`POST /v1beta/voices`, a stored prompted voice that lasts a year after its last use)
  and plays a preview. In Video Studio the script is spoken by `gemini-3.8-flash-tts` with that voice id, and
  the browser mixes it onto the clip:
  - the video stream is copied without re-encoding;
  - the clip's own audio is kept at 0–100 % under the voice;
  - the voice starts at a chosen offset;
  - the audio is encoded with WebCodecs as AAC, or Opus where AAC isn't available (Firefox on Linux).

  The result is uploaded to R2 as a **Voiceover** version of the clip. The mixing uses
  [Mediabunny](https://mediabunny.dev) (MPL-2.0) and runs in the browser, because Workers can't run ffmpeg. Her
  lips don't move to a voiceover, so use it for narration and off-camera lines, and generate those clips with
  **No dialogue**. Voiceover versions can't be edited or extended: edit or extend the version before it, then
  add the voiceover again.

Speech costs about $9 per 1M audio tokens (≈ $0.0002 per second) and shows up in the monthly total. Voice
Design has no separate published price.

## Notes and limits

- Omni edits work on clips of up to 10 s. Extend in 10 s steps up to 40 s total. Edit first, then extend.
- Video Studio sends at most 5 reference images (the documented Omni limit), and you can toggle which of the
  character's references are sent. Image Studio sends all of them (up to 14).
- Mixing a voiceover needs a browser with WebCodecs audio encoding (current Chrome or Firefox). To keep the
  clip's original sound under the voice, the browser must also decode AAC. Google Chrome and Firefox do; some
  open-source Chromium builds don't, and then only the voice is kept.
- Interactions must stay stored (`store: true`) for Edit/Extend to work.
- Google documents that uploading videos for editing is not available in the EEA, Switzerland, the UK and some US
  states. This app only edits and extends clips it generated itself, which Google says is supported everywhere.

## License

MIT. See [LICENSE](LICENSE). Original work © Open Generative AI contributors.
