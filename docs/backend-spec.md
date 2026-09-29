# Vector Stroke Engine — Backend Spec (Phase 6b)

Companion to `build-spec.md`. That document intentionally left Phase 6 —
AI-path-feeder, AI-describe, export/share — for "later, needs backend."
Export/share shipped client-side with no backend dependency (see
`README.md`'s Phase 6 section). This document scopes the other half: the
backend build-spec section 2 said AI-path-feeder/AI-describe need, plus the
"key handling" that comes with it.

Nothing here touches the client-side engine (`src/engine/`, minus one new
shared types file) or changes anything already shipped. This is additive.

---

## 1. What this is

Two endpoints, both thin wrappers around one outbound call to an AI vision
model:

- **`POST /api/describe`** — plain-language description of the uploaded
  photo (build-spec's "AI-describe").
- **`POST /api/path-feeder`** — analyzes the photo and returns *guidance*
  for Sketch mode's classical pipeline (a focus region + a suggested detail
  level), not AI-generated path coordinates directly. See section 4 for why.

Client UI for either endpoint is **not** in this pass — seeing what Claude
maps that onto before it's built is exactly the kind of UI/design call
that should be optioned first, not assumed. This document and its
implementation are the backend only: correct, tested, deployable, and
callable — with nothing yet in `src/ui/` pointed at it.

## 2. Explicitly out of scope (still)

Standing up *a* backend doesn't retroactively green-light everything
build-spec section 2 deferred. Still deferred, unaffected by this doc:

- Accounts / auth / user-specific state
- Server-side storage of uploaded photos or generated output
- A "sharing backend" (shareable links) — export/share's Web Share API path
  (README's Phase 6 section) already covers "hand a file to another app or
  person" without one; a persisted, linkable share is a different feature
  this backend doesn't add.
- Video export

## 3. Architecture

| Layer | Choice | Why |
|---|---|---|
| Hosting | **Vercel Serverless Functions**, `/api/*.ts` | build-spec section 4 already names Vercel as the frontend's example static-deploy target. Same repo, same deploy, zero new hosting relationship — the lowest-delta way to add "a backend" to a project that's otherwise still fully static. |
| Runtime | Node.js (Vercel's default for `/api`) | Needs global `fetch` (stable since Node 18) and nothing else exotic — no new runtime dependency for the AI call itself (see below). |
| Framework | None — plain handler functions | Matches `src/engine/`'s own "plain TS, framework-agnostic" choice (build-spec section 4). Two endpoints don't need Express/Next.js/etc. on top of what Vercel already provides. |
| AI provider | Anthropic Messages API (Claude, vision-capable), called via `fetch` | Not `@anthropic-ai/sdk` — this project already avoids dependencies it doesn't need (README flags `three` for exactly this reasoning); two endpoints making one API call each don't need a full SDK. **This is the one swappable choice in this table** — provider and model are isolated to a single constant in `api/_shared/anthropic-client.ts`, not threaded through the rest of the code, specifically so switching providers or model tiers later is a one-file change. |
| Key storage | Vercel environment variable `ANTHROPIC_API_KEY`, read only inside `api/` handlers | Never bundled into the client. Vite only exposes `VITE_`-prefixed env vars to browser code (`import.meta.env`) — this variable is deliberately *not* given that prefix, specifically so it can't leak into the client bundle by accident. Local dev reads it from `.env.local` (already gitignored — see `.gitignore`'s `*.local` pattern — nothing to change there). |

## 4. AI-path-feeder: the one real ambiguity

build-spec's only description of the old AI-path-feeder is that "old code
called an external API" for it — the name, and nothing else, since that
code wasn't carried forward (build-spec's own header: "every interface
between their modules was broken... only the intent is salvaged"). This
implementation's reading:

**The model returns tuning guidance for the existing classical pipeline
(Sobel edge detection → point extraction, in `mode-sketch.ts`), not raw
path/point coordinates itself.** Concretely: a normalized focus-region
bounding box (or `null` if there's no single clear subject) and a
`"low" | "medium" | "high"` detail suggestion, both meant to bias
`ModeSketch`'s existing point budget/threshold — not replace them.

Why this reading over "have the model emit point coordinates directly":
asking a multimodal LLM to output hundreds of precise pixel coordinates
that then get drawn as-is is a much less reliable ask than asking it for a
bounding box and a coarse category, and it would make the *classical*
algorithm this whole project was rebuilt to trust (deterministic,
type-checked, unit-tested) secondary to an LLM's raw numeric output — the
opposite of build-spec's whole "the compiler/tests catch it, not vibes"
premise. Biasing the existing deterministic pipeline with a small,
structured, validated hint keeps that premise intact while still being
genuinely "AI-fed."

**This is a documented assumption, not a spec-derived certainty** — flagged
here explicitly (matching every other assumption in README.md) precisely so
it's cheap to correct if the intent was actually different. The
implementation isolates the model's prompt and the response shape/parsing
in one place (`api/_shared/handlers.ts`'s `handlePathFeeder` and the
`PATH_FEEDER_PROMPT` constant) so changing the interpretation later doesn't
ripple beyond that one function and the `PathFeederResponse` type.

Wiring `PathFeederResponse` into `mode-sketch.ts`'s actual point-budget logic
is UI-adjacent follow-up work (needs a UI trigger to call the endpoint from)
and isn't part of this backend-only pass.

## 5. Locked contracts

Mirroring build-spec section 5's own discipline — shapes locked before the
handlers are written against them. Full definitions in
`src/engine/ai-types.ts` (living alongside `src/engine/types.ts`, not inside
`api/`, specifically so the eventual client UI can import the exact same
types the backend is checked against — one shape, not two hand-synced
copies):

```ts
export interface DescribeRequest {
  imageBase64: string; // base64 JPEG, no data: URL prefix — see section 6
}
export interface DescribeResponse {
  description: string;
}

export interface PathFeederRequest {
  imageBase64: string;
}
export interface PathFeederResponse {
  focusRegion: { x: number; y: number; width: number; height: number } | null; // normalized 0..1
  suggestedDetail: 'low' | 'medium' | 'high';
  reasoning: string; // one sentence — surfaced in UI later so this isn't a silent black box
}

export interface ApiErrorResponse {
  error: string;
}
```

`focusRegion` is normalized (0..1 fractions of image width/height), not
pixel coordinates — the model only ever sees a downscaled copy of the
photo (section 6), and normalized coordinates let the client apply the
region at whatever size it's actually rendering, without needing to know
what resolution the AI saw. Tying it to the AI's input resolution would be
exactly the kind of coordinate-space mismatch build-spec's whole rebuild
was meant to stop happening.

## 6. Payload size

Vercel Functions have a hard **4.5 MB request/response body limit**,
enforced at the infrastructure level (confirmed against Vercel's current
docs — not configurable via `vercel.json` or application code). The app's
own upload pipeline already caps at 1600px (`useEngine.ts`'s
`MAX_DIMENSION`), which as a lossless PNG can still run several MB — too
close to that ceiling to send as-is, and unnecessary besides: vision models
don't need full resolution for a holistic description or a coarse
subject/detail read.

The client is responsible for preparing the AI payload (when the UI wiring
lands): downscale to a **1024px longest edge** and re-encode as **JPEG**
(quality ~0.85) specifically for this request — separate from the app's own
internal canvas rendering and PNG export, which stay lossless. A typical
photo at that size lands in the tens-to-low-hundreds of KB range, nowhere
near the 4.5 MB ceiling even accounting for base64's ~33% inflation.
`api/_shared/handlers.ts` also rejects any `imageBase64` over ~2.2 MB
decoded server-side (`MAX_IMAGE_BASE64_CHARS`) as defense in depth — a
client bug or a hand-crafted request shouldn't be able to push a
multi-megabyte payload through to the model call.

## 7. Error handling

Three error categories, each mapped to an HTTP status and a client-safe
message in `api/_shared/http-error.ts`, so the mapping is one place instead
of duplicated per-endpoint logic:

- **`ValidationError`** (400) — bad client input (missing/oversized image).
  Message is safe to pass straight through — it describes what the caller
  did wrong.
- **`ModelOutputError`** (502) — the API call succeeded but the model's
  response didn't parse into the expected shape (path-feeder specifically:
  asked for strict JSON, got something that wasn't). Client sees a generic
  "try again," not the raw model output.
- **`AnthropicApiError`** (502, or the upstream status if it's a 4xx) — the
  API call itself failed (bad key, rate limit, provider outage). Client
  never sees the raw upstream error body — that's logged server-side
  (`console.error`) only, since an upstream error message is exactly the
  kind of thing that could leak implementation detail.

## 8. Local development

`npm run dev` works with no Vercel CLI needed, via
`dev-server/ai-proxy-plugin.ts` — a Vite dev-server middleware that mounts
`/api/describe` and `/api/path-feeder` locally using **the same**
`handleDescribe`/`handlePathFeeder` business logic the deployed Vercel
functions call (`api/_shared/handlers.ts`). Only the transport differs
(raw Node `http` primitives in dev vs. `@vercel/node`'s `VercelRequest`/
`VercelResponse` in production) — deliberately, so local dev can never
silently drift from what's actually deployed by having two hand-maintained
implementations of the same logic.

Requires `ANTHROPIC_API_KEY` in `.env.local` (see `.env.example`).
`vite.config.ts` loads it via Vite's `loadEnv()` at config time and sets it
on `process.env` for the dev-proxy's handlers to read — **not** through
Vite's `define`/`envPrefix` mechanism, which is how a variable ends up
embedded in client-visible code. This is the one place in this whole
feature where getting it wrong has real consequences (a leaked API key),
so it's called out here, in `vite.config.ts`'s own comment, and in
`.env.example`.

For an actual deployment test (not just local dev), `vercel dev` or a real
Vercel deploy is still the way to exercise the real `/api` functions as
Vercel runs them — the dev-proxy is a local-development convenience, not a
substitute for that.

## 9. What's NOT done in this pass

- **Client UI.** No button, no panel, nothing in `src/ui/` calls either
  endpoint yet. Deliberate — see section 1.
- **Rate limiting.** Both endpoints call a paid API with no throttle beyond
  Vercel's own platform-level protections. A real limiter needs shared
  state across invocations (Vercel KV, Upstash, etc. — serverless functions
  don't share memory between invocations, so an in-process counter would be
  close to a no-op); adding a fake one would be worse than documenting the
  gap plainly. Follow-up, not done here.
- **`mode-sketch.ts` wiring.** `PathFeederResponse` isn't consumed anywhere
  yet — see section 4's last paragraph.
