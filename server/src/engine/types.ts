import type { PlayerAction, ModuleId } from "../../../shared/src/index.js";
import type { Room } from "./room.js";

/** JSON-schema-ish parameter spec for a host tool (subset both Gemini and
 *  future providers understand). */
export interface ToolParameters {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
      items?: unknown;
    }
  >;
  required?: string[];
}

/** A tool the Director may call inside a beat response. */
export interface HostTool {
  name: string;
  description: string;
  parameters?: ToolParameters;
  handle(room: Room, args: Record<string, unknown>): void;
}

/** One hosted story moment. Modules fire these via room.play(beat). */
export interface Beat {
  /** stable id, also used to look up canned fallback lines */
  id: string;
  /** Director instruction for this moment ("Narrate the dawn: ...") */
  instruction: string;
  /** flush any narration still playing before this beat */
  urgent?: boolean;
  /** a side-comment (ghost last words, ...): if another beat is on stage,
   *  WAIT for it instead of superseding it — superseding cancels the pending
   *  beat's after() continuation and can strand the game. Dropped if the
   *  stage never frees up. */
  interject?: boolean;
  /** extra tools available to the Director for this beat only */
  tools?: HostTool[];
  /** when set, the Director must also return `data` matching this schema */
  schema?: ToolParameters;
  /** consume authored `data` (validated by the module) before narration plays */
  onAuthored?: (room: Room, data: unknown) => void;
  /** story continuation — runs when narration finishes (or safety timeout) */
  after?: (room: Room) => void;
}

export interface GameModule {
  id: ModuleId;
  name: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  /** host personality/system prompt for this mode */
  persona: string;
  /** stable voice-character description for TTS — identical on every line so
   *  the host's delivery stays consistent (see Speaker.synth) */
  voiceStyle?: string;
  /** assign roles, set initial phase, fire the opening beat */
  setup(room: Room): void;
  /** phone input (already checked: player exists + game started) */
  onAction(room: Room, playerId: string, action: PlayerAction): void;
  /** a room timer set by the module expired */
  onTimer(room: Room, label: string): void;
  /** idle host banter: return a one-line instruction for the current lull, or
   *  null to stay quiet. Fired at most once per phase+round after ~45s of no
   *  state changes and no narration on stage. */
  banter?(room: Room): string | null;
  /** what the TV and every phone can see */
  publicState(room: Room): unknown;
  /** what ONE phone can see (role, clues, ...) */
  privateState(room: Room, playerId: string): unknown;
  /** compact state snapshot included in every Director call */
  buildContext(room: Room): string;
  /** offline/fallback narration per beat id */
  canned(beatId: string, room: Room): { text: string; mood?: string }[];
  /** fallback authored data per beat id (mock director / director failure) */
  cannedData?(beatId: string, room: Room): unknown;
}
