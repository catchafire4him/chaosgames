import { MAFIA_ROLES, type PlayerAction } from "../../../../shared/src/index.js";
import type { Room, ServerPlayer } from "../../engine/room.js";
import type { GameModule } from "../../engine/types.js";

/**
 * CONSPIRACY — social deduction.
 * Secret conspirators murder by night; the town votes by day. The server
 * resolves all mechanics; the Director narrates every beat.
 *
 * Role roster (scaled by player count):
 * - conspirator      kills by night
 * - godfather        conspirator who reads as INNOCENT to the detective
 * - doctor           protects one player per night
 * - detective        learns one player's alignment per night
 * - vigilante        one bullet; shooting an innocent = death by guilt next night
 * - jester           neutral — wins ONLY by getting voted out
 * - mayor            town-aligned; their vote counts as TWO
 * - consigliere      conspiracy-aligned; learns a player's EXACT role each night
 * - innocent         votes, panics, survives (ideally)
 */

type Role =
  | "conspirator"
  | "godfather"
  | "doctor"
  | "detective"
  | "vigilante"
  | "jester"
  | "mayor"
  | "consigliere"
  | "innocent";

const CONSPIRACY_TEAM: Role[] = ["conspirator", "godfather", "consigliere"];

interface Death {
  name: string;
  cause: "murder" | "vigilante" | "guilt";
}
interface Dawn {
  deaths: Death[];
  saved: boolean;
}
interface Verdict {
  name: string;
  role: Role;
  tied: boolean;
}

const S = (room: Room) =>
  room.state as {
    totalConspirators?: number;
    rolesList?: string[];
    lastDawn?: Dawn | null;
    lastVerdict?: Verdict | null;
    voteCounts?: Record<string, number>;
    detHits?: number;
    firstBlood?: string | null;
    stats?: { label: string; value: string }[] | null;
  };
const D = (p: ServerPlayer) =>
  p.data as {
    role?: Role;
    pick?: string | null;
    /** vigilante chose to hold fire tonight */
    held?: boolean;
    bulletUsed?: boolean;
    guilt?: boolean;
    vote?: string | null;
    calledVote?: boolean;
    nightResult?: string | null;
    messages?: string[];
    predict?: string | null;
    ghostPoints?: number;
    lastWordsUsed?: boolean;
  };

function isConspiracy(p: ServerPlayer): boolean {
  return CONSPIRACY_TEAM.includes(D(p).role ?? "innocent");
}

/** the mayor's vote counts as two */
function voteWeight(p: ServerPlayer): number {
  return D(p).role === "mayor" ? 2 : 1;
}

interface Scaling {
  conspirators: number; // total conspiracy team size (godfather/consigliere included)
  godfather: boolean;
  consigliere: boolean;
  doctor: boolean;
  detectives: number;
  vigilante: boolean;
  jester: boolean;
  mayor: boolean;
}

function scalingFor(n: number, mode: "classic" | "full"): Scaling {
  const conspirators = n >= 13 ? 4 : n >= 10 ? 3 : n >= 7 ? 2 : 1;
  const full = mode === "full";
  return {
    conspirators,
    godfather: full && conspirators >= 2,
    consigliere: full && n >= 13,
    doctor: n >= 5,
    detectives: n >= 13 ? 2 : 1,
    vigilante: full && n >= 9,
    jester: full && n >= 8,
    mayor: full && n >= 11,
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function aliveWithRole(room: Room, role: Role): ServerPlayer[] {
  return room.alive().filter((p) => D(p).role === role);
}

/** everyone whose night action actually resolves to something */
function nightActors(room: Room): ServerPlayer[] {
  return room.alive().filter((p) => {
    const d = D(p);
    switch (d.role) {
      case "conspirator":
      case "godfather":
      case "doctor":
      case "detective":
      case "consigliere":
        return true;
      case "vigilante":
        return !d.bulletUsed && !d.guilt;
      default:
        return false;
    }
  });
}

/** the killing arm of the mafia — conspirators + godfather (the consigliere
 *  spends their night investigating, not stabbing) */
function mafiaKillers(room: Room): ServerPlayer[] {
  return room.alive().filter(
    (p) => D(p).role === "conspirator" || D(p).role === "godfather",
  );
}

/** the mafia must ALL point at the same victim to strike early */
function killersAgree(room: Room): boolean {
  const killers = mafiaKillers(room);
  if (killers.length <= 1) return true;
  const picks = killers.map((k) => D(k).pick);
  return picks.every((p) => !!p && p === picks[0]);
}

/** Night ends when every REAL actor has acted, every connected living player
 *  has tapped something (sleepers send a decoy suspicion pick so the TV's ✓
 *  badges reveal nothing), AND the mafia agree on one victim. If the night
 *  timer expires while they're still split, the godfather's pick decides. */
function nightComplete(room: Room): boolean {
  if (!nightActors(room).every((p) => p.done)) return false;
  if (!room.alive().every((p) => p.done || !p.connected)) return false;
  return killersAgree(room);
}

const DISCUSSION_MS = 90_000;
const VOTING_MS = 60_000;
const NIGHT_MS = 75_000;
const ROLE_REVEAL_MS = 45_000;

// ─── Flow ─────────────────────────────────────────────────────────────────────

function beginNight(room: Room): void {
  room.round++;
  room.setPhase("night");
  for (const p of room.players.values()) {
    D(p).pick = null;
    D(p).held = false;
    D(p).vote = null;
    D(p).calledVote = false;
    D(p).predict = null;
  }
  room.play({
    id: "nightfall",
    urgent: true,
    instruction:
      `Night ${room.round} falls. Narrate nightfall ominously (2-3 short lines) and tell EVERY player to ` +
      `look at their phone and make their night choice — everyone acts at night, so nobody can tell who ` +
      `is really doing what. Do NOT hint at anyone's role.`,
    after: (r) => {
      if (r.phase === "night") r.setTimer("night", NIGHT_MS);
    },
  });
  room.broadcast();
}

function resolveNight(room: Room): void {
  if (room.phase !== "night") return;
  const s = S(room);
  const deaths: Death[] = [];
  let saved = false;

  // 1. guilt claims any vigilante who shot an innocent
  for (const p of room.alive()) {
    if (D(p).role === "vigilante" && D(p).guilt) {
      p.status = "dead";
      deaths.push({ name: p.name, cause: "guilt" });
    }
  }

  const doctor = aliveWithRole(room, "doctor")[0];
  const savedId = doctor ? D(doctor).pick : null;

  // 2. the mafia strikes — normally a unanimous pick; on a split night (timer
  //    expired without consensus) the godfather's pick decides, else random
  //    among the killers' picks. No picks at all → a random innocent dies.
  //    (Only killers' picks count — the consigliere's pick is their spy work.)
  const innocentTargets = room.alive().filter((p) => !isConspiracy(p));
  const killers = mafiaKillers(room);
  const kPicks = killers
    .map((c) => D(c).pick)
    .filter((id): id is string => !!id && room.players.get(id)?.status === "alive");
  const godfather = killers.find((k) => D(k).role === "godfather");
  const gfPick = godfather ? D(godfather).pick : null;
  const targetId = killersAgree(room) && kPicks.length
    ? kPicks[0]
    : gfPick && room.players.get(gfPick)?.status === "alive"
      ? gfPick
      : kPicks.length
        ? kPicks[Math.floor(Math.random() * kPicks.length)]
        : innocentTargets.length
          ? innocentTargets[Math.floor(Math.random() * innocentTargets.length)].id
          : null;
  const target = targetId ? room.players.get(targetId) : undefined;
  if (target && target.status === "alive") {
    if (savedId === target.id) {
      saved = true;
    } else {
      settleGhostBets(room, target.id);
      target.status = "dead";
      deaths.push({ name: target.name, cause: "murder" });
    }
  }

  // 3. the vigilante's bullet
  const vigilante = aliveWithRole(room, "vigilante")[0];
  if (vigilante && !D(vigilante).bulletUsed && !D(vigilante).held) {
    const shotId = D(vigilante).pick;
    const shot = shotId ? room.players.get(shotId) : undefined;
    if (shot && shot.status === "alive") {
      D(vigilante).bulletUsed = true;
      if (savedId === shot.id) {
        saved = true;
      } else {
        settleGhostBets(room, shot.id);
        shot.status = "dead";
        deaths.push({ name: shot.name, cause: "vigilante" });
        if (!isConspiracy(shot)) {
          D(vigilante).guilt = true;
          room.whisper(
            vigilante.id,
            `${shot.name} was INNOCENT. The guilt is unbearable — you will not survive tomorrow night.`,
          );
        } else {
          room.whisper(vigilante.id, `${shot.name} was a member of the mafia. Justice, delivered.`);
        }
      }
    }
  }

  s.lastDawn = { deaths, saved };
  s.lastVerdict = null;
  if (deaths.length && !s.firstBlood) s.firstBlood = deaths[0].name;

  // 4. the detective's investigation (godfather reads as innocent)
  const detectives = aliveWithRole(room, "detective");
  for (const det of detectives) {
    const suspectId = D(det).pick;
    const suspect = suspectId ? room.players.get(suspectId) : undefined;
    if (suspect) {
      const reads = D(suspect).role === "conspirator"; // godfather lies
      if (reads) s.detHits = (s.detHits ?? 0) + 1;
      D(det).nightResult =
        `${suspect.name} ${reads ? "IS one of the mafia!" : "is not a member of the mafia."}`;
      room.whisper(det.id, `Your investigation: ${D(det).nightResult}`);
    }
  }

  // 5. the consigliere's exact-role check
  const consiglieri = aliveWithRole(room, "consigliere");
  for (const c of consiglieri) {
    const suspectId = D(c).pick;
    const suspect = suspectId ? room.players.get(suspectId) : undefined;
    if (suspect) {
      D(c).nightResult = `${suspect.name} is secretly the ${(D(suspect).role ?? "innocent").toUpperCase()}.`;
      room.whisper(c.id, D(c).nightResult!);
    }
  }

  if (checkGameOver(room)) return;

  room.setPhase("day");
  const dawn = s.lastDawn;
  const deathLine = dawn.deaths
    .map((d) =>
      d.cause === "guilt"
        ? `${d.name} took their own life, consumed by guilt`
        : d.cause === "vigilante"
          ? `${d.name} was shot by an unknown hand`
          : `${d.name} was murdered by the mafia`,
    )
    .join("; ");
  room.play({
    id: "dawn",
    urgent: true,
    instruction: dawn.deaths.length
      ? `Dawn breaks. Tonight's toll: ${deathLine}. Narrate the grim discovery with dark humor — describe ` +
        `HOW each body was found but keep every secret role hidden (never say "vigilante" or "guilt" ` +
        `explicitly — imply). Then open the floor: the town should discuss and may call a vote.`
      : dawn.saved
        ? `Dawn breaks and — a miracle — violence struck but every victim survived thanks to unseen ` +
          `protection. Don't say who. Stir up paranoia, then open discussion.`
        : `Dawn breaks and, strangely, nobody died. Sow suspicion about why, then open discussion.`,
    after: (r) => {
      if (r.phase === "day") r.setTimer("discussion", DISCUSSION_MS);
    },
  });
}

function settleGhostBets(room: Room, victimId: string): void {
  for (const ghost of room.players.values()) {
    if (ghost.status === "dead" && D(ghost).predict === victimId) {
      D(ghost).ghostPoints = (D(ghost).ghostPoints ?? 0) + 1;
    }
  }
}

function beginVoting(room: Room): void {
  if (room.phase !== "day") return;
  room.setPhase("voting");
  for (const p of room.players.values()) D(p).predict = null;
  room.play({
    id: "trial_open",
    urgent: true,
    instruction:
      `The town has called a vote! Command everyone to point their finger — each player must pick who ` +
      `to banish (or abstain) on their phone. Build tension. Keep it to 2-3 lines.`,
    after: (r) => {
      if (r.phase === "voting") r.setTimer("voting", VOTING_MS);
    },
  });
  room.broadcast();
}

function resolveVote(room: Room): void {
  if (room.phase !== "voting") return;

  const tally = new Map<string, number>();
  const counts = (S(room).voteCounts ??= {});
  for (const p of room.alive()) {
    const v = D(p).vote;
    if (v && v !== "abstain" && room.players.get(v)?.status === "alive") {
      const weight = voteWeight(p);
      tally.set(v, (tally.get(v) ?? 0) + weight);
      counts[v] = (counts[v] ?? 0) + weight;
    }
  }
  let top: string | null = null;
  let topCount = 0;
  let tied = false;
  for (const [id, count] of tally) {
    if (count > topCount) [top, topCount, tied] = [id, count, false];
    else if (count === topCount) tied = true;
  }

  room.setPhase("verdict");
  const victim = !tied && top ? room.players.get(top) : undefined;
  if (victim) {
    settleGhostBets(room, victim.id);
    victim.status = "dead";
    S(room).lastVerdict = { name: victim.name, role: D(victim).role!, tied: false };
  } else {
    S(room).lastVerdict = { name: "", role: "innocent", tied: true };
  }
  S(room).lastDawn = null;

  // the jester's entire dream: getting banished
  if (victim && D(victim).role === "jester") {
    buildStats(room);
    room.endGame([victim.name]);
    room.play({
      id: "gameover",
      urgent: true,
      instruction:
        `PLOT TWIST — the town just banished ${victim.name}, who was secretly THE JESTER, a neutral ` +
        `trickster who wins ONLY by getting voted out. They played you all. Reveal it gleefully, crown ` +
        `them sole winner, roast the town for taking the bait, and sign off.`,
    });
    room.broadcast();
    return;
  }

  if (checkGameOver(room)) return;

  const verdict = S(room).lastVerdict!;
  room.play({
    id: "verdict",
    urgent: true,
    instruction: victim
      ? `The town has banished ${victim.name}, who was secretly: ${verdict.role.toUpperCase()}. ` +
        `Narrate their dramatic exit and REVEAL their true role to everyone. React accordingly ` +
        `(horror if innocent-aligned, triumph if a conspirator). Then warn that night approaches.`
      : `The vote was deadlocked — nobody is banished. Mock the town's indecision. Warn that the ` +
        `mafia will feast on this hesitation as night falls.`,
    after: (r) => beginNight(r),
  });
}

function buildStats(room: Room): void {
  const s = S(room);
  const stats: { label: string; value: string }[] = [];
  const counts = s.voteCounts ?? {};
  const mostSuspected = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (mostSuspected) {
    stats.push({
      label: "Most suspected",
      value: `${room.name(mostSuspected[0])} (${mostSuspected[1]} votes)`,
    });
  }
  if (s.firstBlood) stats.push({ label: "First blood", value: s.firstBlood });
  if ([...room.players.values()].some((p) => D(p).role === "detective")) {
    stats.push({ label: "Detective's record", value: `${s.detHits ?? 0} mafia identified` });
  }
  const vig = [...room.players.values()].find((p) => D(p).role === "vigilante");
  if (vig && D(vig).bulletUsed) {
    stats.push({ label: "The bullet", value: D(vig).guilt ? `${vig.name} shot an innocent` : `${vig.name} found their mark` });
  }
  const oracle = [...room.players.values()]
    .filter((p) => (D(p).ghostPoints ?? 0) > 0)
    .sort((a, b) => (D(b).ghostPoints ?? 0) - (D(a).ghostPoints ?? 0))[0];
  if (oracle) {
    stats.push({
      label: "Ghost oracle",
      value: `${oracle.name} (${D(oracle).ghostPoints} correct predictions)`,
    });
  }
  stats.push({ label: "Rounds survived", value: `${room.round}` });
  s.stats = stats;
}

function checkGameOver(room: Room): boolean {
  const team = room.alive().filter(isConspiracy);
  // jester doesn't count toward the town for parity purposes
  const others = room.alive().filter((p) => !isConspiracy(p) && D(p).role !== "jester");

  let winnerSide: "conspiracy" | "town" | null = null;
  if (team.length === 0) winnerSide = "town";
  else if (team.length >= others.length) winnerSide = "conspiracy";
  if (!winnerSide) return false;

  const winners = [...room.players.values()]
    .filter((p) =>
      winnerSide === "conspiracy" ? isConspiracy(p) : !isConspiracy(p) && D(p).role !== "jester",
    )
    .map((p) => p.name);

  buildStats(room);
  room.endGame(winners);

  const teamNames = [...room.players.values()]
    .filter(isConspiracy)
    .map(
      (p) =>
        `${p.name}${D(p).role === "godfather" ? " (the GODFATHER)" : D(p).role === "consigliere" ? " (the CONSIGLIERE)" : ""}`,
    )
    .join(", ");
  room.play({
    id: "gameover",
    urgent: true,
    instruction:
      winnerSide === "town"
        ? `GAME OVER — the town wins! Every member of the mafia is gone. Reveal the full truth: the mafia ` +
          `was ${teamNames}. Recap the cleverest and dumbest moments, crown the town, and sign off with flair.`
        : `GAME OVER — the mafia wins! They were ${teamNames}, and they now match the innocent in ` +
          `number. Reveal the truth, gloat theatrically on their behalf, roast the town's mistakes, and sign off.`,
  });
  room.broadcast();
  return true;
}

// ─── Module ───────────────────────────────────────────────────────────────────

export const conspiracy: GameModule = {
  id: "conspiracy",
  name: "Mafia",
  tagline: "Someone at this table is lying. Probably several someones.",
  minPlayers: 4,
  maxPlayers: 16,

  voiceStyle:
    `"The Narrator" of a gothic parlor game: velvet, unhurried, medium-low pitch, quietly sinister ` +
    `with a knowing smile — like a documentary narrator who enjoys the murders slightly too much`,

  persona:
    `You are "The Narrator" — the velvet-voiced, gleefully sinister host of MAFIA, a party game of ` +
    `secret roles and public betrayal, set in the fog-bound town of Grimsby Hollow. You see everything, ` +
    `including every secret role, but you NEVER reveal hidden information unless the game explicitly tells ` +
    `you to. You address players by name, tease and roast them affectionately, and keep the energy high. ` +
    `Comedy-forward: dramatic, witty, a little menacing, never mean-spirited. Lines are spoken aloud — ` +
    `keep each line short and punchy. Never mention phones/apps mechanics beyond "check your phone". ` +
    `Never break character, never mention being an AI.`,

  setup(room: Room): void {
    const players = shuffle([...room.players.values()]);
    const n = players.length;
    const sc = scalingFor(n, room.settings.conspiracyRoles);

    const roles: Role[] = [];
    if (sc.godfather) roles.push("godfather");
    if (sc.consigliere) roles.push("consigliere");
    while (roles.length < sc.conspirators) roles.push("conspirator");
    for (let i = 0; i < sc.detectives; i++) roles.push("detective");
    if (sc.doctor) roles.push("doctor");
    if (sc.vigilante) roles.push("vigilante");
    if (sc.jester) roles.push("jester");
    if (sc.mayor) roles.push("mayor");
    while (roles.length < n) roles.push("innocent");

    players.forEach((p, i) => {
      D(p).role = roles[i];
      D(p).messages = [];
      D(p).bulletUsed = false;
      D(p).guilt = false;
    });

    const s = S(room);
    s.totalConspirators = sc.conspirators;
    s.rolesList = [
      ...(sc.detectives > 1 ? ["2 detectives"] : ["a detective"]),
      ...(sc.doctor ? ["a doctor"] : []),
      ...(sc.vigilante ? ["a vigilante"] : []),
      ...(sc.jester ? ["a jester"] : []),
      ...(sc.mayor ? ["a mayor"] : []),
      ...(sc.godfather ? ["a godfather"] : []),
      ...(sc.consigliere ? ["a consigliere"] : []),
    ];
    s.lastDawn = null;
    s.lastVerdict = null;

    room.setPhase("role_reveal");
    room.play({
      id: "intro",
      instruction:
        `A new game begins with ${n} players: ${players.map((p) => p.name).join(", ")}. ` +
        `Welcome them to Grimsby Hollow, explain in 3-4 punchy lines that ${sc.conspirators} of them ` +
        `form a secret mafia that kills by night while the town votes to banish by day. Mention the ` +
        `special roles in play tonight (${s.rolesList!.join(", ")}) WITHOUT revealing who holds them` +
        `${sc.jester ? " — and warn that the jester WANTS to be voted out" : ""}. Tell everyone to check ` +
        `their phone NOW for their secret role — and to keep their poker face on.`,
      after: (r) => {
        if (r.phase === "role_reveal") r.setTimer("role_reveal", ROLE_REVEAL_MS);
      },
    });
  },

  onAction(room: Room, playerId: string, action: PlayerAction): void {
    const player = room.players.get(playerId);
    if (!player) return;

    // last words: each ghost gets ONE final statement the host reads aloud
    if (action.kind === "last_words") {
      if (player.status !== "dead" || room.phase === "ended") return;
      if (D(player).lastWordsUsed) return;
      const text = String(action.text ?? "").trim().slice(0, 120);
      if (!text) return;
      D(player).lastWordsUsed = true;
      room.play({
        id: "last_words",
        interject: true, // never steal the stage from a story beat (it would strand the game)
        instruction:
          `From beyond the grave, ${player.name}'s ghost has left their LAST WORDS, verbatim: "${text}". ` +
          `Read them aloud with theatrical gravity and react in 1-2 lines. Reveal no secrets.`,
      });
      return;
    }

    // ghost mode: dead players bet on the next victim/banishment
    if (action.kind === "predict") {
      if (player.status !== "dead") return;
      if (room.phase !== "night" && room.phase !== "voting") return;
      const target = room.players.get(String(action.targetId));
      if (!target || target.status !== "alive") return;
      D(player).predict = target.id;
      return;
    }
    if (player.status !== "alive") return;

    switch (action.kind) {
      case "ready": {
        if (room.phase !== "role_reveal") return;
        player.done = true;
        const waiting = room.alive().filter((p) => p.connected && !p.done);
        if (!waiting.length) beginNight(room);
        return;
      }
      case "night_pick": {
        if (room.phase !== "night") return;
        const role = D(player).role;
        const target = room.players.get(String(action.targetId));
        if (!target || target.status !== "alive" || target.id === player.id) return;
        const isActor = nightActors(room).some((p) => p.id === playerId);
        if (isActor) {
          if (isConspiracy(player) && isConspiracy(target)) return;
          if (role === "vigilante") D(player).held = false;
        }
        // sleepers submit a decoy suspicion pick — resolveNight never reads it,
        // but every phone acts at night so nobody can tell who has a real role
        D(player).pick = target.id;
        player.done = true;
        if (nightComplete(room)) resolveNight(room);
        return;
      }
      case "hold_fire": {
        // vigilante keeps the bullet tonight
        if (room.phase !== "night") return;
        if (D(player).role !== "vigilante" || D(player).bulletUsed) return;
        D(player).held = true;
        D(player).pick = null;
        player.done = true;
        if (nightComplete(room)) resolveNight(room);
        return;
      }
      case "call_vote": {
        if (room.phase !== "day") return;
        D(player).calledVote = true;
        player.done = true;
        const callers = room.alive().filter((p) => D(p).calledVote).length;
        if (callers > room.alive().length / 2) beginVoting(room);
        return;
      }
      case "vote": {
        if (room.phase !== "voting") return;
        const t = String(action.targetId);
        if (t !== "abstain") {
          const target = room.players.get(t);
          if (!target || target.status !== "alive" || target.id === player.id) return;
        }
        D(player).vote = t;
        player.done = true;
        if (room.alive().every((p) => p.done)) resolveVote(room);
        return;
      }
    }
  },

  onTimer(room: Room, label: string): void {
    if (label === "role_reveal" && room.phase === "role_reveal") beginNight(room);
    else if (label === "night" && room.phase === "night") resolveNight(room);
    else if (label === "discussion" && room.phase === "day") beginVoting(room);
    else if (label === "voting" && room.phase === "voting") resolveVote(room);
  },

  banter(room: Room): string | null {
    switch (room.phase) {
      case "day":
        return (
          "The discussion has gone quiet. Stir the pot with ONE wry line — note who's suspiciously " +
          "quiet or suspiciously loud, WITHOUT revealing any secrets. Nothing else."
        );
      case "voting":
        return "Votes are trickling in slowly. ONE line of impatient menace. Nothing else.";
      case "night":
        return "The night drags on. ONE hushed, atmospheric line — do not reveal what is happening. Nothing else.";
      default:
        return null;
    }
  },

  publicState(room: Room) {
    const s = S(room);
    return {
      totalConspirators: s.totalConspirators ?? 1,
      rolesList: s.rolesList ?? [],
      lastDawn: s.lastDawn ?? null,
      lastVerdict: s.lastVerdict ?? null,
      votesIn:
        room.phase === "voting"
          ? room.alive().filter((p) => p.done).length
          : null,
      nightActed:
        room.phase === "night"
          ? room.alive().filter((p) => p.done).length
          : null,
      callVotes:
        room.phase === "day"
          ? room.alive().filter((p) => D(p).calledVote).length
          : null,
      aliveCount: room.alive().length,
      ghostScores: [...room.players.values()]
        .filter((p) => p.status === "dead")
        .map((p) => ({ name: p.name, points: D(p).ghostPoints ?? 0 })),
      stats: s.stats ?? null,
      // the big reveal: every player's true role, shown on the game-over screen
      finalRoles:
        room.phase === "ended"
          ? [...room.players.values()].map((p) => {
              const info = MAFIA_ROLES[D(p).role ?? "innocent"];
              return {
                name: p.name,
                label: info?.name ?? D(p).role ?? "innocent",
                emoji: info?.emoji ?? "",
                team: info?.team ?? "town",
              };
            })
          : null,
    };
  },

  privateState(room: Room, playerId: string) {
    const player = room.players.get(playerId);
    if (!player) return null;
    const d = D(player);
    return {
      id: player.id,
      role: d.role ?? null,
      allies: isConspiracy(player)
        ? [...room.players.values()]
            .filter((p) => isConspiracy(p) && p.id !== playerId)
            .map((p) => p.name)
        : [],
      // the family's live kill plan — every mafia phone sees who each killer
      // is pointing at (the godfather stays anonymous within the team)
      allyPicks:
        isConspiracy(player) && room.phase === "night"
          ? mafiaKillers(room).map((k) => ({
              name: k.name,
              you: k.id === playerId,
              targetName: D(k).pick ? room.name(D(k).pick) : null,
            }))
          : [],
      killersAgree: isConspiracy(player) ? killersAgree(room) : true,
      pick: d.pick ?? null,
      held: d.held ?? false,
      bulletUsed: d.bulletUsed ?? false,
      guilt: d.guilt ?? false,
      vote: d.vote ?? null,
      calledVote: d.calledVote ?? false,
      nightResult: d.nightResult ?? null,
      messages: d.messages ?? [],
      predict: d.predict ?? null,
      ghostPoints: d.ghostPoints ?? 0,
      lastWordsUsed: d.lastWordsUsed ?? false,
    };
  },

  buildContext(room: Room): string {
    const s = S(room);
    const roster = [...room.players.values()]
      .map((p) => `- ${p.name} (id:${p.id}) — ${p.status}, secretly: ${D(p).role}`)
      .join("\n");
    const events: string[] = [];
    if (s.lastDawn?.deaths.length) {
      events.push(
        `Last night: ` +
          s.lastDawn.deaths.map((d) => `${d.name} died (${d.cause})`).join(", ") + ".",
      );
    }
    if (s.lastDawn && !s.lastDawn.deaths.length)
      events.push(s.lastDawn.saved ? "Last night's victim was saved." : "Nobody died last night.");
    if (s.lastVerdict && !s.lastVerdict.tied)
      events.push(`The town banished ${s.lastVerdict.name} (was ${s.lastVerdict.role}).`);
    if (s.lastVerdict?.tied) events.push("The last vote was deadlocked.");
    const ghosts = [...room.players.values()].filter((p) => p.status === "dead");
    if (ghosts.length) {
      events.push(
        `GHOSTS (dead players betting on outcomes — you may aim one wry aside at them): ` +
          ghosts.map((g) => `${g.name} (${D(g).ghostPoints ?? 0} correct)`).join(", ") + ".",
      );
    }
    return (
      `GAME: Mafia — round ${room.round}, phase ${room.phase}.\n` +
      `SPECIAL ROLES IN PLAY: ${(s.rolesList ?? []).join(", ")}. Note: the godfather reads as ` +
      `INNOCENT to the detective; the jester wins only by being voted out; the mayor's vote counts ` +
      `as two (you may narrate their vote as carrying extra weight without naming them); the ` +
      `consigliere learns a player's exact role each night.\n` +
      `PLAYERS (you know every secret; NEVER reveal roles unless instructed):\n${roster}\n` +
      (events.length ? `RECENT EVENTS: ${events.join(" ")}` : "")
    );
  },

  canned(beatId: string, room: Room) {
    const s = S(room);
    switch (beatId) {
      case "intro":
        return [
          { text: "Welcome to Grimsby Hollow, where the fog is thick and the neighbors are thicker.", mood: "gleeful" },
          { text: `Among you, ${s.totalConspirators ?? 1} mafia members plot in the dark. The rest of you are merely... targets.`, mood: "ominous" },
          { text: "Check your phones for your secret role. And do try to keep a straight face.", mood: "deadpan" },
        ];
      case "nightfall":
        return [
          { text: `Night ${room.round} falls on Grimsby Hollow.`, mood: "eerie" },
          { text: "Phones out, everyone — the night has work for each of you. Some of it matters more than you know.", mood: "ominous" },
        ];
      case "dawn": {
        const deaths = s.lastDawn?.deaths ?? [];
        return deaths.length
          ? [
              { text: `Dawn breaks... and ${deaths.map((d) => d.name).join(" and ")} will not be joining us for breakfast.`, mood: "grim" },
              { text: "The town is awake, afraid, and free to point fingers. Discuss.", mood: "stirring" },
            ]
          : [
              { text: "Dawn breaks and — astonishingly — everyone is still breathing.", mood: "surprised" },
              { text: "Someone out there is either merciful or incompetent. Discuss.", mood: "wry" },
            ];
      }
      case "trial_open":
        return [
          { text: "The town has spoken: it is time to vote.", mood: "grave" },
          { text: "Point your fingers, cast your votes. Someone's luck runs out today.", mood: "tense" },
        ];
      case "verdict":
        return s.lastVerdict?.tied
          ? [{ text: "A deadlock! Nobody hangs today — and the mafia grin in the shadows.", mood: "wry" }]
          : [
              { text: `The town has banished ${s.lastVerdict?.name}.`, mood: "grave" },
              { text: `They were... ${CONSPIRACY_TEAM.includes(s.lastVerdict?.role ?? "innocent") ? "a member of the MAFIA! Well done." : `${s.lastVerdict?.role}. Oops.`}`, mood: CONSPIRACY_TEAM.includes(s.lastVerdict?.role ?? "innocent") ? "triumphant" : "horrified" },
            ];
      case "gameover":
        return [
          { text: `The game is over — and the victors are: ${(room.winners ?? []).join(", ")}!`, mood: "triumphant" },
          { text: "Grimsby Hollow returns to its uneasy sleep. Until next time.", mood: "warm" },
        ];
      case "banter":
        return [{ text: "The fog thickens while you deliberate. It can wait. It has practice.", mood: "wry" }];
      case "last_words":
        return [{ text: "A voice drifts back from beyond the veil. How theatrical.", mood: "wry" }];
      default:
        return [{ text: "The story continues..." }];
    }
  },
};
