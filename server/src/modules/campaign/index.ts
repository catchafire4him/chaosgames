import type { PlayerAction } from "../../../../shared/src/index.js";
import type { Room, ServerPlayer } from "../../engine/room.js";
import type { GameModule } from "../../engine/types.js";
import {
  ADJECTIVES, BACKSTORIES, CLASSES, CLASS_BY_ID, SIGNATURE_ITEMS, STAT_ARRAY,
  buildHero, classForAvatar,
  type Ability, type Hero, type Stat,
} from "./heroes.js";
import {
  combatPrivate, combatPublic, heroAction, onTurnTimeout, setEncounterEndHandler, startEncounter,
  type EnemySpec,
} from "./combat.js";

/**
 * CHAOS CAMPAIGN (module 4) — a persistent, AI-DM'd fantasy campaign across
 * game nights. See CAMPAIGN_DESIGN.md.
 *
 *   lobby → forge → briefing → (encounter → aftermath)*
 *
 * Phase 2 built the shell + hero forge (persisted to Neon). Phase 3 adds the
 * rules engine (combat.ts): zone combat, initiative, turns, enemy AI, the 12
 * class abilities, downed/revive, win/loss. Chapters (phase 4) will drive
 * encounters from authored scenes; for now `startEncounter` is a library the
 * sim invokes directly.
 */

export type { Hero, Stat, Ability };

interface CampaignState {
  name: string;
  chapterNum: number;
  roster: Record<string, Hero>; // persisted heroes by playerKey
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

// once combat resolves, drop into an aftermath beat (phase 4 continues the story)
setEncounterEndHandler((room, status) => {
  room.setPhase("aftermath");
  room.broadcast();
  room.play({
    id: "aftermath",
    instruction:
      status === "won"
        ? "The party has won the fight. In one or two sentences, celebrate the victory and hint at what lies ahead."
        : "The party was overwhelmed. In one or two sentences, describe them being dragged off or barely escaping — a setback, not the end.",
  });
});

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
    void hydrate(room).then(() => {
      const heroesExist = Object.keys(s.roster).length > 0;
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
      return;
    }
    if (room.phase === "encounter" && action.kind === "combat_action") {
      heroAction(room, playerId, action as Record<string, unknown>);
      return;
    }
  },

  onTimer(room: Room, label: string): void {
    if (label === "forge" && room.phase === "forge") {
      for (const p of room.players.values()) {
        if (!p.data.hero) { p.data.hero = buildHero(p, {}); p.done = true; }
      }
      void finalizeForge(room);
      return;
    }
    if (label === "combat_turn" && room.phase === "encounter") {
      onTurnTimeout(room);
      return;
    }
  },

  publicState(room: Room): unknown {
    const s = C(room);
    const base = {
      name: s.name,
      chapterNum: s.chapterNum,
      phase: room.phase,
      forgeDeadline: s.forgeDeadline,
      party: [...room.players.values()].map((p) => heroCard(p)),
      awaiting: Object.entries(s.roster)
        .filter(([key]) => ![...room.players.values()].some((p) => p.playerKey === key))
        .map(([, h]) => ({ name: h.name, cls: h.cls, level: h.level })),
    };
    if (room.phase === "encounter" || room.phase === "aftermath") {
      return { ...base, combat: combatPublic(room) };
    }
    return base;
  },

  privateState(room: Room, playerId: string): unknown {
    const player = room.players.get(playerId);
    const hero = (player?.data.hero as Hero | undefined) ?? null;
    const base = {
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
    if (room.phase === "encounter") {
      return { ...base, combat: combatPrivate(room, playerId) };
    }
    return base;
  },

  buildContext(room: Room): string {
    const s = C(room);
    const party = [...room.players.values()]
      .map((p) => p.data.hero as Hero | undefined)
      .filter((h): h is Hero => !!h)
      .map((h) => `${h.name} the ${h.quirks.adjective} ${CLASS_BY_ID.get(h.cls)?.label ?? h.cls} (lvl ${h.level}, ${h.hp}/${h.maxHp} HP, carries ${h.quirks.item})`);
    const combat = room.phase === "encounter" ? "\nA fight is underway." : "";
    return [
      `CAMPAIGN: "${s.name}" — chapter ${s.chapterNum + 1}.`,
      party.length ? `THE PARTY:\n${party.map((l) => `- ${l}`).join("\n")}` : "The party is still being forged.",
      combat,
    ].join("\n");
  },

  canned(beatId: string): { text: string; mood?: string }[] {
    switch (beatId) {
      case "briefing":
        return [{ text: "The party is assembled. Steel yourselves, heroes — your saga begins.", mood: "grand" }];
      case "aftermath":
        return [{ text: "The dust settles. What comes next is another tale…", mood: "wry" }];
      default:
        return [{ text: "…", mood: "flat" }];
    }
  },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function heroCard(p: ServerPlayer): unknown {
  const h = p.data.hero as Hero | undefined;
  return {
    id: p.id, name: p.name, avatar: p.avatar, connected: p.connected, ready: !!h,
    cls: h?.cls ?? null, level: h?.level ?? null, hp: h?.hp ?? null, maxHp: h?.maxHp ?? null,
    stats: h?.stats ?? null, quirks: h?.quirks ?? null,
  };
}

function allForged(room: Room): boolean {
  const connected = [...room.players.values()].filter((p) => p.connected);
  return connected.length > 0 && connected.every((p) => !!p.data.hero);
}

async function hydrate(room: Room): Promise<void> {
  const s = C(room);
  if (s.hydrated) return;
  s.hydrated = true;
  if (!room.storage || !room.campaignId) return;
  try {
    const camp = await room.storage.getCampaign(room.campaignId);
    if (camp) { s.name = camp.name; s.chapterNum = camp.chapterNum; }
    const chars = await room.storage.listCharacters(room.campaignId);
    for (const c of chars) {
      s.roster[c.playerKey] = {
        name: c.name, cls: c.cls, avatar: c.avatar, stats: c.stats as Record<Stat, number>,
        hp: c.hp, maxHp: c.maxHp, level: c.level, abilities: c.abilities as Ability[],
        inventory: c.inventory, quirks: c.quirks as Hero["quirks"],
      };
    }
  } catch (err) {
    console.error(`[campaign:${room.code}] hydrate failed:`, err);
  }
}

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
          campaignId: room.campaignId, playerKey: p.playerKey,
          name: h.name, cls: h.cls, avatar: h.avatar, stats: h.stats,
          hp: h.hp, maxHp: h.maxHp, level: h.level, abilities: h.abilities,
          inventory: h.inventory, quirks: h.quirks, portraitAssetId: null,
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

/** Convenience for phase 4 / the sim: a scaled starter encounter. */
export function demoEncounter(room: Room): void {
  const n = [...room.players.values()].filter((p) => p.data.hero).length;
  const specs: EnemySpec[] = [
    { kind: "bruiser", name: "the Troll Tollkeeper" },
    { kind: "minion", name: "a goblin runt" },
    { kind: "minion", name: "another goblin runt" },
  ];
  if (n >= 4) specs.push({ kind: "caster", name: "a hedge-sorcerer" });
  startEncounter(room, "Ambush at the Rusty Bridge", specs);
}
