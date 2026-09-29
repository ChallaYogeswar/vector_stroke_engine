import * as THREE from 'three';
import type { ModeEngine, RenderContext, Relief3DPayload } from '../types';
import { boxBlurChannel } from '../preprocess/cleanup';
import { cellRange, clamp, clamp01 } from '../math';
import { readThemeColors } from '../theme';

// ---------------------------------------------------------------------------
// 3D — "WebGL depth/relief render" (build-spec 3.2 #5), separate stack
// (Three.js/WebGL), built last since it has the most moving parts.
//
// process() (once per upload/mode-switch):
//   1. Downsample the cleaned image to a coarse `cols x rows` grid (a
//      couple thousand cells at most — a mesh, not a photo, so it doesn't
//      need per-pixel resolution) — same aspect-preserving, non-upsampling
//      scale-to-fit approach ModeASCII's grid uses, just with a bigger
//      target since a mesh vertex is cheaper than a monospace glyph.
//   2. Per cell: average RGB (-> vertex color) and Rec.709 luminance
//      (-> raw height), same weights ModeSketch/ModeHistogram/cleanup.ts
//      all use.
//   3. Smooth the raw height field with cleanup.ts's box blur (a real reuse
//      of Phase 1's shared infra, not just a matching implementation) —
//      unsmoothed per-pixel luminance makes a visibly noisy, spiky mesh.
//   4. Min-max normalize smoothed heights to 0..1, so relief depth reads
//      consistently regardless of the photo's own luminance range.
//
// render() — the interesting architectural decision:
//
// RenderContext's `ctx` is CanvasRenderingContext2D-only (types.ts), and
// every other mode + the Controller + useEngine.ts is written against
// exactly that. The straightforward way to give this one mode WebGL would
// be to widen RenderContext into a 2D/WebGL union and have Controller and
// useEngine.ts branch on the active mode to hand out the right context type
// — but a canvas can only ever bind ONE context type for its lifetime
// (calling `.getContext('webgl')` on a canvas that's already vended a `2d`
// context returns null, and vice versa), so that would also mean either a
// second <canvas> element mounted only for this mode, or the app's one
// canvas getting torn down and recreated on every switch into/out of 3D.
// Real changes to Controller, useEngine.ts, and App.tsx, for one mode's
// implementation detail.
//
// Instead: Mode3D owns a second canvas that never touches the DOM. It
// builds a Three.js scene once, renders the relief mesh to that hidden
// canvas every frame, and draws the result onto the RenderContext's real
// 2D canvas with a single drawImage() — a standard render-to-texture-style
// pattern. Every other mode, the Controller, and useEngine.ts stay exactly
// as Phase 0-3 left them; nothing outside this file needs to know 3D is
// WebGL underneath. If WebGL genuinely isn't available (headless/jsdom test
// environments included — see engine.test.ts), `render()` falls back to a
// 2D-canvas raking-light shading of the same height/color grid instead of
// showing a dead viewport.
//
// `progress` drives a continuous camera orbit (angle = progress * 2*PI)
// rather than a one-shot reveal like Sketch/Histogram/ASCII use — useEngine
// puts the Timeline into loop mode specifically for '3d' so this actually
// keeps turning instead of freezing after one lap. See Timeline.setLoop.
// ---------------------------------------------------------------------------

const GRID_MAX_DIM = 96;
const GRID_MIN_DIM = 8;
const HEIGHT_SMOOTH_RADIUS = 1;
const CAMERA_RADIUS = 2.6;
const CAMERA_ELEVATION = 1.3;
const CAMERA_FOV = 38;

interface WebGLState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  mesh: THREE.Mesh | null;
  geometry: THREE.BufferGeometry | null;
  material: THREE.MeshStandardMaterial | null;
  width: number;
  height: number;
}

export interface Mode3DOptions {
  /** Multiplies the relief extrusion height (0.55 × min(planeW, planeH) at 1.0×, unchanged from the original fixed constant). */
  reliefMultiplier: number;
}

export const DEFAULT_MODE3D_OPTIONS: Mode3DOptions = { reliefMultiplier: 1 };
export const MODE3D_RELIEF_MULTIPLIER_RANGE = { min: 0.25, max: 2.5 } as const;

export class Mode3D implements ModeEngine {
  readonly id = '3d' as const;

  private payload: Relief3DPayload | null = null;
  private webglState: WebGLState | null = null;
  private webglFailed = false;
  private meshBuiltFor: Relief3DPayload | null = null;
  private options: Mode3DOptions = { ...DEFAULT_MODE3D_OPTIONS };

  /**
   * See docs/controls-spec.md section 3.1 — additive, not part of the locked
   * ModeEngine interface. Only affects buildMesh()'s heightScale, not
   * process(), but controls-spec's "one rule" still routes this through a
   * reprocess: process() always returns a fresh payload object even when
   * the numbers are unchanged, and meshBuiltFor's reference check (below)
   * treats that fresh reference as "stale mesh, rebuild" — which is exactly
   * what picks up the new multiplier, with no separate invalidation path
   * needed here.
   */
  configure(options: Partial<Mode3DOptions>): void {
    this.options = {
      reliefMultiplier: clamp(
        options.reliefMultiplier ?? this.options.reliefMultiplier,
        MODE3D_RELIEF_MULTIPLIER_RANGE.min,
        MODE3D_RELIEF_MULTIPLIER_RANGE.max,
      ),
    };
  }

  process(image: ImageData): Relief3DPayload {
    const { width, height } = image;
    const scale = Math.min(1, GRID_MAX_DIM / Math.max(width, height));
    const cols = clamp(Math.round(width * scale), GRID_MIN_DIM, GRID_MAX_DIM);
    const rows = clamp(Math.round(height * scale), GRID_MIN_DIM, GRID_MAX_DIM);

    const rawHeights = new Float64Array(cols * rows);
    const colors = new Array<string>(cols * rows);

    for (let gy = 0; gy < rows; gy++) {
      const [y0, y1] = cellRange(gy, rows, height);
      for (let gx = 0; gx < cols; gx++) {
        const [x0, x1] = cellRange(gx, cols, width);
        const { r, g, b, luminance } = averageCell(image, x0, x1, y0, y1);
        const idx = gy * cols + gx;
        rawHeights[idx] = luminance;
        colors[idx] = toHex(r, g, b);
      }
    }

    const smoothed = boxBlurChannel(rawHeights, cols, rows, HEIGHT_SMOOTH_RADIUS);
    const heights = normalize(smoothed);

    this.payload = { kind: 'relief3d', cols, rows, heights, colors };
    return this.payload;
  }

  render(renderCtx: RenderContext, progress: number): void {
    const { ctx, width, height } = renderCtx;
    if (!this.payload) {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    const state = this.ensureWebGL();
    if (state) {
      try {
        this.renderWebGL(state, renderCtx, progress);
        return;
      } catch {
        // Anything in the WebGL path failing — mesh build, a lost context
        // mid-render, the final drawImage — degrades to the 2D fallback for
        // the rest of this instance's life instead of throwing every frame.
        this.disposeWebGL();
        this.webglFailed = true;
      }
    }
    renderReliefFallback(renderCtx, this.payload, progress);
  }

  reset(): void {
    this.disposeWebGL();
    this.webglFailed = false; // a full reset earns a fresh attempt at WebGL init
    this.payload = null;
  }

  private disposeWebGL(): void {
    const state = this.webglState;
    if (state) {
      if (state.mesh) state.scene.remove(state.mesh);
      state.geometry?.dispose();
      state.material?.dispose();
      try {
        state.renderer.dispose();
        state.renderer.forceContextLoss();
      } catch {
        // Context already gone (e.g. this is running because of a context
        // loss) or the WEBGL_lose_context extension isn't supported —
        // either way there's nothing further to clean up.
      }
    }
    this.webglState = null;
    this.meshBuiltFor = null;
  }

  // -------------------------------------------------------------------------
  // WebGL path
  // -------------------------------------------------------------------------

  /** Lazily creates the offscreen renderer/scene/camera. Never retries after a failed attempt — a dead GPU context doesn't come back mid-session. */
  private ensureWebGL(): WebGLState | null {
    if (this.webglState) return this.webglState;
    if (this.webglFailed) return null;

    try {
      const canvas = document.createElement('canvas');
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
      renderer.setPixelRatio(1); // renderCtx's dimensions are already DPR-scaled backing-store pixels
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const theme = readThemeColors();
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(theme.surface);

      const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 50);

      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const key = new THREE.DirectionalLight(0xffffff, 1.15);
      key.position.set(-3, 4, 2.5);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.3);
      fill.position.set(3, 1.5, -2.5);
      scene.add(fill);

      this.webglState = { renderer, scene, camera, canvas, mesh: null, geometry: null, material: null, width: 0, height: 0 };
      return this.webglState;
    } catch {
      // No WebGL (unsupported, headless test environment, context limit hit
      // elsewhere on the page, etc). Fall back for the rest of this
      // instance's life rather than retrying every frame.
      this.webglFailed = true;
      this.webglState = null;
      return null;
    }
  }

  private renderWebGL(state: WebGLState, renderCtx: RenderContext, progress: number): void {
    const { ctx, width, height } = renderCtx;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));

    if (this.meshBuiltFor !== this.payload) {
      this.buildMesh(state, this.payload!);
      this.meshBuiltFor = this.payload;
    }

    if (state.width !== w || state.height !== h) {
      state.renderer.setSize(w, h, false);
      state.width = w;
      state.height = h;
    }

    const angle = progress * Math.PI * 2;
    state.camera.aspect = w / h;
    state.camera.position.set(Math.sin(angle) * CAMERA_RADIUS, CAMERA_ELEVATION, Math.cos(angle) * CAMERA_RADIUS);
    state.camera.lookAt(0, 0.05, 0);
    state.camera.updateProjectionMatrix();

    state.renderer.render(state.scene, state.camera);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(state.canvas, 0, 0, width, height);
  }

  private buildMesh(state: WebGLState, payload: Relief3DPayload): void {
    if (state.mesh) {
      state.scene.remove(state.mesh);
      state.geometry?.dispose();
      state.material?.dispose();
    }

    const { cols, rows, heights, colors } = payload;
    const aspect = cols / rows;
    const planeW = aspect >= 1 ? 2 : 2 * aspect;
    const planeH = aspect >= 1 ? 2 / aspect : 2;
    const heightScale = 0.55 * this.options.reliefMultiplier * Math.min(planeW, planeH);

    const vertexCount = cols * rows;
    const positions = new Float32Array(vertexCount * 3);
    const vertexColors = new Float32Array(vertexCount * 3);

    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const idx = gy * cols + gx;
        const px = (gx / (cols - 1) - 0.5) * planeW;
        const pz = (gy / (rows - 1) - 0.5) * planeH;
        const py = heights[idx]! * heightScale;

        positions[idx * 3] = px;
        positions[idx * 3 + 1] = py;
        positions[idx * 3 + 2] = pz;

        const linear = srgbHexToLinearUnit(colors[idx]!);
        vertexColors[idx * 3] = linear[0];
        vertexColors[idx * 3 + 1] = linear[1];
        vertexColors[idx * 3 + 2] = linear[2];
      }
    }

    const indices: number[] = [];
    for (let gy = 0; gy < rows - 1; gy++) {
      for (let gx = 0; gx < cols - 1; gx++) {
        const a = gy * cols + gx;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04 });
    const mesh = new THREE.Mesh(geometry, material);

    state.scene.add(mesh);
    state.mesh = mesh;
    state.geometry = geometry;
    state.material = material;
  }
}

// ---------------------------------------------------------------------------
// Grid sampling (mirrors ModeASCII's cellRange — duplicated rather than
// shared, matching this codebase's existing house style of each mode owning
// its own small numeric helpers instead of a shared grid-sampling module).
// ---------------------------------------------------------------------------

function averageCell(
  image: ImageData,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): { r: number; g: number; b: number; luminance: number } {
  const { width, data } = image;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0, luminance: 0 };
  r /= n;
  g /= n;
  b /= n;
  return { r, g, b, luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}

function normalize(values: Float32Array): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) out[i] = (values[i]! - min) / range;
  return out;
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number): string => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hexToRGB(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

/** Converts a `#rrggbb` (sRGB) color to Three's linear working color space, since a raw vertex-color BufferAttribute bypasses THREE.Color's usual automatic sRGB->linear conversion. */
function srgbHexToLinearUnit(hex: string): [number, number, number] {
  const [r, g, b] = hexToRGB(hex);
  const linear = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  return [linear.r, linear.g, linear.b];
}

// ---------------------------------------------------------------------------
// 2D fallback — a raking-light shading of the same height/color grid,
// approximating the WebGL relief's lighting with pure canvas fills. Reveals
// row-by-row against `progress` (this path doesn't orbit, so progress is
// free to drive a one-shot reveal instead — see the render() header comment
// for why WebGL gets continuous rotation and this doesn't).
// ---------------------------------------------------------------------------

const FALLBACK_LIGHT_X = -0.6;
const FALLBACK_LIGHT_Z = -0.75;

function renderReliefFallback(renderCtx: RenderContext, payload: Relief3DPayload, progress: number): void {
  const { ctx, width, height } = renderCtx;
  ctx.clearRect(0, 0, width, height);

  const { cols, rows, heights, colors } = payload;
  // Square cells, grid centered (fit-contain): cols:rows already carries the
  // source image's aspect ratio (see process()), so uniform cells keep it —
  // the WebGL path preserves aspect the same way. Sizing width and height
  // independently (cellW = width/cols, cellH = height/rows) stretched the
  // image to fill whatever shape the canvas happened to be.
  const cellSize = Math.min(width / cols, height / rows);
  const offsetX = (width - cellSize * cols) / 2;
  const offsetY = (height - cellSize * rows) / 2;

  let revealed = Math.floor(progress * rows);
  if (progress > 0 && revealed === 0) revealed = 1;
  revealed = Math.min(rows, revealed);

  for (let gy = 0; gy < revealed; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const idx = gy * cols + gx;
      const left = heights[gy * cols + Math.max(0, gx - 1)]!;
      const right = heights[gy * cols + Math.min(cols - 1, gx + 1)]!;
      const up = heights[Math.max(0, gy - 1) * cols + gx]!;
      const down = heights[Math.min(rows - 1, gy + 1) * cols + gx]!;
      const dx = right - left;
      const dz = down - up;
      const shade = clamp01(0.55 + (dx * FALLBACK_LIGHT_X + dz * FALLBACK_LIGHT_Z) * 1.6 + heights[idx]! * 0.15);

      const [r, g, b] = hexToRGB(colors[idx]!);
      ctx.fillStyle = `rgb(${Math.round(r * shade)}, ${Math.round(g * shade)}, ${Math.round(b * shade)})`;
      // +1px overlap per cell hides hairline seams between neighbouring rects.
      ctx.fillRect(
        offsetX + Math.floor(gx * cellSize),
        offsetY + Math.floor(gy * cellSize),
        Math.ceil(cellSize) + 1,
        Math.ceil(cellSize) + 1,
      );
    }
  }
}
