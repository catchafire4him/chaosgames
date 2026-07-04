import type { ModuleId } from "../../shared/src/index.js";
import type { Director } from "./director/types.js";
import type { Speaker } from "./speaker/types.js";
import type { Storage } from "./storage/index.js";
import type { Artist } from "./artist/index.js";
import { Room, rid } from "./engine/room.js";
import type { GameModule } from "./engine/types.js";
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
    /** persistence for the Campaign module; other modules ignore it */
    readonly storage?: Storage,
    /** image generation for the Campaign module */
    readonly artist?: Artist,
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

    const room = this.build(module, code);
    console.log(`[rooms] created ${code} (${moduleId}) — ${this.rooms.size} active`);
    return room;
  }

  /** shared room construction (code already reserved-unique) */
  private build(module: GameModule, code: string): Room {
    const joinUrl = `${this.publicUrl}/#/play/${code}`;
    const room = new Room(rid("rm"), code, module, this.director, this.speaker, joinUrl, this.storage, this.artist);
    this.rooms.set(room.id, room);
    this.byCode.set(code, room);
    return room;
  }

  private freshCode(): string {
    let code: string;
    do {
      code = Array.from(
        { length: 4 },
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join("");
    } while (this.byCode.has(code));
    return code;
  }

  /** Campaign: create a brand-new persisted campaign and a room bound to it.
   *  The campaign's join code IS the room code, so it's reusable next session. */
  async createCampaign(name: string): Promise<Room> {
    if (this.rooms.size >= MAX_ROOMS) throw new Error("The parlor is at capacity right now — try again in a bit.");
    if (!this.storage) throw new Error("Campaigns need persistence, which isn't configured.");
    const module = getModule("campaign");
    if (!module) throw new Error("Campaign mode isn't available.");
    const code = this.freshCode();
    const campaign = await this.storage.createCampaign({ joinCode: code, name: name.slice(0, 40).trim() || "Untitled Campaign" });
    const room = this.build(module, code);
    room.campaignId = campaign.id;
    console.log(`[rooms] created campaign ${code} "${campaign.name}" — ${this.rooms.size} active`);
    return room;
  }

  /** Campaign: reopen an existing campaign by code. Reuses a live room if one
   *  is still up; otherwise rebuilds from the DB (heroes rehydrated by the
   *  module's setup/hydrate path). */
  async resumeCampaign(code: string): Promise<Room> {
    if (!this.storage) throw new Error("Campaigns need persistence, which isn't configured.");
    const norm = code.trim().toUpperCase();
    const live = this.byCode.get(norm);
    if (live && live.campaignId) return live;
    const campaign = await this.storage.getCampaignByCode(norm);
    if (!campaign) throw new Error("No campaign with that code.");
    if (this.rooms.size >= MAX_ROOMS) throw new Error("The parlor is at capacity right now — try again in a bit.");
    const module = getModule("campaign");
    if (!module) throw new Error("Campaign mode isn't available.");
    const room = this.build(module, campaign.joinCode);
    room.campaignId = campaign.id;
    console.log(`[rooms] resumed campaign ${campaign.joinCode} "${campaign.name}"`);
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
