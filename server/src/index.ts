import "dotenv/config";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  decode,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "../../shared/src/index.js";
import { GeminiDirector } from "./director/gemini.js";
import { MockDirector } from "./director/mock.js";
import { GeminiTtsSpeaker } from "./speaker/geminiTts.js";
import { NullSpeaker, type Speaker } from "./speaker/types.js";
import type { Director } from "./director/types.js";
import type { Room } from "./engine/room.js";
import { getModule, listModules } from "./modules/registry.js";
import { RoomManager } from "./roomManager.js";

// GAME_PORT wins over PORT so dev tooling that injects PORT (preview panels,
// vite wrappers) can't collide with the game server. Railway still sets PORT.
const PORT = Number(process.env.GAME_PORT ?? process.env.PORT ?? 4321);
// The port phones should hit (differs from PORT in dev, where vite serves the UI)
const PUBLIC_PORT = Number(process.env.PUBLIC_PORT ?? PORT);

function lanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return "localhost";
}

const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://${lanIp()}:${PUBLIC_PORT}`).replace(/\/$/, "");

// ─── Provider selection ───────────────────────────────────────────────────────

const apiKey = process.env.GEMINI_API_KEY;
const directorKind = process.env.DIRECTOR ?? (apiKey ? "gemini" : "mock");
const speakerKind = process.env.SPEAKER ?? (apiKey ? "gemini" : "none");

const director: Director =
  directorKind === "gemini" && apiKey ? new GeminiDirector(apiKey) : new MockDirector();
const speaker: Speaker =
  speakerKind === "gemini" && apiKey ? new GeminiTtsSpeaker(apiKey) : new NullSpeaker();

console.log(`[boot] director=${director.kind} speaker=${speaker.kind} public=${PUBLIC_URL}`);

const rooms = new RoomManager(director, speaker, PUBLIC_URL);

// ─── Static files (built client) ──────────────────────────────────────────────

const CLIENT_DIST = join(fileURLToPath(new URL(".", import.meta.url)), "../../client/dist");
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

const httpServer = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  const rel = url === "/" ? "index.html" : url.slice(1);
  const path = normalize(join(CLIENT_DIST, rel));
  if (!path.startsWith(normalize(CLIENT_DIST))) {
    res.writeHead(403).end();
    return;
  }
  try {
    const s = await stat(path);
    if (!s.isFile()) throw new Error("not a file");
    const body = await readFile(path);
    res
      .writeHead(200, {
        "content-type": MIME[extname(path)] ?? "application/octet-stream",
        "cache-control": rel.startsWith("assets/") ? "public,max-age=31536000" : "no-cache",
      })
      .end(body);
  } catch {
    // SPA: unknown non-asset paths get index.html (hash router handles the rest)
    try {
      const body = await readFile(join(CLIENT_DIST, "index.html"));
      res.writeHead(200, { "content-type": "text/html" }).end(body);
    } catch {
      res
        .writeHead(503, { "content-type": "text/plain" })
        .end("Client not built. Run: npm run build (or use the Vite dev server on :5173)");
    }
  }
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

interface ConnCtx {
  room: Room | null;
  role: "tv" | "player" | null;
  playerId: string | null;
  lastCreateAt: number;
  lastEmoteAt: number;
}

const EMOTES = ["😂", "😱", "👏", "🔪", "🤡", "❤️"];

/** secret self-claimed side missions, one per player per game */
const OBJECTIVES = [
  "Get someone ELSE to say the word 'suspicious' before you do.",
  "Work an animal fact into the conversation.",
  "Get the whole group to laugh during a serious moment.",
  "Call someone by the wrong name once and don't correct it.",
  "Use the phrase 'as the prophecy foretold' with a straight face.",
  "Convince someone to change their vote or choice.",
  "Get someone to ask if you're okay.",
  "Compliment the host's narration out loud.",
  "Blame someone for something that happened in a previous game.",
  "Point dramatically at someone at least twice.",
  "Refer to yourself in the third person once.",
  "Get someone to high-five you at a tense moment.",
];

function assignObjectives(room: Room): void {
  const pool = [...OBJECTIVES].sort(() => Math.random() - 0.5);
  let i = 0;
  for (const p of room.players.values()) {
    p.data.__objective = pool[i % pool.length];
    p.data.__objectiveClaimed = false;
    i++;
  }
}

function startGame(room: Room): string | null {
  if (room.started) return null;
  if (room.players.size < room.module.minPlayers) {
    return `Need at least ${room.module.minPlayers} players.`;
  }
  room.started = true;
  assignObjectives(room);
  room.module.setup(room);
  room.broadcast();
  return null;
}

/** shared host controls — issued from the TV or the party host's phone */
function runHostCommand(
  room: Room,
  msg: Extract<ClientMessage, { type: "tv_command" } | { type: "host_command" }>,
): string | null {
  switch (msg.command) {
    case "start_game":
      return startGame(room);
    case "play_again":
      room.resetForNewGame();
      return null;
    case "abort_game":
      if (!room.started) return null;
      console.log(`[room:${room.code}] game aborted by host`);
      room.resetForNewGame();
      return null;
    case "skip_narration":
      room.sendTv({ type: "narration_clear", hard: true });
      room.pending?.skip();
      return null;
    case "extend_timer":
      room.extendTimer();
      return null;
    case "switch_module": {
      if (room.started || !msg.moduleId) return null;
      const module = getModule(msg.moduleId);
      if (module) room.switchModule(module);
      return null;
    }
    case "kick_player":
      if (msg.playerId) room.kickPlayer(msg.playerId);
      return null;
    case "set_setting":
      if (msg.setting) room.setSetting(String(msg.setting.key), String(msg.setting.value));
      return null;
  }
  return null;
}

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(encode(msg));
}

wss.on("connection", (ws) => {
  const ctx: ConnCtx = { room: null, role: null, playerId: null, lastCreateAt: 0, lastEmoteAt: 0 };

  ws.on("message", (raw) => {
    const msg = decode<ClientMessage>(raw.toString());
    if (!msg) return;
    try {
      handle(ws, ctx, msg);
    } catch (err) {
      console.error("[ws] handler error:", err);
      send(ws, { type: "error", message: "Something went wrong." });
    }
  });

  ws.on("close", () => {
    const { room, role, playerId } = ctx;
    if (!room) return;
    if (role === "tv") {
      room.tvSockets.delete(ws);
    } else if (role === "player" && playerId) {
      const player = room.players.get(playerId);
      if (player) {
        player.sockets.delete(ws);
        if (!player.sockets.size) player.connected = false;
      }
    }
    room.broadcast();
  });
});

function handle(ws: WebSocket, ctx: ConnCtx, msg: ClientMessage): void {
  switch (msg.type) {
    case "list_modules":
      send(ws, { type: "modules", modules: listModules() });
      return;

    case "create_room": {
      if (Date.now() - ctx.lastCreateAt < 5000) {
        send(ws, { type: "error", message: "Hold on — one room at a time." });
        return;
      }
      try {
        const room = rooms.create(msg.moduleId);
        ctx.lastCreateAt = Date.now();
        send(ws, { type: "room_created", roomId: room.id, code: room.code });
      } catch (err) {
        send(ws, { type: "error", message: (err as Error).message });
      }
      return;
    }

    case "join_tv": {
      const room = rooms.find(msg.roomId);
      if (!room) {
        send(ws, { type: "error", message: "Room not found." });
        return;
      }
      ctx.room = room;
      ctx.role = "tv";
      room.tvSockets.add(ws);
      send(ws, { type: "joined_tv", roomId: room.id });
      room.broadcast();
      return;
    }

    case "join_player": {
      const room = rooms.find(msg.room);
      if (!room) {
        send(ws, { type: "error", message: "Room not found — check the code." });
        return;
      }
      // Rejoin (refresh / reconnect) with a remembered playerId
      const existing = msg.playerId ? room.players.get(msg.playerId) : undefined;
      if (existing) {
        existing.connected = true;
        existing.sockets.add(ws);
        ctx.room = room;
        ctx.role = "player";
        ctx.playerId = existing.id;
        send(ws, { type: "joined_player", roomId: room.id, playerId: existing.id });
        room.broadcast();
        return;
      }
      if (room.started) {
        // seat transfer: a dead phone can be replaced by rejoining with the
        // same name from any device
        const seat = [...room.players.values()].find(
          (p) => !p.connected && p.name.toLowerCase() === msg.name.trim().toLowerCase(),
        );
        if (seat) {
          seat.connected = true;
          seat.sockets.add(ws);
          ctx.room = room;
          ctx.role = "player";
          ctx.playerId = seat.id;
          send(ws, { type: "joined_player", roomId: room.id, playerId: seat.id });
          room.broadcast();
          return;
        }
        send(ws, {
          type: "error",
          message:
            "That game already started. (Replacing someone? Join with their exact name once their phone is offline.)",
        });
        return;
      }
      if (room.players.size >= room.module.maxPlayers) {
        send(ws, { type: "error", message: "Room is full." });
        return;
      }
      const player = room.addPlayer(msg.name);
      player.sockets.add(ws);
      ctx.room = room;
      ctx.role = "player";
      ctx.playerId = player.id;
      send(ws, { type: "joined_player", roomId: room.id, playerId: player.id });
      room.broadcast();
      return;
    }

    case "action": {
      const { room, playerId } = ctx;
      if (!room || !playerId) return;
      if (!room.started) {
        // lobby-only engine actions (not module gameplay)
        if (msg.action.kind === "cycle_avatar") room.cycleAvatar(playerId);
        return;
      }
      const player = room.players.get(playerId);
      if (!player) return;
      // engine-owned actions
      if (msg.action.kind === "claim_objective") {
        player.data.__objectiveClaimed = true;
        room.broadcast();
        return;
      }
      room.module.onAction(room, playerId, msg.action);
      room.broadcast();
      return;
    }

    case "emote": {
      const { room, playerId } = ctx;
      if (!room || !playerId) return;
      if (!EMOTES.includes(msg.emoji)) return;
      if (Date.now() - ctx.lastEmoteAt < 1500) return; // gentle throttle
      ctx.lastEmoteAt = Date.now();
      const player = room.players.get(playerId);
      if (!player) return;
      room.sendTv({ type: "emote", emoji: msg.emoji, name: player.name });
      return;
    }

    case "tv_command": {
      const { room } = ctx;
      if (!room || ctx.role !== "tv") return;
      const error = runHostCommand(room, msg);
      if (error) send(ws, { type: "error", message: error });
      return;
    }

    case "host_command": {
      const { room, playerId } = ctx;
      if (!room || ctx.role !== "player" || !playerId) return;
      if (room.hostPlayerId !== playerId) return; // only the party host
      const error = runHostCommand(room, msg);
      if (error) send(ws, { type: "error", message: error });
      return;
    }

    case "narration_done": {
      ctx.room?.pending?.done(msg.lineId);
      return;
    }
  }
}

httpServer.listen(PORT, () => {
  console.log(`[boot] Chaos Games server on :${PORT} — ${PUBLIC_URL}`);
});
