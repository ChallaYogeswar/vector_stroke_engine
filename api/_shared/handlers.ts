import type { DescribeRequest, DescribeResponse, PathFeederRequest, PathFeederResponse } from '../../src/engine/ai-types';
import { askClaudeAboutImage } from './anthropic-client';
import { ModelOutputError, ValidationError } from './errors';

// ~2.2 MB decoded — comfortably under Vercel's 4.5 MB request-body ceiling
// with headroom for the rest of the JSON envelope. Defense in depth: the
// client is responsible for downscaling before it ever sends a request
// (docs/backend-spec.md section 6), this just refuses to forward something huge
// to a paid API call regardless of how it got here.
const MAX_IMAGE_BASE64_CHARS = 3_000_000;

function validateImageBase64(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('imageBase64 is required and must be a non-empty string.');
  }
  if (value.length > MAX_IMAGE_BASE64_CHARS) {
    throw new ValidationError('Image payload too large — downscale before sending (see docs/backend-spec.md section 6).');
  }
  return value;
}

export async function handleDescribe(body: DescribeRequest | undefined): Promise<DescribeResponse> {
  const imageBase64 = validateImageBase64(body?.imageBase64);
  const description = await askClaudeAboutImage({
    imageBase64,
    mediaType: 'image/jpeg',
    maxTokens: 300,
    prompt:
      'Describe this photo in 2-3 plain sentences, as alt text for someone who cannot see it. ' +
      'Focus on the actual subject and setting, not any artistic rendering style. No preamble, just the description.',
  });
  return { description: description.trim() };
}

// See docs/backend-spec.md section 4 for why this asks for tuning guidance
// (a focus region + a detail level) rather than raw path coordinates, and
// for why that reading is a documented assumption, not a spec certainty.
const PATH_FEEDER_PROMPT = `Look at this photo as if preparing it for a hand-drawn line-art
sketch. Reply with ONLY a JSON object (no markdown code fences, no other
text before or after it), matching exactly this shape:

{"focusRegion": {"x": number, "y": number, "width": number, "height": number} | null,
 "suggestedDetail": "low" | "medium" | "high",
 "reasoning": string}

focusRegion is the main subject's bounding box, as fractions of the full
image width/height (0..1, x/y measured from the top-left corner) — use null
if there's no single clear subject (e.g. an even texture or a wide
landscape with no focal point).
suggestedDetail is how much fine edge detail a line drawing of this photo
should keep: "low" for simple/graphic subjects, "high" for busy/textured
ones, "medium" otherwise.
reasoning is one short sentence explaining the suggestedDetail choice.`;

export async function handlePathFeeder(body: PathFeederRequest | undefined): Promise<PathFeederResponse> {
  const imageBase64 = validateImageBase64(body?.imageBase64);
  const raw = await askClaudeAboutImage({
    imageBase64,
    mediaType: 'image/jpeg',
    maxTokens: 300,
    prompt: PATH_FEEDER_PROMPT,
  });
  return parsePathFeederResponse(raw);
}

function parsePathFeederResponse(raw: string): PathFeederResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new ModelOutputError('Model response was not valid JSON.');
  }
  return normalizePathFeederPayload(parsed);
}

/** Models asked for strict JSON sometimes wrap it in a ```json fence anyway — stripped defensively rather than trusting the prompt alone. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

const DETAIL_LEVELS: ReadonlySet<string> = new Set<string>(['low', 'medium', 'high']);

function normalizePathFeederPayload(value: unknown): PathFeederResponse {
  // typeof [] === 'object' in JS — Array.isArray is required here, not
  // just a null check, or a bare array response silently normalizes to
  // all-default values instead of being rejected as the wrong shape.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModelOutputError('Model response JSON was not an object.');
  }
  const obj = value as Record<string, unknown>;

  const suggestedDetailRaw = obj['suggestedDetail'];
  const suggestedDetail: PathFeederResponse['suggestedDetail'] =
    typeof suggestedDetailRaw === 'string' && DETAIL_LEVELS.has(suggestedDetailRaw)
      ? (suggestedDetailRaw as PathFeederResponse['suggestedDetail'])
      : 'medium'; // conservative default if the model drifts from the requested shape rather than failing the whole request

  const reasoning = typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '';
  const focusRegion = toFocusRegion(obj['focusRegion']);

  return { focusRegion, suggestedDetail, reasoning };
}

function toFocusRegion(value: unknown): PathFeederResponse['focusRegion'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const x = r['x'];
  const y = r['y'];
  const width = r['width'];
  const height = r['height'];
  if (isUnitFraction(x) && isUnitFraction(y) && isUnitFraction(width) && isUnitFraction(height)) {
    return { x, y, width, height };
  }
  return null; // malformed region from the model — degrade to "no focus region" rather than fail the whole request
}

function isUnitFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
