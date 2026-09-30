> **SUPERSEDED IN PART (Sketch + 3D controls).** This spec describes the controls as first built.
> Sketch's "Edge sensitivity" and "Point budget" and 3D's "Pause/Resume orbit" no longer exist:
> Sketch now has **Detail / Line cleanup / Shading / Stroke thickness**, and 3D has **Relief height /
> Auto sway / Reset view** plus drag-to-rotate, scroll-to-zoom and double-click reset. The current
> behaviour is documented in `PROJECT_MAP.md` sections 6.9, 6.12 and 7; the rest of this file
> (Cleanup controls, 2D, ASCII, the "one rule" for reprocessing, performance notes) still applies.

# Phase 7 — Performance & Interactive Controls

Follow-up to build-spec.md (Phases 0-6, all shipped). Scoped from a second
external code review plus the standing perf items already flagged in-code.
Two of three pieces are implemented and verified below; the third
(interactive controls) is specced here for sign-off before implementation.

## 1. Done — cleanup off the main thread

`cleanupImage()` now runs in a persistent Web Worker (`cleanup-worker.ts` +
`cleanup-client.ts`), with a synchronous same-thread fallback when `Worker`
is unavailable or the worker errors at runtime. `useEngine.ts`'s `loadFile`
now `await`s `cleanupClient.run(...)` instead of calling `cleanupImage()`
directly, and retains the raw (pre-cleanup) `ImageData` in `rawImageRef` so
a future cleanup-option change can re-run the pipeline without re-decoding
the upload.

This matters more once section 3 below ships: cleanup stops being a
once-per-upload cost and becomes something a settings toggle can re-trigger
repeatedly.

Verified: `npm test` (86/86), `npm run typecheck`, `npm run build` — the
production build now emits a separate `cleanup-worker-*.js` chunk,
confirming Vite's `new URL(..., import.meta.url)` worker detection actually
picked it up (not just type-checked in isolation).

## 2. Done — spatial-grid path ordering (ModeSketch)

`orderIntoPaths` was a plain O(n²) nearest-neighbor walk, deliberately left
that way while `POINT_BUDGET` was a fixed constant. Section 3 turns that
into a slider, which invalidates the "always small n" premise. Replaced
with a uniform grid (cell size == `maxJump`, 3x3 neighborhood search) that
is an *exact* replacement, not an approximation — proof is in the comment
above `buildSpatialGrid` in `mode-sketch.ts`. Cross-checked against the
original brute-force logic across 5 randomized configs (up to 2,200 points)
in `engine.test.ts`; separately benchmarked at 20,000 points (~106ms) to
confirm the budget can be raised well past its current ceiling.

## 3. Proposed — interactive controls

### 3.1 Architecture

`ModeEngine.process(image: ImageData)` (build-spec.md section 5) stays
exactly as locked — no new parameter, no widened union. Instead, each
configurable mode class gets its own concrete `configure(partial): void`
method (not part of the shared `ModeEngine` interface, so modes that don't
need options don't grow one). `useEngine.ts` already constructs each mode
instance directly (`new Mode2D()`, etc.) to register it with the
`Controller`; it additionally keeps a typed ref to the ones with options, so
a slider change can call `.configure()` on the exact instance, then
`controller.switchTo(activeMode)` to reprocess and redraw. `Controller`
needs no changes — `switchTo` already unconditionally re-runs
`process(currentImage)` for whichever id it's given, so calling it again
with the *same* id is already exactly "reprocess with current settings."

One rule, no special cases: every option change (whether it affects
`process()` or only `render()`) triggers the same reprocess-and-redraw path.
Slightly more work than strictly necessary for a render-only tweak like
stroke thickness, but with the grid fix from section 2 a full sketch
reprocess is fast even at a raised point budget, so simplicity wins over
micro-optimizing which options need which path.

Cleanup toggles are already parametrized (`CleanupOptions` in `cleanup.ts`)
— no per-mode change needed there, just a UI surface plus reusing
`rawImageRef` (section 1) to re-run `cleanupClient.run()` on demand.

### 3.2 Controls, grounded in current constants

| Mode | Control | Current constant | Proposed range | Default |
|---|---|---|---|---|
| Cleanup | Denoise on/off | `denoise.enabled` | toggle | on |
| Cleanup | Spot removal on/off | `spotRemoval.enabled` | toggle | on |
| Cleanup | Sharpen on/off + amount | `sharpen.enabled` / `.amount` | toggle + 0–1.5 | on / 0.6 |
| 2D | Posterize levels | `POSTERIZE_LEVELS = 6` | 2–12 | 6 |
| Sketch | Edge sensitivity | `EDGE_PERCENTILE = 0.88` | 0.70–0.97 (lower = denser) | 0.88 |
| Sketch | Point budget | `POINT_BUDGET = 2200` | 500–8000 | 2200 |
| Sketch | Stroke thickness | `lineWidth = 1.4` | 0.5–3 | 1.4 |
| ASCII | Density (columns) | auto from image width, capped `[8, 140]` | 20–140 override | current auto value |
| 3D | Relief height | `0.55 × min(planeW, planeH)` | 0.25–2.5× multiplier | 1.0× |
| 3D | Orbit pause/play | `Timeline` loop (already exists) | toggle | playing |

Deliberately *not* exposed: spot-removal's darkness threshold / neighborhood
radius / max area, and sharpen's blur radius — fine-grained enough that
they read as noise to tune rather than useful controls, and the existing
defaults were already picked to look right across a range of photos.

### 3.3 UI placement — resolved

Went with **Option A + C combined**: a collapsed-by-default drawer
(`SettingsPanel.tsx`) under the control rail, one click to expand. Inside
it, the Cleanup toggles are always shown (they're mode-independent), and
the mode-specific controls swap to match whichever mode is currently
active — so the panel never shows more than ~4-7 controls at once instead
of all ~10 across every mode. The orbit pause/play button only appears
while 3D is active.

## 4. Status

All three pieces implemented and verified: 91/91 tests, clean strict
typecheck, clean production build (worker chunk confirmed present in the
build output, not just type-checked). New/changed test coverage: spatial
grid vs. brute-force reference (5 configs), cleanup worker/client round
trip + error fallback + buffer-copy safety (6 tests), and configure()
behavior + clamping for all four modes (7 tests).

One bug caught during review and fixed before shipping: the 3D orbit
pause/play button read `timeline.isRunning` directly on every render.
Timeline is a plain, non-reactive class — calling `timeline.pause()`
doesn't trigger a re-render on its own, so the button's label would go
stale after the first click. Fixed by mirroring orbit-playing state into
React state explicitly (`isOrbitPlaying`), the same pattern already used
for `currentOutput` and `activeMode`.
