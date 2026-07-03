import type { PublicPlayer, PublicRoom } from "@shared/index";
import { avatarSrc, PlayerGrid } from "../ui";

interface WhodunnitPublic {
  scenario: {
    title: string;
    setting: string;
    victimName: string;
    victimDescription: string;
    weapon: string;
  } | null;
  locations: { id: string; name: string }[];
  clues: { round: number; locationId: string; text: string }[];
  round: number;
  maxRounds: number;
  trial: {
    accusedId: string;
    accusedName: string;
    accusedCharacter: string | null;
    alibi: string | null;
    votesIn: number;
    jurors: number;
  } | null;
  lastOutcome: { name: string; convicted: boolean; wasKiller: boolean; tied?: boolean } | null;
  reputations: Record<string, { reputation: number; cleared: boolean }>;
  locationsOccupancy: Record<string, string[]> | null;
}

export function WhodunnitTv({ room }: { room: PublicRoom }) {
  const m = room.module as WhodunnitPublic | null;
  if (!m) return null;

  const byId = new Map(room.players.map((p) => [p.id, p]));
  const repBadge = (p: PublicPlayer) => {
    const r = m.reputations[p.id];
    if (!r) return undefined;
    return `${r.cleared ? "✓ cleared · " : ""}${"⭐".repeat(Math.max(0, r.reputation))}`;
  };

  if (room.phase === "prologue") {
    return (
      <>
        <div className="tv-banner title-font fade-in">
          {m.scenario ? m.scenario.title : "The Inspector is composing tonight's tragedy..."}
        </div>
        {m.scenario && (
          <div className="tv-sub" style={{ maxWidth: 900 }}>
            {m.scenario.setting} The victim: {m.scenario.victimName},{" "}
            {m.scenario.victimDescription}
          </div>
        )}
        <PlayerGrid room={room} />
      </>
    );
  }

  if (room.phase === "investigation" || room.phase === "clue_reveal") {
    return (
      <>
        <div className="tv-sub">
          Round {m.round} of {m.maxRounds} —{" "}
          {room.phase === "investigation"
            ? "choose where to search on your phones"
            : "the evidence emerges..."}
        </div>
        <div className="location-grid">
          {m.locations.map((loc) => {
            const here = (m.locationsOccupancy?.[loc.id] ?? [])
              .map((id) => byId.get(id))
              .filter((p): p is PublicPlayer => !!p);
            return (
              <div className="location-card" key={loc.id}>
                <img className="loc-art" src={`/img/locations/${loc.id}.png`} alt="" />
                <div className="loc-people">
                  {here.map((p) => (
                    <img key={p.id} src={avatarSrc(p.avatar)} title={p.name} alt={p.name} />
                  ))}
                </div>
                <div className="loc-name">{loc.name}</div>
              </div>
            );
          })}
        </div>
        {m.clues.length > 0 && (
          <div className="clue-feed">
            {m.clues.slice(-4).map((c, i) => (
              <div key={i}>
                <span className="clue-loc">
                  {m.locations.find((l) => l.id === c.locationId)?.name ?? c.locationId}:
                </span>{" "}
                {c.text}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  if (room.phase === "accusation") {
    return (
      <>
        <div className="tv-banner fade-in">Who is your prime suspect?</div>
        <div className="tv-sub">Point your finger on your phone. Round {m.round} of {m.maxRounds}.</div>
        <PlayerGrid room={room} badge={repBadge} />
      </>
    );
  }

  if (room.phase === "verdict" && m.trial) {
    const accused = byId.get(m.trial.accusedId);
    return (
      <>
        <div className="tv-banner fade-in">
          ⚖️ {m.trial.accusedName}
          {m.trial.accusedCharacter ? ` — "${m.trial.accusedCharacter}"` : ""} stands accused!
        </div>
        {accused && (
          <img
            src={avatarSrc(accused.avatar)}
            alt=""
            style={{ width: 170, height: 170, borderRadius: "50%", border: "4px solid var(--accent)", objectFit: "cover" }}
          />
        )}
        <div className="tv-sub" style={{ fontStyle: "italic", fontSize: 28 }}>
          {m.trial.alibi ? `“${m.trial.alibi}”` : "Awaiting their alibi..."}
        </div>
        <div className="tv-sub">
          {m.trial.votesIn}/{m.trial.jurors} verdicts in — guilty or innocent?
        </div>
      </>
    );
  }

  if (room.phase === "revelation") {
    return (
      <>
        <div className="tv-banner title-font fade-in">The Revelation</div>
        <PlayerGrid room={room} badge={repBadge} />
      </>
    );
  }

  return <PlayerGrid room={room} badge={repBadge} />;
}
