import type { AssetKind } from "../storage/index.js";

/**
 * Artist — the third pluggable brain (alongside Director/Speaker). Turns a
 * prompt into image bytes. Like the others it NEVER blocks a beat: on any
 * failure it returns null and the caller falls back to stock art.
 */
export interface ArtRequest {
  kind: AssetKind;
  /** the subject to draw */
  prompt: string;
  /** per-module style anchor, repeated verbatim every call so the look stays
   *  consistent across stateless generations (the TTS-voice-drift lesson) */
  styleKey: string;
  /** aspect hint, e.g. "portrait" / "wide" (folded into the prompt) */
  aspect?: string;
}

export interface ArtResult {
  bytes: Buffer;
  mime: string;
}

export interface Artist {
  readonly kind: string;
  /** returns null on failure/disabled — callers use stock art */
  generate(req: ArtRequest): Promise<ArtResult | null>;
}

/** shared per-module style anchors */
export const CAMPAIGN_ART_STYLE =
  "Detailed fantasy pixel art, 16-bit retro RPG style, warm torch-lit palette, chunky visible pixels, consistent cohesive game art style, simple dark dungeon background.";
