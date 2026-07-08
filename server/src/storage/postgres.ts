import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  emptyLog,
  type AssetQuery,
  type AssetRow,
  type CampaignRow,
  type CharacterRow,
  type PlayerRow,
  type PlayerStats,
  type SnapshotRow,
  type Storage,
} from "./types.js";

const SCHEMA_PATH = fileURLToPath(new URL("./schema.sql", import.meta.url));

/** Neon-backed Storage. Same contract as MemoryStorage — see types.ts. */
export class PostgresStorage implements Storage {
  readonly kind = "postgres";
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      // Neon requires TLS; the pooled host presents a valid cert.
      ssl: { rejectUnauthorized: false },
      max: 8,
    });
  }

  async init(): Promise<void> {
    const sql = await readFile(SCHEMA_PATH, "utf8");
    // simple-query protocol (no params) runs the whole batch in one round-trip
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getOrCreatePlayer(playerKey: string, displayName?: string): Promise<PlayerRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO players (player_key, display_name)
       VALUES ($1, $2)
       ON CONFLICT (player_key) DO UPDATE
         SET last_seen_at = now(),
             display_name = COALESCE(EXCLUDED.display_name, players.display_name)
       RETURNING player_key, display_name, created_at`,
      [playerKey, displayName ?? null],
    );
    return mapPlayer(rows[0]);
  }

  async linkAccount(playerKey: string, accountId: string): Promise<void> {
    await this.pool.query(`UPDATE players SET account_id = $2 WHERE player_key = $1`, [playerKey, accountId]);
  }

  async recordGameResult(playerKey: string, result: { won: boolean; points: number }): Promise<void> {
    const won = result.won ? 1 : 0;
    await this.pool.query(
      `INSERT INTO player_stats (player_key, games, wins, points, updated_at)
       VALUES ($1, 1, $2, $3, now())
       ON CONFLICT (player_key) DO UPDATE SET
         games = player_stats.games + 1,
         wins = player_stats.wins + $2,
         points = player_stats.points + $3,
         updated_at = now()`,
      [playerKey, won, result.points],
    );
  }

  async getStats(playerKey: string): Promise<PlayerStats | null> {
    const { rows } = await this.pool.query(
      `SELECT games, wins, points FROM player_stats WHERE player_key = $1`,
      [playerKey],
    );
    return rows[0] ? { games: rows[0].games, wins: rows[0].wins, points: rows[0].points } : null;
  }

  async createCampaign(input: { joinCode: string; name: string; settings?: Record<string, unknown> }): Promise<CampaignRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO campaigns (join_code, name, settings, campaign_log)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)
       RETURNING *`,
      [input.joinCode.toUpperCase(), input.name, JSON.stringify(input.settings ?? {}), JSON.stringify(emptyLog())],
    );
    return mapCampaign(rows[0]);
  }

  async getCampaignByCode(joinCode: string): Promise<CampaignRow | null> {
    const { rows } = await this.pool.query(`SELECT * FROM campaigns WHERE join_code = $1`, [joinCode.toUpperCase()]);
    return rows[0] ? mapCampaign(rows[0]) : null;
  }

  async getCampaign(id: string): Promise<CampaignRow | null> {
    const { rows } = await this.pool.query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
    return rows[0] ? mapCampaign(rows[0]) : null;
  }

  async saveCampaign(id: string, patch: Partial<CampaignRow>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.name !== undefined) { sets.push(`name = $${i++}`); vals.push(patch.name); }
    if (patch.settings !== undefined) { sets.push(`settings = $${i++}::jsonb`); vals.push(JSON.stringify(patch.settings)); }
    if (patch.chapterNum !== undefined) { sets.push(`chapter_num = $${i++}`); vals.push(patch.chapterNum); }
    if (patch.status !== undefined) { sets.push(`status = $${i++}`); vals.push(patch.status); }
    if (patch.campaignLog !== undefined) { sets.push(`campaign_log = $${i++}::jsonb`); vals.push(JSON.stringify(patch.campaignLog)); }
    if (!sets.length) return;
    sets.push(`updated_at = now()`);
    vals.push(id);
    await this.pool.query(`UPDATE campaigns SET ${sets.join(", ")} WHERE id = $${i}`, vals);
  }

  async upsertCharacter(c: Omit<CharacterRow, "id"> & { id?: string }): Promise<CharacterRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO characters
         (campaign_id, player_key, name, class, avatar, stats, hp, max_hp, level, abilities, inventory, quirks, portrait_asset_id)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13)
       ON CONFLICT (campaign_id, player_key) DO UPDATE SET
         name = EXCLUDED.name, class = EXCLUDED.class, avatar = EXCLUDED.avatar,
         stats = EXCLUDED.stats, hp = EXCLUDED.hp, max_hp = EXCLUDED.max_hp,
         level = EXCLUDED.level, abilities = EXCLUDED.abilities,
         inventory = EXCLUDED.inventory, quirks = EXCLUDED.quirks,
         portrait_asset_id = EXCLUDED.portrait_asset_id, updated_at = now()
       RETURNING *`,
      [
        c.campaignId, c.playerKey, c.name, c.cls, c.avatar,
        JSON.stringify(c.stats), c.hp, c.maxHp, c.level,
        JSON.stringify(c.abilities), JSON.stringify(c.inventory), JSON.stringify(c.quirks),
        c.portraitAssetId,
      ],
    );
    return mapCharacter(rows[0]);
  }

  async listCharacters(campaignId: string): Promise<CharacterRow[]> {
    const { rows } = await this.pool.query(`SELECT * FROM characters WHERE campaign_id = $1 ORDER BY created_at`, [campaignId]);
    return rows.map(mapCharacter);
  }

  async getCharacter(campaignId: string, playerKey: string): Promise<CharacterRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM characters WHERE campaign_id = $1 AND player_key = $2`,
      [campaignId, playerKey],
    );
    return rows[0] ? mapCharacter(rows[0]) : null;
  }

  async findAsset(q: AssetQuery): Promise<AssetRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM assets
       WHERE scope = $1 AND kind = $2 AND tags @> $3
         AND ($4::text IS NULL OR style_key = $4)
       ORDER BY times_used ASC, created_at ASC
       LIMIT 1`,
      [q.scope, q.kind, q.tags, q.styleKey ?? null],
    );
    return rows[0] ? mapAsset(rows[0]) : null;
  }

  async getAsset(id: string): Promise<AssetRow | null> {
    const { rows } = await this.pool.query(`SELECT * FROM assets WHERE id = $1`, [id]);
    return rows[0] ? mapAsset(rows[0]) : null;
  }

  async saveAsset(a: Omit<AssetRow, "id" | "timesUsed"> & { id?: string }): Promise<AssetRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO assets (scope, kind, tags, style_key, prompt, image, mime)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [a.scope, a.kind, a.tags, a.styleKey, a.prompt, a.image, a.mime],
    );
    return mapAsset(rows[0]);
  }

  async touchAsset(id: string): Promise<void> {
    await this.pool.query(`UPDATE assets SET times_used = times_used + 1 WHERE id = $1`, [id]);
  }

  async saveSnapshot(s: Omit<SnapshotRow, "updatedAt">): Promise<void> {
    await this.pool.query(
      `INSERT INTO snapshots (campaign_id, chapter, scene, state, updated_at)
       VALUES ($1,$2,$3,$4::jsonb, now())
       ON CONFLICT (campaign_id) DO UPDATE SET
         chapter = EXCLUDED.chapter, scene = EXCLUDED.scene,
         state = EXCLUDED.state, updated_at = now()`,
      [s.campaignId, s.chapter, s.scene, JSON.stringify(s.state)],
    );
  }

  async loadSnapshot(campaignId: string): Promise<SnapshotRow | null> {
    const { rows } = await this.pool.query(`SELECT * FROM snapshots WHERE campaign_id = $1`, [campaignId]);
    return rows[0] ? mapSnapshot(rows[0]) : null;
  }
}

// ── row mappers (snake_case → camelCase) ──
function mapPlayer(r: any): PlayerRow {
  return { playerKey: r.player_key, displayName: r.display_name, createdAt: iso(r.created_at) };
}
function mapCampaign(r: any): CampaignRow {
  return {
    id: r.id,
    joinCode: r.join_code,
    name: r.name,
    settings: r.settings ?? {},
    chapterNum: r.chapter_num,
    status: r.status,
    campaignLog: { ...emptyLog(), ...(r.campaign_log ?? {}) },
    createdAt: iso(r.created_at),
  };
}
function mapCharacter(r: any): CharacterRow {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    playerKey: r.player_key,
    name: r.name,
    cls: r.class,
    avatar: r.avatar,
    stats: r.stats ?? {},
    hp: r.hp,
    maxHp: r.max_hp,
    level: r.level,
    abilities: r.abilities ?? [],
    inventory: r.inventory ?? [],
    quirks: r.quirks ?? {},
    portraitAssetId: r.portrait_asset_id,
  };
}
function mapAsset(r: any): AssetRow {
  return {
    id: r.id,
    scope: r.scope,
    kind: r.kind,
    tags: r.tags ?? [],
    styleKey: r.style_key,
    prompt: r.prompt,
    image: r.image ?? null,
    mime: r.mime,
    timesUsed: r.times_used,
  };
}
function mapSnapshot(r: any): SnapshotRow {
  return { campaignId: r.campaign_id, chapter: r.chapter, scene: r.scene, state: r.state, updatedAt: iso(r.updated_at) };
}
function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
