import type { Room, ServerPlayer } from "../../engine/room.js";
import type { ToolParameters } from "../../engine/types.js";
import { CLASS_BY_ID, maxHpFor, type Hero, type Stat } from "./heroes.js";
import { DC, skillCheck, startEncounter, type Difficulty, type EnemySpec } from "./combat.js";

/**
 * Intent-driven chapters — the "digital table" loop (CAMPAIGN_DESIGN.md §5.4).
 *
 *   beginChapter → (recap) → scene_intro → [players TYPE actions; the DM
 *   interprets, the ENGINE rolls, the DM narrates the verdict] + a party fork
 *   → climax combat → camp (loot + level-up) → chapter_end (log) → ready
 *
 * The Director only interprets intent and narrates; every die/DC/HP stays in
 * the engine. Hybrid start: free-text in scenes, phase-3 tap actions in combat.
 */

const STAT_ENUM: Stat[] = ["might", "cunning", "arcana", "heart"];
const DIFF_ENUM: Difficulty[] = ["easy", "tricky", "hard", "heroic"];

interface Fork { prompt: string; options: string[]; votes: Record<string, number> }
interface LastCheck {
  playerId: string; playerName: string; interpretedAs: string;
  stat: Stat; difficulty: Difficulty; plausible: boolean;
  success: boolean; d20: number; total: number; dc: number; crit: "nat20" | "nat1" | null;
}
interface ChapterState {
  title: string;
  hook: string;
  climax: EnemySpec[];
  fork: Fork | null;
  forkResolved: boolean;
  declarations: number;
  lastCheck: LastCheck | null;
  camp: { leveled: boolean };
}

function CH(room: Room): ChapterState {
  return room.state.chapter as ChapterState;
}
function heroesIn(room: Room): ServerPlayer[] {
  return [...room.players.values()].filter((p) => p.data.hero);
}

// ─── Schemas (real Director; Mock uses cannedData) ────────────────────────────
const OUTLINE_SCHEMA: ToolParameters = {
  type: "object",
  properties: {
    title: { type: "string", description: "this chapter's title" },
    hook: { type: "string", description: "1-2 sentence scene-setting opening" },
    forkPrompt: { type: "string", description: "a choice the party must make" },
    forkOptions: { type: "array", items: { type: "string" }, description: "2-3 short options" },
    climax: {
      type: "array",
      description: "enemies for the climax fight",
      items: { type: "object", properties: { kind: { type: "string", enum: ["minion", "bruiser", "caster", "lurker", "boss"] }, name: { type: "string" } } },
    },
  },
  required: ["title", "hook", "forkPrompt", "forkOptions", "climax"],
};

const INTERPRET_SCHEMA: ToolParameters = {
  type: "object",
  properties: {
    interpretedAs: { type: "string", description: "a short paraphrase of what the player is attempting" },
    stat: { type: "string", enum: STAT_ENUM, description: "which stat governs this attempt" },
    difficulty: { type: "string", enum: DIFF_ENUM, description: "how hard it is" },
    plausible: { type: "boolean", description: "false ONLY if the attempt is impossible in this fiction; you do NOT decide success" },
  },
  required: ["interpretedAs", "stat", "difficulty", "plausible"],
};

// ─── Chapter lifecycle ────────────────────────────────────────────────────────

export function beginChapter(room: Room): void {
  room.state.chapter = {
    title: "", hook: "", climax: [], fork: null, forkResolved: false,
    declarations: 0, lastCheck: null, camp: { leveled: false },
  } satisfies ChapterState;
  room.setPhase("chapter_intro");
  room.broadcast();
  const prior = campaignState(room).log.chapters;
  if (prior.length) {
    room.play({
      id: "recap",
      instruction: `"Previously on ${campaignName(room)}…" — in 1-2 sentences, remind the party what happened last chapter: ${prior[prior.length - 1].summary}. Then say the story continues.`,
      after: (r) => authorOutline(r),
    });
  } else {
    authorOutline(room);
  }
}

function authorOutline(room: Room): void {
  room.play({
    id: "chapter_outline",
    schema: OUTLINE_SCHEMA,
    instruction: `Author chapter ${chapterNum(room) + 1} of "${campaignName(room)}". Return a title, a 1-2 sentence hook, a fork (a choice for the party) with 2-3 options, and a small set of climax enemies. Keep it comedic-heroic.`,
    onAuthored: (r, data) => applyOutline(r, data),
    after: (r) => openScene(r),
  });
}

function applyOutline(room: Room, data: unknown): void {
  const d = (data ?? {}) as Record<string, unknown>;
  const ch = CH(room);
  ch.title = String(d.title ?? "An Unnamed Chapter").slice(0, 80);
  ch.hook = String(d.hook ?? "The road goes ever on.").slice(0, 300);
  const opts = Array.isArray(d.forkOptions) ? (d.forkOptions as unknown[]).map((o) => String(o).slice(0, 60)).slice(0, 3) : [];
  ch.fork = opts.length >= 2 ? { prompt: String(d.forkPrompt ?? "What do you do?").slice(0, 160), options: opts, votes: {} } : null;
  const climax = Array.isArray(d.climax) ? (d.climax as Record<string, unknown>[]) : [];
  ch.climax = climax
    .map((e) => ({ kind: String(e.kind ?? "minion"), name: String(e.name ?? "a foe").slice(0, 40) }))
    .filter((e): e is EnemySpec => ["minion", "bruiser", "caster", "lurker", "boss"].includes(e.kind)) as EnemySpec[];
  if (!ch.climax.length) ch.climax = [{ kind: "bruiser", name: "the Gatekeeper" }, { kind: "minion", name: "a lackey" }];
}

function openScene(room: Room): void {
  room.setPhase("scene");
  void saveScene(room, "scene"); // snapshot the scene boundary for redeploy resume
  room.broadcast();
  const ch = CH(room);
  room.play({
    id: "scene_intro",
    instruction: `Set the scene: ${ch.hook}. Invite the heroes to act in their own words.${ch.fork ? ` Then pose the choice: ${ch.fork.prompt}` : ""}`,
  });
}

/** Autosave the durable mid-chapter state so a server restart resumes here.
 *  We snapshot only at NON-combat boundaries — combat state is keyed by the
 *  in-memory playerId, which changes on a fresh room, so a mid-combat redeploy
 *  resumes at the scene and replays the encounter (combat is short). */
export async function saveScene(room: Room, phase: string): Promise<void> {
  if (!room.storage || !room.campaignId) return;
  const heroes: Record<string, Hero> = {};
  for (const p of room.players.values()) {
    if (p.playerKey && p.data.hero) heroes[p.playerKey] = p.data.hero as Hero;
  }
  const state = { phase, chapter: (room.state.chapter as ChapterState) ?? null, heroes, round: room.round };
  try {
    await room.storage.saveSnapshot({ campaignId: room.campaignId, chapter: campaignState(room).chapterNum, scene: phase, state });
  } catch (err) {
    console.error(`[campaign:${room.code}] snapshot(${phase}) failed:`, err);
  }
}

// ─── The Interpreter loop (free-text → engine → narration) ────────────────────

export function declare(room: Room, playerId: string, text: string): void {
  if (room.phase !== "scene") return;
  const player = room.players.get(playerId);
  const hero = player?.data.hero as Hero | undefined;
  if (!player || !hero) return;
  const clean = text.trim().slice(0, 300);
  if (!clean) return;
  const ch = CH(room);
  ch.declarations++;
  player.spotlight = true;

  room.play({
    id: "declare_interpret",
    schema: INTERPRET_SCHEMA,
    urgent: false,
    instruction: `${player.name} (the ${CLASS_BY_ID.get(hero.cls)?.label ?? hero.cls}) says: "${clean}". Classify this attempt — which stat, how hard, and whether it's even possible. Do NOT decide whether it succeeds.`,
    onAuthored: (r, data) => resolveDeclaration(r, playerId, clean, data),
    after: (r) => narrateDeclaration(r),
  });
}

function resolveDeclaration(room: Room, playerId: string, text: string, data: unknown): void {
  const d = (data ?? {}) as Record<string, unknown>;
  const player = room.players.get(playerId)!;
  const hero = player.data.hero as Hero;
  const stat: Stat = STAT_ENUM.includes(d.stat as Stat) ? (d.stat as Stat) : "might";
  const difficulty: Difficulty = DIFF_ENUM.includes(d.difficulty as Difficulty) ? (d.difficulty as Difficulty) : "tricky";
  const plausible = d.plausible !== false;
  const interpretedAs = String(d.interpretedAs ?? text).slice(0, 120);

  if (!plausible) {
    CH(room).lastCheck = { playerId, playerName: player.name, interpretedAs, stat, difficulty, plausible: false, success: false, d20: 0, total: 0, dc: DC[difficulty], crit: null };
    return;
  }
  const { roll, success } = skillCheck(hero.stats[stat], difficulty);
  CH(room).lastCheck = { playerId, playerName: player.name, interpretedAs, stat, difficulty, plausible: true, success, d20: roll.d20, total: roll.total, dc: DC[difficulty], crit: roll.crit };
  room.sfx(success ? "bell" : "sting");
}

function narrateDeclaration(room: Room): void {
  const lc = CH(room).lastCheck;
  if (!lc) { for (const p of room.players.values()) p.spotlight = false; return; }
  const instruction = !lc.plausible
    ? `${lc.playerName} tried to ${lc.interpretedAs}, but that isn't possible here. In one sentence, have the DM rule it out — in character, with good humor.`
    : `${lc.playerName} tried to ${lc.interpretedAs} (${lc.stat.toUpperCase()} check). They rolled ${lc.total} vs DC ${lc.dc} and ${lc.success ? "SUCCEEDED" : "FAILED"}${lc.crit === "nat20" ? " — a natural 20!" : lc.crit === "nat1" ? " — a natural 1!" : ""}. Narrate the outcome vividly in 1-2 sentences, and hint at what it opens up.`;
  room.play({
    id: "declare_narrate",
    instruction,
    after: (r) => { for (const p of r.players.values()) p.spotlight = false; r.broadcast(); },
  });
}

// ─── Party fork ────────────────────────────────────────────────────────────────

export function forkVote(room: Room, playerId: string, option: number): void {
  const ch = CH(room);
  if (room.phase !== "scene" || !ch.fork || ch.forkResolved) return;
  if (option < 0 || option >= ch.fork.options.length) return;
  ch.fork.votes[playerId] = option;
  room.broadcast();
  const connected = heroesIn(room).filter((p) => p.connected);
  if (connected.length && connected.every((p) => ch.fork!.votes[p.id] !== undefined)) resolveFork(room);
}

/** host/party chooses to move on (also resolves the fork by current tally) */
export function advanceScene(room: Room): void {
  if (room.phase !== "scene") return;
  const ch = CH(room);
  if (ch.fork && !ch.forkResolved) resolveFork(room);
  else toClimax(room);
}

function resolveFork(room: Room): void {
  const ch = CH(room);
  if (!ch.fork || ch.forkResolved) return;
  ch.forkResolved = true;
  const tally = new Array(ch.fork.options.length).fill(0);
  for (const v of Object.values(ch.fork.votes)) tally[v]++;
  let best = 0;
  for (let i = 1; i < tally.length; i++) if (tally[i] > tally[best]) best = i;
  const choice = ch.fork.options[best];
  recordChoice(room, ch.fork.prompt, choice);
  room.play({
    id: "fork_resolve",
    instruction: `The party chose: "${choice}". In one sentence, acknowledge it and turn toward the danger ahead.`,
    after: (r) => toClimax(r),
  });
}

function toClimax(room: Room): void {
  const ch = CH(room);
  startEncounter(room, ch.title || "The Climax", ch.climax.length ? ch.climax : [{ kind: "bruiser", name: "the Gatekeeper" }]);
}

// ─── Camp + level-up + chapter end (called from the combat end handler) ───────

export function toCamp(room: Room, won: boolean): void {
  room.setPhase("camp");
  const ch = CH(room);
  // milestone level-up on a win; a loss still advances the story (fail forward)
  if (won && !ch.camp.leveled) {
    ch.camp.leveled = true;
    for (const p of heroesIn(room)) levelUp(p.data.hero as Hero);
  }
  room.broadcast();
  room.play({
    id: "camp",
    instruction: won
      ? "Around the campfire after the victory: in 1-2 sentences, let the party breathe, note they've grown stronger, and tease what's next."
      : "Battered but alive after the setback: in 1-2 sentences, regroup at camp and vow to press on.",
    after: (r) => endChapter(r, won),
  });
}

function levelUp(hero: Hero): void {
  hero.level += 1;
  const cls = CLASS_BY_ID.get(hero.cls);
  if (cls) hero.stats[cls.stat] += 1; // signature stat grows (ability picks: v2)
  hero.maxHp = maxHpFor(hero.stats.might, hero.level);
  hero.hp = hero.maxHp; // a night's rest
}

async function endChapter(room: Room, won: boolean): Promise<void> {
  const ch = CH(room);
  const s = campaignState(room);
  const n = s.chapterNum + 1;
  const summary = `Chapter ${n}: ${ch.title || "an adventure"} — the party ${won ? "prevailed" : "was set back"} at ${ch.title || "the climax"}.`;
  s.log.chapters.push({ n, summary });
  if (s.log.chapters.length > 12) s.log.chapters.shift();
  s.chapterNum = n;

  // persist level-ups + campaign log
  if (room.storage && room.campaignId) {
    try {
      for (const p of heroesIn(room)) {
        const h = p.data.hero as Hero;
        if (!p.playerKey) continue;
        await room.storage.upsertCharacter({
          campaignId: room.campaignId, playerKey: p.playerKey, name: h.name, cls: h.cls, avatar: h.avatar,
          stats: h.stats, hp: h.hp, maxHp: h.maxHp, level: h.level, abilities: h.abilities,
          inventory: h.inventory, quirks: h.quirks, portraitAssetId: null,
        });
      }
      await room.storage.saveCampaign(room.campaignId, { chapterNum: s.chapterNum, campaignLog: s.log });
    } catch (err) {
      console.error(`[campaign:${room.code}] end-chapter persist failed:`, err);
    }
  }
  room.setPhase("chapter_end");
  room.broadcast();
  room.play({
    id: "chapter_end",
    instruction: `End chapter ${n} of "${s.name}" on a cliffhanger — one or two sentences promising the next tale.`,
    after: (r) => {
      r.setPhase("briefing");
      void saveScene(r, "briefing"); // chapter done → resume lands on the briefing, not a stale scene
      r.broadcast();
    },
  });
}

// ─── small accessors into the module's campaign state (avoid a circular import) ─
interface CampaignLike { name: string; chapterNum: number; log: { chapters: { n: number; summary: string }[]; openThreads: string[]; heroMoments: Record<string, string[]>; choices: { chapter: number; prompt: string; outcome: string }[] } }
function campaignState(room: Room): CampaignLike {
  const s = room.state.campaign as { name: string; chapterNum: number; roster: Record<string, Hero>; log?: CampaignLike["log"] } & Record<string, unknown>;
  if (!s.log) s.log = { chapters: [], openThreads: [], heroMoments: {}, choices: [] };
  return s as unknown as CampaignLike;
}
function chapterNum(room: Room): number { return campaignState(room).chapterNum; }
function campaignName(room: Room): string { return campaignState(room).name; }
function recordChoice(room: Room, prompt: string, outcome: string): void {
  const s = campaignState(room);
  s.log.choices.push({ chapter: s.chapterNum + 1, prompt, outcome });
  if (s.log.choices.length > 20) s.log.choices.shift();
}

// ─── Views ────────────────────────────────────────────────────────────────────
export function chapterPublic(room: Room): unknown {
  const ch = room.state.chapter as ChapterState | undefined;
  if (!ch) return null;
  return {
    title: ch.title, hook: ch.hook,
    fork: ch.fork && !ch.forkResolved ? { prompt: ch.fork.prompt, options: ch.fork.options, tally: tallyOf(ch.fork) } : null,
    lastCheck: ch.lastCheck ? { name: ch.lastCheck.playerName, interpretedAs: ch.lastCheck.interpretedAs, success: ch.lastCheck.success, plausible: ch.lastCheck.plausible, total: ch.lastCheck.total, dc: ch.lastCheck.dc } : null,
  };
}
export function chapterPrivate(room: Room, playerId: string): unknown {
  const ch = room.state.chapter as ChapterState | undefined;
  if (!ch || room.phase !== "scene") return null;
  return {
    canDeclare: true,
    fork: ch.fork && !ch.forkResolved ? { prompt: ch.fork.prompt, options: ch.fork.options, yourVote: ch.fork.votes[playerId] ?? null } : null,
  };
}
function tallyOf(f: Fork): number[] {
  const t = new Array(f.options.length).fill(0);
  for (const v of Object.values(f.votes)) t[v]++;
  return t;
}

// ─── Canned (offline / MockDirector) ──────────────────────────────────────────
export function chapterCannedData(beatId: string): unknown {
  if (beatId === "chapter_outline") {
    return {
      title: "The Rusted Crown",
      hook: "A crooked signpost points three ways, and something is howling down the left-hand road.",
      forkPrompt: "Which road do you take?",
      forkOptions: ["The howling road", "The quiet road", "Cut through the woods"],
      climax: [{ kind: "bruiser", name: "the Rust-Knight" }, { kind: "minion", name: "a scrap-goblin" }, { kind: "minion", name: "another scrap-goblin" }],
    };
  }
  if (beatId === "declare_interpret") {
    // deterministic offline interpretation: a middling CUNNING attempt
    return { interpretedAs: "improvise a clever solution", stat: "cunning", difficulty: "tricky", plausible: true };
  }
  return undefined;
}
export function chapterCanned(beatId: string, room: Room): { text: string; mood?: string }[] {
  const ch = room.state.chapter as ChapterState | undefined;
  switch (beatId) {
    case "scene_intro": return [{ text: ch?.hook ?? "The scene is set.", mood: "grand" }];
    case "declare_narrate": {
      const lc = ch?.lastCheck;
      if (!lc) return [{ text: "The moment passes.", mood: "flat" }];
      if (!lc.plausible) return [{ text: `The DM raises an eyebrow: "${lc.interpretedAs}? A bold idea. And a doomed one."`, mood: "wry" }];
      return [{ text: lc.success ? `${lc.playerName} manages to ${lc.interpretedAs}. It works!` : `${lc.playerName} tries to ${lc.interpretedAs}, and it goes sideways.`, mood: lc.success ? "triumphant" : "wry" }];
    }
    case "recap": {
      const last = campaignState(room).log.chapters.slice(-1)[0];
      return [{ text: last ? `Previously: ${last.summary} The tale continues…` : "The tale continues…", mood: "grand" }];
    }
    case "fork_resolve": return [{ text: "The party commits to their path.", mood: "grand" }];
    case "camp": return [{ text: "The fire crackles. The party rests, and grows a little stronger.", mood: "warm" }];
    case "chapter_end": return [{ text: "But something stirs in the dark, and that is a tale for next time…", mood: "ominous" }];
    default: return [{ text: "…", mood: "flat" }];
  }
}
