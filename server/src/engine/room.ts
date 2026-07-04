import type { WebSocket } from "ws";
import {
  DEFAULT_SETTINGS,
  encode,
  type PublicPlayer,
  type PublicRoom,
  type PlayerStatus,
  type RoomSettings,
  type RoomTimer,
  type ServerMessage,
} from "../../../shared/src/index.js";
import type { Director } from "../director/types.js";
import type { Speaker } from "../speaker/types.js";
import type { Storage } from "../storage/index.js";
import type { Beat, GameModule } from "./types.js";
import { runBeat, type PendingNarration } from "./beats.js";

export interface ServerPlayer {
  id: string;
  name: string;
  avatar: string;
  status: PlayerStatus;
  connected: boolean;
  tag: string | null;
  done: boolean;
  spotlight: boolean;
  /** device identity (Campaign): localStorage UUID, links this seat to a
   *  persisted hero and lets it be reclaimed across sessions. */
  playerKey: string | null;
  /** module scratch: role, votes, clues, messages, ... */
  data: Record<string, unknown>;
  sockets: Set<WebSocket>;
}

const AVATARS = Array.from({ length: 16 }, (_, i) =>
  `p${String(i + 1).padStart(2, "0")}`,
);

let nextId = 1;
export function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(nextId++).toString(36)}`;
}

export class Room {
  phase = "lobby";
  round = 0;
  winners: string[] | null = null;
  started = false;
  players = new Map<string, ServerPlayer>();
  /** module-owned state bag */
  state: Record<string, unknown> = {};
  tvSockets = new Set<WebSocket>();
  createdAt = Date.now();
  lastActivityAt = Date.now();

  /** rolling memory of what the host already said (Director continuity) */
  memory: { beatId: string; text: string }[] = [];

  /** one-line summaries of finished games tonight (fuels running gags) */
  nightLog: string[] = [];
  private gamesPlayed = 0;

  /** running points across every game played in this room tonight, by player id.
   *  Survives play-again and switch-module — it's a whole game-night score. */
  private scoreboard = new Map<string, number>();

  private awardPoints(playerId: string, points: number): void {
    this.scoreboard.set(playerId, (this.scoreboard.get(playerId) ?? 0) + points);
  }

  /** the party host — first player to join; may issue host_command */
  hostPlayerId: string | null = null;

  settings: RoomSettings = { ...DEFAULT_SETTINGS };

  timer: (RoomTimer & { handle: NodeJS.Timeout }) | null = null;

  /** idle-banter machinery — see scheduleBanter() */
  private banterTimer: NodeJS.Timeout | null = null;
  private bantered = new Set<string>();

  /** narration currently awaiting TV playback acks (set by beats.ts) */
  pending: PendingNarration | null = null;
  /** a beat is mid-flight — from the Director call through narration playback.
   *  True earlier than `pending` (which is only set once the call returns), so
   *  callers can tell "the host is busy" even during the in-flight API call. */
  composing = false;

  /** Campaign only: the persisted campaign this room is bound to. */
  campaignId: string | null = null;
  /** persistence backend (Campaign module); undefined for the party modes */
  readonly storage?: Storage;

  constructor(
    readonly id: string,
    readonly code: string,
    /** swappable in the lobby — one room hosts a whole game night */
    public module: GameModule,
    readonly director: Director,
    readonly speaker: Speaker,
    readonly joinUrl: string,
    storage?: Storage,
  ) {
    this.storage = storage;
  }

  /** Lobby-only: swap the game mode, keeping the room code and players. */
  switchModule(module: GameModule): void {
    if (this.started) return;
    this.module = module;
    this.state = {};
    this.memory = [];
    for (const p of this.players.values()) {
      p.tag = null;
      p.done = false;
      p.spotlight = false;
      p.data = {};
    }
    this.broadcast();
  }

  /** Lobby-only: remove a player (dead phone, rage-quit, wrong room). */
  kickPlayer(playerId: string): void {
    if (this.started) return;
    const player = this.players.get(playerId);
    if (!player) return;
    this.sendPlayer(playerId, {
      type: "error",
      message: "You were removed from the room by the host.",
    });
    for (const ws of player.sockets) ws.close();
    this.players.delete(playerId);
    // the crown passes to the next connected player
    if (this.hostPlayerId === playerId) {
      this.hostPlayerId =
        [...this.players.values()].find((p) => p.connected)?.id ??
        [...this.players.keys()][0] ??
        null;
    }
    this.broadcast();
  }

  /** lobby-only settings change (host phone or TV) */
  setSetting(key: string, value: string): void {
    if (this.started) return;
    const s = this.settings as unknown as Record<string, unknown>;
    switch (key) {
      case "pace":
        if (["relaxed", "standard", "fast"].includes(value)) s.pace = value;
        break;
      case "dungeonRooms":
        if (["4", "5", "7"].includes(value)) s.dungeonRooms = Number(value);
        break;
      case "dungeonIntensity":
        if (["casual", "standard"].includes(value)) s.dungeonIntensity = value;
        break;
      case "mysteryRounds":
        if (["2", "3", "4"].includes(value)) s.mysteryRounds = Number(value);
        break;
      case "conspiracyRoles":
        if (["classic", "full"].includes(value)) s.conspiracyRoles = value;
        break;
    }
    this.broadcast();
  }

  /** pace multiplier applied to every phase timer */
  private paceFactor(): number {
    return this.settings.pace === "relaxed" ? 1.5 : this.settings.pace === "fast" ? 0.6 : 1;
  }

  /** Lobby-only: let a player try on the next free portrait. */
  cycleAvatar(playerId: string): void {
    if (this.started) return;
    const player = this.players.get(playerId);
    if (!player) return;
    const taken = new Set(
      [...this.players.values()].filter((p) => p.id !== playerId).map((p) => p.avatar),
    );
    const all = Array.from({ length: 16 }, (_, i) => `p${String(i + 1).padStart(2, "0")}`);
    const start = all.indexOf(player.avatar);
    for (let i = 1; i <= all.length; i++) {
      const candidate = all[(start + i) % all.length];
      if (!taken.has(candidate)) {
        player.avatar = candidate;
        break;
      }
    }
    this.broadcast();
  }

  // ─── Players ───────────────────────────────────────────────────────────────

  addPlayer(name: string, playerKey: string | null = null): ServerPlayer {
    const player: ServerPlayer = {
      id: rid("pl"),
      name: name.slice(0, 20).trim() || "Player",
      avatar: AVATARS[this.players.size % AVATARS.length],
      status: "alive",
      connected: true,
      tag: null,
      done: false,
      spotlight: false,
      playerKey,
      data: {},
      sockets: new Set(),
    };
    this.players.set(player.id, player);
    if (!this.hostPlayerId) this.hostPlayerId = player.id;
    return player;
  }

  alive(): ServerPlayer[] {
    return [...this.players.values()].filter((p) => p.status === "alive");
  }

  name(playerId: string | undefined | null): string {
    return (playerId && this.players.get(playerId)?.name) || "someone";
  }

  /** clear per-phase submission flags */
  clearDone(): void {
    for (const p of this.players.values()) p.done = false;
  }

  // ─── Messaging ─────────────────────────────────────────────────────────────

  sendTv(msg: ServerMessage): void {
    const raw = encode(msg);
    for (const ws of this.tvSockets) {
      if (ws.readyState === ws.OPEN) ws.send(raw);
    }
  }

  sendPlayer(playerId: string, msg: ServerMessage): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const raw = encode(msg);
    for (const ws of player.sockets) {
      if (ws.readyState === ws.OPEN) ws.send(raw);
    }
  }

  /** Host whisper: delivered live + stored so the phone UI can show an inbox. */
  whisper(playerId: string, text: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const messages = (player.data.messages ?? []) as string[];
    messages.push(text);
    player.data.messages = messages.slice(-12);
    this.sendPlayer(playerId, { type: "private_message", text });
  }

  sfx(sound: string): void {
    this.sendTv({ type: "sfx", sound });
  }

  publicRoom(): PublicRoom {
    const players: PublicPlayer[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      status: p.status,
      connected: p.connected,
      tag: p.tag,
      done: p.done,
      spotlight: p.spotlight,
    }));
    return {
      id: this.id,
      code: this.code,
      moduleId: this.module.id,
      moduleName: this.module.name,
      phase: this.phase,
      round: this.round,
      players,
      winners: this.winners,
      timer: this.timer ? { endsAt: this.timer.endsAt, label: this.timer.label } : null,
      hostPlayerId: this.hostPlayerId,
      settings: this.settings,
      objectives:
        this.phase === "ended"
          ? [...this.players.values()].map((p) => ({
              name: p.name,
              text: String(p.data.__objective ?? ""),
              claimed: !!p.data.__objectiveClaimed,
            }))
          : null,
      module: this.started ? this.module.publicState(this) : null,
      joinUrl: this.joinUrl,
      scoreboard: [...this.players.values()]
        .map((p) => ({ playerId: p.id, name: p.name, avatar: p.avatar, points: this.scoreboard.get(p.id) ?? 0 }))
        .filter((s) => s.points > 0)
        .sort((a, b) => b.points - a.points),
    };
  }

  /** Push tailored room_state to the TV and every phone. */
  broadcast(): void {
    this.lastActivityAt = Date.now();
    this.scheduleBanter();
    const room = this.publicRoom();
    this.sendTv({ type: "room_state", room });
    for (const p of this.players.values()) {
      if (!p.sockets.size) continue;
      // engine-owned private extras (secret objective) ride along with the
      // module's private view
      const moduleYou = this.started ? this.module.privateState(this, p.id) : { id: p.id };
      const you =
        moduleYou && typeof moduleYou === "object"
          ? {
              ...(moduleYou as Record<string, unknown>),
              __objective: p.data.__objective ?? null,
              __objectiveClaimed: !!p.data.__objectiveClaimed,
            }
          : moduleYou;
      this.sendPlayer(p.id, { type: "room_state", room, you });
    }
  }

  /** After ~45s with no state changes and nothing on stage, let the host fill
   *  the silence with one in-character quip (at most once per phase+round). */
  private scheduleBanter(): void {
    if (this.banterTimer) clearTimeout(this.banterTimer);
    this.banterTimer = null;
    if (!this.started || this.phase === "ended" || !this.module.banter) return;
    this.banterTimer = setTimeout(() => {
      this.banterTimer = null;
      if (!this.started || this.phase === "ended" || this.pending) return;
      if (this.tvSockets.size === 0) return; // nobody listening
      const key = `${this.phase}:${this.round}`;
      if (this.bantered.has(key)) return;
      const instruction = this.module.banter!(this);
      if (!instruction) return;
      this.bantered.add(key);
      this.play({ id: "banter", instruction });
    }, 45_000);
  }

  // ─── Timers ────────────────────────────────────────────────────────────────

  setTimer(label: string, ms: number): void {
    this.clearTimer();
    const scaled = Math.round(ms * this.paceFactor());
    this.timer = {
      label,
      endsAt: Date.now() + scaled,
      handle: setTimeout(() => {
        this.timer = null;
        this.module.onTimer(this, label);
      }, scaled),
    };
    this.broadcast();
  }

  /** host control: +30s on whatever timer is running */
  extendTimer(ms = 30_000): void {
    if (!this.timer) return;
    const { label, endsAt } = this.timer;
    clearTimeout(this.timer.handle);
    const remaining = Math.max(0, endsAt - Date.now()) + ms;
    this.timer = {
      label,
      endsAt: Date.now() + remaining,
      handle: setTimeout(() => {
        this.timer = null;
        this.module.onTimer(this, label);
      }, remaining),
    };
    this.broadcast();
  }

  clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer.handle);
      this.timer = null;
    }
  }

  // ─── Flow ──────────────────────────────────────────────────────────────────

  setPhase(phase: string): void {
    this.clearTimer();
    this.phase = phase;
    this.clearDone();
    for (const p of this.players.values()) p.spotlight = false;
  }

  /** Fire a hosted story beat (async; never throws into game logic). */
  play(beat: Beat): void {
    void runBeat(this, beat).catch((err) =>
      console.error(`[room:${this.code}] beat ${beat.id} crashed:`, err),
    );
  }

  remember(beatId: string, text: string): void {
    this.memory.push({ beatId, text });
    if (this.memory.length > 12) this.memory.shift();
  }

  memoryContext(): string {
    let out = "";
    if (this.nightLog.length) {
      out +=
        "\n\nEARLIER TONIGHT (previous games with these same people — call back to them for running gags):\n" +
        this.nightLog.map((l) => `- ${l}`).join("\n");
    }
    if (this.memory.length) {
      out +=
        "\n\nWHAT YOU (THE HOST) ALREADY SAID RECENTLY — stay consistent, don't repeat yourself:\n" +
        this.memory.map((m) => `- [${m.beatId}] ${m.text}`).join("\n");
    }
    return out;
  }

  endGame(winnerNames: string[]): void {
    this.winners = winnerNames;
    this.gamesPlayed++;
    // scoring: +1 for everyone who played, +3 bonus for each name in winnerNames
    for (const p of this.players.values()) this.awardPoints(p.id, 1);
    for (const name of winnerNames) {
      const winner = [...this.players.values()].find((p) => p.name === name);
      if (winner) this.awardPoints(winner.id, 3);
    }
    this.nightLog.push(
      `Game ${this.gamesPlayed} — ${this.module.name}: ` +
        (winnerNames.length ? `${winnerNames.join(", ")} won` : "nobody won") +
        ` (players: ${[...this.players.values()].map((p) => p.name).join(", ")})`,
    );
    if (this.nightLog.length > 8) this.nightLog.shift();
    this.setPhase("ended");
  }

  resetForNewGame(): void {
    this.pending?.cancel();
    this.pending = null;
    this.clearTimer();
    if (this.banterTimer) clearTimeout(this.banterTimer);
    this.banterTimer = null;
    this.bantered.clear();
    this.started = false;
    this.winners = null;
    this.round = 0;
    this.phase = "lobby";
    this.state = {};
    this.memory = []; // per-game narration memory resets; nightLog persists
    for (const p of this.players.values()) {
      p.status = "alive";
      p.tag = null;
      p.done = false;
      p.spotlight = false;
      p.data = {};
    }
    this.sendTv({ type: "narration_clear", hard: true });
    this.broadcast();
  }

  destroy(): void {
    this.pending?.cancel();
    this.clearTimer();
    if (this.banterTimer) clearTimeout(this.banterTimer);
    this.banterTimer = null;
  }
}
