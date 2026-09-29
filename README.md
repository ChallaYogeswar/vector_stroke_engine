# Vector Stroke Engine

Client-side photo tool: upload a photo, it is cleaned up (denoise → spot removal → sharpen, in a
Web Worker), then rendered by one of five engines on a single canvas — **2D** (posterized),
**Sketch** (animated pen strokes from edge detection), **Histogram** (RGB + luminance chart),
**ASCII** (character art) and **3D** (WebGL bas-relief). Export as PNG (all modes), SVG (Sketch),
TXT (ASCII) or CSV (Histogram). Everything runs in the browser; no key or server is needed.

## Run

Requires Node `^20.19 || ^22.12 || >=24`.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 92 unit tests (vitest + jsdom)
npm run build      # typecheck + production build -> dist/
npm run preview    # serve dist/
npm run check      # typecheck + test + build in one go
```

## Layout

```
src/engine/    framework-agnostic engine: types, controller, timeline, theme, export,
               math, preprocess/ (cleanup + worker), modes/ (the five renderers)
src/ui/        React shell: App, useEngine hook, upload / mode / settings / export / telemetry
api/           optional Vercel serverless functions: POST /api/describe, /api/path-feeder
dev-server/    Vite plugin that serves /api/* locally during `npm run dev`
docs/          PROJECT_MAP.md (full file-by-file reference), build-spec, backend-spec, controls-spec
```

## Optional AI endpoints

`/api/describe` and `/api/path-feeder` call Anthropic's Messages API. Copy `.env.example` to
`.env.local` and set `ANTHROPIC_API_KEY` (server-side only; never prefix it with `VITE_`).
No UI calls them yet — see `docs/backend-spec.md`.

## If something breaks

`docs/PROJECT_MAP.md` documents every file's purpose, exact API, constants, algorithms and tests.
Give it to Claude with the file(s) you still have and ask it to regenerate what is missing.
