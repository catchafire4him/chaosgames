/**
 * Headless full-game simulation with bot players — the main dev test.
 * Runs both modules to completion with the MockDirector (no API keys, no TV).
 *
 *   npm run sim              # both modules
 *   npm run sim conspiracy   # one module
 *
 * Set DIRECTOR=gemini + GEMINI_API_KEY to smoke-test real AI authoring.
 */
import "dotenv/config";
import type { ModuleId, PlayerAction, RoomSettings } from "../../../shared/src/index.js";
import { GeminiDirector } from "../director/gemini.js";
import { MockDirector } from "../director/mock.js";
import type { Director } from "../director/types.js";
import { Room, rid } from "../engine/room.js";
import { NullSpeaker } from "../speaker/types.js";
import { getModule } from "../modules/registry.js";
import { MemoryStorage } from "../storage/index.js";
import { beginChapter } from "../modules/campaign/index.js";
import { saveScene } from "../modules/campaign/chapter.js";

const BOT_NAMES = [
  "Ada", "Bruno", "Cleo", "Dex", "Edie", "Finn",
  "Gus", "Hana", "Iggy", "Juno", "Kip", "Lola",
  "Milo", "Nia", "Otto", "Pia",
];

function act(room: Room, playerId: string, action: PlayerAction): void {
  room.module.onAction(room, playerId, action);
}

/** pick a random alive player other than self */
function randomTarget(room: Room, selfId: string): string | null {
  const options = room.alive().filter((p) => p.id !== selfId);
  return options.length ? options[Math.floor(Math.random() * options.length)].id : null;
}

/** Bots respond to whatever phase the room is in. */
function botTick(room: Room): void {
  for (const p of room.alive()) {
    if (p.done) continue;
    const you = room.module.privateState(room, p.id) as Record<string, unknown>;
    switch (room.phase) {
      case "role_reveal":
        act(room, p.id, { kind: "ready" });
        break;
      case "night": {
        const role = you.role as string;
        if (role === "vigilante") {
          if (Math.random() < 0.5) act(room, p.id, { kind: "hold_fire" });
          else {
            const target = randomTarget(room, p.id);
            if (target) act(room, p.id, { kind: "night_pick", targetId: target });
          }
        } else if (role) {
          // real actors AND sleepers — everyone submits at night (sleepers decoy)
          const target = randomTarget(room, p.id);
          if (target) act(room, p.id, { kind: "night_pick", targetId: target });
        }
        break;
      }
      case "forge": {
        if (room.module.id === "campaign") {
          const f = (you.forge ?? null) as {
            suggestedClass: string;
            classes: { id: string; defaultStats: Record<string, number> }[];
            adjectives: string[];
            items: string[];
            backstories: string[];
          } | null;
          if (f) {
            const cls = f.classes.find((c) => c.id === f.suggestedClass);
            act(room, p.id, {
              kind: "forge_submit",
              cls: f.suggestedClass,
              stats: cls?.defaultStats,
              adjective: f.adjectives[0],
              item: f.items[0],
              backstory: f.backstories[0],
            });
          }
          break;
        }
        const opts = (you.forgeOptions ?? null) as {
          adjectives: string[];
          items: string[];
          backstories: string[];
        } | null;
        if (opts) {
          act(room, p.id, { kind: "forge_pick", category: "adjective", value: opts.adjectives[0] });
          act(room, p.id, { kind: "forge_pick", category: "item", value: opts.items[0] });
          act(room, p.id, { kind: "forge_pick", category: "backstory", value: opts.backstories[0] });
        }
        break;
      }
      case "day":
        act(room, p.id, { kind: "call_vote" });
        break;
      case "voting": {
        const target = randomTarget(room, p.id);
        if (target) act(room, p.id, { kind: "vote", targetId: target });
        break;
      }
      case "investigation": {
        const locs = ["library", "billiard-room", "drawing-room", "gazebo", "master-bedroom", "generic"];
        act(room, p.id, { kind: "move", locationId: locs[Math.floor(Math.random() * locs.length)] });
        break;
      }
      case "accusation": {
        const target = randomTarget(room, p.id);
        if (target) act(room, p.id, { kind: "suspect_pick", targetId: target });
        break;
      }
      case "verdict": {
        const pub = room.module.publicState(room) as {
          trial?: { accusedId: string } | null;
          alibiOptions?: string[];
        };
        if (pub.trial?.accusedId === p.id) {
          act(room, p.id, { kind: "alibi", text: (pub.alibiOptions ?? [""])[0] });
        } else {
          act(room, p.id, {
            kind: "verdict_vote",
            vote: Math.random() < 0.5 ? "guilty" : "innocent",
          });
        }
        break;
      }
      case "action_pick": {
        const pub = room.module.publicState(room) as { activeId?: string | null };
        if (pub.activeId === p.id) {
          const options = ["brute", "magic", "chaos"];
          act(room, p.id, { kind: "pick_action", action: options[Math.floor(Math.random() * 3)] });
        } else if (Math.random() < 0.5) {
          act(room, p.id, { kind: "spend", spendKind: Math.random() < 0.5 ? "buff" : "sabotage" });
        }
        break;
      }
      case "rolling": {
        const pub = room.module.publicState(room) as { activeId?: string | null };
        if (pub.activeId === p.id) act(room, p.id, { kind: "roll" });
        break;
      }
    }
  }
}

async function runGame(
  moduleId: ModuleId,
  playerCount: number,
  settingsOverride?: Partial<RoomSettings>,
): Promise<void> {
  const module = getModule(moduleId)!;
  const apiKey = process.env.GEMINI_API_KEY;
  const director: Director =
    process.env.DIRECTOR === "gemini" && apiKey
      ? new GeminiDirector(apiKey)
      : new MockDirector();

  const room = new Room(rid("rm"), "SIMX", module, director, new NullSpeaker(), "http://sim");
  for (let i = 0; i < playerCount; i++) room.addPlayer(BOT_NAMES[i]);
  if (settingsOverride) Object.assign(room.settings, settingsOverride);

  console.log(
    `\n=== SIM: ${moduleId} with ${playerCount} bots (director=${director.kind}` +
      `${settingsOverride ? `, settings=${JSON.stringify(settingsOverride)}` : ""}) ===`,
  );
  room.started = true;
  module.setup(room);

  const start = Date.now();
  let lastLog = "";
  while (room.phase !== "ended") {
    if (Date.now() - start > 120_000) {
      throw new Error(`SIM TIMEOUT in phase "${room.phase}" round ${room.round}`);
    }
    botTick(room);
    // fast-forward any module timer (bots may legitimately all be done/waiting)
    if (room.timer) {
      const t = room.timer;
      room.clearTimer();
      module.onTimer(room, t.label);
    }
    const log = `phase=${room.phase} round=${room.round} alive=${room.alive().length}`;
    if (log !== lastLog) {
      console.log(`  ${log}`);
      lastLog = log;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`  ✔ ended in ${((Date.now() - start) / 1000).toFixed(1)}s — winners: ${room.winners?.join(", ")}`);
  room.destroy();
}

/** wait until the room reaches one of `phases` (or time out) */
async function waitFor(room: Room, phases: string[], drive: () => void): Promise<void> {
  const start = Date.now();
  while (!phases.includes(room.phase)) {
    if (Date.now() - start > 30_000) throw new Error(`SIM TIMEOUT waiting for ${phases} (in "${room.phase}")`);
    drive();
    if (room.timer) {
      const t = room.timer;
      room.clearTimer();
      room.module.onTimer(room, t.label);
    }
    await new Promise((r) => setTimeout(r, 60));
  }
}

/** Campaign (phase 2): forge a party, prove it persists, then prove a fresh
 *  room bound to the same campaign resumes with the party intact. */
async function runCampaign(playerCount: number): Promise<void> {
  const module = getModule("campaign")!;
  const apiKey = process.env.GEMINI_API_KEY;
  const director: Director =
    process.env.DIRECTOR === "gemini" && apiKey ? new GeminiDirector(apiKey) : new MockDirector();
  const storage = new MemoryStorage();
  await storage.init();
  const campaign = await storage.createCampaign({ joinCode: "SIMC", name: "The Sim Saga" });

  console.log(`\n=== SIM: campaign with ${playerCount} bots (forge + persist + resume) ===`);

  // ── night one: forge ──
  const r1 = new Room(rid("rm"), "SIMC", module, director, new NullSpeaker(), "http://sim", storage);
  r1.campaignId = campaign.id;
  const keys: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const key = `simkey-${i}`;
    keys.push(key);
    const p = r1.addPlayer(BOT_NAMES[i], key);
    await storage.getOrCreatePlayer(key, BOT_NAMES[i]);
    void p;
  }
  r1.started = true;
  module.setup(r1);
  await waitFor(r1, ["briefing"], () => botTick(r1));
  const saved = await storage.listCharacters(campaign.id);
  if (saved.length !== playerCount) throw new Error(`FAIL: expected ${playerCount} heroes persisted, got ${saved.length}`);
  console.log(`  ✔ forged + persisted ${saved.length} heroes (e.g. ${saved[0].name} the ${saved[0].cls}, ${saved[0].maxHp} HP)`);
  r1.destroy();

  // ── night two: a brand-new room (server "restarted") resumes from the DB ──
  const r2 = new Room(rid("rm"), "SIMC", module, director, new NullSpeaker(), "http://sim", storage);
  r2.campaignId = campaign.id;
  for (let i = 0; i < playerCount; i++) {
    const p = r2.addPlayer(BOT_NAMES[i], keys[i]);
    void p;
  }
  r2.started = true;
  module.setup(r2);
  await waitFor(r2, ["briefing"], () => {});
  const pub = module.publicState(r2) as { party: { ready: boolean; name: string }[] };
  const ready = pub.party.filter((h) => h.ready).length;
  if (ready !== playerCount) throw new Error(`FAIL: resume attached ${ready}/${playerCount} heroes`);
  console.log(`  ✔ resumed campaign — ${ready}/${playerCount} heroes reattached by player_key, no re-forge`);

  // ── phase 4: play a full chapter (intent scene → fork → climax → camp) ──
  const beforeLevel = ([...r2.players.values()][0].data.hero as { level: number }).level;
  await driveChapter(r2);
  const combat = r2.state.combat as { status: string; round: number };
  const campaignAfter = await storage.getCampaign(campaign.id);
  if (campaignAfter!.chapterNum !== 1) throw new Error(`FAIL: chapterNum should be 1, got ${campaignAfter!.chapterNum}`);
  if (!campaignAfter!.campaignLog.chapters.length) throw new Error("FAIL: campaign log has no chapter summary");
  const savedChars = await storage.listCharacters(campaign.id);
  const won = combat.status === "won";
  console.log(`  ✔ chapter 1 played: climax ${combat.status}, chapterNum→${campaignAfter!.chapterNum}, log="${campaignAfter!.campaignLog.chapters[0].summary.slice(0, 48)}…"`);
  if (won && savedChars[0].level !== beforeLevel + 1) throw new Error(`FAIL: win should level up (${beforeLevel}→${savedChars[0].level})`);
  console.log(`  ✔ persisted: heroes ${won ? `leveled to ${savedChars[0].level}` : "kept level (fail-forward)"}, log saved`);

  // ── chapter 2 sees chapter-1's memory (recap uses the log) ──
  await driveChapter(r2);
  const camp2 = await storage.getCampaign(campaign.id);
  if (camp2!.chapterNum !== 2) throw new Error(`FAIL: chapter 2 should bump chapterNum to 2, got ${camp2!.chapterNum}`);
  console.log(`  ✔ chapter 2 built on the log (recap fired) — chapterNum→${camp2!.chapterNum}`);
  r2.destroy();

  // ── phase 7: a redeploy mid-scene resumes from the snapshot ──
  const r3 = new Room(rid("rm"), "SIMC", module, director, new NullSpeaker(), "http://sim", storage);
  r3.campaignId = campaign.id;
  for (let i = 0; i < playerCount; i++) r3.addPlayer(BOT_NAMES[i], keys[i]);
  r3.started = true;
  module.setup(r3);
  await waitFor(r3, ["briefing"], () => {});
  await settle(r3);
  beginChapter(r3);
  await waitFor(r3, ["scene"], () => {});
  const title3 = (module.publicState(r3) as { chapter: { title: string } }).chapter.title;
  const victim = [...r3.players.values()][0];
  (victim.data.hero as { hp: number }).hp = 5; // wound them mid-scene
  await saveScene(r3, "scene"); // the autosave that a real scene boundary writes
  r3.destroy(); // the server "dies"

  const r4 = new Room(rid("rm"), "SIMC", module, director, new NullSpeaker(), "http://sim", storage);
  r4.campaignId = campaign.id;
  for (let i = 0; i < playerCount; i++) r4.addPlayer(BOT_NAMES[i], keys[i]);
  r4.started = true;
  module.setup(r4);
  await waitFor(r4, ["scene"], () => {});
  const pub4 = module.publicState(r4) as { chapter: { title: string } };
  if (pub4.chapter.title !== title3) throw new Error(`FAIL: resume landed on the wrong chapter ("${pub4.chapter.title}" vs "${title3}")`);
  const resumed = [...r4.players.values()].find((p) => p.playerKey === victim.playerKey)!;
  const hp = (resumed.data.hero as { hp: number }).hp;
  if (hp !== 5) throw new Error(`FAIL: resume should restore the wound (HP 5), got ${hp}`);
  console.log(`  ✔ redeploy mid-scene resumed: back in "${title3}" with the wounded hero at ${hp} HP`);
  r4.destroy();
}

/** spin until no beat is composing or awaiting playback */
async function settle(room: Room): Promise<void> {
  const start = Date.now();
  while (room.pending || room.composing) {
    if (Date.now() - start > 10_000) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Drive one full chapter with bots: declare an action, vote the fork, fight
 *  the climax, rest at camp. Gated on `!room.pending` so beats don't stomp. */
async function driveChapter(room: Room): Promise<void> {
  const module = room.module;
  beginChapter(room);
  const start = Date.now();
  let declared = false;
  const heroes = () => [...room.players.values()].filter((p) => p.data.hero);
  while (room.phase !== "briefing") {
    if (Date.now() - start > 45_000) throw new Error(`SIM TIMEOUT in chapter (phase "${room.phase}")`);
    const busy = room.pending || room.composing;
    if (room.phase === "encounter") {
      await driveCombat(room);
    } else if (room.phase === "scene" && !busy) {
      const pub = module.publicState(room) as { chapter?: { fork?: { options: string[] } | null } };
      if (!declared) {
        declared = true;
        act(room, heroes()[0].id, { kind: "declare", text: "I search the area for anything useful" });
      } else if (pub.chapter?.fork) {
        for (const p of heroes()) act(room, p.id, { kind: "fork_vote", option: 0 });
      } else {
        act(room, room.hostPlayerId!, { kind: "advance_scene" });
      }
    } else if (room.timer && !busy) {
      const t = room.timer; room.clearTimer(); module.onTimer(room, t.label);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

interface CombatView {
  status: string;
  activeHeroId: string | null;
}
interface CombatPriv {
  combat?: {
    yourTurn: boolean;
    enemies: { id: string; inReach: boolean }[];
    abilities: { id: string; ready: boolean }[];
  };
}

/** Bots fight: the active hero attacks (occasionally fires a ready ability),
 *  enemy turns resolve inside the engine. Timers auto-defend. */
async function driveCombat(room: Room): Promise<void> {
  const module = room.module;
  const start = Date.now();
  let turns = 0;
  while ((room.state.combat as CombatView | undefined)?.status === "active") {
    if (Date.now() - start > 30_000) throw new Error("SIM TIMEOUT in combat");
    const c = room.state.combat as CombatView;
    const activeId = c.activeHeroId;
    if (activeId) {
      const you = module.privateState(room, activeId) as CombatPriv;
      const cb = you.combat;
      if (cb?.yourTurn) {
        turns++;
        const target = cb.enemies.find((e) => e.inReach) ?? cb.enemies[0];
        const ability = cb.abilities.find((a) => a.ready);
        if (ability && turns % 3 === 0) {
          act(room, activeId, { kind: "combat_action", action: "ability", abilityId: ability.id, targetId: target?.id });
        } else {
          act(room, activeId, { kind: "combat_action", action: "attack", targetId: target?.id });
        }
      }
    } else if (room.timer) {
      const t = room.timer;
      room.clearTimer();
      module.onTimer(room, t.label);
    }
    await new Promise((r) => setTimeout(r, 15));
  }
}

const only = process.argv[2] as ModuleId | undefined;
const runs: [ModuleId, number, Partial<RoomSettings>?][] = [
  ["conspiracy", 10], // godfather + vigilante + jester
  ["conspiracy", 14], // + mayor + consigliere
  ["whodunnit", 8], // big enough for an accomplice
  ["dungeon", 5],
  ["dungeon", 5, { dungeonIntensity: "standard" }], // exercise KOs + situational action
];
for (const [id, count, settings] of runs) {
  if (only && only !== id) continue;
  await runGame(id, count, settings);
}
if (!only || only === "campaign") await runCampaign(4);
console.log("\nAll sims passed.");
process.exit(0);
