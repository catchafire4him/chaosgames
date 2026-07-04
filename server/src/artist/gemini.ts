import { GoogleGenAI } from "@google/genai";
import type { ArtRequest, ArtResult, Artist } from "./types.js";

/** Fast, cheap image model (~$0.034 / 1K image, sub-2s). Fallback chain in case
 *  the preview id is retired. */
const MODEL_CANDIDATES = [
  process.env.GEMINI_IMAGE_MODEL,
  "gemini-3.1-flash-lite-image",
  "gemini-2.5-flash-image",
].filter((m): m is string => !!m);

export class GeminiArtist implements Artist {
  readonly kind = "gemini";
  private ai: GoogleGenAI;
  private model: string | null = null;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate(req: ArtRequest): Promise<ArtResult | null> {
    const aspect = req.aspect ? ` ${req.aspect} orientation.` : "";
    const prompt = `${req.styleKey} ${req.prompt}${aspect}`;
    const models = this.model ? [this.model] : MODEL_CANDIDATES;
    let lastErr: unknown;
    for (const model of models) {
      try {
        const res = await this.ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseModalities: ["IMAGE"] },
        });
        const parts = res.candidates?.[0]?.content?.parts ?? [];
        for (const p of parts) {
          const data = p.inlineData?.data;
          if (data) {
            this.model = model;
            return { bytes: Buffer.from(data, "base64"), mime: p.inlineData?.mimeType ?? "image/png" };
          }
        }
        throw new Error("no image part in response");
      } catch (err) {
        lastErr = err;
        console.warn(`[artist] model ${model} failed:`, (err as Error).message);
        this.model = null;
      }
    }
    console.warn("[artist] all models failed:", lastErr instanceof Error ? lastErr.message : lastErr);
    return null;
  }
}
