import { useState } from "react";
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
}

const ROLE_INFO: Record<string, { title: string; desc: string; bad?: boolean }> = {
  conspirator: {
    title: "Conspirator",
    desc: "Each night, you and your allies choose someone to eliminate. By day: lie, deflect, survive.",
    bad: true,
  },
  godfather: {
    title: "Godfather",
    desc:
      "You lead the conspiracy — and to the detective's eye, you appear INNOCENT. " +
      "Each night, choose a victim with your allies.",
    bad: true,
  },
  doctor: {
    title: "Doctor",
    desc: "Each night, choose someone to protect. If the conspirators strike them, they survive.",
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
      "Advisor to the conspiracy. Each night, investigate someone to learn their EXACT role — " +
      "sharper intel than the detective ever gets.",
    bad: true,
  },
  innocent: {
    title: "Innocent",
    desc: "You have no powers — only your wits. Find the conspirators before they find you.",
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
  const act = (action: Record<string, unknown>) => send({ type: "action", action: { kind: "", ...action } as never });

  const targets = (exclude: (p: PublicPlayer) => boolean) =>
    room.players.filter((p) => p.status === "alive" && p.id !== me.id && !exclude(p));

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
                Your fellow conspirators: {y.allies.join(", ")}
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
          {role === "vigilante" && (
            <p className="phone-hint" style={{ color: "var(--danger)" }}>
              ⚠ One bullet. Shoot an innocent and the guilt will kill you.
            </p>
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
            <p className="phone-hint">Locked in. You can still change your mind.</p>
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
