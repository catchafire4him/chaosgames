import type {
  ModuleId,
  ModuleInfo,
  NarrationLine,
  PlayerAction,
  PublicRoom,
  RoomSettings,
} from "./types.js";

/** commands the party host (or the TV) can issue */
export type HostCommand =
  | "start_game"
  | "play_again"
  | "skip_narration"
  /** abort a running game and return everyone to the lobby */
  | "abort_game"
  /** lobby only: swap the game mode, keeping the room + players */
  | "switch_module"
  /** lobby only: remove a player (e.g. a dead phone) */
  | "kick_player"
  /** add 30s to the current phase timer */
  | "extend_timer"
  /** lobby only: change a gameplay setting */
  | "set_setting";

// ─── Client → Server ─────────────────────────────────────────────────────────

export type ClientMessage =
  | { type: "list_modules" }
  | { type: "create_room"; moduleId: ModuleId }
  | { type: "join_tv"; roomId: string }
  | {
      type: "join_player";
      /** room code (4 letters) or room id */
      room: string;
      name: string;
      /** for rejoin after refresh/disconnect */
      playerId?: string;
    }
  | { type: "action"; action: PlayerAction }
  | {
      type: "tv_command";
      command: HostCommand;
      moduleId?: ModuleId;
      playerId?: string;
      setting?: { key: keyof RoomSettings; value: string };
    }
  /** same commands, issued from the party host's phone */
  | {
      type: "host_command";
      command: HostCommand;
      moduleId?: ModuleId;
      playerId?: string;
      setting?: { key: keyof RoomSettings; value: string };
    }
  /** quick reaction that floats up the TV */
  | { type: "emote"; emoji: string }
  /** TV finished playing a narration line */
  | { type: "narration_done"; lineId: string };

// ─── Server → Client ─────────────────────────────────────────────────────────

export type ServerMessage =
  | { type: "modules"; modules: ModuleInfo[] }
  | { type: "room_created"; roomId: string; code: string }
  | { type: "joined_tv"; roomId: string }
  | { type: "joined_player"; roomId: string; playerId: string }
  | { type: "room_state"; room: PublicRoom; you?: unknown }
  /** Announce a host line; its audio streams separately (TV only) */
  | { type: "narration"; line: NarrationLine }
  /** One streamed chunk of base64 24kHz PCM for a line (TV only) */
  | { type: "narration_audio"; lineId: string; pcm: string }
  /** All audio sent for a line. ok=false → TV should speak the text itself */
  | { type: "narration_audio_end"; lineId: string; ok: boolean }
  /** The Director is composing (show a subtle indicator between beats) */
  | { type: "host_thinking"; on: boolean }
  /** Drop queued narration. Soft (default): current line finishes. hard: cut now */
  | { type: "narration_clear"; hard?: boolean }
  | { type: "sfx"; sound: string }
  /** a player reaction to float up the TV */
  | { type: "emote"; emoji: string; name: string }
  /** Host whisper delivered to one phone */
  | { type: "private_message"; text: string }
  | { type: "error"; message: string };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decode<T>(raw: unknown): T | null {
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}
