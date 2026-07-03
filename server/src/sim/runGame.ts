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
        } else if (role && role !== "innocent" && role !== "jester") {
          const target = randomTarget(room, p.id);
          if (target) act(room, p.id, { kind: "night_pick", targetId: target });
        }
        break;
      }
      case "forge": {
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
console.log("\nAll sims passed.");
process.exit(0);
