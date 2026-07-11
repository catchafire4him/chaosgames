import type { ToolParameters } from "../engine/types.js";

/** One bounded job for the AI host: narrate a moment, optionally author
 *  structured content, optionally call stage tools. Pure request→response. */
export interface DirectorJob {
  roomId: string;
  beatId: string;
  /** host personality (module persona) */
  persona: string;
  /** compact game-state snapshot + recent-narration memory */
  context: string;
  /** what to do right now */
  instruction: string;
  /** stage tools the Director may call (described in-prompt) */
  tools: { name: string; description: string; parameters?: ToolParameters }[];
  /** when set, the response must include `data` matching this schema */
  schema?: ToolParameters;
  /** canned fallbacks (used by MockDirector, and by the engine on failure) */
  fallbackLines: { text: string; mood?: string }[];
  fallbackData?: unknown;
  /** Streaming: called with the FIRST narration line as soon as it parses out
   *  of the model's response stream — long before the full response (and any
   *  authored `data`) completes. Lets the stage start speaking immediately.
   *  Directors that don't stream simply never call it. */
  onLine?: (line: { text: string; mood?: string }) => void;
}

export interface DirectorResult {
  lines: { text: string; mood?: string }[];
  calls: { name: string; args: Record<string, unknown> }[];
  data?: unknown;
}

export interface Director {
  readonly kind: string;
  perform(job: DirectorJob): Promise<DirectorResult>;
}
