import type { PlayerAction } from "../../../../shared/src/index.js";
import type { Room, ServerPlayer } from "../../engine/room.js";
import type { GameModule, ToolParameters } from "../../engine/types.js";

/**
 * DUNGEON RUN — fast comedic party dungeon crawl.
 * One hero acts per turn (Brute Force / Magic / Chaos + a d20); everyone else
 * spends charges to BUFF or SABOTAGE the roll in real time. The Director
 * authors each room live and narrates outcomes weaving roll, meddlers and
 * character quirks together. Server owns all math.
 */

type ActionKind = "brute" | "magic" | "chaos" | "situational";

interface ClassDef {
  id: string;
  label: string;
  affinity: ActionKind;
  quirk: string;
}

const CLASSES: ClassDef[] = [
  { id: "barbarian", label: "Barbarian", affinity: "brute", quirk: "solves emotional problems with furniture" },
  { id: "wizard", label: "Wizard", affinity: "magic", quirk: "casts first, reads the fine print never" },
  { id: "rogue", label: "Rogue", affinity: "chaos", quirk: "steals from the party 'for practice'" },
  { id: "bard", label: "Bard", affinity: "chaos", quirk: "seduces first, asks names later" },
  { id: "knight", label: "Knight", affinity: "brute", quirk: "will not shut up about honor" },
  { id: "hedge_witch", label: "Hedge Witch", affinity: "magic", quirk: "brews potions of dubious legality" },
  { id: "goblin_diplomat", label: "Goblin Diplomat", affinity: "chaos", quirk: "negotiates with monsters, badly" },
  { id: "retired_pirate", label: "Retired Pirate", affinity: "chaos", quirk: "narrates everything like a sea shanty" },
  { id: "overconfident_alchemist", label: "Alchemist", affinity: "magic", quirk: "is 90% sure this one isn't poison" },
  { id: "feral_druid", label: "Feral Druid", affinity: "chaos", quirk: "was raised by raccoons, and it shows" },
  { id: "tavern_bouncer", label: "Tavern Bouncer", affinity: "brute", quirk: "checks everyone's ID, even skeletons" },
  { id: "cursed_influencer", label: "Cursed Influencer", affinity: "magic", quirk: "streams the dungeon live to no one" },
];

/** Deterministic avatar → class mapping, so the themed lobby portrait matches
 *  the class assigned at game start. MUST stay in sync with the same mapping
 *  in client/src/theme.ts (dungeonPortraitFor). */
export function classForAvatar(avatar: string): { cls: ClassDef; sex: "m" | "f" } {
  const idx = Math.max(0, (parseInt(avatar.replace(/\D/g, ""), 10) || 1) - 1);
  const cls = CLASSES[idx % CLASSES.length];
  const baseSex: "m" | "f" = idx % 2 === 0 ? "m" : "f";
  const sex = idx < CLASSES.length ? baseSex : baseSex === "m" ? "f" : "m";
  return { cls, sex };
}

const ACTION_LABEL: Record<ActionKind, string> = {
  brute: "Brute Force",
  magic: "Magic",
  chaos: "Pure Chaos",
  situational: "Improvised Gambit", // overridden by the room's actual situational label when present
};

/** casual: no KOs, 3 actions. standard: comedic KOs + a Director-invented 4th action per room */
function isStandard(room: Room): boolean {
  return room.settings.dungeonIntensity === "standard";
}

const ROOM_COUNT = 5; // default; actual count comes from room.settings.dungeonRooms
const roomsFor = (room: Room): number => room.settings.dungeonRooms ?? ROOM_COUNT;
const ENCOUNTERS_PER_ROOM = 2;
/** per the original design: 2 buff + 2 sabotage charges, REFILLED every room */
const BUFF_CHARGES = 2;
const SAB_CHARGES = 2;
/** net spectator swing is capped at ±6 per roll (extra attempts are refused) */
const SPECTATOR_NET_CAP = 6;
const ACTION_MS = 30_000;
const ROLL_MS = 25_000;
const FORGE_MS = 60_000;
const MAX_ITEMS = 4;
const LOOT_CHANCE = 0.4;

/** "Mad Libs" hero-forging pools (from the original design doc) */
const ADJECTIVES = [
  "Cowardly", "Overconfident", "Suspiciously Wet", "Perpetually Hungry",
  "Tragically Honest", "Mildly Cursed", "Allergic to Magic", "Unreasonably Calm",
  "Recently Resurrected", "Bad at Names", "Haunted by a Goose",
];
const SIGNATURE_ITEMS = [
  "a cursed spoon", "a sentient map (rude)", "a very heavy rock",
  "a sword that only cuts vegetables", "a flask of questionable courage",
  "a single immortal houseplant", "a bag of teeth (not yours)",
  "a lute with one string", 'a "lucky" coin (it is not lucky)',
  "a map to a different dungeon",
];
const BACKSTORIES = [
  "I'm only here because I owe someone a great deal of money.",
  "I seek glory, fortune, and ideally a nap.",
  "Someone told me there'd be snacks.",
  "I am legally required to complete one (1) heroic deed.",
  "Revenge. Against whom, I've forgotten.",
];

function pickOptions<T>(pool: T[], n: number): T[] {
  return [...pool].sort(() => Math.random() - 0.5).slice(0, n);
}

/** party loot — ids match the art in /img/dnd/items */
interface Item {
  id: string;
  name: string;
  /** power: +4 to the roll · shield: negates all sabotage this turn */
  effect: "power" | "shield";
}
const ITEM_POOL: Item[] = [
  { id: "sword", name: "Suspiciously Ornate Sword", effect: "power" },
  { id: "wand", name: "Wand of Mild Convenience", effect: "power" },
  { id: "potion_red", name: "Potion of Unearned Confidence", effect: "power" },
  { id: "scroll", name: "Scroll of Probably-Fireball", effect: "power" },
  { id: "torch", name: "Torch of Dramatic Lighting", effect: "power" },
  { id: "shield", name: "Emotional Support Shield", effect: "shield" },
  { id: "boot", name: "Left Boot of Evasion", effect: "shield" },
  { id: "coin", name: "Coin of Preemptive Bribery", effect: "shield" },
];

interface Turn {
  action: ActionKind | null;
  buffs: string[]; // player ids
  sabotages: string[];
  roll: number | null;
  total: number | null;
  success: boolean | null;
  /** total ≥ 20 (or nat 20): the "great success" narrative band */
  great: boolean | null;
  crit: "hit" | "fail" | null;
  difficulty: number;
  itemUsed: Item | null;
}

interface RoomCard {
  title: string;
  description: string;
  challenge: string;
  /** Standard intensity only: a 4th action option the Director invents per room */
  situational?: { label: string; description: string } | null;
}

const S = (room: Room) =>
  room.state as {
    roomIndex?: number;
    encounterInRoom?: number;
    turnIndex?: number;
    activeId?: string | null;
    turn?: Turn | null;
    currentRoom?: RoomCard | null;
    successes?: number;
    failures?: number;
    lastOutcome?: string | null;
    best?: { name: string; total: number } | null;
    worst?: { name: string; total: number } | null;
    stats?: { label: string; value: string }[] | null;
    items?: Item[];
    lastLoot?: Item | null;
    /** true once the entire party is KO'd (standard intensity only) */
    wiped?: boolean;
  };
const D = (p: ServerPlayer) =>
  p.data as {
    classId?: string;
    classLabel?: string;
    portrait?: string;
    quirk?: string;
    affinity?: ActionKind;
    buffCharges?: number;
    sabCharges?: number;
    messages?: string[];
    wins?: number;
    buffsGiven?: number;
    sabsGiven?: number;
    nat20s?: number;
    nat1s?: number;
    chaosPicks?: number;
    /** standard intensity: rolled a natural 1 and is out for the rest of the run —
     *  can no longer act but gets unlimited buff/sabotage charges as a heckler */
    koed?: boolean;
    /** mad-libs hero forging */
    adjective?: string | null;
    sigItem?: string | null;
    backstory?: string | null;
    forgeOptions?: { adjectives: string[]; items: string[]; backstories: string[] };
  };

function difficultyFor(roomIndex: number): number {
  return 10 + roomIndex; // 10..14
}

function active(room: Room): ServerPlayer | null {
  const id = S(room).activeId;
  return (id && room.players.get(id)) || null;
}

function names(room: Room, ids: string[]): string {
  return ids.map((id) => room.name(id)).join(", ");
}

// ─── Authoring ────────────────────────────────────────────────────────────────

function roomSchema(room: Room): ToolParameters {
  const properties: ToolParameters["properties"] = {
    title: { type: "string", description: "short evocative room name" },
    description: { type: "string", description: "1-2 sentences describing the room" },
    challenge: {
      type: "string",
      description: "the obstacle/monster/puzzle blocking the party, one sentence",
    },
  };
  if (isStandard(room)) {
    properties.situationalLabel = {
      type: "string",
      description:
        "a punchy 2-4 word name for a 4th action option unique to THIS room's challenge " +
        "(e.g. 'Negotiate', 'Flee the Scene', 'Bribe the Elemental') — distinct from Brute Force/Magic/Chaos",
    };
    properties.situationalDescription = {
      type: "string",
      description: "one short phrase describing what that 4th action means here",
    };
  }
  return {
    type: "object",
    properties,
    required: ["title", "description", "challenge"],
  };
}

const CANNED_ROOMS: RoomCard[] = [
  { title: "The Damp Foyer", description: "A dungeon entrance that smells aggressively of mushrooms.", challenge: "A portcullis rusted shut by centuries of neglect blocks the way." },
  { title: "The Gambling Crypt", description: "Skeletons sit around a card table, mid-game for eternity.", challenge: "The skeletal dealer insists someone plays a hand before passing." },
  { title: "The Sideways Library", description: "Bookshelves grow from the walls at impossible angles.", challenge: "A librarian golem demands the party return a book due 400 years ago." },
  { title: "The Lava Lounge", description: "A magma chamber inexplicably furnished with velvet couches.", challenge: "The only bridge across is guarded by a fire elemental doing stand-up comedy." },
  { title: "The Vault of the Big Deal", description: "The final chamber, stacked with gold and bad decisions.", challenge: "The dungeon's landlord — an ancient dragon — wants to discuss the party's security deposit." },
];

// ─── Flow ─────────────────────────────────────────────────────────────────────

function forgeComplete(p: ServerPlayer): boolean {
  const d = D(p);
  return !!d.adjective && !!d.sigItem && !!d.backstory;
}

/** everyone forged (or timer expired) → the DM introduces the party properly */
function beginIntro(room: Room): void {
  if (room.phase !== "forge") return;
  // auto-fill anyone who dawdled
  for (const p of room.alive()) {
    const d = D(p);
    const o = d.forgeOptions;
    if (!d.adjective) d.adjective = o?.adjectives[0] ?? ADJECTIVES[0];
    if (!d.sigItem) d.sigItem = o?.items[0] ?? SIGNATURE_ITEMS[0];
    if (!d.backstory) d.backstory = o?.backstories[0] ?? BACKSTORIES[0];
  }
  room.setPhase("intro");
  const players = [...room.players.values()];
  room.play({
    id: "intro",
    urgent: true,
    instruction:
      `The party is forged. Introduce each hero aloud with full mad-libs glory — ` +
      players
        .map(
          (p) =>
            `${p.name} the ${D(p).adjective} ${D(p).classLabel}, carrying ${D(p).sigItem}, motivation: "${D(p).backstory}"`,
        )
        .join("; ") +
      `. Read each backstory line with relish, mock their odds in one line, explain that heroes take turns ` +
      `facing challenges while the others BUFF or SABOTAGE from their phones — then fling open the gates. 4-6 lines.`,
    after: (r) => newRoom(r),
  });
  room.broadcast();
}

function newRoom(room: Room): void {
  const s = S(room);
  const idx = s.roomIndex ?? 0;
  // charges refill at every room — spectators should never run dry for long
  for (const p of room.players.values()) {
    D(p).buffCharges = BUFF_CHARGES;
    D(p).sabCharges = SAB_CHARGES;
  }
  room.setPhase("room_intro");
  const standard = isStandard(room);
  room.play({
    id: "room_intro",
    urgent: true,
    schema: roomSchema(room),
    onAuthored: (r, data) => {
      const d = data as
        | (Partial<RoomCard> & { situationalLabel?: string; situationalDescription?: string })
        | undefined;
      if (!d?.title || !d.challenge) throw new Error("invalid room");
      S(r).currentRoom = {
        title: String(d.title).slice(0, 60),
        description: String(d.description ?? "").slice(0, 240),
        challenge: String(d.challenge).slice(0, 240),
        situational:
          standard && d.situationalLabel
            ? {
                label: String(d.situationalLabel).slice(0, 30),
                description: String(d.situationalDescription ?? "").slice(0, 120),
              }
            : null,
      };
    },
    instruction:
      `The party enters room ${idx + 1} of ${roomsFor(room)}${idx === roomsFor(room) - 1 ? " — the FINAL room" : ""}. ` +
      `Author it in \`data\` (title, description, challenge` +
      (standard ? ", situationalLabel, situationalDescription" : "") +
      `) — escalate the stakes and absurdity with depth.` +
      (standard
        ? " This is STANDARD intensity: invent a 4th situational action option unique to this room, distinct from Brute Force/Magic/Chaos."
        : "") +
      ` Then narrate the party's entrance and the challenge in 2-3 vivid, funny lines.`,
    after: (r) => startTurn(r),
  });
  room.broadcast();
}

/** heroes still able to take a turn (excludes standard-intensity KOs) */
function activeRoster(room: Room): ServerPlayer[] {
  return room.alive().filter((p) => !D(p).koed);
}

function startTurn(room: Room): void {
  const s = S(room);
  const roster = activeRoster(room);
  if (!roster.length) {
    s.wiped = true;
    return finale(room);
  }
  const hero = roster[(s.turnIndex ?? 0) % roster.length];
  s.activeId = hero.id;
  s.turn = {
    action: null,
    buffs: [],
    sabotages: [],
    roll: null,
    total: null,
    success: null,
    great: null,
    crit: null,
    difficulty: difficultyFor(s.roomIndex ?? 0),
    itemUsed: null,
  };
  s.lastLoot = null;
  for (const p of room.players.values()) p.spotlight = p.id === hero.id;
  room.setPhase("action_pick");
  // setPhase clears spotlights — reapply
  for (const p of room.players.values()) p.spotlight = p.id === hero.id;
  room.setTimer("action_pick", ACTION_MS);
  room.broadcast();
}

function beginRoll(room: Room): void {
  if (room.phase !== "action_pick") return;
  room.setPhase("rolling");
  const s = S(room);
  for (const p of room.players.values()) p.spotlight = p.id === s.activeId;
  room.setTimer("roll", ROLL_MS);
  room.broadcast();
}

function doRoll(room: Room): void {
  if (room.phase !== "rolling") return;
  const s = S(room);
  const turn = s.turn;
  const hero = active(room);
  if (!turn || !hero) return;

  const roll = 1 + Math.floor(Math.random() * 20);
  const affinityBonus = turn.action && turn.action !== "situational" && D(hero).affinity === turn.action ? 2 : 0;
  const itemBonus = turn.itemUsed?.effect === "power" ? 4 : 0;
  const sabotagePenalty = turn.itemUsed?.effect === "shield" ? 0 : turn.sabotages.length * 2;
  const modifier = affinityBonus + itemBonus + turn.buffs.length * 2 - sabotagePenalty;
  const total = roll + modifier;
  const crit = roll === 20 ? "hit" : roll === 1 ? "fail" : null;
  const success = crit === "hit" ? true : crit === "fail" ? false : total >= turn.difficulty;
  const great = success && (crit === "hit" || total >= 20);

  turn.roll = roll;
  turn.total = total;
  turn.success = success;
  turn.great = great;
  turn.crit = crit;
  if (crit === "hit") D(hero).nat20s = (D(hero).nat20s ?? 0) + 1;
  if (crit === "fail") D(hero).nat1s = (D(hero).nat1s ?? 0) + 1;
  if (turn.action === "chaos") D(hero).chaosPicks = (D(hero).chaosPicks ?? 0) + 1;

  // standard intensity: a natural 1 knocks the hero out for the rest of the run —
  // they become an unlimited-charge heckler instead
  const justKoed = crit === "fail" && isStandard(room);
  if (justKoed) D(hero).koed = true;
  if (success) {
    s.successes = (s.successes ?? 0) + 1;
    D(hero).wins = (D(hero).wins ?? 0) + 1;
  } else {
    s.failures = (s.failures ?? 0) + 1;
  }
  if (!s.best || total > s.best.total) s.best = { name: hero.name, total };
  if (!s.worst || total < s.worst.total) s.worst = { name: hero.name, total };

  // loot drop on success
  const inventory = (s.items ??= []);
  if (success && inventory.length < MAX_ITEMS && Math.random() < LOOT_CHANCE) {
    const item = ITEM_POOL[Math.floor(Math.random() * ITEM_POOL.length)];
    inventory.push(item);
    s.lastLoot = item;
  }

  room.sfx("dice");
  room.setPhase("outcome");
  room.broadcast();

  const meddling =
    (turn.buffs.length ? `BUFFED by ${names(room, turn.buffs)} (+${turn.buffs.length * 2}). ` : "") +
    (turn.sabotages.length
      ? turn.itemUsed?.effect === "shield"
        ? `${names(room, turn.sabotages)} tried to sabotage but the ${turn.itemUsed.name} BLOCKED it all. `
        : `SABOTAGED by ${names(room, turn.sabotages)} (-${turn.sabotages.length * 2}). `
      : "");
  const itemNote =
    turn.itemUsed && turn.itemUsed.effect === "power"
      ? `They used the ${turn.itemUsed.name} (+4). `
      : "";
  const lootNote = s.lastLoot
    ? `The party LOOTED a new item: "${s.lastLoot.name}" — announce it with glee. `
    : "";
  const actionLabel =
    turn.action === "situational"
      ? s.currentRoom?.situational?.label ?? "an improvised gambit"
      : ACTION_LABEL[turn.action ?? "chaos"];
  const koNote = justKoed
    ? `${hero.name} is KNOCKED OUT COLD by this catastrophe — comedically, not gruesomely (they're fine, just ` +
      `done for tonight). They become a permanent heckler on the sidelines for the rest of the run. Make their ` +
      `KO the highlight of this narration. `
    : "";

  room.play({
    id: "outcome",
    instruction:
      `${hero.name} the ${D(hero).classLabel} (quirk: ${D(hero).quirk}) attempted ${actionLabel} ` +
      `against: ${s.currentRoom?.challenge ?? "the challenge"}. ` +
      `Rolled ${roll} on the d20${affinityBonus ? ` +${affinityBonus} class affinity` : ""}. ${itemNote}${meddling}` +
      `Final total ${total} vs difficulty ${turn.difficulty} → ${great ? "GREAT SUCCESS (spectacular — maximum glory)" : success ? "SUCCESS" : "FAILURE"}` +
      `${crit === "hit" ? " (NATURAL 20 — legendary!)" : crit === "fail" ? " (NATURAL 1 — catastrophic!)" : ""}. ` +
      `${koNote}Narrate the outcome in 2-3 hilarious lines, weaving in their quirk (${D(hero).adjective ?? "?"}) and their ` +
      `signature item (${D(hero).sigItem ?? "?"}) if it's funny, and CALLING OUT the meddlers by name ` +
      `${turn.sabotages.length ? "(roast the saboteurs)" : ""}. ${lootNote}Keep the party moving.`,
    after: (r) => advance(r),
  });
}

function advance(room: Room): void {
  const s = S(room);
  s.turnIndex = (s.turnIndex ?? 0) + 1;
  s.lastOutcome = null;
  const nextEncounter = (s.encounterInRoom ?? 0) + 1;
  if (nextEncounter >= ENCOUNTERS_PER_ROOM) {
    s.encounterInRoom = 0;
    s.roomIndex = (s.roomIndex ?? 0) + 1;
    if ((s.roomIndex ?? 0) >= roomsFor(room)) return finale(room);
    newRoom(room);
  } else {
    s.encounterInRoom = nextEncounter;
    startTurn(room);
  }
}

function finale(room: Room): void {
  const s = S(room);
  const wins = s.successes ?? 0;
  const losses = s.failures ?? 0;
  const victorious = !s.wiped && wins >= losses;

  // game-over stats
  const players = [...room.players.values()];
  const stats: { label: string; value: string }[] = [
    { label: "Final tally", value: `${wins} triumphs · ${losses} disasters` },
  ];
  const mvp = [...players].sort((a, b) => (D(b).wins ?? 0) - (D(a).wins ?? 0))[0];
  if (mvp && (D(mvp).wins ?? 0) > 0) {
    stats.push({ label: "MVP", value: `${mvp.name} (${D(mvp).wins} triumphs)` });
  }
  if (s.best) stats.push({ label: "Best roll", value: `${s.best.name} — ${s.best.total}` });
  if (s.worst) stats.push({ label: "Worst roll", value: `${s.worst.name} — ${s.worst.total}` });
  const angel = [...players].sort((a, b) => (D(b).buffsGiven ?? 0) - (D(a).buffsGiven ?? 0))[0];
  if (angel && (D(angel).buffsGiven ?? 0) > 0) {
    stats.push({ label: "Guardian angel", value: `${angel.name} (${D(angel).buffsGiven} blessings)` });
  }
  const menace = [...players].sort((a, b) => (D(b).sabsGiven ?? 0) - (D(a).sabsGiven ?? 0))[0];
  if (menace && (D(menace).sabsGiven ?? 0) > 0) {
    stats.push({ label: "The menace", value: `${menace.name} (${D(menace).sabsGiven} sabotages)` });
  }
  const nat20Club = players.filter((p) => (D(p).nat20s ?? 0) > 0);
  if (nat20Club.length) {
    stats.push({ label: "Natural 20 Club", value: nat20Club.map((p) => p.name).join(", ") });
  }
  const cursed = [...players].sort((a, b) => (D(b).nat1s ?? 0) - (D(a).nat1s ?? 0))[0];
  if (cursed && (D(cursed).nat1s ?? 0) > 0) {
    stats.push({ label: "Cursed dice", value: `${cursed.name} (${D(cursed).nat1s} natural 1s)` });
  }
  const gremlin = [...players].sort((a, b) => (D(b).chaosPicks ?? 0) - (D(a).chaosPicks ?? 0))[0];
  if (gremlin && (D(gremlin).chaosPicks ?? 0) > 1) {
    stats.push({ label: "Chaos gremlin", value: `${gremlin.name} (chose chaos ${D(gremlin).chaosPicks}×)` });
  }
  s.stats = stats;

  room.endGame(victorious ? players.map((p) => p.name) : []);
  room.play({
    id: "gameover",
    urgent: true,
    instruction: s.wiped
      ? `TOTAL PARTY WIPEOUT — every last hero has been knocked out cold. Final tally: ${wins} triumphs, ` +
        `${losses} disasters. Deliver the most theatrical eulogy of your career: recap the run's best and ` +
        `dumbest moments, crown a "last one standing (briefly)" and a "most chaotic" award, and dare them to ` +
        `try again. 4-6 lines.`
      : victorious
        ? `THE PARTY ESCAPES THE DUNGEON! Final tally: ${wins} triumphs, ${losses} disasters. Deliver a rousing ` +
          `finale: recap the run's best and dumbest moments, crown an MVP and a "most chaotic" award, and send ` +
          `them off. 4-6 lines.`
        : `THE DUNGEON WINS. Final tally: ${wins} triumphs, ${losses} disasters — the party limps home in shame. ` +
          `Eulogize their incompetence lovingly, name the worst roll and the most treacherous saboteur, and dare ` +
          `them to try again. 4-6 lines.`,
  });
  room.broadcast();
}

// ─── Module ───────────────────────────────────────────────────────────────────

export const dungeon: GameModule = {
  id: "dungeon",
  name: "Dungeon Run",
  tagline: "Five rooms. One hero at a time. Your friends control your fate.",
  minPlayers: 3,
  maxPlayers: 10,

  voiceStyle:
    `"Grimtongue", an ancient dungeon master: deep, gravelly, resonant, movie-trailer gravitas at a ` +
    `steady rolling pace — grand and booming but never shouty, with dry amusement underneath`,

  persona:
    `You are "Grimtongue" — the booming, gleefully sadistic (but secretly fond) Dungeon Master of DUNGEON RUN, ` +
    `a fast comedy dungeon crawl. You authored this dungeon and you delight in the party's suffering and their ` +
    `rare, accidental competence. Address players by name and class. Style: high-fantasy bombast undercut by ` +
    `modern deadpan — think a movie-trailer voice doing observational comedy. Every line is spoken aloud: keep ` +
    `lines short, punchy, quotable. Never break character, never mention being an AI.`,

  setup(room: Room): void {
    const players = [...room.players.values()];
    players.forEach((p) => {
      // class follows the avatar they picked in the lobby (see classForAvatar)
      const { cls, sex } = classForAvatar(p.avatar);
      D(p).classId = cls.id;
      D(p).classLabel = cls.label;
      D(p).portrait = `${cls.id}_${sex}`;
      D(p).quirk = cls.quirk;
      D(p).affinity = cls.affinity;
      D(p).buffCharges = BUFF_CHARGES;
      D(p).sabCharges = SAB_CHARGES;
      D(p).koed = false;
      D(p).messages = [];
      D(p).forgeOptions = {
        adjectives: pickOptions(ADJECTIVES, 3),
        items: pickOptions(SIGNATURE_ITEMS, 3),
        backstories: pickOptions(BACKSTORIES, 3),
      };
      p.tag = cls.label;
    });
    const s = S(room);
    s.roomIndex = 0;
    s.encounterInRoom = 0;
    s.turnIndex = 0;
    s.successes = 0;
    s.failures = 0;

    // mad-libs hero forging: pick an adjective, a signature item, a backstory
    room.setPhase("forge");
    room.play({
      id: "forge",
      instruction:
        `${players.length} would-be heroes stand at the dungeon gates. In 2 short lines: introduce yourself ` +
        `and command them to FORGE THEIR LEGEND on their phones — choosing what kind of disaster they are, ` +
        `what they carry, and why they're even here.`,
      after: (r) => {
        if (r.phase === "forge") r.setTimer("forge", FORGE_MS);
      },
    });
  },

  onAction(room: Room, playerId: string, action: PlayerAction): void {
    const player = room.players.get(playerId);
    if (!player || player.status !== "alive") return;
    const s = S(room);
    const isActive = s.activeId === playerId;

    switch (action.kind) {
      case "forge_pick": {
        if (room.phase !== "forge") return;
        const d = D(player);
        const o = d.forgeOptions;
        if (!o) return;
        const value = String(action.value);
        const category = String(action.category);
        if (category === "adjective" && o.adjectives.includes(value)) d.adjective = value;
        else if (category === "item" && o.items.includes(value)) d.sigItem = value;
        else if (category === "backstory" && o.backstories.includes(value)) d.backstory = value;
        else return;
        player.done = forgeComplete(player);
        if (room.alive().every((p) => forgeComplete(p))) beginIntro(room);
        else room.broadcast();
        return;
      }
      case "pick_action": {
        if (room.phase !== "action_pick" || !isActive || !s.turn) return;
        const a = String(action.action) as ActionKind;
        const options: ActionKind[] = ["brute", "magic", "chaos"];
        if (s.currentRoom?.situational) options.push("situational");
        if (!options.includes(a)) return;
        s.turn.action = a;
        beginRoll(room);
        return;
      }
      case "roll": {
        if (room.phase !== "rolling" || !isActive) return;
        doRoll(room);
        return;
      }
      case "use_item": {
        if (!["action_pick", "rolling"].includes(room.phase)) return;
        if (!isActive || !s.turn || s.turn.itemUsed) return;
        const inventory = s.items ?? [];
        const idx = inventory.findIndex((it) => it.id === String(action.itemId));
        if (idx === -1) return;
        s.turn.itemUsed = inventory.splice(idx, 1)[0];
        room.broadcast();
        return;
      }
      case "spend": {
        if (!["action_pick", "rolling"].includes(room.phase)) return;
        if (isActive || !s.turn) return;
        const kind = action.spendKind === "sabotage" ? "sabotage" : "buff";
        const d = D(player);
        // standard-intensity KO'd heroes become unlimited-charge hecklers
        const unlimited = !!d.koed;
        const pool = kind === "buff" ? (d.buffCharges ?? 0) : (d.sabCharges ?? 0);
        if (!unlimited && pool <= 0) return;
        // net swing cap ±6 per roll — attempts past the cap are refused
        const buffs = s.turn.buffs.length + (kind === "buff" ? 1 : 0);
        const sabs = s.turn.sabotages.length + (kind === "sabotage" ? 1 : 0);
        const net = buffs * 2 - sabs * 2;
        if (net > SPECTATOR_NET_CAP || net < -SPECTATOR_NET_CAP) return;
        if (kind === "buff") {
          if (!unlimited) d.buffCharges = pool - 1;
          d.buffsGiven = (d.buffsGiven ?? 0) + 1;
        } else {
          if (!unlimited) d.sabCharges = pool - 1;
          d.sabsGiven = (d.sabsGiven ?? 0) + 1;
        }
        (kind === "buff" ? s.turn.buffs : s.turn.sabotages).push(playerId);
        room.broadcast();
        return;
      }
    }
  },

  banter(room: Room): string | null {
    const s = S(room);
    const hero = s.activeId ? room.name(s.activeId) : null;
    switch (room.phase) {
      case "action_pick":
        return hero
          ? `${hero} is taking FOREVER to choose an approach. ONE taunting line to hurry them. Nothing else.`
          : null;
      case "rolling":
        return hero
          ? `${hero} is hovering over the dice. ONE line daring them to roll. Nothing else.`
          : null;
      default:
        return null;
    }
  },

  onTimer(room: Room, label: string): void {
    const s = S(room);
    if (label === "forge" && room.phase === "forge") {
      beginIntro(room);
    } else if (label === "action_pick" && room.phase === "action_pick" && s.turn) {
      // hero froze — the dungeon picks for them
      const options: ActionKind[] = ["brute", "magic", "chaos"];
      if (s.currentRoom?.situational) options.push("situational");
      s.turn.action = options[Math.floor(Math.random() * options.length)];
      beginRoll(room);
    } else if (label === "roll" && room.phase === "rolling") {
      doRoll(room);
    }
  },

  publicState(room: Room) {
    const s = S(room);
    const turn = s.turn;
    return {
      roomIndex: s.roomIndex ?? 0,
      roomCount: roomsFor(room),
      encounterInRoom: s.encounterInRoom ?? 0,
      encountersPerRoom: ENCOUNTERS_PER_ROOM,
      roomArt: `room_${Math.min(5, (s.roomIndex ?? 0) + 1)}`,
      currentRoom: s.currentRoom ?? null,
      activeId: s.activeId ?? null,
      activeName: s.activeId ? room.name(s.activeId) : null,
      turn: turn
        ? {
            action: turn.action,
            actionLabel: turn.action ? ACTION_LABEL[turn.action] : null,
            buffNames: turn.buffs.map((id) => room.name(id)),
            sabotageNames: turn.sabotages.map((id) => room.name(id)),
            roll: turn.roll,
            total: turn.total,
            success: turn.success,
            crit: turn.crit,
            great: turn.great,
            difficulty: turn.difficulty,
            itemUsed: turn.itemUsed,
          }
        : null,
      items: s.items ?? [],
      lastLoot: s.lastLoot ?? null,
      score: { successes: s.successes ?? 0, failures: s.failures ?? 0 },
      stats: s.stats ?? null,
      heroes: Object.fromEntries(
        [...room.players.values()].map((p) => [
          p.id,
          {
            classLabel: D(p).classLabel ?? "?",
            portrait: D(p).portrait ?? "rogue_m",
            charges: (D(p).buffCharges ?? 0) + (D(p).sabCharges ?? 0),
            koed: D(p).koed ?? false,
          },
        ]),
      ),
    };
  },

  privateState(room: Room, playerId: string) {
    const player = room.players.get(playerId);
    if (!player) return null;
    const d = D(player);
    const s = S(room);
    return {
      id: playerId,
      classId: d.classId ?? null,
      classLabel: d.classLabel ?? null,
      portrait: d.portrait ?? null,
      quirk: d.quirk ?? null,
      adjective: d.adjective ?? null,
      sigItem: d.sigItem ?? null,
      backstory: d.backstory ?? null,
      forgeOptions: room.phase === "forge" ? d.forgeOptions ?? null : null,
      affinity: d.affinity ?? null,
      buffCharges: d.buffCharges ?? 0,
      sabCharges: d.sabCharges ?? 0,
      koed: d.koed ?? false,
      isActive: s.activeId === playerId,
      messages: d.messages ?? [],
    };
  },

  buildContext(room: Room): string {
    const s = S(room);
    const roster = [...room.players.values()]
      .map(
        (p) =>
          `- ${p.name} (id:${p.id}) — the ${D(p).adjective ?? ""} ${D(p).classLabel} (${D(p).quirk}), ` +
          `carrying ${D(p).sigItem ?? "nothing notable"}, motivation "${D(p).backstory ?? "?"}", ` +
          `affinity ${D(p).affinity}, ▲${D(p).buffCharges ?? 0}/▼${D(p).sabCharges ?? 0} charges` +
          (D(p).koed ? " — KO'D, now a heckler with unlimited charges" : ""),
      )
      .join("\n");
    return (
      `GAME: Dungeon Run — room ${(s.roomIndex ?? 0) + 1}/${roomsFor(room)}, encounter ${(s.encounterInRoom ?? 0) + 1}/${ENCOUNTERS_PER_ROOM}, phase ${room.phase}.\n` +
      `SCORE: ${s.successes ?? 0} successes, ${s.failures ?? 0} failures.\n` +
      (s.currentRoom
        ? `CURRENT ROOM: "${s.currentRoom.title}" — ${s.currentRoom.description} Challenge: ${s.currentRoom.challenge}\n`
        : "") +
      (s.activeId ? `ACTIVE HERO: ${room.name(s.activeId)}\n` : "") +
      `THE PARTY:\n${roster}`
    );
  },

  canned(beatId: string, room: Room) {
    const s = S(room);
    switch (beatId) {
      case "forge":
        return [
          { text: "I am Grimtongue, and this dungeon has standards. Forge your legends on your phones — quickly.", mood: "booming" },
        ];
      case "intro":
        return [
          { text: "Mortals! I am Grimtongue, and this dungeon is my life's work. Please wipe your feet.", mood: "booming" },
          { text: "One hero acts at a time. The rest of you may bless or ruin them from your phones. I encourage ruin.", mood: "gleeful" },
          { text: "The gates open. Try not to die in the foyer — it's embarrassing for everyone.", mood: "deadpan" },
        ];
      case "room_intro": {
        const r = s.currentRoom;
        return [
          { text: `The party enters: ${r?.title ?? "a new chamber"}.`, mood: "ominous" },
          { text: r?.challenge ?? "Something unpleasant blocks the way.", mood: "menacing" },
        ];
      }
      case "outcome": {
        const t = s.turn;
        return t?.success
          ? [{ text: `A ${t.total}! Against difficulty ${t.difficulty}, that is — annoyingly — a success.`, mood: "begrudging" }]
          : [{ text: `A ${t?.total}. The dungeon thanks you for your generous donation of dignity.`, mood: "mocking" }];
      }
      case "gameover":
        return [
          { text: (s.successes ?? 0) >= (s.failures ?? 0) ? "Against all odds — and my sincere efforts — the party escapes!" : "The dungeon claims another party. I'll add your portraits to the wall.", mood: "dramatic" },
          { text: "Come back soon. I'll leave the portcullis unlocked.", mood: "warm" },
        ];
      case "banter":
        return [{ text: "Take your time. The dungeon charges rent by the minute.", mood: "deadpan" }];
      default:
        return [{ text: "The dungeon rumbles..." }];
    }
  },

  cannedData(beatId: string, room: Room) {
    if (beatId === "room_intro") {
      return CANNED_ROOMS[Math.min(CANNED_ROOMS.length - 1, S(room).roomIndex ?? 0)];
    }
    return undefined;
  },
};
