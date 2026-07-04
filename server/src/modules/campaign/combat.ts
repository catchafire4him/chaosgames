import type { Room, ServerPlayer } from "../../engine/room.js";
import { CLASS_BY_ID, type Hero, type Stat } from "./heroes.js";

/**
 * Campaign combat — zone-based, initiative-ordered, server-authoritative.
 * The DM (Director) only narrates; every die and hit is resolved here.
 *
 * GRID-READY CONTRACT: positions are `{ zone, slot }` and NO rule references
 * anything finer than a zone, so a v2 tile renderer can map zones→regions
 * without touching these rules.
 */

// ─── Zones ────────────────────────────────────────────────────────────────
export type ZoneId = "enemy_back" | "enemy_front" | "party_front" | "party_back" | "hidden";
/** the ordered battle strip; HIDDEN sits off-strip beside the party */
const STRIP: ZoneId[] = ["enemy_back", "enemy_front", "party_front", "party_back"];

function adjacent(a: ZoneId, b: ZoneId): boolean {
  if (a === b) return true;
  // HIDDEN flanks the party line
  if (a === "hidden") return b === "party_front" || b === "party_back";
  if (b === "hidden") return a === "party_front" || a === "party_back";
  const i = STRIP.indexOf(a);
  const j = STRIP.indexOf(b);
  return i >= 0 && j >= 0 && Math.abs(i - j) === 1;
}

/** step one zone from `from` toward `to` along the strip (ignores HIDDEN) */
function stepToward(from: ZoneId, to: ZoneId): ZoneId {
  const i = STRIP.indexOf(from === "hidden" ? "party_front" : from);
  const j = STRIP.indexOf(to === "hidden" ? "party_front" : to);
  if (i < 0 || j < 0 || i === j) return from;
  return STRIP[i + (j > i ? 1 : -1)];
}

// ─── Dice / checks ──────────────────────────────────────────────────────────
export interface Roll { d20: number; total: number; crit: "nat20" | "nat1" | null }

function d20(): number {
  return 1 + Math.floor(Math.random() * 20);
}
function roll(mod: number): Roll {
  const n = d20();
  return { d20: n, total: n + mod, crit: n === 20 ? "nat20" : n === 1 ? "nat1" : null };
}

export const DC = { easy: 8, tricky: 12, hard: 16, heroic: 20 } as const;
export type Difficulty = keyof typeof DC;

/** Out-of-combat skill check (phase 4 uses this from scene beats). */
export function skillCheck(statValue: number, difficulty: Difficulty): { roll: Roll; success: boolean } {
  const r = roll(statValue);
  const success = r.crit === "nat20" ? true : r.crit === "nat1" ? false : r.total >= DC[difficulty];
  return { roll: r, success };
}

// ─── Enemy templates ────────────────────────────────────────────────────────
type EnemyKind = "minion" | "bruiser" | "caster" | "lurker" | "boss";
interface Template { hp: number; def: number; atk: number; dmg: number; ranged: boolean; start: ZoneId }
const TEMPLATES: Record<EnemyKind, Template> = {
  minion: { hp: 6, def: 11, atk: 2, dmg: 3, ranged: false, start: "enemy_front" },
  bruiser: { hp: 16, def: 12, atk: 4, dmg: 6, ranged: false, start: "enemy_front" },
  caster: { hp: 10, def: 11, atk: 5, dmg: 5, ranged: true, start: "enemy_back" },
  lurker: { hp: 8, def: 13, atk: 4, dmg: 5, ranged: false, start: "enemy_front" },
  boss: { hp: 30, def: 14, atk: 6, dmg: 7, ranged: true, start: "enemy_back" },
};

export interface EnemySpec { kind: EnemyKind; name: string }

interface Enemy {
  id: string;
  kind: EnemyKind;
  name: string;
  hp: number;
  maxHp: number;
  def: number;
  atk: number;
  dmg: number;
  ranged: boolean;
  zone: ZoneId;
  hexTurns: number;
  skipMove: boolean;
  alive: boolean;
}

// ─── Combat state ───────────────────────────────────────────────────────────
interface Combatant {
  ref: "hero" | "enemy";
  id: string;
  init: number;
}
interface HeroCombat {
  zone: ZoneId;
  defending: boolean;
  shieldWall: number; // rounds of +2 DEF remaining
  extraDmg: number; // Unreasonable Anger etc.
  helpBonus: number; // pending +N on next roll (Help / Inspire)
  intervening: boolean; // Knight redirect armed
  hidden: boolean;
  cooldowns: Record<string, number>;
  downed: boolean;
}
export interface CombatState {
  status: "active" | "won" | "lost";
  round: number;
  order: Combatant[];
  turnIndex: number;
  activeHeroId: string | null;
  enemies: Enemy[];
  heroes: Record<string, HeroCombat>; // by playerId
  log: string[];
  title: string;
}

const HERO_DEF_BASE = 12;
const TURN_MS = 40_000;

function S(room: Room): CombatState {
  return room.state.combat as CombatState;
}
function heroOf(room: Room, id: string): Hero | undefined {
  return room.players.get(id)?.data.hero as Hero | undefined;
}
function livingHeroes(room: Room): ServerPlayer[] {
  const c = S(room);
  return [...room.players.values()].filter((p) => p.data.hero && !c.heroes[p.id]?.downed);
}
function livingEnemies(room: Room): Enemy[] {
  return S(room).enemies.filter((e) => e.alive);
}
function log(room: Room, line: string): void {
  const c = S(room);
  c.log.push(line);
  if (c.log.length > 30) c.log.shift();
}

// ─── Encounter lifecycle ────────────────────────────────────────────────────

/** scale template numbers to party level + size (keeps fights winnable) */
function scale(t: Template, partySize: number, avgLevel: number): Template {
  const f = 1 + 0.12 * Math.max(0, partySize - 2) + 0.1 * Math.max(0, avgLevel - 1);
  return { ...t, hp: Math.round(t.hp * f), dmg: Math.max(1, Math.round(t.dmg * (1 + 0.05 * (avgLevel - 1)))) };
}

export function startEncounter(room: Room, title: string, specs: EnemySpec[]): void {
  const heroes = [...room.players.values()].filter((p) => p.data.hero);
  const partySize = heroes.length;
  const avgLevel = Math.max(1, Math.round(heroes.reduce((s, p) => s + (p.data.hero as Hero).level, 0) / Math.max(1, partySize)));

  const enemies: Enemy[] = specs.map((sp, i) => {
    const t = scale(TEMPLATES[sp.kind], partySize, avgLevel);
    return {
      id: `e${i}`, kind: sp.kind, name: sp.name,
      hp: t.hp, maxHp: t.hp, def: t.def, atk: t.atk, dmg: t.dmg, ranged: t.ranged,
      zone: t.start, hexTurns: 0, skipMove: false, alive: true,
    };
  });

  const heroCombat: Record<string, HeroCombat> = {};
  heroes.forEach((p, i) => {
    heroCombat[p.id] = {
      zone: i % 2 === 0 ? "party_front" : "party_back",
      defending: false, shieldWall: 0, extraDmg: 0, helpBonus: 0,
      intervening: false, hidden: false, cooldowns: {}, downed: false,
    };
  });

  // initiative: heroes d20+CUNNING, enemies d20+2
  const order: Combatant[] = [
    ...heroes.map((p) => ({ ref: "hero" as const, id: p.id, init: roll((p.data.hero as Hero).stats.cunning).total })),
    ...enemies.map((e) => ({ ref: "enemy" as const, id: e.id, init: roll(2).total })),
  ].sort((a, b) => b.init - a.init || (Math.random() < 0.5 ? -1 : 1));

  room.state.combat = {
    status: "active", round: 1, order, turnIndex: -1, activeHeroId: null,
    enemies, heroes: heroCombat, log: [], title,
  } satisfies CombatState;

  room.setPhase("encounter");
  log(room, `A fight breaks out: ${title}.`);
  advanceTurn(room);
}

// ─── Turn loop ──────────────────────────────────────────────────────────────

function advanceTurn(room: Room): void {
  const c = S(room);
  if (c.status !== "active") return;

  // win / loss checks
  if (livingEnemies(room).length === 0) return finish(room, "won");
  if (livingHeroes(room).length === 0) return finish(room, "lost");

  // find the next living combatant; process enemies inline, stop on a hero
  for (let guard = 0; guard < c.order.length * 2 + 2; guard++) {
    c.turnIndex++;
    if (c.turnIndex >= c.order.length) {
      c.turnIndex = 0;
      c.round++;
      startRound(room);
    }
    const slot = c.order[c.turnIndex];
    if (slot.ref === "enemy") {
      const e = c.enemies.find((x) => x.id === slot.id);
      if (!e || !e.alive) continue;
      resolveEnemyTurn(room, e);
      if (c.status !== "active") return;
      if (livingHeroes(room).length === 0) return finish(room, "lost");
      continue;
    }
    // hero
    const hc = c.heroes[slot.id];
    if (!hc || hc.downed) continue;
    beginHeroTurn(room, slot.id);
    return;
  }
  // safety: nobody could act
  advanceTurnAsync(room);
}

/** small async hop to avoid deep recursion across long enemy chains */
function advanceTurnAsync(room: Room): void {
  setTimeout(() => advanceTurn(room), 0);
}

function startRound(room: Room): void {
  const c = S(room);
  for (const e of c.enemies) if (e.hexTurns > 0) e.hexTurns--;
  for (const hc of Object.values(c.heroes)) if (hc.shieldWall > 0) hc.shieldWall--;
  log(room, `— Round ${c.round} —`);
}

function beginHeroTurn(room: Room, playerId: string): void {
  const c = S(room);
  const hc = c.heroes[playerId];
  hc.defending = false; // defence lasts until your next turn
  for (const k of Object.keys(hc.cooldowns)) if (hc.cooldowns[k] > 0) hc.cooldowns[k]--;
  c.activeHeroId = playerId;
  room.setTimer("combat_turn", TURN_MS);
  room.broadcast();
}

// ─── Hero DEF ───────────────────────────────────────────────────────────────
function heroDef(room: Room, playerId: string): number {
  const hc = S(room).heroes[playerId];
  return HERO_DEF_BASE + (hc.defending ? 3 : 0) + (hc.shieldWall > 0 ? 2 : 0);
}

// ─── Hero actions (from the phone) ───────────────────────────────────────────

export function heroAction(room: Room, playerId: string, a: Record<string, unknown>): void {
  const c = S(room);
  if (c.status !== "active" || c.activeHeroId !== playerId) return;
  const hero = heroOf(room, playerId);
  const hc = c.heroes[playerId];
  if (!hero || !hc || hc.downed) return;

  // optional move first
  const moveZone = a.moveZone as ZoneId | undefined;
  if (moveZone && moveZone !== hc.zone) {
    if (moveZone === "hidden") {
      // only via Vanish (handled in ability); ignore a raw move to hidden
    } else if (adjacent(hc.zone, moveZone) && (moveZone === "party_front" || moveZone === "party_back" || moveZone === "enemy_front")) {
      hc.zone = moveZone;
      hc.hidden = false;
    }
  }

  const kind = String(a.action ?? "defend");
  switch (kind) {
    case "attack": basicAttack(room, playerId, String(a.targetId ?? "")); break;
    case "ability": useAbility(room, playerId, String(a.abilityId ?? ""), a); break;
    case "help": doHelp(room, playerId, String(a.targetId ?? "")); break;
    case "defend":
    default:
      hc.defending = true;
      log(room, `${hero.name} braces for impact.`);
      break;
  }

  room.clearTimer();
  c.activeHeroId = null;
  room.broadcast();
  advanceTurn(room);
}

/** turn timer expired — the hero defends automatically so nothing stalls */
export function onTurnTimeout(room: Room): void {
  const c = S(room);
  if (c.status !== "active" || !c.activeHeroId) return;
  const id = c.activeHeroId;
  const hero = heroOf(room, id);
  if (c.heroes[id]) c.heroes[id].defending = true;
  if (hero) log(room, `${hero.name} hesitates, and guards instead.`);
  c.activeHeroId = null;
  advanceTurn(room);
}

function consumeRollBonus(hc: HeroCombat): number {
  const b = hc.helpBonus;
  hc.helpBonus = 0;
  return b;
}

function basicAttack(room: Room, playerId: string, targetId: string): void {
  const hero = heroOf(room, playerId)!;
  const cls = CLASS_BY_ID.get(hero.cls);
  const hc = S(room).heroes[playerId];
  const enemy = S(room).enemies.find((e) => e.id === targetId && e.alive) ?? nearestEnemy(room, hc.zone);
  if (!enemy) return;
  const ranged = false; // basic attack is melee
  if (!ranged && !adjacent(hc.zone, enemy.zone)) {
    // shuffle one step toward them and jab if now in reach
    hc.zone = stepToward(hc.zone, enemy.zone);
    if (!adjacent(hc.zone, enemy.zone)) {
      log(room, `${hero.name} closes in on ${enemy.name}.`);
      return;
    }
  }
  const stat = cls?.stat ?? "might";
  attackRoll(room, playerId, enemy, hero.stats[stat], (cls?.weaponDmg ?? 3) + hc.extraDmg, `${hero.name} strikes`);
  if (hc.hidden) { hc.hidden = false; hc.zone = "party_front"; } // attacking reveals
}

/** shared attack resolution: hero stat/dmg vs enemy DEF */
function attackRoll(room: Room, playerId: string, enemy: Enemy, statMod: number, dmg: number, verb: string): void {
  const hc = S(room).heroes[playerId];
  const r = roll(statMod + consumeRollBonus(hc));
  if (r.crit === "nat1") { log(room, `${verb} at ${enemy.name} and whiffs spectacularly.`); return; }
  const hit = r.crit === "nat20" || r.total >= enemy.def;
  if (!hit) { log(room, `${verb} at ${enemy.name} but glances off (${r.total} vs DEF ${enemy.def}).`); return; }
  const dealt = r.crit === "nat20" ? dmg * 2 : dmg;
  enemy.hp -= dealt;
  log(room, `${verb} ${enemy.name} for ${dealt}${r.crit === "nat20" ? " — CRITICAL!" : ""}.`);
  room.sfx("hit");
  if (enemy.hp <= 0) { enemy.alive = false; log(room, `${enemy.name} is defeated!`); }
}

function doHelp(room: Room, playerId: string, targetId: string): void {
  const hero = heroOf(room, playerId)!;
  const t = S(room).heroes[targetId];
  if (t && !t.downed) { t.helpBonus += 2; log(room, `${hero.name} lends ${room.name(targetId)} an opening (+2).`); }
  else log(room, `${hero.name} looks around for someone to help.`);
}

// ─── Abilities (the 12) ───────────────────────────────────────────────────────

function useAbility(room: Room, playerId: string, abilityId: string, a: Record<string, unknown>): void {
  const c = S(room);
  const hero = heroOf(room, playerId)!;
  const cls = CLASS_BY_ID.get(hero.cls);
  const hc = c.heroes[playerId];
  const ability = cls?.abilities.find((x) => x.id === abilityId);
  if (!ability) { hc.defending = true; return; }
  if ((hc.cooldowns[abilityId] ?? 0) > 0) { hc.defending = true; log(room, `${hero.name}'s ${ability.label} isn't ready.`); return; }
  hc.cooldowns[abilityId] = ability.cd === 0 ? 0 : ability.cd + 1; // decremented at next turn start

  const targetEnemy = () => c.enemies.find((e) => e.id === a.targetId && e.alive) ?? nearestEnemy(room, hc.zone);
  const targetAllyId = () => (typeof a.targetId === "string" && c.heroes[a.targetId] ? (a.targetId as string) : lowestHpAllyId(room, playerId));
  const s = (st: Stat) => hero.stats[st];

  switch (abilityId) {
    // Barbarian
    case "big_swing": {
      const inReach = c.enemies.filter((e) => e.alive && adjacent(hc.zone, e.zone)).slice(0, 2);
      if (!inReach.length) { log(room, `${hero.name} swings at empty air.`); break; }
      for (const e of inReach) attackRoll(room, playerId, e, s("might"), (cls!.weaponDmg) + hc.extraDmg, `${hero.name}'s Big Swing crashes into`);
      break;
    }
    case "anger": hc.extraDmg += 2; log(room, `${hero.name} works up an Unreasonable Anger (+2 damage).`); break;
    // Knight
    case "intervene": hc.intervening = true; log(room, `${hero.name} stands ready to Intervene for an ally.`); break;
    case "shield_wall":
      for (const [id, h] of Object.entries(c.heroes)) if (h.zone === "party_front") h.shieldWall = 2, void id;
      log(room, `${hero.name} raises a Shield Wall over the front line.`);
      break;
    // Rogue
    case "vanish": hc.hidden = true; hc.zone = "hidden"; log(room, `${hero.name} melts into the shadows.`); break;
    case "backstab": {
      const e = targetEnemy();
      if (!e) break;
      if (!hc.hidden) { log(room, `${hero.name} needs the shadows first — a clumsy jab.`); attackRoll(room, playerId, e, s("cunning"), cls!.weaponDmg, `${hero.name} stabs`); break; }
      attackRoll(room, playerId, e, s("cunning"), cls!.weaponDmg + 4 + hc.extraDmg, `${hero.name}'s Backstab sinks into`);
      hc.hidden = false; hc.zone = "party_front";
      break;
    }
    // Wizard
    case "firebolt": { const e = targetEnemy(); if (e) attackRoll(room, playerId, e, s("arcana"), cls!.weaponDmg + hc.extraDmg, `${hero.name}'s Firebolt streaks at`); break; }
    case "fireball": {
      const zone = (targetEnemy()?.zone) ?? "enemy_front";
      const inZone = c.enemies.filter((e) => e.alive && e.zone === zone);
      const r = roll(s("arcana"));
      const dmg = 3 + Math.max(0, s("arcana"));
      if (r.crit === "nat1") {
        log(room, `${hero.name}'s Probably-Fireball goes off EARLY — friendly fire!`);
        const ally = livingHeroes(room)[Math.floor(Math.random() * livingHeroes(room).length)];
        if (ally) damageHero(room, ally.id, dmg, "the misfired fireball");
        break;
      }
      for (const e of inZone) { e.hp -= dmg; log(room, `Fireball scorches ${e.name} for ${dmg}.`); if (e.hp <= 0) { e.alive = false; log(room, `${e.name} is incinerated!`); } }
      room.sfx("hit");
      break;
    }
    // Hedge Witch
    case "brew": {
      const id = targetAllyId(); const t = c.heroes[id]; const th = heroOf(room, id);
      const r = roll(0);
      if (r.crit === "nat1" && th) { damageHero(room, id, 3, "a Dubious Brew gone wrong"); break; }
      const heal = 4 + (1 + Math.floor(Math.random() * 4));
      if (th) { th.hp = Math.min(th.maxHp, th.hp + heal); log(room, `${hero.name}'s brew heals ${th.name} for ${heal}.`); }
      break;
    }
    case "hex": { const e = targetEnemy(); if (e) { e.hexTurns = 2; log(room, `${hero.name} hexes ${e.name} (-2 for two rounds).`); } break; }
    // Bard
    case "inspire": { const id = targetAllyId(); const t = c.heroes[id]; if (t) { t.helpBonus += 3; log(room, `${hero.name} inspires ${room.name(id)} (+3 next roll).`); } break; }
    case "limerick": { const e = targetEnemy(); if (e) { attackRoll(room, playerId, e, s("heart"), 3 + hc.extraDmg, `${hero.name}'s Devastating Limerick lands on`); e.skipMove = true; } break; }
    default: hc.defending = true;
  }
}

// ─── Enemy turns ─────────────────────────────────────────────────────────────

function resolveEnemyTurn(room: Room, e: Enemy): void {
  const c = S(room);
  // pick a target by behavior
  const targets = livingHeroes(room).filter((p) => {
    const hidden = c.heroes[p.id]?.hidden;
    return e.kind === "lurker" ? true : !hidden; // only lurkers can find HIDDEN heroes
  });
  if (!targets.length) return;
  let target: ServerPlayer;
  if (e.kind === "bruiser") target = frontmost(room, targets);
  else if (e.kind === "caster") target = backmost(room, targets);
  else if (e.kind === "lurker") target = c.heroes[targets[0].id] && targets.find((p) => c.heroes[p.id]?.hidden) || lowestHp(room, targets);
  else if (e.kind === "boss") target = lowestHp(room, targets);
  else target = targets[Math.floor(Math.random() * targets.length)];

  let tc = c.heroes[target.id];
  // move toward the target unless ranged / already in reach
  if (!e.ranged && !adjacent(e.zone, targetZone(tc))) {
    if (e.skipMove) { e.skipMove = false; log(room, `${e.name} is still reeling and can't close in.`); return; }
    e.zone = stepToward(e.zone, targetZone(tc));
    if (!adjacent(e.zone, targetZone(tc))) { log(room, `${e.name} advances.`); return; }
  }

  // Knight Intervene: redirect onto a guarding knight in reach
  const redirect = [...room.players.values()].find((p) => {
    const h = c.heroes[p.id];
    return h?.intervening && !h.downed && adjacent(e.zone, h.zone);
  });
  if (redirect && redirect.id !== target.id) {
    c.heroes[redirect.id].intervening = false;
    log(room, `${(heroOf(room, redirect.id))?.name} throws themselves in the way!`);
    target = redirect;
    tc = c.heroes[redirect.id];
  }

  const mod = e.atk - (e.hexTurns > 0 ? 2 : 0);
  const r = roll(mod);
  const def = heroDef(room, target.id);
  if (r.crit === "nat1" || (r.crit !== "nat20" && r.total < def)) {
    log(room, `${e.name} attacks ${target.name} but misses (${r.total} vs DEF ${def}).`);
    return;
  }
  let dmg = r.crit === "nat20" ? e.dmg * 2 : e.dmg;
  if (tc.shieldWall > 0) dmg = Math.max(1, dmg - 2);
  damageHero(room, target.id, dmg, e.name);
}

function damageHero(room: Room, playerId: string, dmg: number, source: string): void {
  const hero = heroOf(room, playerId);
  const hc = S(room).heroes[playerId];
  if (!hero || !hc || hc.downed) return;
  hero.hp = Math.max(0, hero.hp - dmg);
  log(room, `${source} hits ${hero.name} for ${dmg} (${hero.hp}/${hero.maxHp}).`);
  room.sfx("hit");
  if (hero.hp <= 0) { hc.downed = true; log(room, `${hero.name} goes down!`); }
}

// ─── target helpers ───────────────────────────────────────────────────────────
function targetZone(hc: HeroCombat): ZoneId { return hc.hidden ? "party_front" : hc.zone; }
function nearestEnemy(room: Room, zone: ZoneId): Enemy | undefined {
  const alive = livingEnemies(room);
  return alive.find((e) => adjacent(zone, e.zone)) ?? alive[0];
}
function frontmost(room: Room, ps: ServerPlayer[]): ServerPlayer {
  const rank: ZoneId[] = ["party_front", "party_back", "hidden"];
  return [...ps].sort((a, b) => rank.indexOf(S(room).heroes[a.id].zone) - rank.indexOf(S(room).heroes[b.id].zone))[0];
}
function backmost(room: Room, ps: ServerPlayer[]): ServerPlayer {
  const rank: ZoneId[] = ["party_back", "party_front", "hidden"];
  return [...ps].sort((a, b) => rank.indexOf(S(room).heroes[a.id].zone) - rank.indexOf(S(room).heroes[b.id].zone))[0];
}
function lowestHp(room: Room, ps: ServerPlayer[]): ServerPlayer {
  return [...ps].sort((a, b) => (heroOf(room, a.id)!.hp) - (heroOf(room, b.id)!.hp))[0];
}
function lowestHpAllyId(room: Room, selfId: string): string {
  const hurt = livingHeroes(room).sort((a, b) => (heroOf(room, a.id)!.hp / heroOf(room, a.id)!.maxHp) - (heroOf(room, b.id)!.hp / heroOf(room, b.id)!.maxHp));
  return hurt[0]?.id ?? selfId;
}

// ─── Finish ────────────────────────────────────────────────────────────────
function finish(room: Room, status: "won" | "lost"): void {
  const c = S(room);
  c.status = status;
  c.activeHeroId = null;
  room.clearTimer();
  log(room, status === "won" ? "The party stands victorious." : "The party falls…");
  room.broadcast();
  onEncounterEnd?.(room, status);
}

/** the module registers a callback so combat stays decoupled from flow */
let onEncounterEnd: ((room: Room, status: "won" | "lost") => void) | null = null;
export function setEncounterEndHandler(fn: (room: Room, status: "won" | "lost") => void): void {
  onEncounterEnd = fn;
}

// ─── Views ───────────────────────────────────────────────────────────────────
export function combatPublic(room: Room): unknown {
  const c = S(room);
  if (!c) return null;
  return {
    status: c.status, round: c.round, title: c.title, activeHeroId: c.activeHeroId,
    log: c.log.slice(-8),
    zones: STRIP,
    enemies: c.enemies.map((e) => ({ id: e.id, name: e.name, kind: e.kind, hp: e.hp, maxHp: e.maxHp, zone: e.zone, alive: e.alive, hexed: e.hexTurns > 0 })),
    heroes: [...room.players.values()].filter((p) => p.data.hero).map((p) => {
      const hc = c.heroes[p.id]; const h = p.data.hero as Hero;
      return { id: p.id, name: p.name, cls: h.cls, avatar: p.avatar, hp: h.hp, maxHp: h.maxHp, zone: hc?.hidden ? "hidden" : hc?.zone, downed: hc?.downed, defending: hc?.defending };
    }),
    order: c.order.map((o) => o.id),
  };
}

export function combatPrivate(room: Room, playerId: string): unknown {
  const c = S(room);
  if (!c) return null;
  const hc = c.heroes[playerId];
  const hero = heroOf(room, playerId);
  if (!hc || !hero) return { yourTurn: false };
  const cls = CLASS_BY_ID.get(hero.cls);
  return {
    yourTurn: c.activeHeroId === playerId && c.status === "active",
    downed: hc.downed,
    zone: hc.hidden ? "hidden" : hc.zone,
    enemies: c.enemies.filter((e) => e.alive).map((e) => ({ id: e.id, name: e.name, zone: e.zone, inReach: adjacent(hc.zone, e.zone) })),
    allies: livingHeroes(room).filter((p) => p.id !== playerId).map((p) => ({ id: p.id, name: p.name })),
    abilities: (cls?.abilities ?? []).map((ab) => ({ ...ab, ready: (hc.cooldowns[ab.id] ?? 0) === 0 })),
    canMoveTo: STRIP.filter((z) => adjacent(hc.zone, z) && z !== hc.zone),
  };
}
