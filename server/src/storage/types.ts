/**
 * Storage — persistence boundary for the Campaign module (and, later, other
 * modules' snapshots). Two implementations: `PostgresStorage` (Neon) and
 * `MemoryStorage` (the sim + offline tests). NOTHING outside this folder
 * touches SQL; modules speak only this interface.
 *
 * v1 identity is "auth-lite": a `player_key` UUID minted in the phone's
 * localStorage IS the identity — no passwords. A future Neon Auth pass
 * attaches real accounts to the same `players` row.
 */

export interface PlayerRow {
  playerKey: string;
  displayName: string | null;
  createdAt: string;
}

/** Career stats, keyed on the device player_key (guests included). */
export interface PlayerStats {
  games: number;
  wins: number;
  points: number;
}

export interface CampaignRow {
  id: string;
  joinCode: string;
  name: string;
  settings: Record<string, unknown>;
  chapterNum: number;
  status: "active" | "completed" | "abandoned";
  /** compacted running memory the Director sees (summaries, threads, moments) */
  campaignLog: CampaignLog;
  createdAt: string;
}

export interface CampaignLog {
  /** one-paragraph summary per finished chapter, oldest first */
  chapters: { n: number; summary: string }[];
  /** unresolved promises / enemies / debts the next chapter must honor */
  openThreads: string[];
  /** per-hero running gags, keyed by playerKey */
  heroMoments: Record<string, string[]>;
  /** party choices recorded at forks, so later chapters can honor them */
  choices: { chapter: number; prompt: string; outcome: string }[];
}

export function emptyLog(): CampaignLog {
  return { chapters: [], openThreads: [], heroMoments: {}, choices: [] };
}

export interface CharacterRow {
  id: string;
  campaignId: string;
  playerKey: string;
  name: string;
  cls: string;
  avatar: string;
  stats: Record<string, number>;
  hp: number;
  maxHp: number;
  level: number;
  abilities: unknown[];
  inventory: unknown[];
  quirks: Record<string, unknown>;
  portraitAssetId: string | null;
}

export type AssetKind = "portrait" | "enemy" | "boss" | "scene" | "item";

export interface AssetRow {
  id: string;
  /** "shared" for the cross-campaign library, or a campaignId for private art */
  scope: string;
  kind: AssetKind;
  tags: string[];
  styleKey: string;
  prompt: string;
  image: Buffer | null;
  mime: string;
  timesUsed: number;
}

export interface AssetQuery {
  scope: string;
  kind: AssetKind;
  /** an asset matches if it carries ALL of these tags (superset ok) */
  tags: string[];
  styleKey?: string;
}

export interface SnapshotRow {
  campaignId: string;
  chapter: number;
  scene: string;
  state: unknown;
  updatedAt: string;
}

export interface Storage {
  readonly kind: string;

  /** call once at boot; postgres runs migrations, memory is a no-op */
  init(): Promise<void>;
  close(): Promise<void>;

  // ── players ──
  getOrCreatePlayer(playerKey: string, displayName?: string): Promise<PlayerRow>;
  /** Link a device player_key to an authenticated account. Additive; identity
   *  stays the player_key. Safe to call repeatedly (idempotent per key). */
  linkAccount(playerKey: string, accountId: string): Promise<void>;

  // ── career stats (keyed on player_key) ──
  /** Fold one finished game into the player's running stats (games+1 always). */
  recordGameResult(playerKey: string, result: { won: boolean; points: number }): Promise<void>;
  getStats(playerKey: string): Promise<PlayerStats | null>;

  // ── campaigns ──
  createCampaign(input: { joinCode: string; name: string; settings?: Record<string, unknown> }): Promise<CampaignRow>;
  getCampaignByCode(joinCode: string): Promise<CampaignRow | null>;
  getCampaign(id: string): Promise<CampaignRow | null>;
  saveCampaign(id: string, patch: Partial<Pick<CampaignRow, "name" | "settings" | "chapterNum" | "status" | "campaignLog">>): Promise<void>;

  // ── characters ──
  upsertCharacter(c: Omit<CharacterRow, "id"> & { id?: string }): Promise<CharacterRow>;
  listCharacters(campaignId: string): Promise<CharacterRow[]>;
  getCharacter(campaignId: string, playerKey: string): Promise<CharacterRow | null>;

  // ── tagged asset library (phase 6) ──
  findAsset(q: AssetQuery): Promise<AssetRow | null>;
  getAsset(id: string): Promise<AssetRow | null>;
  saveAsset(a: Omit<AssetRow, "id" | "timesUsed"> & { id?: string }): Promise<AssetRow>;
  touchAsset(id: string): Promise<void>;

  // ── snapshots (phase 7) ──
  saveSnapshot(s: Omit<SnapshotRow, "updatedAt">): Promise<void>;
  loadSnapshot(campaignId: string): Promise<SnapshotRow | null>;
}
