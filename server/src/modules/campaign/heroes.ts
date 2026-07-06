import type { ServerPlayer } from "../../engine/room.js";

/**
 * Campaign hero definitions: the 4 stats, the 6 classes (with abilities), and
 * the mad-libs forge. Kept separate from index.ts so the combat engine can
 * import class/ability data without a circular dependency.
 */

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
  /** flat weapon/attack damage for a basic Attack */
  weaponDmg: number;
  abilities: Ability[];
}

export const CLASSES: ClassDef[] = [
  {
    id: "barbarian", label: "Barbarian", stat: "might", role: "striker", weaponDmg: 5,
    defaultStats: { might: 2, heart: 1, cunning: 0, arcana: -1 },
    abilities: [
      { id: "big_swing", label: "Big Swing", cd: 3, desc: "Hit two enemies in reach at once." },
      { id: "anger", label: "Unreasonable Anger", cd: 99, desc: "+2 damage for the rest of this encounter." },
    ],
  },
  {
    id: "knight", label: "Knight", stat: "might", role: "defender", weaponDmg: 4,
    defaultStats: { might: 2, heart: 1, arcana: 0, cunning: -1 },
    abilities: [
      { id: "intervene", label: "Intervene", cd: 2, desc: "Redirect the next hit aimed at an ally onto yourself." },
      { id: "shield_wall", label: "Shield Wall", cd: 3, desc: "Your front line takes -2 damage for a round." },
    ],
  },
  {
    id: "rogue", label: "Rogue", stat: "cunning", role: "skirmisher", weaponDmg: 4,
    defaultStats: { cunning: 2, might: 1, heart: 0, arcana: -1 },
    abilities: [
      { id: "vanish", label: "Vanish", cd: 3, desc: "Slip into the HIDDEN zone for free." },
      { id: "backstab", label: "Backstab", cd: 2, desc: "+4 damage from HIDDEN, then you're revealed." },
    ],
  },
  {
    id: "wizard", label: "Wizard", stat: "arcana", role: "blaster", weaponDmg: 3,
    defaultStats: { arcana: 2, cunning: 1, heart: 0, might: -1 },
    abilities: [
      { id: "firebolt", label: "Firebolt", cd: 0, desc: "A reliable ranged zap; ignores zone limits." },
      { id: "fireball", label: "Probably-Fireball", cd: 4, desc: "Hit a whole zone — friendly fire on a fumble." },
    ],
  },
  {
    id: "hedge_witch", label: "Hedge Witch", stat: "heart", role: "healer", weaponDmg: 3,
    defaultStats: { heart: 2, arcana: 1, cunning: 0, might: -1 },
    abilities: [
      { id: "brew", label: "Dubious Brew", cd: 2, desc: "Heal an ally — on a fumble it's a poison." },
      { id: "hex", label: "Hex", cd: 3, desc: "An enemy rolls at -2 for two rounds." },
    ],
  },
  {
    id: "bard", label: "Bard", stat: "heart", role: "support", weaponDmg: 3,
    defaultStats: { heart: 2, cunning: 1, might: 0, arcana: -1 },
    abilities: [
      { id: "inspire", label: "Inspire", cd: 2, desc: "An ally's next roll gets +3." },
      { id: "limerick", label: "Devastating Limerick", cd: 3, desc: "A HEART attack; the target also skips its move." },
    ],
  },
];

export const CLASS_BY_ID = new Map(CLASSES.map((c) => [c.id, c]));

/** deterministic avatar → default class, so a one-tap forge still matches the
 *  portrait the player picked in the lobby */
export function classForAvatar(avatar: string): ClassDef {
  const idx = Math.max(0, (parseInt(avatar.replace(/\D/g, ""), 10) || 1) - 1);
  return CLASSES[idx % CLASSES.length];
}

// ─── Mad-libs flavor pools ──────────────────────────────────────────────────

export const ADJECTIVES = [
  "Cowardly", "Overconfident", "Suspiciously Wet", "Perpetually Hungry",
  "Tragically Honest", "Mildly Cursed", "Unreasonably Calm", "Recently Resurrected",
  "Bad at Names", "Haunted by a Goose",
];
export const SIGNATURE_ITEMS = [
  "a cursed spoon", "a sentient map (rude)", "a very heavy rock",
  "a sword that only cuts vegetables", "a flask of questionable courage",
  "a single immortal houseplant", "a bag of teeth (not yours)", "a lute with one string",
];
export const BACKSTORIES = [
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
  /** generated portrait asset id (phase 6); null → use the stock class art */
  portraitAssetId?: string | null;
}

export function maxHpFor(might: number, level: number): number {
  return Math.max(6, 8 + 2 * might + 2 * level);
}

function isValidSpread(stats: Record<string, unknown>): stats is Record<Stat, number> {
  const vals = STATS.map((s) => stats[s]);
  if (vals.some((v) => typeof v !== "number")) return false;
  return [...(vals as number[])].sort((a, b) => a - b).join(",") === [...STAT_ARRAY].sort((a, b) => a - b).join(",");
}

export function buildHero(player: ServerPlayer, input: {
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
    portraitAssetId: null,
  };
}

/** m/f from avatar index, matching classForAvatar's portrait convention */
export function sexForAvatar(avatar: string): "male" | "female" {
  const idx = Math.max(0, (parseInt(avatar.replace(/\D/g, ""), 10) || 1) - 1);
  return idx % 2 === 0 ? "male" : "female";
}
