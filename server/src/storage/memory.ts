import { randomUUID } from "node:crypto";
import {
  emptyLog,
  type AssetQuery,
  type AssetRow,
  type CampaignRow,
  type CharacterRow,
  type PlayerRow,
  type SnapshotRow,
  type Storage,
} from "./types.js";

/**
 * In-memory Storage — the default when no DATABASE_URL is set. Used by the
 * sim and offline tests, and behaves identically to PostgresStorage so a
 * green sim means the interface contract holds. State lives only for the
 * process lifetime.
 */
export class MemoryStorage implements Storage {
  readonly kind = "memory";
  private players = new Map<string, PlayerRow>();
  private campaigns = new Map<string, CampaignRow>();
  private byCode = new Map<string, string>();
  private characters = new Map<string, CharacterRow>(); // key: `${campaignId}:${playerKey}`
  private assets = new Map<string, AssetRow>();
  private snapshots = new Map<string, SnapshotRow>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async getOrCreatePlayer(playerKey: string, displayName?: string): Promise<PlayerRow> {
    let p = this.players.get(playerKey);
    if (!p) {
      p = { playerKey, displayName: displayName ?? null, createdAt: new Date().toISOString() };
      this.players.set(playerKey, p);
    } else if (displayName && displayName !== p.displayName) {
      p.displayName = displayName;
    }
    return { ...p };
  }

  async createCampaign(input: { joinCode: string; name: string; settings?: Record<string, unknown> }): Promise<CampaignRow> {
    const row: CampaignRow = {
      id: randomUUID(),
      joinCode: input.joinCode,
      name: input.name,
      settings: input.settings ?? {},
      chapterNum: 0,
      status: "active",
      campaignLog: emptyLog(),
      createdAt: new Date().toISOString(),
    };
    this.campaigns.set(row.id, row);
    this.byCode.set(input.joinCode.toUpperCase(), row.id);
    return structuredClone(row);
  }

  async getCampaignByCode(joinCode: string): Promise<CampaignRow | null> {
    const id = this.byCode.get(joinCode.toUpperCase());
    return id ? structuredClone(this.campaigns.get(id)!) : null;
  }

  async getCampaign(id: string): Promise<CampaignRow | null> {
    const c = this.campaigns.get(id);
    return c ? structuredClone(c) : null;
  }

  async saveCampaign(id: string, patch: Partial<CampaignRow>): Promise<void> {
    const c = this.campaigns.get(id);
    if (!c) return;
    Object.assign(c, structuredClone(patch));
  }

  async upsertCharacter(c: Omit<CharacterRow, "id"> & { id?: string }): Promise<CharacterRow> {
    const key = `${c.campaignId}:${c.playerKey}`;
    const existing = this.characters.get(key);
    const row: CharacterRow = { ...structuredClone(c), id: existing?.id ?? c.id ?? randomUUID() };
    this.characters.set(key, row);
    return structuredClone(row);
  }

  async listCharacters(campaignId: string): Promise<CharacterRow[]> {
    return [...this.characters.values()]
      .filter((c) => c.campaignId === campaignId)
      .map((c) => structuredClone(c));
  }

  async getCharacter(campaignId: string, playerKey: string): Promise<CharacterRow | null> {
    const c = this.characters.get(`${campaignId}:${playerKey}`);
    return c ? structuredClone(c) : null;
  }

  async findAsset(q: AssetQuery): Promise<AssetRow | null> {
    // deterministic-ish: prefer the least-used match so the shared library
    // doesn't ossify around one image (mirrors the postgres ORDER BY).
    const matches = [...this.assets.values()]
      .filter(
        (a) =>
          a.scope === q.scope &&
          a.kind === q.kind &&
          (!q.styleKey || a.styleKey === q.styleKey) &&
          q.tags.every((t) => a.tags.includes(t)),
      )
      .sort((a, b) => a.timesUsed - b.timesUsed);
    return matches.length ? cloneAsset(matches[0]) : null;
  }

  async saveAsset(a: Omit<AssetRow, "id" | "timesUsed"> & { id?: string }): Promise<AssetRow> {
    const row: AssetRow = { ...cloneAsset(a as AssetRow), id: a.id ?? randomUUID(), timesUsed: 0 };
    this.assets.set(row.id, row);
    return cloneAsset(row);
  }

  async touchAsset(id: string): Promise<void> {
    const a = this.assets.get(id);
    if (a) a.timesUsed += 1;
  }

  async saveSnapshot(s: Omit<SnapshotRow, "updatedAt">): Promise<void> {
    this.snapshots.set(s.campaignId, { ...structuredClone(s), updatedAt: new Date().toISOString() });
  }

  async loadSnapshot(campaignId: string): Promise<SnapshotRow | null> {
    const s = this.snapshots.get(campaignId);
    return s ? structuredClone(s) : null;
  }
}

/** structuredClone downgrades Buffer→Uint8Array; keep `image` a Buffer so the
 *  memory backend yields the same types Postgres bytea does. */
function cloneAsset(a: AssetRow): AssetRow {
  const image = a.image ? Buffer.from(a.image) : null;
  return { ...structuredClone({ ...a, image: null }), image };
}
