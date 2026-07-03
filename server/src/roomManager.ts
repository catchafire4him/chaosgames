import type { ModuleId } from "../../shared/src/index.js";
import type { Director } from "./director/types.js";
import type { Speaker } from "./speaker/types.js";
import { Room, rid } from "./engine/room.js";
import { getModule } from "./modules/registry.js";

/** no ambiguous letters (I/O/L) */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const IDLE_ROOM_MS = 2 * 60 * 60 * 1000;
/** hard cap on concurrently active rooms (each live room can cost AI calls) */
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 40);

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byCode = new Map<string, Room>();

  constructor(
    private readonly director: Director,
    private readonly speaker: Speaker,
    private readonly publicUrl: string,
  ) {
    setInterval(() => this.sweep(), 10 * 60 * 1000).unref();
  }

  create(moduleId: ModuleId): Room {
    if (this.rooms.size >= MAX_ROOMS) {
      throw new Error("The parlor is at capacity right now — try again in a bit.");
    }
    const module = getModule(moduleId);
    if (!module) throw new Error(`unknown module: ${moduleId}`);
    let code: string;
    do {
      code = Array.from(
        { length: 4 },
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join("");
    } while (this.byCode.has(code));

    const joinUrl = `${this.publicUrl}/#/play/${code}`;
    const room = new Room(rid("rm"), code, module, this.director, this.speaker, joinUrl);
    this.rooms.set(room.id, room);
    this.byCode.set(code, room);
    console.log(`[rooms] created ${code} (${moduleId}) — ${this.rooms.size} active`);
    return room;
  }

  find(roomIdOrCode: string): Room | undefined {
    return (
      this.rooms.get(roomIdOrCode) ??
      this.byCode.get(roomIdOrCode.trim().toUpperCase())
    );
  }

  private sweep(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (now - room.lastActivityAt > IDLE_ROOM_MS) {
        console.log(`[rooms] sweeping idle room ${room.code}`);
        room.destroy();
        this.rooms.delete(room.id);
        this.byCode.delete(room.code);
      }
    }
  }
}
