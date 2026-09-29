// ---------------------------------------------------------------------------
// AI endpoint contracts — docs/backend-spec.md section 5.
// Kept alongside types.ts (not inside api/) specifically so the eventual
// client UI imports the exact same shapes api/_shared/handlers.ts is
// checked against — one contract, not two hand-synced copies drifting
// apart the way build-spec's whole rebuild exists to prevent.
// ---------------------------------------------------------------------------

/** Base64-encoded JPEG, no `data:` URL prefix. See docs/backend-spec.md section 6 for the client-side downscale/encode contract this assumes. */
export interface DescribeRequest {
  imageBase64: string;
}

export interface DescribeResponse {
  description: string;
}

export interface PathFeederRequest {
  imageBase64: string;
}

export type SuggestedDetail = 'low' | 'medium' | 'high';

/** Normalized 0..1 fractions of the source image's width/height, not pixel coordinates — see docs/backend-spec.md section 5 for why. */
export interface PathFeederFocusRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PathFeederResponse {
  /** Null when the model doesn't identify one clear subject (even texture, wide landscape, etc.). */
  focusRegion: PathFeederFocusRegion | null;
  suggestedDetail: SuggestedDetail;
  /** One short sentence — surfaced in the UI so an AI-driven parameter change isn't a silent black box. */
  reasoning: string;
}

export interface ApiErrorResponse {
  error: string;
}
