// ---------------------------------------------------------------------------
// Theme color access for canvas-drawn content.
//
// build-spec section 6's design tokens live as CSS custom properties on
// <html> (src/ui/styles.css), flipped per-mode by useEngine.ts setting
// `document.documentElement.dataset.mode`. DOM elements pick those up for
// free via CSS; anything drawn on a <canvas> can't, since canvas painting
// only ever takes literal color values. This reads the live custom
// properties at process()/render() time so canvas output — Sketch's
// strokes, Histogram's chart — stays in sync with the current mode's theme
// instead of hardcoding one palette (which would be wrong for Histogram's
// light flip) or the other (wrong for the four dark modes).
//
// Falls back to the dark-shell defaults outside a browser (Vitest/jsdom,
// where no stylesheet is loaded and the custom properties resolve empty).
// ---------------------------------------------------------------------------

export interface ThemeColors {
  accent: string;
  accentStrong: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  /** Panel background — used by Mode3D to clear its viewport to the same tone as the stage frame around it, rather than a hardcoded color. */
  surface: string;
}

const FALLBACK: ThemeColors = {
  accent: '#46e0a0',
  accentStrong: '#7dffc7',
  textPrimary: '#e9eaec',
  textSecondary: '#9ba0a8',
  textTertiary: '#5c6169',
  border: '#262a30',
  surface: '#15171b',
};

export function readThemeColors(): ThemeColors {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return FALLBACK;
  }

  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;

  return {
    accent: read('--accent', FALLBACK.accent),
    accentStrong: read('--accent-strong', FALLBACK.accentStrong),
    textPrimary: read('--text-primary', FALLBACK.textPrimary),
    textSecondary: read('--text-secondary', FALLBACK.textSecondary),
    textTertiary: read('--text-tertiary', FALLBACK.textTertiary),
    border: read('--border', FALLBACK.border),
    surface: read('--surface', FALLBACK.surface),
  };
}

/** Converts a `#rrggbb` color to `rgba(...)` at the given alpha. Returns the input unchanged if it isn't 6-digit hex (e.g. already rgba/named). */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.trim().replace('#', '');
  if (clean.length !== 6 || /[^0-9a-fA-F]/.test(clean)) return hex;

  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
