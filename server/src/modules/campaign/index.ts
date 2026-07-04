import type { PlayerAction } from "../../../../shared/src/index.js";
import type { Room, ServerPlayer } from "../../engine/room.js";
import type { GameModule } from "../../engine/types.js";

/**
 * CHAOS CAMPAIGN (module 4) — a persistent, AI-DM'd fantasy campaign played
 * across game nights. See CAMPAIGN_DESIGN.md for the full design.
 *
 * PHASE 2 scope (this file, so far): the campaign SHELL + HERO FORGE.
 *   lobby → forge → briefing
 * Heroes (4 stats, class, HP, abilities, mad-libs flavor) are built on phones
 * and persisted to the DB, so a campaign resumes with its party intact. The
 * rules engine (checks/combat) is phase 3; chapters are phase 4 — for now the
 * flow ends at a "briefing" that proves the roster round-trips through Neon.
 */

// ─── Heroes ───────────────────────────────────────────────────────────────────

export type Stat = "might" | "cunning" | "arcana" | "heart";
export const STATS: Stat[] = ["might", "cunning", "arcana", "heart"];
/** the assignable stat array — every hero is a permutation of these */
export const STAT_ARRAY = [2, 1, 0, -1];

export interface Ability {
  id: string;
  label: string;
  /** rounds between uses (0 = every turn, 99 = once per encounter) */
  cd: number;
  desc: string;
}

export interface ClassDef {
  id: string;
  label: string;
  stat: Stat;
  role: string;
  /** default stat spread (a permutation of STAT_ARRAY); signature stat = +2 */
  defaultStats: Record<Stat, number>;
  abilities: Ability[];
  /** avatars this class prefers (portrait reuse from the dungeon art set) */
}

export const CLASSES: ClassDef[] = [
  {
    id: "barbarian", label: "Barbarian", stat: "might", role: "striker",
    defaultStats: { might: 2, heart: 1, cunning: 0, arcana: -1 },
    abilities: [
      { id: "big_swing", label: "Big Swing", cd: 3, desc: "Hit two enemies in reach at once." },
      { id: "anger", label: "Unreasonable Anger", cd: 99, desc: "+2 damage for the rest of this encounter." },
    ],
  },
  {
    id: "knight", label: "Knight", stat: "might", role: "defender",
    defaultStats: { might: 2, heart: 1, arcana: 0, cunning: -1 },
    abilities: [
      { id: "intervene", label: "Intervene", cd: 2, desc: "Redirect a hit aimed at an ally onto yourself." },
      { id: "shield_wall", label: "Shield Wall", cd: 3, desc: "Your front line takes -2 damage for a round." },
    ],
  },
  {
    id: "rogue", label: "Rogue", stat: "cunning", role: "skirmisher",
    defaultStats: { cunning: 2, might: 1, heart: 0, arcana: -1 },
    abilities: [
      { id: "vanish", label: "Vanish", cd: 3, desc: "Slip into the HIDDEN zone for free." },
      { id: "backstab", label: "Backstab", cd: 2, desc: "+4 damage from HIDDEN, then you're revealed." },
    ],
  },
  {
    id: "wizard", label: "Wizard", stat: "arcana", role: "blaster",
    defaultStats: { arcana: 2, cunning: 1, heart: 0, might: -1 },
    abilities: [
      { id: "firebolt", label: "Firebolt", cd: 0, desc: "A reliable ranged zap; ignores zone limits." },
      { id: "fireball", label: "Probably-Fireball", cd: 4, desc: "Hit a whole zone — friendly fire on a fumble." },
    ],
  },
  {
    id: "hedge_witch", label: "Hedge Witch", stat: "heart", role: "healer",
    defaultStats: { heart: 2, arcana: 1, cunning: 0, might: -1 },
    abilities: [
      { id: "brew", label: "Dubious Brew", cd: 2, desc: "Heal an ally 2d4 — on a nat 1 it's a poison." },
      { id: "hex", label: "Hex", cd: 3, desc: "An enemy rolls at -2 for two rounds." },
    ],
  },
  {
    id: "bard", label: "Bard", stat: "heart", role: "support",
    defaultStats: { heart: 2, cunning: 1, might: 0, arcana: -1 },
    abilities: [
      { id: "inspire", label: "Inspire", cd: 2, desc: "An ally's next roll gets +3." },
      { id: "limerick", label: "Devastating Limerick", cd: 3, desc: "A HEART attack; the target also skips its move." },
    ],
  },
];

const CLASS_BY_ID = new Map(CLASSES.map((c) => [c.id, c]));

/** deterministic avatar → default class, so a hero forged with one tap still
 *  matches the portrait the player picked in the lobby */
export function classForAvatar(avatar: string): ClassDef {
  const idx = Math.max(0, (parseInt(avatar.replace(/\D/g, ""), 10) || 1) - 1);
  return CLASSES[idx % CLASSES.length];
}

// ─── Mad-libs flavor pools ──────────────────────────────────────────────────

const ADJECTIVES = [
  "Cowardly", "Overconfident", "Suspiciously Wet", "Perpetually Hungry",
  "Tragically Honest", "Mildly Cursed", "Unreasonably Calm", "Recently Resurrected",
  "Bad at Names", "Haunted by a Goose",
];
const SIGNATURE_ITEMS = [
  "a cursed spoon", "a sentient map (rude)", "a very heavy rock",
  "a sword that only cuts vegetables", "a flask of questionable courage",
  "a single immortal houseplant", "a bag of teeth (not yours)", "a lute with one string",
];
const BACKSTORIES = [
  "I'm only here because I owe someone a great deal of money.",
  "I seek glory, fortune, and ideally a nap.",
  "Someone told me there'd be snacks.",
  "I am legally required to complete one (1) heroic deed.",
  "Revenge. Against whom, I've forgotten.",
];

function pick<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Hero shape (lives on player.data.hero and in the DB) ───────────────────

export interface Hero {
  name: string;
  cls: string;
  avatar: string;
  stats: Record<Stat, number>;
  hp: number;
  maxHp: number;
  level: number;
  abilities: Ability[];
  inventory: unknown[];
  quirks: { adjective: string; item: string; backstory: string };
}

export function maxHpFor(might: number, level: number): number {
  return Math.max(6, 8 + 2 * might + 2 * level);
}

function isValidSpread(stats: Record<string, unknown>): stats is Record<Stat, number> {
  const vals = STATS.map((s) => stats[s]);
  if (vals.some((v) => typeof v !== "number")) return false;
  return [...(vals as number[])].sort((a, b) => a - b).join(",") === [...STAT_ARRAY].sort((a, b) => a - b).join(",");
}

function buildHero(player: ServerPlayer, input: {
  cls?: string; stats?: Record<string, number>; adjective?: string; item?: string; backstory?: string;
}): Hero {
  const cls = (input.cls && CLASS_BY_ID.get(input.cls)) || classForAvatar(player.avatar);
  const stats = input.stats && isValidSpread(input.stats) ? { ...(input.stats as Record<Stat, number>) } : { ...cls.defaultStats };
  const level = 1;
  const maxHp = maxHpFor(stats.might, level);
  return {
    name: player.name,
    cls: cls.id,
    avatar: player.avatar,
    stats,
    hp: maxHp,
    maxHp,
    level,
    abilities: cls.abilities,
    inventory: [],
    quirks: {
      adjective: input.adjective && ADJECTIVES.includes(input.adjective) ? input.adjective : pick(ADJECTIVES),
      item: input.item && SIGNATURE_ITEMS.includes(input.item) ? input.item : pick(SIGNATURE_ITEMS),
      backstory: input.backstory && BACKSTORIES.includes(input.backstory) ? input.backstory : pick(BACKSTORIES),
    },
  };
}

// ─── Module state ───────────────────────────────────────────────────────────

interface CampaignState {
  name: string;
  chapterNum: number;
  /** heroes loaded from the DB on resume, keyed by playerKey (may not yet be
   *  claimed by a connected player) */
  roster: Record<string, Hero>;
  forgeDeadline: number | null;
  hydrated: boolean;
}

function C(room: Room): CampaignState {
  if (!room.state.campaign) {
    room.state.campaign = { name: "Campaign", chapterNum: 0, roster: {}, forgeDeadline: null, hydrated: false } satisfies CampaignState;
  }
  return room.state.campaign as CampaignState;
}

const FORGE_MS = 90_000;

/** attach a persisted hero to a joining player (called from the join handler) */
export function attachHero(room: Room, player: ServerPlayer): void {
  if (room.module.id !== "campaign" || !player.playerKey) return;
  const hero = C(room).roster[player.playerKey];
  if (hero) {
    player.data.hero = hero;
    player.done = true;
  }
}

// ─── The module ─────────────────────────────────────────────────────────────

export const campaign: GameModule = {
  id: "campaign",
  name: "Chaos Campaign",
  tagline: "A saga you build together, one night at a time.",
  minPlayers: 2,
  maxPlayers: 6,
  persona:
    "You are the Dungeon Master of an ongoing comedic-heroic fantasy campaign — grand but never self-serious, quick to reincorporate the party's past disasters. You remember these heroes across chapters.",
  voiceStyle:
    "a warm, theatrical storyteller's voice: measured and rich, with a sly wink under the grandeur, like a favorite GM who has been running this table for years",

  setup(room: Room): void {
    const s = C(room);
    // load persisted campaign + roster, then either skip to briefing (resume)
    // or open the forge (new party).
    void hydrate(room).then(() => {
      const heroesExist = Object.keys(s.roster).length > 0;
      // claim any already-connected players' heroes
      for (const p of room.players.values()) attachHero(room, p);
      if (heroesExist) {
        openBriefing(room, true);
      } else {
        room.setPhase("forge");
        s.forgeDeadline = Date.now() + FORGE_MS;
        room.setTimer("forge", FORGE_MS);
        room.broadcast();
      }
    });
  },

  onAction(room: Room, playerId: string, action: PlayerAction): void {
    const player = room.players.get(playerId);
    if (!player) return;
    if (room.phase === "forge" && action.kind === "forge_submit") {
      player.data.hero = buildHero(player, {
        cls: typeof action.cls === "string" ? action.cls : undefined,
        stats: (action.stats as Record<string, number>) ?? undefined,
        adjective: typeof action.adjective === "string" ? action.adjective : undefined,
        item: typeof action.item === "string" ? action.item : undefined,
        backstory: typeof action.backstory === "string" ? action.backstory : undefined,
      });
      player.done = true;
      room.broadcast();
      if (allForged(room)) void finalizeForge(room);
    }
  },

  onTimer(room: Room, label: string): void {
    if (label === "forge" && room.phase === "forge") {
      // auto-forge anyone who dawdled (default class from their avatar)
      for (const p of room.players.values()) {
        if (!p.data.hero) {
          p.data.hero = buildHero(p, {});
          p.done = true;
        }
      }
      void finalizeForge(room);
    }
  },

  publicState(room: Room): unknown {
    const s = C(room);
    return {
      name: s.name,
      chapterNum: s.chapterNum,
      phase: room.phase,
      forgeDeadline: s.forgeDeadline,
      party: [...room.players.values()].map((p) => heroCard(p)),
      // heroes from a prior session not yet reclaimed this session
      awaiting: Object.entries(s.roster)
        .filter(([key]) => ![...room.players.values()].some((p) => p.playerKey === key))
        .map(([, h]) => ({ name: h.name, cls: h.cls, level: h.level })),
    };
  },

  privateState(room: Room, playerId: string): unknown {
    const player = room.players.get(playerId);
    const hero = (player?.data.hero as Hero | undefined) ?? null;
    return {
      id: playerId,
      phase: room.phase,
      hero,
      forge:
        room.phase === "forge" && !hero
          ? {
              classes: CLASSES.map((c) => ({ id: c.id, label: c.label, stat: c.stat, role: c.role, defaultStats: c.defaultStats, abilities: c.abilities })),
              statArray: STAT_ARRAY,
              suggestedClass: classForAvatar(player?.avatar ?? "p01").id,
              adjectives: ADJECTIVES,
              items: SIGNATURE_ITEMS,
              backstories: BACKSTORIES,
            }
          : null,
    };
  },

  buildContext(room: Room): string {
    const s = C(room);
    const party = [...room.players.values()]
      .map((p) => p.data.hero as Hero | undefined)
      .filter((h): h is Hero => !!h)
      .map((h) => `${h.name} the ${h.quirks.adjective} ${CLASS_BY_ID.get(h.cls)?.label ?? h.cls} (lvl ${h.level}, carries ${h.quirks.item})`);
    return [
      `CAMPAIGN: "${s.name}" — chapter ${s.chapterNum + 1}.`,
      party.length ? `THE PARTY:\n${party.map((l) => `- ${l}`).join("\n")}` : "The party is still being forged.",
    ].join("\n");
  },

  canned(beatId: string): { text: string; mood?: string }[] {
    if (beatId === "briefing") {
      return [
        { text: "The party is assembled. Steel yourselves, heroes — your saga begins.", mood: "grand" },
      ];
    }
    return [{ text: "…", mood: "flat" }];
  },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function heroCard(p: ServerPlayer): unknown {
  const h = p.data.hero as Hero | undefined;
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    connected: p.connected,
    ready: !!h,
    cls: h?.cls ?? null,
    level: h?.level ?? null,
    hp: h?.hp ?? null,
    maxHp: h?.maxHp ?? null,
    stats: h?.stats ?? null,
    quirks: h?.quirks ?? null,
  };
}

function allForged(room: Room): boolean {
  const connected = [...room.players.values()].filter((p) => p.connected);
  return connected.length > 0 && connected.every((p) => !!p.data.hero);
}

/** load campaign row + persisted characters into module state */
async function hydrate(room: Room): Promise<void> {
  const s = C(room);
  if (s.hydrated) return;
  s.hydrated = true;
  if (!room.storage || !room.campaignId) return;
  try {
    const camp = await room.storage.getCampaign(room.campaignId);
    if (camp) {
      s.name = camp.name;
      s.chapterNum = camp.chapterNum;
    }
    const chars = await room.storage.listCharacters(room.campaignId);
    for (const c of chars) {
      s.roster[c.playerKey] = {
        name: c.name,
        cls: c.cls,
        avatar: c.avatar,
        stats: c.stats as Record<Stat, number>,
        hp: c.hp,
        maxHp: c.maxHp,
        level: c.level,
        abilities: c.abilities as Ability[],
        inventory: c.inventory,
        quirks: c.quirks as Hero["quirks"],
      };
    }
  } catch (err) {
    console.error(`[campaign:${room.code}] hydrate failed:`, err);
  }
}

/** persist every forged hero, then move to the briefing */
async function finalizeForge(room: Room): Promise<void> {
  if (room.phase !== "forge") return;
  room.clearTimer();
  const s = C(room);
  s.forgeDeadline = null;
  if (room.storage && room.campaignId) {
    for (const p of room.players.values()) {
      const h = p.data.hero as Hero | undefined;
      if (!h || !p.playerKey) continue;
      try {
        await room.storage.upsertCharacter({
          campaignId: room.campaignId,
          playerKey: p.playerKey,
          name: h.name,
          cls: h.cls,
          avatar: h.avatar,
          stats: h.stats,
          hp: h.hp,
          maxHp: h.maxHp,
          level: h.level,
          abilities: h.abilities,
          inventory: h.inventory,
          quirks: h.quirks,
          portraitAssetId: null,
        });
        s.roster[p.playerKey] = h;
      } catch (err) {
        console.error(`[campaign:${room.code}] persist hero ${h.name} failed:`, err);
      }
    }
  }
  openBriefing(room, false);
}

function openBriefing(room: Room, resumed: boolean): void {
  room.setPhase("briefing");
  room.broadcast();
  room.play({
    id: "briefing",
    instruction: resumed
      ? `Welcome the party back for chapter ${C(room).chapterNum + 1} of "${C(room).name}". One or two sentences, warm and grand, hinting the story continues.`
      : `The heroes have just been forged. In one or two sentences, welcome this new party to the campaign "${C(room).name}" and promise adventure.`,
  });
}
