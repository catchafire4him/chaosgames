import { useState } from "react";
import { getMafiaRoleCounts, MAFIA_ROLES } from "@shared/index";
import type { PublicPlayer, PublicRoom } from "@shared/index";
import { avatarSrc } from "../ui";
import type { Send } from "../pages/Play";

interface ConspiracyYou {
  id: string;
  role:
    | "conspirator"
    | "godfather"
    | "doctor"
    | "detective"
    | "vigilante"
    | "jester"
    | "mayor"
    | "consigliere"
    | "innocent"
    | null;
  allies: string[];
  pick: string | null;
  held: boolean;
  bulletUsed: boolean;
  guilt: boolean;
  vote: string | null;
  calledVote: boolean;
  nightResult: string | null;
  messages: string[];
  predict: string | null;
  ghostPoints: number;
  lastWordsUsed: boolean;
  /** mafia only: the family's live kill plan (killers + who they point at) */
  allyPicks: { name: string; you: boolean; targetName: string | null }[];
  /** mafia only: true once every killer points at the same victim */
  killersAgree: boolean;
}

const ROLE_INFO: Record<string, { title: string; desc: string; bad?: boolean }> = {
  conspirator: {
    title: "Mafia",
    desc:
      "Each night, you and your allies must AGREE on someone to eliminate — you'll see " +
      "each other's picks. By day: lie, deflect, survive.",
    bad: true,
  },
  godfather: {
    title: "Godfather",
    desc:
      "You lead the mafia — and to the detective's eye, you appear INNOCENT. " +
      "Each night, agree on a victim with your allies; if the family is split when " +
      "night ends, YOUR pick decides.",
    bad: true,
  },
  doctor: {
    title: "Doctor",
    desc: "Each night, choose someone to protect. If the mafia strikes them, they survive.",
  },
  detective: {
    title: "Detective",
    desc: "Each night, investigate someone. The host will whisper you the truth about them.",
  },
  vigilante: {
    title: "Vigilante",
    desc:
      "You carry ONE bullet. Any night, you may shoot someone — but if they were innocent, " +
      "the guilt will claim you the following night. Choose carefully, or hold your fire.",
  },
  jester: {
    title: "Jester",
    desc:
      "You play no side. You win ONLY if the town votes you out. " +
      "Act suspicious — but not TOO suspicious. Make them want to banish you.",
  },
  mayor: {
    title: "Mayor",
    desc: "Your word carries weight — literally. Your vote counts as TWO during every vote.",
  },
  consigliere: {
    title: "Consigliere",
    desc:
      "Advisor to the mafia. Each night, investigate someone to learn their EXACT role — " +
      "sharper intel than the detective ever gets.",
    bad: true,
  },
  innocent: {
    title: "Innocent",
    desc: "You have no powers — only your wits. Find the mafia before they find you.",
  },
};

export function ConspiracyPhone({
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
  const y = (you ?? {}) as Partial<ConspiracyYou>;
  const role = y.role ?? null;
  const [lastWords, setLastWords] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const act = (action: Record<string, unknown>) => send({ type: "action", action: { kind: "", ...action } as never });

  const targets = (exclude: (p: PublicPlayer) => boolean) =>
    room.players.filter((p) => p.status === "alive" && p.id !== me.id && !exclude(p));

  const renderContent = () => {
    if (me.status === "dead" && room.phase !== "ended") {
      const betting = room.phase === "night" || room.phase === "voting";
      return (
      <div className="dead-screen">
        <div className="skull">👻</div>
        <div className="phone-title">
          Ghost mode {y.ghostPoints ? `· 🔮 ${y.ghostPoints}` : ""}
        </div>
        {betting ? (
          <>
            <p className="phone-hint">
              {room.phase === "night"
                ? "Place your bet: who won't survive the night?"
                : "Place your bet: who gets banished?"}
            </p>
            <div className="target-list" style={{ textAlign: "left" }}>
              {targets(() => false).map((p) => (
                <button
                  key={p.id}
                  className={`target-btn ${y.predict === p.id ? "selected" : ""}`}
                  onClick={() => act({ kind: "predict", targetId: p.id })}
                >
                  <img src={avatarSrc(p.avatar)} alt="" />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="phone-hint">
            Keep your secrets. The next bet opens at nightfall or the vote.
          </p>
        )}
        {!y.lastWordsUsed && (
          <>
            <p className="phone-hint" style={{ marginTop: 10 }}>
              One final statement — the host will read it aloud:
            </p>
            <textarea
              className="alibi-input"
              rows={2}
              maxLength={120}
              placeholder="Tell my goldfish I loved her..."
              value={lastWords}
              onChange={(e) => setLastWords(e.target.value)}
            />
            <button
              disabled={!lastWords.trim()}
              onClick={() => act({ kind: "last_words", text: lastWords.trim() })}
            >
              🪦 Speak my last words
            </button>
          </>
        )}
        {role && <p className="phone-hint">You were: <b>{ROLE_INFO[role]?.title}</b></p>}
      </div>
    );
  }

  const TargetList = ({
    onPick,
    selectedId,
    exclude = () => false,
  }: {
    onPick: (id: string) => void;
    selectedId: string | null | undefined;
    exclude?: (p: PublicPlayer) => boolean;
  }) => (
    <div className="target-list">
      {targets(exclude).map((p) => (
        <button
          key={p.id}
          className={`target-btn ${selectedId === p.id ? "selected" : ""}`}
          onClick={() => onPick(p.id)}
        >
          <img src={avatarSrc(p.avatar)} alt="" />
          <span>{p.name}</span>
        </button>
      ))}
    </div>
  );

  switch (room.phase) {
    case "role_reveal":
      return (
        <>
          <div className={`role-card fade-in ${ROLE_INFO[role ?? ""]?.bad ? "bad" : ""}`}>
            <div className="phone-hint">Your secret role</div>
            <div className="role-name">{ROLE_INFO[role ?? ""]?.title ?? "..."}</div>
            <div className="role-desc">{ROLE_INFO[role ?? ""]?.desc}</div>
            {!!y.allies?.length && (
              <div className="role-desc" style={{ color: "var(--accent)" }}>
                Your fellow mafia members: {y.allies.join(", ")}
              </div>
            )}
          </div>
          {me.done ? (
            <p className="phone-hint">Waiting for the others...</p>
          ) : (
            <button className="primary" onClick={() => act({ kind: "ready" })}>
              Got it. Poker face on.
            </button>
          )}
        </>
      );

    case "night": {
      const sleeper =
        !role ||
        role === "innocent" ||
        role === "jester" ||
        (role === "vigilante" && (y.bulletUsed || y.guilt));
      if (sleeper) {
        return (
          <>
            <div className="phone-title">🌙 Point a finger in the dark</div>
            {y.guilt ? (
              <p className="phone-hint" style={{ color: "var(--danger)" }}>
                The guilt gnaws at you. You feel this night will be your last...
              </p>
            ) : role === "vigilante" && y.bulletUsed ? (
              <p className="phone-hint">Your bullet is spent. You sleep with one eye open.</p>
            ) : null}
            <p className="phone-hint">
              Everyone acts at night — mark who you find most suspicious. Your pick stays
              secret, and it keeps the killers guessing who's who.
            </p>
            <TargetList
              selectedId={y.pick}
              onPick={(id) => act({ kind: "night_pick", targetId: id })}
            />
            {me.done && (
              <p className="phone-hint">Locked in. You can still change your mind.</p>
            )}
          </>
        );
      }
      const isTeam = role === "conspirator" || role === "godfather";
      const showPlan = (isTeam || role === "consigliere") && !!y.allyPicks?.length;
      const prompt = isTeam
        ? "Choose tonight's victim"
        : role === "doctor"
          ? "Choose someone to protect"
          : role === "vigilante"
            ? "Take your shot — or hold your fire"
            : role === "consigliere"
              ? "Choose someone to learn the EXACT role of"
              : "Choose someone to investigate";
      return (
        <>
          <div className="phone-title">🌙 {prompt}</div>
          {!!y.allies?.length && (
            <p className="phone-hint">Allies: {y.allies.join(", ")}</p>
          )}
          {isTeam && (y.allyPicks?.length ?? 0) > 1 && (
            <p className="phone-hint">
              The family must agree on ONE victim. If the night ends split, the boss's
              pick decides.
            </p>
          )}
          {role === "vigilante" && (
            <p className="phone-hint" style={{ color: "var(--danger)" }}>
              ⚠ One bullet. Shoot an innocent and the guilt will kill you.
            </p>
          )}
          {showPlan && (
            <div className="msg-box" style={{ textAlign: "left" }}>
              🔪 The family's plan{" "}
              {(y.allyPicks?.length ?? 0) > 1 && (
                <b style={{ color: y.killersAgree ? "var(--accent)" : "var(--danger)" }}>
                  — {y.killersAgree ? "agreed" : "split"}
                </b>
              )}
              {y.allyPicks!.map((a) => (
                <div key={a.name} style={{ marginTop: 4, fontSize: 14 }}>
                  {a.name}
                  {a.you ? " (you)" : ""} → <b>{a.targetName ?? "undecided…"}</b>
                </div>
              ))}
            </div>
          )}
          <TargetList
            selectedId={y.pick}
            exclude={(p) => (isTeam || role === "consigliere") && (y.allies ?? []).includes(p.name)}
            onPick={(id) => act({ kind: "night_pick", targetId: id })}
          />
          {role === "vigilante" && (
            <button
              className={y.held ? "primary" : ""}
              onClick={() => act({ kind: "hold_fire" })}
            >
              🕊️ Hold fire tonight{y.held ? " ✓" : ""}
            </button>
          )}
          {me.done && !y.held && (
            <p className="phone-hint">
              {isTeam && !y.killersAgree
                ? "Locked in — waiting for the family to agree."
                : "Locked in. You can still change your mind."}
            </p>
          )}
        </>
      );
    }

    case "day":
      return (
        <>
          <div className="phone-title">☀️ Discuss</div>
          {y.nightResult && <div className="msg-box">🔍 {y.nightResult}</div>}
          <p className="phone-hint">Talk it out. When you're ready to hang somebody:</p>
          <button
            className="danger"
            disabled={y.calledVote}
            onClick={() => act({ kind: "call_vote" })}
          >
            {y.calledVote ? "You called for the vote" : "🔥 Call the vote"}
          </button>
          <Inbox messages={y.messages} />
        </>
      );

    case "voting":
      return (
        <>
          <div className="phone-title">⚖️ Vote to banish</div>
          {role === "mayor" && (
            <p className="phone-hint" style={{ color: "var(--accent)" }}>
              👑 Your vote counts as TWO.
            </p>
          )}
          <TargetList selectedId={y.vote} onPick={(id) => act({ kind: "vote", targetId: id })} />
          <button
            className={y.vote === "abstain" ? "primary" : ""}
            onClick={() => act({ kind: "vote", targetId: "abstain" })}
          >
            Abstain
          </button>
        </>
      );

    case "verdict":
      return (
        <>
          <div className="phone-title">The verdict...</div>
          <p className="phone-hint">All eyes on the big screen.</p>
        </>
      );

    case "ended":
      return (
        <>
          <div className="phone-title">
            {room.winners?.includes(me.name) ? "🏆 You win!" : "Defeat."}
          </div>
          <p className="phone-hint">You were: <b>{ROLE_INFO[role ?? ""]?.title}</b></p>
        </>
      );

      default:
        return <p className="phone-hint">Watch the big screen...</p>;
    }
  };

  return (
    <div className="mafia-phone-container" style={{ position: "relative", width: "100%", display: "flex", flexDirection: "column", gap: "10px" }}>
      <button 
        className="guide-toggle-btn" 
        style={{ alignSelf: "center", fontSize: "14px", padding: "6px 16px", borderRadius: "16px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", cursor: "pointer", color: "var(--ink)", fontWeight: "bold" }}
        onClick={() => setShowGuide(true)}
      >
        📖 Roles Guide
      </button>

      {renderContent()}

      {showGuide && (
        <div className="guide-modal-overlay" onClick={() => setShowGuide(false)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000, padding: "20px" }}>
          <div className="guide-modal-dialog" onClick={(e) => e.stopPropagation()} style={{ background: "#161622", border: "1px solid var(--line)", borderRadius: "12px", width: "100%", maxWidth: "400px", maxHeight: "85vh", display: "flex", flexDirection: "column", padding: "20px", position: "relative" }}>
            <button className="modal-close" onClick={() => setShowGuide(false)} style={{ position: "absolute", top: "12px", right: "16px", background: "none", border: "none", color: "var(--ink-dim)", fontSize: "24px", cursor: "pointer" }}>×</button>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "18px" }}>📖 Mafia Roles Guide</h3>
            <p className="guide-intro" style={{ margin: "0 0 16px 0", fontSize: "13px", color: "var(--ink-dim)", lineHeight: "1.4" }}>
              Roles highlighted in <span style={{ color: "var(--accent)" }}>gold</span> are active in tonight's game based on the current player count.
            </p>
            <div className="guide-roles-list" style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "12px", paddingRight: "4px" }}>
              {Object.values(MAFIA_ROLES).map((r) => {
                const activeRoles = getMafiaRoleCounts(room.players.length, room.settings.conspiracyRoles);
                const isActive = activeRoles.some((ar) => ar.id === r.id);
                return (
                  <div key={r.id} className={`guide-role-card team-${r.team} ${isActive ? "active" : ""}`} style={{ padding: "10px 12px", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: isActive ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <span style={{ fontSize: "18px" }}>{r.emoji}</span>
                      <strong style={{ fontSize: "14px", color: isActive ? "var(--accent)" : "var(--ink)" }}>{r.name}</strong>
                      <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em", color: r.team === "mafia" ? "var(--danger)" : r.team === "town" ? "var(--accent)" : "#888", marginLeft: "auto", fontWeight: "bold" }}>{r.team}</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--ink-dim)", lineHeight: "1.4" }}>
                      <div><strong>Power:</strong> {r.ability}</div>
                      <div style={{ marginTop: "3px" }}><strong>Wins:</strong> {r.winCondition}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="primary" style={{ marginTop: "16px", padding: "10px" }} onClick={() => setShowGuide(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Inbox({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <>
      {messages.slice(-3).map((m, i) => (
        <div className="msg-box" key={i}>🤫 {m}</div>
      ))}
    </>
  );
}
