// ---------------------------------------------------------------------------
// Timeline — requestAnimationFrame-driven progress ticker.
//
// Every ModeEngine.render(ctx, progress) takes a 0..1 progress value.
// Static modes (2D, Histogram) can ignore it; ModeSketch's stroke-by-stroke
// reveal is what this class exists for. The render loop in useEngine.ts
// needs *something* driving progress from day one — better to have one real
// implementation than a TODO that a later phase has to
// has to retrofit into an already-wired loop.
// ---------------------------------------------------------------------------

export type TimelineListener = (progress: number) => void;

export class Timeline {
  private durationMs: number;
  private loop: boolean;
  private elapsedMs = 0;
  private running = false;
  private rafHandle: number | null = null;
  private lastFrameTime: number | null = null;
  private listeners = new Set<TimelineListener>();

  constructor(options: { durationMs?: number; loop?: boolean } = {}) {
    this.durationMs = options.durationMs ?? 2000;
    this.loop = options.loop ?? false;
  }

  onTick(listener: TimelineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get progress(): number {
    if (this.durationMs <= 0) return 1;
    return Math.min(1, this.elapsedMs / this.durationMs);
  }

  /** Exposed for the 3D orbit pause/play toggle — lets the UI show the correct label without tracking play state itself. */
  get isRunning(): boolean {
    return this.running;
  }

  setDuration(durationMs: number): void {
    this.durationMs = durationMs;
  }

  /**
   * Phase 5 addition: Mode3D drives a continuous camera orbit off `progress`,
   * which only works if the Timeline keeps ticking past its duration instead
   * of stopping — every other mode wants the original one-shot behavior.
   * useEngine.ts calls this on every mode switch, `true` only for '3d'.
   */
  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  play(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = null;
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  reset(): void {
    this.pause();
    this.elapsedMs = 0;
    this.notify();
  }

  private tick = (now: number): void => {
    if (!this.running) return;

    if (this.lastFrameTime !== null) {
      this.elapsedMs += now - this.lastFrameTime;
    }
    this.lastFrameTime = now;

    if (this.elapsedMs >= this.durationMs) {
      if (this.loop) {
        this.elapsedMs = this.elapsedMs % this.durationMs;
      } else {
        this.elapsedMs = this.durationMs;
        this.running = false;
        this.notify();
        return;
      }
    }

    this.notify();
    this.rafHandle = requestAnimationFrame(this.tick);
  };

  private notify(): void {
    const p = this.progress;
    for (const listener of this.listeners) listener(p);
  }
}
