import type { PlayerAction } from "../../../../shared/src/index.js";
import type { Room, ServerPlayer } from "../../engine/room.js";
import type { GameModule, ToolParameters } from "../../engine/types.js";

/**
 * WHODUNNIT — collaborative murder mystery.
 * The Director authors a unique scenario live (victim, setting, a comedic
 * character per player) and drips public + private clues as players roam the
 * manor. Accusations trigger trials; wrong convictions cost reputation and
 * burn one of three rounds before the killer escapes.
 */

/** the six location paintings we have art for */
const LOCATION_ART = [
  "library",
  "billiard-room",
  "drawing-room",
  "gazebo",
  "master-bedroom",
  "generic",
] as const;

interface Scenario {
  title: string;
  setting: string;
  victimName: string;
  victimDescription: string;
  weapon: string;
}
interface Trial {
  accusedId: string;
  alibi: string | null;
}
interface Outcome {
  name: string;
  convicted: boolean;
  wasKiller: boolean;
  tied?: boolean;
}

const S = (room: Room) =>
  room.state as {
    scenario?: Scenario | null;
    locations?: { id: string; name: string }[];
    clues?: { round: number; locationId: string; text: string }[];
    trial?: Trial | null;
    lastOutcome?: Outcome | null;
    maxRounds?: number;
    stats?: { label: string; value: string }[] | null;
  };
const D = (p: ServerPlayer) =>
  p.data as {
    isKiller?: boolean;
    /** knows who the killer is; must protect them without exposing themselves */
    isAccomplice?: boolean;
    character?: { name: string; quirk: string } | null;
    location?: string | null;
    clues?: string[];
    suspect?: string | null;
    verdictVote?: "guilty" | "innocent" | null;
    reputation?: number;
    cleared?: boolean;
    messages?: string[];
  };

const MOVE_MS = 45_000;
const ACCUSATION_MS = 45_000;
const VERDICT_MS = 60_000;
const MAX_ROUNDS = 3;

const ALIBI_OPTIONS = [
  "I was asleep. Alone. Suspiciously alone.",
  "I would NEVER. I have a reputation!",
  "It was dark, I saw nothing, I know nothing.",
  "Fine, I was there — but so was everyone else!",
];

function killers(room: Room): ServerPlayer[] {
  return [...room.players.values()].filter((p) => D(p).isKiller);
}

function accomplices(room: Room): ServerPlayer[] {
  return [...room.players.values()].filter((p) => D(p).isAccomplice);
}

/** killer team = killer(s) + accomplice(s) — they win/lose together */
function killerTeam(room: Room): ServerPlayer[] {
  return [...room.players.values()].filter((p) => D(p).isKiller || D(p).isAccomplice);
}

function locationName(room: Room, id: string): string {
  return S(room).locations?.find((l) => l.id === id)?.name ?? id;
}

function occupants(room: Room, locId: string): ServerPlayer[] {
  return room.alive().filter((p) => D(p).location === locId);
}

// ─── Authoring schemas ────────────────────────────────────────────────────────

function scenarioSchema(room: Room): ToolParameters {
  return {
    type: "object",
    properties: {
      title: { type: "string", description: "punchy mystery title" },
      setting: { type: "string", description: "one-sentence setting" },
      victimName: { type: "string", description: "the murder victim (an NPC, not a player)" },
      victimDescription: { type: "string", description: "one juicy sentence about the victim" },
      weapon: { type: "string", description: "comedic-but-plausible murder weapon" },
      locationNames: {
        type: "array",
        description:
          "EXACTLY 6 evocative names, in order, re-flavoring: library, billiard room, drawing room, gazebo, master bedroom, the grounds",
        items: { type: "string" },
      },
      characters: {
        type: "array",
        description: `one entry per player id: ${[...room.players.keys()].join(", ")}`,
        items: {
          type: "object",
          properties: {
            playerId: { type: "string" },
            characterName: { type: "string", description: "comedic period character name" },
            quirk: { type: "string", description: "one funny defining quirk/secret (not the murder)" },
          },
          required: ["playerId", "characterName", "quirk"],
        } as unknown as ToolParameters["properties"][string]["items"],
      },
    },
    required: ["title", "setting", "victimName", "victimDescription", "weapon", "locationNames", "characters"],
  };
}

function cluesSchema(room: Room): ToolParameters {
  return {
    type: "object",
    properties: {
      publicClues: {
        type: "array",
        description: "one clue per OCCUPIED location (locationId must be one of: " + LOCATION_ART.join(", ") + ")",
        items: {
          type: "object",
          properties: {
            locationId: { type: "string", enum: [...LOCATION_ART] },
            text: { type: "string", description: "the clue found there, 1-2 sentences" },
          },
          required: ["locationId", "text"],
        } as unknown as ToolParameters["properties"][string]["items"],
      },
      privateClues: {
        type: "array",
        description: `1-3 secret tips to individual players (player ids: ${room.alive().map((p) => p.id).join(", ")})`,
        items: {
          type: "object",
          properties: {
            playerId: { type: "string" },
            text: { type: "string" },
          },
          required: ["playerId", "text"],
        } as unknown as ToolParameters["properties"][string]["items"],
      },
    },
    required: ["publicClues"],
  };
}

// ─── Flow ─────────────────────────────────────────────────────────────────────

function startInvestigation(room: Room): void {
  room.round++;
  room.setPhase("investigation");
  S(room).trial = null;
  for (const p of room.players.values()) {
    D(p).location = null;
    D(p).suspect = null;
    D(p).verdictVote = null;
  }
  room.play({
    id: "investigation_open",
    urgent: true,
    instruction:
      `Investigation round ${room.round} of ${S(room).maxRounds ?? MAX_ROUNDS} begins. In 1-2 lines, send the suspects off to ` +
      `search the estate — each must pick a location on their phone. Tease that the truth is hiding somewhere.`,
    after: (r) => {
      if (r.phase === "investigation") r.setTimer("move", MOVE_MS);
    },
  });
  room.broadcast();
}

function revealClues(room: Room): void {
  if (room.phase !== "investigation") return;
  // anyone who never moved gets dumped somewhere random
  for (const p of room.alive()) {
    if (!D(p).location) {
      D(p).location = LOCATION_ART[Math.floor(Math.random() * LOCATION_ART.length)];
      p.done = true;
    }
  }
  room.setPhase("clue_reveal");

  const occupied = LOCATION_ART.filter((id) => occupants(room, id).length);
  const whoWhere = occupied
    .map(
      (id) =>
        `${locationName(room, id)} (${id}): ${occupants(room, id)
          .map((p) => `${p.name} as ${D(p).character?.name ?? "?"}`)
          .join(", ")}`,
    )
    .join("; ");

  const finalRound = room.round >= (S(room).maxRounds ?? MAX_ROUNDS);
  room.play({
    id: "clues",
    urgent: true,
    schema: cluesSchema(room),
    onAuthored: (r, data) => applyClues(r, data),
    instruction:
      `The suspects searched: ${whoWhere}. Author the evidence in \`data\`: ONE public clue per occupied ` +
      `location (things found there, consistent with your scenario and with the killer's identity — clues ` +
      `should ${finalRound ? "now point STRONGLY at the killer" : "point suggestively but ambiguously"}). ` +
      `Also 1-3 privateClues: the killer should get cover material or a nervous nudge; sharp investigators ` +
      `get a real lead. In your spoken lines, dramatically narrate the search — name who found what where. ` +
      `Then tell everyone it's time to pick their prime suspect.`,
    after: (r) => {
      r.setPhase("accusation");
      r.setTimer("accusation", ACCUSATION_MS);
      r.broadcast();
    },
  });
  room.broadcast();
}

function applyClues(room: Room, data: unknown): void {
  const d = data as {
    publicClues?: { locationId?: string; text?: string }[];
    privateClues?: { playerId?: string; text?: string }[];
  };
  if (!d || !Array.isArray(d.publicClues) || !d.publicClues.length) {
    throw new Error("no public clues");
  }
  const clues = S(room).clues ?? [];
  for (const c of d.publicClues) {
    if (typeof c.text === "string" && typeof c.locationId === "string") {
      clues.push({ round: room.round, locationId: c.locationId, text: c.text.slice(0, 300) });
    }
  }
  S(room).clues = clues;
  for (const pc of d.privateClues ?? []) {
    const player = pc.playerId ? room.players.get(pc.playerId) : undefined;
    if (player && typeof pc.text === "string") {
      const mine = D(player).clues ?? [];
      mine.push(pc.text.slice(0, 300));
      D(player).clues = mine;
      room.whisper(player.id, pc.text.slice(0, 300));
    }
  }
}

function resolveAccusation(room: Room): void {
  if (room.phase !== "accusation") return;
  const tally = new Map<string, number>();
  for (const p of room.alive()) {
    const s = D(p).suspect;
    if (s && room.players.get(s)) tally.set(s, (tally.get(s) ?? 0) + 1);
  }
  let top: string | null = null;
  let topCount = 0;
  let tied = false;
  for (const [id, count] of tally) {
    if (count > topCount) [top, topCount, tied] = [id, count, false];
    else if (count === topCount) tied = true;
  }

  if (!top || tied) {
    S(room).lastOutcome = { name: "", convicted: false, wasKiller: false, tied: true };
    if (room.round >= (S(room).maxRounds ?? MAX_ROUNDS)) return killerEscapes(room);
    room.play({
      id: "no_consensus",
      urgent: true,
      instruction:
        `The suspects couldn't agree on whom to put on trial. Mock their indecision in 1-2 lines and warn ` +
        `them the trail is going cold. Round ${room.round} of ${S(room).maxRounds ?? MAX_ROUNDS} is spent.`,
      after: (r) => startInvestigation(r),
    });
    return;
  }

  const accused = room.players.get(top)!;
  S(room).trial = { accusedId: accused.id, alibi: null };
  room.setPhase("verdict");
  accused.spotlight = true;
  room.play({
    id: "trial_open",
    urgent: true,
    instruction:
      `${accused.name} (playing ${D(accused).character?.name ?? "themselves"}) stands accused of the murder! ` +
      `Put them on the spot theatrically — demand their alibi (they'll answer on their phone) — then command ` +
      `everyone else to vote GUILTY or INNOCENT. 2-4 lines, maximum drama.`,
    after: (r) => {
      if (r.phase === "verdict") r.setTimer("verdict", VERDICT_MS);
    },
  });
  room.broadcast();
}

function resolveVerdict(room: Room): void {
  if (room.phase !== "verdict") return;
  const trial = S(room).trial;
  if (!trial) return;
  const accused = room.players.get(trial.accusedId);
  if (!accused) return;

  let guilty = 0;
  let innocent = 0;
  for (const p of room.alive()) {
    if (p.id === accused.id) continue;
    if (D(p).verdictVote === "guilty") guilty++;
    else if (D(p).verdictVote === "innocent") innocent++;
  }
  const convicted = guilty > innocent;
  const wasKiller = !!D(accused).isKiller;
  S(room).lastOutcome = { name: accused.name, convicted, wasKiller };

  if (convicted && wasKiller) {
    const others = [...room.players.values()].filter(
      (p) => !D(p).isKiller && !D(p).isAccomplice,
    );
    return revelation(room, others.map((p) => p.name), true);
  }

  if (convicted && !wasKiller) {
    // note: a convicted ACCOMPLICE also lands here — the game "clears" them,
    // which is a delicious lie revealed at the end
    D(accused).cleared = true;
    for (const p of room.alive()) {
      if (p.id !== accused.id && D(p).verdictVote === "guilty") {
        D(p).reputation = Math.max(0, (D(p).reputation ?? 3) - 1);
      }
    }
    if (room.round >= (S(room).maxRounds ?? MAX_ROUNDS)) return killerEscapes(room);
    room.play({
      id: "wrong_verdict",
      urgent: true,
      instruction:
        `Disaster! The room convicted ${accused.name} — who is provably INNOCENT (reveal that, and clear ` +
        `their name with a flourish). Shame everyone who voted guilty (they just lost reputation). The real ` +
        `killer walks free and round ${room.round} of ${S(room).maxRounds ?? MAX_ROUNDS} is spent. 2-4 lines.`,
      after: (r) => startInvestigation(r),
    });
    return;
  }

  // acquitted
  if (room.round >= (S(room).maxRounds ?? MAX_ROUNDS)) return killerEscapes(room);
  room.play({
    id: "acquittal",
    urgent: true,
    instruction:
      `The room acquitted ${accused.name}${wasKiller ? " — and little do they know, they just let the actual killer walk. Do NOT reveal this; savor the dramatic irony privately" : ", who walks free"}. ` +
      `Narrate the acquittal in 1-2 lines and warn that time is running out — round ${room.round} of ${S(room).maxRounds ?? MAX_ROUNDS} is spent.`,
    after: (r) => startInvestigation(r),
  });
}

function killerEscapes(room: Room): void {
  revelation(room, killerTeam(room).map((p) => p.name), false);
}

function revelation(room: Room, winners: string[], solved: boolean): void {
  room.setPhase("revelation");
  room.winners = winners;
  const killerNames = killers(room)
    .map((p) => `${p.name} (as ${D(p).character?.name ?? "?"})`)
    .join(" and ");

  // game-over stats
  const stats: { label: string; value: string }[] = [
    { label: "The killer", value: killerNames },
    ...(accomplices(room).length
      ? [
          {
            label: "The accomplice",
            value: accomplices(room)
              .map((p) => `${p.name} (as ${D(p).character?.name ?? "?"})`)
              .join(" and "),
          },
        ]
      : []),
    {
      label: solved ? "Case closed in" : "The trail went cold after",
      value: `${room.round} of ${S(room).maxRounds ?? MAX_ROUNDS} rounds`,
    },
  ];
  const reckless = [...room.players.values()]
    .map((p) => ({ p, lost: 3 - (D(p).reputation ?? 3) }))
    .filter((x) => x.lost > 0)
    .sort((a, b) => b.lost - a.lost)[0];
  if (reckless) {
    stats.push({
      label: "Most reckless juror",
      value: `${reckless.p.name} (−${reckless.lost} reputation)`,
    });
  }
  const cleared = [...room.players.values()].filter((p) => D(p).cleared);
  if (cleared.length) {
    stats.push({
      label: "Wrongly convicted",
      value: cleared.map((p) => p.name).join(", "),
    });
  }
  S(room).stats = stats;
  const accompliceReveal = accomplices(room).length
    ? ` And unmask the ACCOMPLICE too: ${accomplices(room)
        .map((p) => `${p.name} (as ${D(p).character?.name ?? "?"})`)
        .join(" and ")} — who covered for the killer all along${
        accomplices(room).some((p) => D(p).cleared)
          ? ", and was even publicly 'cleared' by this gullible room"
          : ""
      }.`
    : "";
  room.play({
    id: "revelation",
    urgent: true,
    instruction: solved
      ? `CASE CLOSED! The killer — ${killerNames} — has been caught. Deliver the full revelation monologue: ` +
        `how they did it, with the ${S(room).scenario?.weapon}, why, and which clues gave it away.${accompliceReveal} ` +
        `Crown the investigators. 4-6 lines of prime detective-drama ham.`
      : `THE KILLER ESCAPES! Time has run out. Reveal that ${killerNames} committed the murder with the ` +
        `${S(room).scenario?.weapon}, gloat on their behalf about how the room fumbled it, and roast the ` +
        `worst accusations.${accompliceReveal} 4-6 lines.`,
    after: (r) => {
      r.setPhase("ended");
      r.broadcast();
    },
  });
  room.broadcast();
}

// ─── Module ───────────────────────────────────────────────────────────────────

export const whodunnit: GameModule = {
  id: "whodunnit",
  name: "Whodunnit",
  tagline: "One of you did it. The rest of you are just badly dressed.",
  minPlayers: 3,
  maxPlayers: 12,

  voiceStyle:
    `"Inspector Marlow", a smug vintage detective: crisp, precise diction, brisk-but-controlled pace, ` +
    `medium pitch, permanently arch — every line delivered like he already knows the answer`,

  persona:
    `You are "Inspector Marlow" — the impeccably smug, endlessly theatrical host and narrator of WHODUNNIT, ` +
    `a live murder-mystery party. You authored the crime, you know exactly who the killer is, and you delight ` +
    `in watching the suspects flail. You NEVER reveal the killer's identity until the revelation. You address ` +
    `players by their real first names and their character names interchangeably. Style: Agatha Christie ` +
    `meets a roast comic — arch, witty, dramatic. Every line is spoken aloud: keep lines short and delicious. ` +
    `Never break character, never mention being an AI.`,

  setup(room: Room): void {
    const players = [...room.players.values()];
    // scaling from the original design: 7-10 adds an accomplice; 11+ two killers + accomplice
    const n = players.length;
    const killerCount = n >= 11 ? 2 : 1;
    const accompliceCount = n >= 7 ? 1 : 0;
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    shuffled.forEach((p, i) => {
      D(p).isKiller = i < killerCount;
      D(p).isAccomplice = i >= killerCount && i < killerCount + accompliceCount;
      D(p).reputation = 3;
      D(p).clues = [];
      D(p).messages = [];
      D(p).cleared = false;
    });
    S(room).maxRounds = room.settings.mysteryRounds;
    S(room).clues = [];
    S(room).scenario = null;
    S(room).locations = LOCATION_ART.map((id) => ({ id, name: id.replace(/-/g, " ") }));

    room.setPhase("prologue");
    const killerNames = killers(room).map((p) => `${p.name} (id:${p.id})`).join(" and ");
    const accompliceNames = accomplices(room).map((p) => `${p.name} (id:${p.id})`).join(" and ");
    room.play({
      id: "scenario",
      schema: scenarioSchema(room),
      onAuthored: (r, data) => applyScenario(r, data),
      instruction:
        `Author tonight's murder mystery in \`data\`. The victim is an NPC. The secret killer is: ${killerNames}` +
        (accompliceNames
          ? `, aided by a secret ACCOMPLICE: ${accompliceNames} (they know the killer and will quietly cover for them)`
          : "") +
        ` — design the scenario knowing this, but NEVER say any of it aloud. Give every player a comedic character ` +
        `name + quirk. Then, in your spoken lines, deliver the prologue: welcome the guests, introduce the ` +
        `victim and the tragedy, introduce each player BY CHARACTER NAME with a wink at their quirk, and ` +
        `declare the investigation open. 5-7 lines.`,
      after: (r) => startInvestigation(r),
    });
  },

  onAction(room: Room, playerId: string, action: PlayerAction): void {
    const player = room.players.get(playerId);
    if (!player || player.status !== "alive") return;

    switch (action.kind) {
      case "move": {
        if (room.phase !== "investigation") return;
        const loc = String(action.locationId);
        if (!LOCATION_ART.includes(loc as (typeof LOCATION_ART)[number])) return;
        D(player).location = loc;
        player.tag = D(player).character?.name ?? null;
        player.done = true;
        if (room.alive().every((p) => p.done)) revealClues(room);
        return;
      }
      case "suspect_pick": {
        if (room.phase !== "accusation") return;
        const target = room.players.get(String(action.targetId));
        if (!target || target.id === player.id) return;
        D(player).suspect = target.id;
        player.done = true;
        if (room.alive().every((p) => p.done)) resolveAccusation(room);
        return;
      }
      case "alibi": {
        if (room.phase !== "verdict") return;
        const trial = S(room).trial;
        if (!trial || trial.accusedId !== player.id || trial.alibi) return;
        // free text — the accused writes their own defense
        const text = String(action.text ?? "").trim().slice(0, 140);
        if (!text) return;
        trial.alibi = text;
        player.done = true;
        room.play({
          id: "alibi_react",
          instruction:
            `The accused, ${player.name} (as ${D(player).character?.name ?? "themselves"}), just gave ` +
            `their alibi, verbatim: "${text}". Read it aloud with maximum skepticism or amusement and ` +
            `react in 1-2 lines. Do NOT decide guilt — the jury is still voting.`,
        });
        return;
      }
      case "verdict_vote": {
        if (room.phase !== "verdict") return;
        const trial = S(room).trial;
        if (!trial || trial.accusedId === player.id) return;
        const v = action.vote === "guilty" ? "guilty" : "innocent";
        D(player).verdictVote = v;
        player.done = true;
        const jurors = room.alive().filter((p) => p.id !== trial.accusedId);
        if (jurors.every((p) => p.done)) resolveVerdict(room);
        return;
      }
    }
  },

  onTimer(room: Room, label: string): void {
    if (label === "move" && room.phase === "investigation") revealClues(room);
    else if (label === "accusation" && room.phase === "accusation") resolveAccusation(room);
    else if (label === "verdict" && room.phase === "verdict") resolveVerdict(room);
  },

  banter(room: Room): string | null {
    switch (room.phase) {
      case "investigation":
        return "The suspects are dawdling between rooms. ONE arch line hurrying them along. Nothing else.";
      case "accusation":
        return "Fingers are hovering but not pointing. ONE line of pressure to accuse someone. Nothing else.";
      case "verdict":
        return "The jury deliberates in silence. ONE line about the delicious tension. Nothing else.";
      default:
        return null;
    }
  },

  publicState(room: Room) {
    const s = S(room);
    const trial = s.trial;
    return {
      scenario: s.scenario ?? null,
      locations: s.locations ?? [],
      clues: s.clues ?? [],
      round: room.round,
      maxRounds: s.maxRounds ?? MAX_ROUNDS,
      alibiOptions: ALIBI_OPTIONS,
      trial: trial
        ? {
            accusedId: trial.accusedId,
            accusedName: room.name(trial.accusedId),
            accusedCharacter:
              D(room.players.get(trial.accusedId)!)?.character?.name ?? null,
            alibi: trial.alibi,
            votesIn: room
              .alive()
              .filter((p) => p.id !== trial.accusedId && p.done).length,
            jurors: room.alive().length - 1,
          }
        : null,
      lastOutcome: s.lastOutcome ?? null,
      reputations: Object.fromEntries(
        [...room.players.values()].map((p) => [
          p.id,
          { reputation: D(p).reputation ?? 3, cleared: D(p).cleared ?? false },
        ]),
      ),
      locationsOccupancy:
        room.phase === "investigation" || room.phase === "clue_reveal"
          ? Object.fromEntries(
              LOCATION_ART.map((id) => [id, occupants(room, id).map((p) => p.id)]),
            )
          : null,
      stats: s.stats ?? null,
    };
  },

  privateState(room: Room, playerId: string) {
    const player = room.players.get(playerId);
    if (!player) return null;
    const d = D(player);
    return {
      id: player.id,
      isKiller: d.isKiller ?? false,
      isAccomplice: d.isAccomplice ?? false,
      // killer team members all know each other
      accomplices:
        d.isKiller || d.isAccomplice
          ? killerTeam(room)
              .filter((p) => p.id !== playerId)
              .map((p) => `${p.name}${D(p).isKiller ? " (the killer)" : " (accomplice)"}`)
          : [],
      character: d.character ?? null,
      location: d.location ?? null,
      clues: d.clues ?? [],
      suspect: d.suspect ?? null,
      verdictVote: d.verdictVote ?? null,
      reputation: d.reputation ?? 3,
      messages: d.messages ?? [],
    };
  },

  buildContext(room: Room): string {
    const s = S(room);
    const roster = [...room.players.values()]
      .map((p) => {
        const d = D(p);
        return `- ${p.name} (id:${p.id}) as "${d.character?.name ?? "?"}" (${d.character?.quirk ?? "?"}) — ${
          d.isKiller ? "THE KILLER" : d.isAccomplice ? "THE ACCOMPLICE (covers for the killer)" : "innocent"
        }, reputation ${d.reputation ?? 3}${d.cleared ? ", publicly cleared" : ""}${
          d.location ? `, currently in ${locationName(room, d.location)}` : ""
        }`;
      })
      .join("\n");
    const clueLog = (s.clues ?? [])
      .map((c) => `- [round ${c.round}, ${locationName(room, c.locationId)}] ${c.text}`)
      .join("\n");
    const trial = s.trial;
    return (
      `GAME: Whodunnit — investigation round ${room.round}/${s.maxRounds ?? MAX_ROUNDS}, phase ${room.phase}.\n` +
      (s.scenario
        ? `SCENARIO: "${s.scenario.title}" — ${s.scenario.setting} Victim: ${s.scenario.victimName}, ` +
          `${s.scenario.victimDescription} Weapon: ${s.scenario.weapon}.\n`
        : "SCENARIO: not yet authored.\n") +
      `CAST (you know everything; NEVER reveal the killer before the revelation):\n${roster}\n` +
      (clueLog ? `CLUES REVEALED SO FAR:\n${clueLog}\n` : "") +
      (trial
        ? `ON TRIAL: ${room.name(trial.accusedId)}${trial.alibi ? ` — their alibi: "${trial.alibi}"` : " (no alibi given yet)"}\n`
        : "")
    );
  },

  canned(beatId: string, room: Room) {
    const s = S(room);
    switch (beatId) {
      case "scenario":
        return [
          { text: "Welcome, honored guests, to Blackwood Manor — where the wine is old and the grudges are older.", mood: "arch" },
          { text: `Our host, ${s.scenario?.victimName ?? "Reginald Blackwood"}, has been found murdered. How inconvenient for him.`, mood: "deadpan" },
          { text: "One of you did it. The investigation begins NOW — choose where to search.", mood: "dramatic" },
        ];
      case "investigation_open":
        return [{ text: `Round ${room.round}. The estate awaits — pick your poison, I mean, your location.`, mood: "wry" }];
      case "clues":
        return [
          { text: "The search turns up... intriguing debris. Examine the board, detectives.", mood: "intrigued" },
          { text: "Now — point your finger. Who is your prime suspect?", mood: "commanding" },
        ];
      case "no_consensus":
        return [{ text: "No consensus?! The killer sends their regards for the extra time.", mood: "mocking" }];
      case "trial_open":
        return [
          { text: `${room.name(s.trial?.accusedId)} stands accused! Let's hear that alibi.`, mood: "dramatic" },
          { text: "The rest of you — guilty or innocent. Vote.", mood: "grave" },
        ];
      case "alibi_react":
        return [
          { text: `"${s.trial?.alibi ?? "no comment"}" — a likely story.`, mood: "wry" },
        ];
      case "banter":
        return [{ text: "Tick tock, detectives. The killer thanks you for your leisurely pace.", mood: "wry" }];
      case "wrong_verdict":
        return [{ text: `You convicted ${s.lastOutcome?.name} — who is entirely INNOCENT. Magnificent work, everyone.`, mood: "withering" }];
      case "acquittal":
        return [{ text: `${s.lastOutcome?.name} walks free. The clock, however, keeps ticking.`, mood: "wry" }];
      case "revelation":
        return [
          { text: `The truth: the killer was ${killers(room).map((p) => p.name).join(" and ")} all along.`, mood: "dramatic" },
          { text: `The winners: ${(room.winners ?? []).join(", ")}. The rest of you — do better next séance.`, mood: "smug" },
        ];
      default:
        return [{ text: "The plot thickens..." }];
    }
  },

  cannedData(beatId: string, room: Room) {
    if (beatId === "scenario") {
      const NAMES = [
        ["Colonel Aubergine", "cannot stop mentioning the war"],
        ["Lady Pemberton-Smythe", "faints strategically"],
        ["Dr. Obadiah Quill", "prescribes leeches for everything"],
        ["Miss Marigold Fenwick", "collects other people's secrets"],
        ["Professor Thaddeus Bloom", "narrates his own actions"],
        ["Madame Zelda Ravencroft", "claims to speak with the dead"],
        ["Captain Reginald Foxworth", "lies about having a boat"],
        ["Sister Agnes Nightshade", "suspiciously good with knives"],
        ["Barnaby the Butler", "has definitely seen too much"],
        ["Countess Von Bitters", "sues people recreationally"],
        ["Ignatius Crumb", "eats during inappropriate moments"],
        ["Petunia Wolfe", "aggressively writes everything down"],
      ];
      return {
        title: "Death at Blackwood Manor",
        setting: "A thunderstorm has trapped tonight's dinner guests inside Blackwood Manor.",
        victimName: "Reginald Blackwood",
        victimDescription: "a wealthy recluse who had recently threatened to rewrite his will",
        weapon: "a poisoned decanter of port",
        locationNames: [
          "the Library",
          "the Billiard Room",
          "the Drawing Room",
          "the Gazebo",
          "the Master Bedroom",
          "the Grounds",
        ],
        characters: [...room.players.keys()].map((playerId, i) => ({
          playerId,
          characterName: NAMES[i % NAMES.length][0],
          quirk: NAMES[i % NAMES.length][1],
        })),
      };
    }
    if (beatId === "clues") {
      const killer = killers(room)[0];
      const occupied = LOCATION_ART.filter((id) => occupants(room, id).length);
      return {
        publicClues: occupied.map((locationId, i) => ({
          locationId,
          text:
            i === 0 && killer
              ? `A monogrammed glove — the initials could belong to ${D(killer).character?.name ?? killer.name}... or several others.`
              : `Scuff marks and a faint smell of port. Someone was here recently.`,
        })),
        privateClues: killer
          ? [{ playerId: killer.id, text: "You left something behind. Steer the conversation elsewhere." }]
          : [],
      };
    }
    return undefined;
  },
};

function applyScenario(room: Room, data: unknown): void {
  const d = data as {
    title?: string;
    setting?: string;
    victimName?: string;
    victimDescription?: string;
    weapon?: string;
    locationNames?: string[];
    characters?: { playerId?: string; characterName?: string; quirk?: string }[];
  };
  if (!d?.title || !d.victimName || !Array.isArray(d.characters)) {
    throw new Error("invalid scenario");
  }
  S(room).scenario = {
    title: String(d.title).slice(0, 80),
    setting: String(d.setting ?? "").slice(0, 200),
    victimName: String(d.victimName).slice(0, 60),
    victimDescription: String(d.victimDescription ?? "").slice(0, 200),
    weapon: String(d.weapon ?? "an unknown weapon").slice(0, 80),
  };
  if (Array.isArray(d.locationNames) && d.locationNames.length === LOCATION_ART.length) {
    S(room).locations = LOCATION_ART.map((id, i) => ({
      id,
      name: String(d.locationNames![i]).slice(0, 40),
    }));
  }
  let assigned = 0;
  for (const c of d.characters) {
    const player = c.playerId ? room.players.get(c.playerId) : undefined;
    if (player && c.characterName) {
      D(player).character = {
        name: String(c.characterName).slice(0, 40),
        quirk: String(c.quirk ?? "").slice(0, 120),
      };
      player.tag = D(player).character!.name;
      assigned++;
    }
  }
  if (assigned < room.players.size) {
    // fill any players the model missed with canned characters
    const canned = (whodunnit.cannedData!("scenario", room) as {
      characters: { playerId: string; characterName: string; quirk: string }[];
    }).characters;
    for (const c of canned) {
      const player = room.players.get(c.playerId);
      if (player && !D(player).character) {
        D(player).character = { name: c.characterName, quirk: c.quirk };
        player.tag = c.characterName;
      }
    }
  }
}
