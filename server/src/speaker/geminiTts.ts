import { GoogleGenAI } from "@google/genai";
import type { Speaker } from "./types.js";

/** Candidate TTS models, best first — the first one that answers gets cached.
 *  (3.1-flash-tts is a preview model; fall back if it's ever retired.)
 *  NOTE: switching models mid-game audibly changes the host's voice, so model
 *  fallback is a last resort — transient errors (429s) retry the SAME model. */
const TTS_CANDIDATES = [
  process.env.GEMINI_TTS_MODEL,
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
].filter((m): m is string => !!m);

const VOICE = process.env.GEMINI_TTS_VOICE ?? "Charon";
/** free tier allows 10 TTS requests/min per model → pace ourselves */
const MIN_REQUEST_GAP_MS = Number(process.env.TTS_MIN_GAP_MS ?? 6500);
/** total time we'll fight for one line before giving up on audio */
const LINE_DEADLINE_MS = 90_000;
/** hard deadline for a single streaming attempt */
const ATTEMPT_DEADLINE_MS = 25_000;

function is429(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
}

/** Gemini's 429 payload includes "Please retry in 16.7s" — honor it. */
function retryDelayMs(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/retry in ([\d.]+)s/i);
  const s = m ? parseFloat(m[1]) : 12;
  return Math.min(30_000, Math.max(2_000, s * 1000 + 500));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gemini TTS — STREAMS 24kHz 16-bit mono PCM chunks as they're produced.
 *
 *  Consistency guarantees:
 *  - all requests are serialized through one queue and paced under the
 *    free-tier 10-requests/min cap, so lines don't 429 each other;
 *  - 429s retry the SAME model after the server-suggested delay (same voice);
 *  - a different model (different-sounding voice) is only tried on hard
 *    errors, and browser TTS is the absolute last resort. */
export class GeminiTtsSpeaker implements Speaker {
  readonly kind = "gemini";
  private ai: GoogleGenAI;
  private model: string | null = null;
  /** serializes all synth requests (across every room in this process) */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  synth(
    text: string,
    mood: string | undefined,
    emit: (pcmBase64: string) => void,
    voiceStyle?: string,
    stillWanted?: () => boolean,
  ): Promise<boolean> {
    const job = this.queue.then(() =>
      this.synthNow(text, mood, emit, voiceStyle, stillWanted),
    );
    // keep the chain alive even if a job rejects
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async synthNow(
    text: string,
    mood: string | undefined,
    emit: (pcmBase64: string) => void,
    voiceStyle?: string,
    stillWanted?: () => boolean,
  ): Promise<boolean> {
    // a superseded beat's job — skip without spending quota or the pacing gap
    if (stillWanted && !stillWanted()) return false;
    // Every request is stateless, so the character description must be
    // IDENTICAL on every line — only the inflection hint varies, subtly.
    const character =
      voiceStyle ??
      "a seasoned game-show narrator: warm, theatrical, measured pace, medium-low pitch";
    const styled =
      `You are ${character}. Keep the EXACT same voice, pitch, pace and character on every line — ` +
      `do not become a different narrator. ` +
      (mood
        ? `Read the following line with a subtle ${mood} inflection, staying fully in your usual voice: `
        : `Read the following line in your usual voice: `) +
      text;

    const started = Date.now();
    const models = this.model
      ? [this.model, ...TTS_CANDIDATES.filter((m) => m !== this.model)]
      : [...TTS_CANDIDATES];

    let modelIdx = 0;
    while (Date.now() - started < LINE_DEADLINE_MS && modelIdx < models.length) {
      // the beat may have been superseded while we waited out a 429
      if (stillWanted && !stillWanted()) return false;
      const model = models[modelIdx];

      // pace requests under the per-minute quota
      const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();

      const deadline = Date.now() + ATTEMPT_DEADLINE_MS;
      let emitted = false;
      try {
        const stream = await this.ai.models.generateContentStream({
          model,
          contents: [{ parts: [{ text: styled }] }],
          config: {
            responseModalities: ["AUDIO"],
            temperature: 0.6, // lower delivery variance between lines
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
            },
          },
        });
        for await (const chunk of stream) {
          const data =
            chunk.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
              ?.inlineData?.data;
          if (data) {
            emitted = true;
            emit(data);
          }
          if (Date.now() > deadline) {
            console.warn(`[speaker] ${model} exceeded deadline mid-stream`);
            break;
          }
        }
        if (emitted) {
          this.model = model;
          return true;
        }
        console.warn(`[speaker] ${model} returned no audio`);
        modelIdx++;
      } catch (err) {
        // partial audio already reached the TV — don't retry or the line plays twice
        if (emitted) return true;
        if (is429(err)) {
          const delay = retryDelayMs(err);
          console.warn(`[speaker] ${model} rate-limited — retrying same voice in ${Math.round(delay / 1000)}s`);
          await sleep(delay);
          // same model, same voice — do NOT advance modelIdx
        } else {
          console.warn(`[speaker] ${model} failed:`, (err as Error).message);
          this.model = null;
          modelIdx++;
        }
      }
    }
    return false;
  }
}
