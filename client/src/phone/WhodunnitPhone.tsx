import { useState } from "react";
import type { PublicPlayer, PublicRoom } from "@shared/index";
import { avatarSrc } from "../ui";
import type { Send } from "../pages/Play";

interface WhodunnitYou {
  id: string;
  isKiller: boolean;
  isAccomplice: boolean;
  accomplices: string[];
  character: { name: string; quirk: string } | null;
  location: string | null;
  clues: string[];
  suspect: string | null;
  verdictVote: "guilty" | "innocent" | null;
  reputation: number;
  messages: string[];
}

interface WhodunnitPublic {
  locations: { id: string; name: string }[];
  trial: { accusedId: string; accusedName: string; alibi: string | null } | null;
  alibiOptions: string[];
  round: number;
  maxRounds: number;
}

export function WhodunnitPhone({
  room,
  me,
  you,
  send,
}: {
  room: PublicRoom;
  me: PublicPlayer;
  you: unknown;
  send: Send;
}) {
  const y = (you ?? {}) as Partial<WhodunnitYou>;
  const m = (room.module ?? {}) as Partial<WhodunnitPublic>;
  const [alibiDraft, setAlibiDraft] = useState("");
  const act = (action: Record<string, unknown>) =>
    send({ type: "action", action: { kind: "", ...action } as never });

  const CharacterCard = () =>
    y.character ? (
      <div className={`role-card fade-in ${y.isKiller ? "bad" : ""}`}>
        <div className="phone-hint">You are playing</div>
        <div className="role-name">{y.character.name}</div>
        <div className="role-desc">{y.character.quirk}</div>
        {y.isKiller && (
          <div className="role-desc" style={{ color: "#e0566f", fontWeight: "bold" }}>
            🔪 YOU ARE THE KILLER. Deflect. Deceive. Don't get caught.
            {!!y.accomplices?.length && <> Your team: {y.accomplices.join(", ")}</>}
          </div>
        )}
        {y.isAccomplice && (
          <div className="role-desc" style={{ color: "#e0566f", fontWeight: "bold" }}>
            🤫 YOU ARE THE ACCOMPLICE. You know the truth: {(y.accomplices ?? []).join(", ")}.
            Protect them, muddy the trail — and never let suspicion land on you.
          </div>
        )}
      </div>
    ) : (
      <p className="phone-hint">The Inspector is preparing your character...</p>
    );

  const Clues = () =>
    y.clues?.length ? (
      <>
        <div className="phone-hint" style={{ marginTop: 8 }}>Your private clues:</div>
        {y.clues.slice(-4).map((c, i) => (
          <div className="msg-box" key={i}>🔍 {c}</div>
        ))}
      </>
    ) : null;

  switch (room.phase) {
    case "prologue":
      return (
        <>
          <div className="phone-title">The Crime</div>
          <CharacterCard />
          <p className="phone-hint">Listen to the big screen...</p>
        </>
      );

    case "investigation":
      return (
        <>
          <div className="phone-title">
            🔎 Where do you search? <span style={{ color: "var(--ink-dim)", fontSize: 15 }}>({m.round}/{m.maxRounds})</span>
          </div>
          <div className="target-list">
            {(m.locations ?? []).map((loc) => (
              <button
                key={loc.id}
                className={`target-btn ${y.location === loc.id ? "selected" : ""}`}
                onClick={() => act({ kind: "move", locationId: loc.id })}
              >
                <span style={{ fontSize: 22 }}>📍</span>
                <span style={{ textTransform: "capitalize" }}>{loc.name}</span>
              </button>
            ))}
          </div>
          <Clues />
        </>
      );

    case "clue_reveal":
      return (
        <>
          <div className="phone-title">The evidence emerges...</div>
          <p className="phone-hint">Watch the big screen. Private tips arrive here.</p>
          <Clues />
        </>
      );

    case "accusation":
      return (
        <>
          <div className="phone-title">☝️ Your prime suspect</div>
          <div className="target-list">
            {room.players
              .filter((p) => p.id !== me.id && p.status === "alive")
              .map((p) => (
                <button
                  key={p.id}
                  className={`target-btn ${y.suspect === p.id ? "selected" : ""}`}
                  onClick={() => act({ kind: "suspect_pick", targetId: p.id })}
                >
                  <img src={avatarSrc(p.avatar)} alt="" />
                  <span>
                    {p.name}
                    {p.tag ? <em style={{ color: "var(--accent)" }}> — {p.tag}</em> : null}
                  </span>
                </button>
              ))}
          </div>
          <Clues />
        </>
      );

    case "verdict": {
      const trial = m.trial;
      if (!trial) return <p className="phone-hint">Watch the big screen...</p>;
      if (trial.accusedId === me.id) {
        return (
          <>
            <div className="phone-title">😰 You stand accused!</div>
            {trial.alibi ? (
              <p className="phone-hint">Your alibi is on record. Sweat gracefully.</p>
            ) : (
              <>
                <p className="phone-hint">
                  Write your alibi — the Inspector will read it aloud to the room:
                </p>
                <textarea
                  className="alibi-input"
                  maxLength={140}
                  rows={3}
                  placeholder="I was... elsewhere. Doing... things."
                  value={alibiDraft}
                  onChange={(e) => setAlibiDraft(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={!alibiDraft.trim()}
                  onClick={() => act({ kind: "alibi", text: alibiDraft.trim() })}
                >
                  💬 Swear to it
                </button>
                <p className="phone-hint">or grab a classic:</p>
                <div className="target-list">
                  {(m.alibiOptions ?? []).map((a) => (
                    <button key={a} className="target-btn" onClick={() => setAlibiDraft(a)}>
                      <span>💬 {a}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        );
      }
      return (
        <>
          <div className="phone-title">⚖️ {trial.accusedName} — guilty?</div>
          <button
            className={y.verdictVote === "guilty" ? "danger" : ""}
            style={y.verdictVote === "guilty" ? {} : { background: "#3a2430" }}
            onClick={() => act({ kind: "verdict_vote", vote: "guilty" })}
          >
            🔨 GUILTY {y.verdictVote === "guilty" && "✓"}
          </button>
          <button
            className={y.verdictVote === "innocent" ? "primary" : ""}
            onClick={() => act({ kind: "verdict_vote", vote: "innocent" })}
          >
            🕊️ INNOCENT {y.verdictVote === "innocent" && "✓"}
          </button>
          <p className="phone-hint">Careful — convicting an innocent costs you reputation.</p>
        </>
      );
    }

    case "revelation":
    case "ended":
      return (
        <>
          <div className="phone-title">
            {room.winners?.includes(me.name) ? "🏆 You win!" : "Outplayed."}
          </div>
          <p className="phone-hint">
            {y.isKiller ? "You were the killer all along." : "You were innocent."}
          </p>
          <CharacterCard />
        </>
      );

    default:
      return <p className="phone-hint">Watch the big screen...</p>;
  }
}
