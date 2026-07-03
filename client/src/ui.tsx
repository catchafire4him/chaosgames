import { useEffect, useState } from "react";
import type { PublicPlayer, PublicRoom } from "@shared/index";
import { themedAvatarSrc } from "./theme";

export function avatarSrc(avatar: string): string {
  return `/img/portraits/${avatar}.png`;
}

export function PlayerChip({
  p,
  badge,
  art,
}: {
  p: PublicPlayer;
  badge?: string;
  /** portrait override (e.g. dungeon class art); defaults to the player avatar */
  art?: string;
}) {
  const cls = [
    "player-chip",
    p.status === "dead" ? "dead" : "",
    p.done ? "done" : "",
    p.spotlight ? "spotlight" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <img src={art ?? avatarSrc(p.avatar)} alt="" />
      <div className="p-name">{p.name}{p.connected ? "" : " ⚠"}</div>
      <div className="p-tag">{p.tag ?? ""}</div>
      <div className="p-badge">{badge ?? (p.done ? "✓" : "")}</div>
    </div>
  );
}

export function PlayerGrid({
  room,
  badge,
  art,
}: {
  room: PublicRoom;
  badge?: (p: PublicPlayer) => string | undefined;
  art?: (p: PublicPlayer) => string | undefined;
}) {
  return (
    <div className="player-grid">
      {room.players.map((p) => (
        <PlayerChip key={p.id} p={p} badge={badge?.(p)} art={art?.(p)} />
      ))}
    </div>
  );
}

/** Dungeon Run renders players with their class portraits, not hub avatars.
 *  Pre-game (lobby) the class is derived from the avatar — same mapping the
 *  server uses at setup, so nobody's face changes when the game starts. */
export function moduleArt(room: PublicRoom): ((p: PublicPlayer) => string | undefined) | undefined {
  if (room.moduleId !== "dungeon") return undefined;
  const heroes = (room.module as { heroes?: Record<string, { portrait: string }> } | null)?.heroes;
  return (p) => {
    const portrait = heroes?.[p.id]?.portrait;
    return portrait
      ? `/img/dnd/portraits/${portrait}.png`
      : themedAvatarSrc(room.moduleId, p.avatar);
  };
}

export function TimerChip({ room }: { room: PublicRoom }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(h);
  }, []);
  if (!room.timer) return <div style={{ minWidth: 130 }} />;
  const left = Math.max(0, Math.ceil((room.timer.endsAt - Date.now()) / 1000));
  return <div className="timer-chip">⏳ {left}s</div>;
}

const SFX_EMOJI: Record<string, string> = {
  thunder: "⚡",
  sting: "🗡️",
  bell: "🔔",
  heartbeat: "🫀",
  crowd_gasp: "😱",
  victory: "🏆",
};

export function SfxFlash({ sound }: { sound: string | null }) {
  if (!sound) return null;
  return (
    <div className="sfx-flash" key={sound + Date.now()}>
      {SFX_EMOJI[sound] ?? "✨"}
    </div>
  );
}
