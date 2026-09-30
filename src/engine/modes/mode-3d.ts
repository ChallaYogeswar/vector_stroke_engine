import * as THREE from 'three';
import type { ModeEngine, RenderContext, Relief3DPayload } from '../types';
import { boxBlurChannel } from '../preprocess/cleanup';
import { cellRange, clamp, clamp01 } from '../math';
import { readThemeColors } from '../theme';

// ---------------------------------------------------------------------------
// 3D — a photo hung like a picture and pushed into a smooth relief, viewed
// with a stable, user-controlled camera.
//
// process() (once per upload / mode switch / settings change):
//   1. Downsample the cleaned image to a `cols x rows` grid (<= GRID_MAX_DIM
//      per side, never upsampled) — this is only the *geometry* resolution.
//      The photo itself is kept at full detail and applied as a texture, so
//      the picture stays sharp even though the mesh is coarser.
//   2. Height = luminance, smoothed very hard (two large box-blur passes) and
//      percentile-normalised so a few blown highlights / crushed blacks can't
//      flatten everything; a mild dome term (centre nearer than edges) makes
//      it read as a rounded relief instead of rough terrain.
//   3. Per-cell average color is kept for the 2D fallback path.
//
// render():
//   The mesh lives in the XY plane (a picture on a wall, facing +Z) with
//   height pushed toward the viewer along +Z. The camera sits on a sphere
//   around it with user-controlled yaw / pitch / zoom:
//     - the default view is fixed and front-facing (a small yaw/pitch shows
//       depth), so a capture is always framed correctly — nothing spins
//       unless the user turns "Auto sway" on;
//     - yaw / pitch are clamped, so the back and edge-on views are
//       unreachable — this is the "stabilised" part;
//     - `progress` only matters when autoSway is on, where it drives a gentle
//       +/- sway around the current view (never a full revolution).
//
// RenderContext's `ctx` stays 2D-only (types.ts): Mode3D renders into its own
// hidden WebGL canvas and blits the result with drawImage(), so Controller,
// useEngine and every other mode never learn 3D uses WebGL, and PNG export
// captures exactly what's on screen. If WebGL is unavailable (or fails
// mid-session) render() falls back to a 2D shaded version of the same grid.
// ---------------------------------------------------------------------------

const GRID_MAX_DIM = 200;
const GRID_MIN_DIM = 8;
const HEIGHT_SMOOTH_RADIUS_FRACTION = 0.05; // of the longer grid side, per blur pass — large on purpose: soft volume, no cliffs
const DOME_MIX = 0.35;
const EDGE_FLATTEN_FRACTION = 0.1; // the outer 10% of each side eases down to zero depth, so the outline stays a clean rectangle
const RELIEF_BASE_DEPTH = 0.26; // fraction of the plane's short edge at reliefMultiplier = 1
const TEXTURE_MAX_DIM = 1400;
const CAMERA_FOV = 36;
const FIT_MARGIN = 1.1;

const DEFAULT_YAW = 0.32;
const DEFAULT_PITCH = 0.14;
const YAW_LIMIT = 0.6; // ~34 degrees either way: never the back, edge-on, or a badly stretched oblique view
const PITCH_MIN = -0.3;
const PITCH_MAX = 0.5;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 3;
const SWAY_AMPLITUDE = 0.34; // radians either side of the current view

interface WebGLState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  mesh: THREE.Mesh | null;
  geometry: THREE.BufferGeometry | null;
  material: THREE.MeshStandardMaterial | null;
  texture: THREE.Texture | null;
  width: number;
  height: number;
}

export interface Mode3DOptions {
  /** Multiplies the relief depth (1 = RELIEF_BASE_DEPTH of the plane's short edge). */
  reliefMultiplier: number;
  /** Gentle back-and-forth sway of the camera. Off by default so the view is stable. */
  autoSway: boolean;
}

export const DEFAULT_MODE3D_OPTIONS: Mode3DOptions = { reliefMultiplier: 1, autoSway: false };
export const MODE3D_RELIEF_MULTIPLIER_RANGE = { min: 0.25, max: 3 } as const;

export class Mode3D implements ModeEngine {
  readonly id = '3d' as const;

  private payload: Relief3DPayload | null = null;
  private sourceImage: ImageData | null = null;
  private webglState: WebGLState | null = null;
  private webglFailed = false;
  private meshBuiltFor: Relief3DPayload | null = null;
  private options: Mode3DOptions = { ...DEFAULT_MODE3D_OPTIONS };

  private yaw = DEFAULT_YAW;
  private pitch = DEFAULT_PITCH;
  private zoom = 1;

  /**
   * Additive to the locked ModeEngine interface (see docs/PROJECT_MAP.md).
   * reliefMultiplier changes the mesh, which is rebuilt because process()
   * always returns a fresh payload object (meshBuiltFor's reference check).
   */
  configure(options: Partial<Mode3DOptions>): void {
    this.options = {
      reliefMultiplier: clamp(
        options.reliefMultiplier ?? this.options.reliefMultiplier,
        MODE3D_RELIEF_MULTIPLIER_RANGE.min,
        MODE3D_RELIEF_MULTIPLIER_RANGE.max,
      ),
      autoSway: options.autoSway ?? this.options.autoSway,
    };
  }

  /** Rotates the camera by the given radians (drag). Clamped so the back is never shown. */
  orbitBy(deltaYaw: number, deltaPitch: number): void {
    this.yaw = clamp(this.yaw + deltaYaw, -YAW_LIMIT, YAW_LIMIT);
    this.pitch = clamp(this.pitch + deltaPitch, PITCH_MIN, PITCH_MAX);
  }

  /** Multiplies the zoom (scroll / pinch). */
  zoomBy(factor: number): void {
    this.zoom = clamp(this.zoom * factor, ZOOM_MIN, ZOOM_MAX);
  }

  /** Back to the default framing. */
  resetView(): void {
    this.yaw = DEFAULT_YAW;
    this.pitch = DEFAULT_PITCH;
    this.zoom = 1;
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

    const radius = Math.max(1, Math.round(Math.max(cols, rows) * HEIGHT_SMOOTH_RADIUS_FRACTION));
    const pass1 = boxBlurChannel(rawHeights, cols, rows, radius);
    const smoothed = boxBlurChannel(Float64Array.from(pass1), cols, rows, radius);
    const heights = shapeHeights(smoothed, cols, rows);

    this.sourceImage = image;
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
    renderReliefFallback(renderCtx, this.payload);
  }

  reset(): void {
    this.disposeWebGL();
    this.webglFailed = false; // a full reset earns a fresh attempt at WebGL init
    this.payload = null;
    this.sourceImage = null;
    this.resetView();
  }

  private disposeWebGL(): void {
    const state = this.webglState;
    if (state) {
      if (state.mesh) state.scene.remove(state.mesh);
      state.geometry?.dispose();
      state.material?.dispose();
      state.texture?.dispose();
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

      // Mostly ambient so the photo keeps its own exposure and color; the key
      // light is what makes the relief read (it rakes across the slopes).
      scene.add(new THREE.AmbientLight(0xffffff, 1.35));
      const key = new THREE.DirectionalLight(0xffffff, 2.3);
      key.position.set(-3.2, 2.4, 2.6);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.35);
      fill.position.set(3, -1, 2);
      scene.add(fill);

      this.webglState = { renderer, scene, camera, canvas, mesh: null, geometry: null, material: null, texture: null, width: 0, height: 0 };
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

    const payload = this.payload!;
    const aspect = payload.cols / payload.rows;
    const planeW = aspect >= 1 ? 2 : 2 * aspect;
    const planeH = aspect >= 1 ? 2 / aspect : 2;
    const camAspect = w / h;

    // Distance at which the whole picture just fits the viewport (either axis).
    const halfNeeded = Math.max(planeH / 2, planeW / 2 / camAspect) * FIT_MARGIN;
    const distance = halfNeeded / Math.tan((CAMERA_FOV * Math.PI) / 360) / this.zoom;

    const sway = this.options.autoSway ? Math.sin(progress * Math.PI * 2) * SWAY_AMPLITUDE : 0;
    const yaw = clamp(this.yaw + sway, -YAW_LIMIT, YAW_LIMIT);
    const pitch = this.pitch;

    state.camera.aspect = camAspect;
    state.camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    state.camera.lookAt(0, 0, 0);
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
      state.texture?.dispose();
    }

    const { cols, rows, heights } = payload;
    const aspect = cols / rows;
    const planeW = aspect >= 1 ? 2 : 2 * aspect;
    const planeH = aspect >= 1 ? 2 / aspect : 2;
    const depth = RELIEF_BASE_DEPTH * this.options.reliefMultiplier * Math.min(planeW, planeH);

    const vertexCount = cols * rows;
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);

    // The picture hangs in the XY plane facing +Z; height pushes toward the viewer.
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const idx = gy * cols + gx;
        const u = gx / (cols - 1);
        const v = gy / (rows - 1);
        positions[idx * 3] = (u - 0.5) * planeW;
        positions[idx * 3 + 1] = (0.5 - v) * planeH;
        positions[idx * 3 + 2] = heights[idx]! * depth * edgeFade(u, v);
        uvs[idx * 2] = u;
        uvs[idx * 2 + 1] = 1 - v;
      }
    }

    const indices: number[] = [];
    for (let gy = 0; gy < rows - 1; gy++) {
      for (let gx = 0; gx < cols - 1; gx++) {
        const a = gy * cols + gx;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d); // counter-clockwise seen from +Z
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const texture = this.sourceImage ? buildTexture(this.sourceImage) : null;
    const material = new THREE.MeshStandardMaterial({
      ...(texture ? { map: texture } : { color: 0x888888 }),
      roughness: 0.92,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);

    state.scene.add(mesh);
    state.mesh = mesh;
    state.geometry = geometry;
    state.material = material;
    state.texture = texture;
  }
}

/** 0 on the border -> 1 once EDGE_FLATTEN_FRACTION in from every side (smoothstep). */
function edgeFade(u: number, v: number): number {
  const d = Math.min(u, 1 - u, v, 1 - v) / EDGE_FLATTEN_FRACTION;
  const t = clamp01(d);
  return t * t * (3 - 2 * t);
}

/** The full-detail photo as a texture (long edge capped at TEXTURE_MAX_DIM). */
function buildTexture(image: ImageData): THREE.Texture {
  const src = document.createElement('canvas');
  src.width = image.width;
  src.height = image.height;
  src.getContext('2d')!.putImageData(image, 0, 0);

  const k = Math.min(1, TEXTURE_MAX_DIM / Math.max(image.width, image.height));
  let source: HTMLCanvasElement = src;
  if (k < 1) {
    source = document.createElement('canvas');
    source.width = Math.max(1, Math.round(image.width * k));
    source.height = Math.max(1, Math.round(image.height * k));
    const g = source.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, source.width, source.height);
  }

  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
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

/**
 * Smoothed luminance -> relief heights in 0..1. Percentile-normalised (2nd..98th)
 * so isolated highlights/blacks can't compress the useful range, plus a mild
 * dome so the centre sits nearer than the edges.
 */
function shapeHeights(values: Float32Array, cols: number, rows: number): number[] {
  const sorted = Float32Array.from(values).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] ?? 1;
  const range = hi - lo || 1;

  const out = new Array<number>(values.length);
  for (let gy = 0; gy < rows; gy++) {
    const v = rows > 1 ? gy / (rows - 1) - 0.5 : 0;
    for (let gx = 0; gx < cols; gx++) {
      const u = cols > 1 ? gx / (cols - 1) - 0.5 : 0;
      const idx = gy * cols + gx;
      const lum = clamp01((values[idx]! - lo) / range);
      const dome = clamp01(1 - (u * u + v * v) * 3.2);
      out[idx] = clamp01(lum * (1 - DOME_MIX) + dome * DOME_MIX);
    }
  }
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

// ---------------------------------------------------------------------------
// 2D fallback — a raking-light shading of the same height/color grid,
// approximating the WebGL relief's lighting with pure canvas fills. Always
// drawn in full (the camera controls only apply to the WebGL path).
// ---------------------------------------------------------------------------

const FALLBACK_LIGHT_X = -0.6;
const FALLBACK_LIGHT_Z = -0.75;

function renderReliefFallback(renderCtx: RenderContext, payload: Relief3DPayload): void {
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

  for (let gy = 0; gy < rows; gy++) {
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
