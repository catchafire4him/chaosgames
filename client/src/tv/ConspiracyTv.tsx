import type { PublicRoom } from "@shared/index";
import { PlayerGrid } from "../ui";

interface GhostScore {
  name: string;
  points: number;
}

interface Death {
  name: string;
  cause: "murder" | "vigilante" | "guilt";
}

interface ConspiracyPublic {
  ghostScores: GhostScore[];
  totalConspirators: number;
  rolesList: string[];
  lastDawn: { deaths: Death[]; saved: boolean } | null;
  lastVerdict: { name: string; role: string; tied: boolean } | null;
  votesIn: number | null;
  nightActed: number | null;
  callVotes: number | null;
  aliveCount: number;
}

export function ConspiracyTv({ room }: { room: PublicRoom }) {
  const m = room.module as ConspiracyPublic | null;
  if (!m) return null;

  const banner = (() => {
    switch (room.phase) {
      case "role_reveal":
        return `${m.totalConspirators} mafia member${m.totalConspirators > 1 ? "s" : ""} walk among you. Check your phones.`;
      case "night":
        return "The town sleeps. Some of you are... busy.";
      case "day": {
        const deaths = m.lastDawn?.deaths ?? [];
        return deaths.length
          ? `☠ ${deaths.map((d) => d.name).join(" · ")} — dead by morning.`
          : m.lastDawn?.saved
            ? "An attack — but the victim was saved!"
            : "Nobody died last night. Curious.";
      }
      case "voting":
        return "Cast your votes. Someone hangs today.";
      case "verdict":
        return m.lastVerdict?.tied
          ? "Deadlock — nobody is banished."
          : `${m.lastVerdict?.name} was banished — they were ${m.lastVerdict?.role?.toUpperCase()}.`;
      default:
        return "";
    }
  })();

  const sub = (() => {
    if (room.phase === "day" && m.callVotes !== null) {
      return `${m.callVotes}/${m.aliveCount} calling for a vote — tap it on your phone`;
    }
    if (room.phase === "voting" && m.votesIn !== null) {
      return `${m.votesIn}/${m.aliveCount} votes in`;
    }
    if (room.phase === "night") {
      return m.nightActed != null
        ? `${m.nightActed}/${m.aliveCount} choices made — every player acts at night`
        : "Everyone: make your night choice on your phone";
    }
    if (room.phase === "role_reveal" && m.rolesList?.length) {
      return `In play tonight: ${m.rolesList.join(" · ")}`;
    }
    return "";
  })();

  return (
    <>
      {banner && <div className="tv-banner fade-in" key={banner}>{banner}</div>}
      {sub && <div className="tv-sub">{sub}</div>}
      <PlayerGrid
        room={room}
        badge={(p) => {
          if (p.status !== "dead") return undefined;
          const g = m.ghostScores?.find((s) => s.name === p.name);
          return g && g.points > 0 ? `🔮 ${g.points}` : "👻";
        }}
      />
    </>
  );
}
