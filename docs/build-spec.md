# Vector Stroke Engine — Build Spec (v2)

Clean rebuild spec. Supersedes everything in the old zip. The old `engine/`,
`procedural/`, `tools/` code and both `vector-stroke-engine-v3-fixed*.html`
files are **not carried forward** — every interface between their modules
was broken (see prior analysis). Only the *intent* is salvaged.

---

## 1. What this is

A client-side photo processing and visualization tool. You upload a photo,
it gets cleaned up, then you can view/render it through five distinct
engines:

- **Sketch** — animated hand-drawn stroke reveal (the original, flagship idea)
- **2D** — flat, clean vector-style render
- **3D** — WebGL depth/relief render
- **Histogram** — RGB + luminance distribution as a live chart
- **ASCII** — character-art render

No backend for v1. Runs entirely in the browser.

## 2. Explicitly out of scope for v1

- AI-path-feeder / AI-describe (old code called an external API — needs a
  backend + key handling, deferred)
- Video export
- True AI-based photo restoration (cleanup below is classical CV, not ML)
- Accounts, server-side storage, sharing backend

## 3. Core pipeline

```
Upload → Preprocess/Cleanup → Mode Router → [Mode Engine] → Renderer → Canvas
```

### 3.1 Preprocessing (runs once per upload, feeds every mode)

This replaces the old, mislabeled "without filters" mode — it's cleanup,
not a display mode:

- **Noise reduction** — bilateral or median filter
- **Sharpening** — unsharp mask, for blur
- **Spot/blemish removal** — detect small dark outlier regions, inpaint
  from surrounding pixels
- Output: one cleaned `ImageData`, shared by all five modes below

### 3.2 Modes — build order

Ranked by shared infrastructure and complexity, flagship early, hardest last:

1. **2D** — foundation. Validates upload → preprocess → canvas pipeline.
2. **Sketch** — Sobel edge detection → point extraction → nearest-neighbor
   path ordering → timeline-driven stroke-by-stroke animation.
3. **Histogram** — cheap, reuses pixel data already in memory.
4. **ASCII** — reuses the same luminance sampling as histogram/sketch.
5. **3D** — separate stack (Three.js/WebGL), most moving parts, done last.

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript**, strict mode | Every bug found in the old codebase (wrong method names, missing args, mismatched point shapes) is a type error the compiler catches immediately — this is the actual fix for the failure class, not just "be more careful." |
| Build | **Vite** | Zero-config dev server + static build, no backend needed |
| Engine | Plain TS classes, framework-agnostic | Canvas/WebGL render loops shouldn't fight a framework's render cycle |
| UI shell | **React**, only if the control panel needs it | Upload, mode switcher, sliders, history — kept fully decoupled from the render loop (canvas driven imperatively via refs) |
| Backend | None for v1 | Static deploy, e.g. Vercel |
| Deferred | AI-path-feeder, AI-describe | Move here once a backend exists |

## 5. Data contracts — locked before any implementation

Every module in the old code disagreed on shapes and method names. This
time the types are written first and every class is checked against them.

```ts
export interface Point { x: number; y: number; }

export interface Layer {
  name: string;
  stroke: string;
  points: Point[];
}

export interface ImageMeta {
  width: number;
  height: number;
  totalPoints: number;
  layers: number;
}

export interface StrokeData {
  meta: ImageMeta;
  layers: Layer[];
}

// Every mode implements this — no more guessing method names
export interface ModeEngine {
  readonly id: 'sketch' | '2d' | '3d' | 'histogram' | 'ascii';
  process(image: ImageData): StrokeData | RenderPayload;
  render(ctx: RenderContext, progress: number): void;
  reset(): void;
}
```

(Full type definitions get fleshed out in `src/engine/types.ts` during
Phase 0, but the shapes above are locked — no mode ships until it matches.)

## 6. Visual / design system

Theme is **mode-dependent**, not a single global light/dark toggle:

| Mode | Base | Reasoning |
|---|---|---|
| Sketch | Dark | Strokes read as light/glowing lines on near-black — matches how the effect actually looks |
| 2D | Dark | Neutral chrome, image is the hero |
| ASCII | Dark | Terminal convention |
| 3D | Dark | Standard convention for 3D viewports (Blender, CAD, etc.) |
| Histogram | **Light** | Data reads better as a warm, print-report style page than glowing-on-black |

**Color** — neutral graphite/near-black base across dark modes, one precise
accent (a tuned phosphor green — the same accent color that shows up
repeatedly across your own past iterations of this project, refined rather
than reinvented). Histogram's light mode pairs a warm off-white with a dark
ink accent, echoing the "print shop" direction from the old design tokens.

**Typography** — no system-ui/Arial anywhere:
- Display/headings: **Fraunces** — high-contrast, rich, editorial serif, reads as premium rather than templated
- Technical/data labels (telemetry, histogram values, ASCII controls): **JetBrains Mono** or **IBM Plex Mono**
- The pairing itself reflects the app: editorial richness for identity, precision mono for data.

## 7. Target file structure

```
vector-stroke-engine/
├── src/
│   ├── engine/
│   │   ├── preprocess/
│   │   │   └── cleanup.ts
│   │   ├── modes/
│   │   │   ├── mode-2d.ts
│   │   │   ├── mode-sketch.ts
│   │   │   ├── mode-histogram.ts
│   │   │   ├── mode-ascii.ts
│   │   │   └── mode-3d.ts
│   │   ├── controller.ts
│   │   ├── timeline.ts
│   │   └── types.ts
│   ├── ui/              # React shell, if/when needed
│   └── main.ts
├── public/
├── index.html
├── vite.config.ts
├── package.json
└── build-spec.md
```

## 8. Phased roadmap

- **Phase 0** — scaffold: Vite + TS project, `types.ts` locked, empty mode router, dark shell shell
- **Phase 1** — foundation: upload, preprocessing/cleanup, 2D mode working end-to-end
- **Phase 2** — Sketch mode (flagship)
- **Phase 3** — Histogram mode + light-theme flip
- **Phase 4** — ASCII mode
- **Phase 5** — 3D mode (Three.js)
- **Phase 6** (later, needs backend) — AI-path-feeder, AI-describe, export/share

Each mode gets a minimal smoke test on landing — so we never repeat the old
`test.html` failure mode (crashed on the very first line, never caught
because nothing ever ran it end-to-end).

## 9. Left behind from the old zip (on purpose)

- `engine/`, `procedural/`, `tools/` — concept kept, code discarded
- `style.css`, `test.svg`, `video-exporter.js` — dead/orphaned, not ported
- Both `vector-stroke-engine-v3-fixed*.html` monoliths — superseded entirely
