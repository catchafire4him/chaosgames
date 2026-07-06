import { GeminiArtist } from "./gemini.js";
import { NullArtist } from "./none.js";
import type { Artist } from "./types.js";
import type { AssetKind, Storage } from "../storage/index.js";

export * from "./types.js";
export { GeminiArtist } from "./gemini.js";
export { NullArtist } from "./none.js";

/** ARTIST=gemini|none — defaults to gemini when a key is present, else none. */
export function createArtist(): Artist {
  const key = process.env.GEMINI_API_KEY;
  const kind = process.env.ARTIST ?? (key ? "gemini" : "none");
  return kind === "gemini" && key ? new GeminiArtist(key) : new NullArtist();
}

export interface AssetSpec {
  scope: string; // campaignId (private) or "shared"
  kind: AssetKind;
  tags: string[];
  styleKey: string;
  prompt: string;
  aspect?: string;
}

/**
 * The tagged asset library: LOOK UP BY TAGS FIRST — a hit is free, instant, and
 * visually identical (the recurring villain looks the same because it IS the
 * same image). On a miss, generate + store. Returns the asset id to serve via
 * /asset/:id, or null if generation failed/disabled (→ caller uses stock art).
 */
export async function getOrCreateAsset(storage: Storage, artist: Artist, spec: AssetSpec): Promise<string | null> {
  try {
    const hit = await storage.findAsset({ scope: spec.scope, kind: spec.kind, tags: spec.tags, styleKey: spec.styleKey });
    if (hit) {
      await storage.touchAsset(hit.id);
      return hit.id;
    }
  } catch (err) {
    console.warn("[artist] asset lookup failed:", (err as Error).message);
  }
  if (artist.kind === "none") return null;
  const art = await artist.generate({ kind: spec.kind, prompt: spec.prompt, styleKey: spec.styleKey, aspect: spec.aspect });
  if (!art) return null;
  try {
    const saved = await storage.saveAsset({ scope: spec.scope, kind: spec.kind, tags: spec.tags, styleKey: spec.styleKey, prompt: spec.prompt, image: art.bytes, mime: art.mime });
    return saved.id;
  } catch (err) {
    console.warn("[artist] asset save failed:", (err as Error).message);
    return null;
  }
}
