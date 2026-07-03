import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { ToolParameters } from "../engine/types.js";
import type { Director, DirectorJob, DirectorResult } from "./types.js";

/** Candidate models, best first. The first one that answers gets cached. */
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
].filter((m): m is string => !!m);

const TYPE_MAP: Record<string, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
};

/** Convert our provider-neutral ToolParameters into a Gemini Schema. */
export function toGeminiSchema(p: ToolParameters): Schema {
  const properties: Record<string, Schema> = {};
  for (const [key, prop] of Object.entries(p.properties)) {
    const s: Schema = {
      type: TYPE_MAP[prop.type] ?? Type.STRING,
      description: prop.description,
    };
    if (prop.enum) s.enum = prop.enum;
    if (prop.items) {
      const items = prop.items as { type?: string } & Record<string, unknown>;
      s.items =
        items.type === "object"
          ? toGeminiSchema(items as unknown as ToolParameters)
          : { type: TYPE_MAP[String(items.type ?? "string")] ?? Type.STRING };
    }
    properties[key] = s;
  }
  return { type: Type.OBJECT, properties, required: p.required };
}

export class GeminiDirector implements Director {
  readonly kind = "gemini";
  private ai: GoogleGenAI;
  private model: string | null = null;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async perform(job: DirectorJob): Promise<DirectorResult> {
    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        lines: {
          type: Type.ARRAY,
          description:
            "Your spoken narration, split into short lines of 1-2 sentences each.",
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              mood: {
                type: Type.STRING,
                description:
                  "OPTIONAL subtle inflection hint, one word (eerie, gleeful, ominous, deadpan, " +
                  "triumphant, grave, wry). The narrator's voice never changes — this only tints delivery.",
              },
            },
            required: ["text"],
          },
        },
        calls: {
          type: Type.ARRAY,
          description: "Stage tool calls, if any.",
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              argsJson: {
                type: Type.STRING,
                description: "JSON-encoded arguments object for the tool",
              },
            },
            required: ["name"],
          },
        },
        ...(job.schema ? { data: toGeminiSchema(job.schema) } : {}),
      },
      required: job.schema ? ["lines", "data"] : ["lines"],
    };

    const toolDocs = job.tools.length
      ? "\n\nSTAGE TOOLS you may include in `calls`:\n" +
        job.tools
          .map(
            (t) =>
              `- ${t.name}: ${t.description}` +
              (t.parameters
                ? ` args: ${JSON.stringify(t.parameters.properties)}`
                : ""),
          )
          .join("\n")
      : "";

    const prompt =
      `${job.context}\n\n=== YOUR JOB RIGHT NOW ===\n${job.instruction}${toolDocs}\n\n` +
      `Respond ONLY with JSON matching the response schema. Keep narration punchy — ` +
      `every line is spoken aloud, so 1-2 sentences per line, 2-5 lines total unless told otherwise.`;

    const raw = await this.generate(job.persona, prompt, responseSchema);
    const parsed = JSON.parse(raw) as {
      lines?: { text?: string; mood?: string }[];
      calls?: { name?: string; argsJson?: string }[];
      data?: unknown;
    };

    const lines = (parsed.lines ?? [])
      .filter((l) => typeof l.text === "string" && l.text.trim())
      .map((l) => ({ text: l.text!.trim(), mood: l.mood }));

    const calls = (parsed.calls ?? [])
      .filter((c) => typeof c.name === "string")
      .map((c) => {
        let args: Record<string, unknown> = {};
        if (c.argsJson) {
          try {
            args = JSON.parse(c.argsJson) as Record<string, unknown>;
          } catch {
            /* unparseable args → empty */
          }
        }
        return { name: c.name!, args };
      });

    return { lines, calls, data: parsed.data };
  }

  /** Try candidate models until one answers; cache the winner. */
  private async generate(
    persona: string,
    prompt: string,
    responseSchema: Schema,
  ): Promise<string> {
    const models = this.model ? [this.model] : MODEL_CANDIDATES;
    let lastErr: unknown;
    for (const model of models) {
      try {
        const res = await this.ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction: persona,
            responseMimeType: "application/json",
            responseSchema,
            temperature: 1.0,
          },
        });
        const text = res.text;
        if (!text) throw new Error("empty response");
        this.model = model;
        return text;
      } catch (err) {
        lastErr = err;
        console.warn(`[director] model ${model} failed:`, (err as Error).message);
        this.model = null;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
