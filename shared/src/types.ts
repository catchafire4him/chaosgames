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

export interface MafiaRoleDetails {
  id: string;
  name: string;
  emoji: string;
  team: "mafia" | "town" | "neutral";
  winCondition: string;
  ability: string;
}

export const MAFIA_ROLES: Record<string, MafiaRoleDetails> = {
  godfather: {
    id: "godfather",
    name: "Godfather",
    emoji: "🕴️",
    team: "mafia",
    winCondition: "Outnumber or equal the Town.",
    ability: "Leads the Mafia. Appears innocent to Detective investigations.",
  },
  consigliere: {
    id: "consigliere",
    name: "Consigliere",
    emoji: "📖",
    team: "mafia",
    winCondition: "Outnumber or equal the Town.",
    ability: "Advisor to the Mafia. Learns players' exact roles at night.",
  },
  conspirator: {
    id: "conspirator",
    name: "Mafia",
    emoji: "🔪",
    team: "mafia",
    winCondition: "Outnumber or equal the Town.",
    ability: "Eliminates players at night with the Mafia team.",
  },
  detective: {
    id: "detective",
    name: "Detective",
    emoji: "🔍",
    team: "town",
    winCondition: "Eliminate all Mafia members.",
    ability: "Investigates alignments (Mafia vs Innocent) each night.",
  },
  doctor: {
    id: "doctor",
    name: "Doctor",
    emoji: "🫁",
    team: "town",
    winCondition: "Eliminate all Mafia members.",
    ability: "Protects one player each night from elimination.",
  },
  vigilante: {
    id: "vigilante",
    name: "Vigilante",
    emoji: "🔫",
    team: "town",
    winCondition: "Eliminate all Mafia members.",
    ability: "Has one bullet to shoot a suspect. Dies of guilt if target is innocent.",
  },
  jester: {
    id: "jester",
    name: "Jester",
    emoji: "🤡",
    team: "neutral",
    winCondition: "Get voted out by the Town.",
    ability: "Has no night powers. Wins only by getting voted out.",
  },
  mayor: {
    id: "mayor",
    name: "Mayor",
    emoji: "📜",
    team: "town",
    winCondition: "Eliminate all Mafia members.",
    ability: "Vote counts as double in daytime voting.",
  },
  innocent: {
    id: "innocent",
    name: "Innocent",
    emoji: "🧑",
    team: "town",
    winCondition: "Eliminate all Mafia members.",
    ability: "Has no night powers. Uses deduction and logic to survive.",
  },
};

export function getMafiaRoleCounts(n: number, mode: "classic" | "full"): { id: string; count: number }[] {
  if (n < 4) return [];
  const mafiaCount = n >= 13 ? 4 : n >= 10 ? 3 : n >= 7 ? 2 : 1;
  const full = mode === "full";
  
  const sc = {
    mafia: mafiaCount,
    godfather: full && mafiaCount >= 2,
    consigliere: full && n >= 13,
    doctor: n >= 5,
    detectives: n >= 13 ? 2 : 1,
    vigilante: full && n >= 9,
    jester: full && n >= 8,
    mayor: full && n >= 11,
  };

  const counts: Record<string, number> = {};
  
  let remainingMafia = sc.mafia;
  if (sc.godfather) {
    counts.godfather = 1;
    remainingMafia--;
  }
  if (sc.consigliere) {
    counts.consigliere = 1;
    remainingMafia--;
  }
  if (remainingMafia > 0) {
    counts.conspirator = remainingMafia;
  }

  counts.detective = sc.detectives;
  if (sc.doctor) counts.doctor = 1;
  if (sc.vigilante) counts.vigilante = 1;
  if (sc.jester) counts.jester = 1;
  if (sc.mayor) counts.mayor = 1;

  const specialCount = Object.values(counts).reduce((a, b) => a + b, 0);
  counts.innocent = Math.max(0, n - specialCount);

  // Return roles ordered by team (mafia first, then town, then neutral) for neat listing
  const order = ["godfather", "consigliere", "conspirator", "detective", "doctor", "vigilante", "mayor", "innocent", "jester"];
  return order
    .map(id => ({ id, count: counts[id] ?? 0 }))
    .filter(item => item.count > 0);
}


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
