/** Shared game types — the contract between server, TV and phones. */

export type ModuleId = "conspiracy" | "whodunnit" | "dungeon" | "campaign";

export type PlayerStatus = "alive" | "dead";

export interface PublicPlayer {
  id: string;
  name: string;
  /** portrait asset id, e.g. "p01" -> /img/portraits/p01.png */
  avatar: string;
  status: PlayerStatus;
  connected: boolean;
  /** Module-specific public label (character name, current location, ...) */
  tag?: string | null;
  /** "this player has submitted their input for the current phase" */
  done?: boolean;
  /** Host spotlight — TV highlights this player */
  spotlight?: boolean;
}

export interface ModuleInfo {
  id: ModuleId;
  name: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface RoomTimer {
  /** epoch ms when the timer expires */
  endsAt: number;
  label: string;
}

/** Host-adjustable gameplay settings (lobby only). */
export interface RoomSettings {
  /** scales every phase timer: relaxed=1.5x, standard=1x, fast=0.6x */
  pace: "relaxed" | "standard" | "fast";
  /** Dungeon Run: rooms per run */
  dungeonRooms: 4 | 5 | 7;
  /** Dungeon Run: casual = no KOs, 3 actions only. standard = comedic KOs
   *  (dead heroes become unlimited-charge hecklers) + a 4th situational action */
  dungeonIntensity: "casual" | "standard";
  /** Whodunnit: investigation rounds before the killer escapes */
  mysteryRounds: 2 | 3 | 4;
  /** Conspiracy: classic = doctor+detective only; full = godfather/vigilante/jester too */
  conspiracyRoles: "classic" | "full";
}

export const DEFAULT_SETTINGS: RoomSettings = {
  pace: "standard",
  dungeonRooms: 5,
  dungeonIntensity: "casual",
  mysteryRounds: 3,
  conspiracyRoles: "full",
};

/** A secret self-claimed side mission, revealed at game over. */
export interface ObjectiveReveal {
  name: string;
  text: string;
  claimed: boolean;
}

/** Running points for one player across every game played in this room tonight. */
export interface ScoreEntry {
  playerId: string;
  name: string;
  avatar: string;
  points: number;
}

export interface PublicRoom {
  id: string;
  code: string;
  moduleId: ModuleId;
  moduleName: string;
  phase: string;
  round: number;
  players: PublicPlayer[];
  winners: string[] | null;
  timer: RoomTimer | null;
  /** the party host — first player to join; their phone gets host controls */
  hostPlayerId: string | null;
  settings: RoomSettings;
  /** secret side missions, revealed once the game ends */
  objectives: ObjectiveReveal[] | null;
  /** running points across every game played in this room tonight, sorted desc */
  scoreboard: ScoreEntry[];
  /** Module-specific public state (scenario, clue feed, tallies, ...) */
  module: unknown;
  /** URL phones should open (encoded in the TV QR code) */
  joinUrl: string;
}

/** A phone input. Modules define their own kinds; the server validates. */
export interface PlayerAction {
  kind: string;
  [key: string]: unknown;
}

/** One host utterance, queued and played in order on the TV. */
export interface NarrationLine {
  id: string;
  text: string;
  /** delivery hint, e.g. "eerie", "gleeful", "ominous", "deadpan" */
  mood?: string;
  /** TTS batching: this line's audio lives inside another line's audio track
   *  (one synth call per beat). The TV advances this caption on an estimated
   *  schedule while the leader's audio plays. */
  audioFrom?: string;
}
