import type { ModuleId, PublicRoom } from "@shared/index";

/**
 * Per-module theming. The hub (landing + phone join) stays NEUTRAL; the moment
 * a room's module is known, its theme takes over palette/typography (via the
 * [data-theme] CSS blocks in styles.css) and scene artwork (here).
 *
 * Adding a game mode: add an entry here + a [data-theme="<id>"] block in
 * styles.css. Everything else picks it up automatically.
 */
export interface Theme {
  /** value for the data-theme attribute (drives CSS variables) */
  id: string;
  /** big-screen lobby backdrop */
  lobbyBg: string;
  /** backdrop per game phase (fallback used when a phase isn't listed) */
  phaseBg: Record<string, string>;
  fallbackBg: string;
  /** looping lobby/game-over music, if any */
  music?: string;
  /** state-driven backdrop (e.g. current dungeon room) — wins over phaseBg */
  dynamicBg?: (room: PublicRoom) => string | undefined;
}

export const NEUTRAL_THEME: Theme = {
  id: "neutral",
  lobbyBg: "",
  phaseBg: {},
  fallbackBg: "",
};

const THEMES: Record<ModuleId, Theme> = {
  conspiracy: {
    id: "conspiracy",
    lobbyBg: "/img/bg/lobby.png",
    phaseBg: {
      role_reveal: "/img/bg/lobby.png",
      night: "/img/bg/night.png",
      day: "/img/bg/day.png",
      voting: "/img/bg/voting.png",
      verdict: "/img/bg/voting.png",
      ended: "/img/bg/revelation.png",
    },
    fallbackBg: "/img/bg/day.png",
    music: "/audio/conspiracy-theme.mp3",
  },
  whodunnit: {
    id: "whodunnit",
    lobbyBg: "/img/locations/drawing-room.png",
    phaseBg: {
      prologue: "/img/locations/master-bedroom.png",
      investigation: "/img/locations/library.png",
      clue_reveal: "/img/locations/library.png",
      accusation: "/img/locations/billiard-room.png",
      verdict: "/img/locations/billiard-room.png",
      revelation: "/img/bg/revelation.png",
      ended: "/img/bg/revelation.png",
    },
    fallbackBg: "/img/locations/generic.png",
    music: "/audio/whodunnit-theme.mp3",
  },
  dungeon: {
    id: "dungeon",
    lobbyBg: "/img/dnd/rooms/room_1.png",
    phaseBg: {
      ended: "/img/dnd/rooms/room_5.png",
    },
    fallbackBg: "/img/dnd/rooms/room_1.png",
    music: "/audio/dungeon-theme.mp3",
    dynamicBg: (room) => {
      const art = (room.module as { roomArt?: string } | null)?.roomArt;
      return art ? `/img/dnd/rooms/${art}.png` : undefined;
    },
  },
  // Campaign reuses the dungeon art set for v1 (generated scenes land in phase 6)
  campaign: {
    id: "campaign",
    lobbyBg: "/img/dnd/rooms/room_2.png",
    phaseBg: {
      forge: "/img/dnd/rooms/room_1.png",
      briefing: "/img/dnd/rooms/room_3.png",
    },
    fallbackBg: "/img/dnd/rooms/room_2.png",
    music: "/audio/dungeon-theme.mp3",
  },
};

export function themeFor(moduleId: ModuleId | null | undefined): Theme {
  return (moduleId && THEMES[moduleId]) || NEUTRAL_THEME;
}

/** Deterministic avatar → dungeon class portrait. MUST stay in sync with
 *  classForAvatar in server/src/modules/dungeon/index.ts (same order/rule),
 *  so the lobby look matches the class assigned at game start. */
const DUNGEON_CLASS_IDS = [
  "barbarian",
  "wizard",
  "rogue",
  "bard",
  "knight",
  "hedge_witch",
  "goblin_diplomat",
  "retired_pirate",
  "overconfident_alchemist",
  "feral_druid",
  "tavern_bouncer",
  "cursed_influencer",
];

export function dungeonPortraitFor(avatar: string): string {
  const idx = Math.max(0, (parseInt(avatar.replace(/\D/g, ""), 10) || 1) - 1);
  const cls = DUNGEON_CLASS_IDS[idx % DUNGEON_CLASS_IDS.length];
  const baseSex = idx % 2 === 0 ? "m" : "f";
  const sex = idx < DUNGEON_CLASS_IDS.length ? baseSex : baseSex === "m" ? "f" : "m";
  return `${cls}_${sex}`;
}

/** Portrait src for a player, themed to the room's game mode. */
export function themedAvatarSrc(
  moduleId: ModuleId | null | undefined,
  avatar: string,
): string {
  if (moduleId === "dungeon" || moduleId === "campaign") {
    return `/img/dnd/portraits/${dungeonPortraitFor(avatar)}.png`;
  }
  return `/img/portraits/${avatar}.png`;
}

/** Class portrait for a Campaign hero (their chosen class, m/f from avatar). */
export function campaignPortrait(cls: string, avatar: string): string {
  const idx = Math.max(0, (parseInt(avatar.replace(/\D/g, ""), 10) || 1) - 1);
  const sex = idx % 2 === 0 ? "m" : "f";
  return `/img/dnd/portraits/${cls}_${sex}.png`;
}
