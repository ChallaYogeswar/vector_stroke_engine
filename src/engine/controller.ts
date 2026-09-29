import type { ModeEngine, ModeId, RenderContext, RenderPayload, StrokeData } from './types';

// ---------------------------------------------------------------------------
// Controller — the "Mode Router" box in build-spec's pipeline diagram:
//
//   Upload -> Preprocess/Cleanup -> Mode Router -> [Mode Engine] -> Renderer -> Canvas
//
// It owns the registry of engines, holds the currently-loaded (cleaned)
// image, and re-runs process() whenever the active mode changes. It does
// NOT own the render loop or the canvas — useEngine.ts drives requestAnimationFrame
// and calls controller.render() each frame, so the controller stays testable
// without a real DOM.
// ---------------------------------------------------------------------------

export class Controller {
  private engines = new Map<ModeId, ModeEngine>();
  private activeId: ModeId | null = null;
  private currentImage: ImageData | null = null;
  private currentOutput: StrokeData | RenderPayload | null = null;

  register(engine: ModeEngine): void {
    this.engines.set(engine.id, engine);
  }

  get registeredModes(): ModeId[] {
    return Array.from(this.engines.keys());
  }

  get activeMode(): ModeId | null {
    return this.activeId;
  }

  get output(): StrokeData | RenderPayload | null {
    return this.currentOutput;
  }

  /** Loads a new (already-cleaned) image. Does not switch modes or re-process by itself. */
  setImage(image: ImageData): void {
    this.currentImage = image;
    this.currentOutput = null;
  }

  /** Switches the active mode, running that engine's process() on the currently loaded image. */
  switchTo(id: ModeId): StrokeData | RenderPayload {
    const engine = this.engines.get(id);
    if (!engine) {
      throw new Error(`Controller: no engine registered for mode "${id}"`);
    }
    if (!this.currentImage) {
      throw new Error('Controller: switchTo() called before setImage() — nothing to process yet.');
    }

    this.activeId = id;
    this.currentOutput = engine.process(this.currentImage);
    return this.currentOutput;
  }

  /** Draws one frame of the active mode. No-op if no mode is active yet. */
  render(ctx: RenderContext, progress: number): void {
    if (!this.activeId) return;
    const engine = this.engines.get(this.activeId);
    engine?.render(ctx, progress);
  }

  /** Resets every registered engine's internal state and clears the active mode/image. */
  reset(): void {
    for (const engine of this.engines.values()) engine.reset();
    this.activeId = null;
    this.currentImage = null;
    this.currentOutput = null;
  }
}
