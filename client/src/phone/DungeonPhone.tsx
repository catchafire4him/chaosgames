import { useEffect, useRef, useState } from "react";
import type { PublicPlayer, PublicRoom } from "@shared/index";
import type { Send } from "../pages/Play";

interface DungeonYou {
  id: string;
  classId: string | null;
  classLabel: string | null;
  portrait: string | null;
  quirk: string | null;
  adjective: string | null;
  sigItem: string | null;
  backstory: string | null;
  forgeOptions: { adjectives: string[]; items: string[]; backstories: string[] } | null;
  affinity: "brute" | "magic" | "chaos" | null;
  buffCharges: number;
  sabCharges: number;
  koed: boolean;
  isActive: boolean;
  messages: string[];
}

interface Item {
  id: string;
  name: string;
  effect: "power" | "shield";
}

interface DungeonPublic {
  activeName: string | null;
  turn: {
    action: string | null;
    difficulty: number;
    roll: number | null;
    itemUsed: Item | null;
  } | null;
  currentRoom: {
    title: string;
    challenge: string;
    situational?: { label: string; description: string } | null;
  } | null;
  items: Item[];
}

const ACTIONS: { id: "brute" | "magic" | "chaos"; icon: string; label: string }[] = [
  { id: "brute", icon: "🪓", label: "Brute Force" },
  { id: "magic", icon: "✨", label: "Magic" },
  { id: "chaos", icon: "🎲", label: "Pure Chaos" },
];

export function DungeonPhone({
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
  const y = (you ?? {}) as Partial<DungeonYou>;
  const m = (room.module ?? {}) as Partial<DungeonPublic>;
  const act = (action: Record<string, unknown>) =>
    send({ type: "action", action: { kind: "", ...action } as never });
  const actRef = useRef(act);
  actRef.current = act;

  // shake-to-roll (iOS needs a one-tap permission grant first)
  const needsMotionPermission =
    typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> })
      ?.requestPermission === "function";
  const [motionGranted, setMotionGranted] = useState(!needsMotionPermission);
  const canShake = y.isActive && room.phase === "rolling";
  useEffect(() => {
    if (!canShake || !motionGranted || !("DeviceMotionEvent" in window)) return;
    let lastFire = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.abs(a.x ?? 0) + Math.abs(a.y ?? 0) + Math.abs(a.z ?? 0);
      if (mag > 45 && Date.now() - lastFire > 2000) {
        lastFire = Date.now();
        if (navigator.vibrate) navigator.vibrate(80);
        actRef.current({ kind: "roll" });
      }
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [canShake, motionGranted]);

  const UseItems = () => {
    const items = m.items ?? [];
    if (!y.isActive || m.turn?.itemUsed || !items.length) return null;
    return (
      <>
        <p className="phone-hint">Party inventory — use one?</p>
        <div className="target-list">
          {items.map((it, i) => (
            <button
              key={`${it.id}_${i}`}
              className="target-btn"
              onClick={() => act({ kind: "use_item", itemId: it.id })}
            >
              <img src={`/img/dnd/items/${it.id}.png`} alt="" style={{ borderRadius: 8 }} />
              <span>
                {it.name}
                <em style={{ color: "var(--good)" }}>
                  {" "}{it.effect === "power" ? "+4 to the roll" : "blocks all sabotage"}
                </em>
              </span>
            </button>
          ))}
        </div>
      </>
    );
  };

  const ClassCard = () => (
    <div className="role-card fade-in" style={{ padding: "16px" }}>
      {y.portrait && (
        <img
          src={`/img/dnd/portraits/${y.portrait}.png`}
          alt=""
          style={{ width: 92, height: 92, borderRadius: "50%", objectFit: "cover", border: "3px solid var(--accent)" }}
        />
      )}
      <div className="role-name" style={{ fontSize: 26 }}>
        {me.name} the {y.adjective ? `${y.adjective} ` : ""}{y.classLabel}
      </div>
      <div className="role-desc">{y.quirk}</div>
      {y.sigItem && <div className="role-desc">Carrying: {y.sigItem}</div>}
      {y.backstory && <div className="role-desc" style={{ fontStyle: "italic" }}>“{y.backstory}”</div>}
      <div className="role-desc" style={{ color: "var(--accent)" }}>
        {y.koed ? "▲∞ bless · ▼∞ sabotage (heckler)" : `▲${y.buffCharges} bless · ▼${y.sabCharges} sabotage`} · affinity: {y.affinity}
      </div>
      {y.koed && (
        <div className="role-desc" style={{ color: "var(--danger)", fontWeight: "bold" }}>
          💀 Knocked out — you're a permanent heckler for the rest of the run.
        </div>
      )}
    </div>
  );

  const ForgePicker = ({
    title,
    options,
    picked,
    category,
  }: {
    title: string;
    options: string[];
    picked: string | null | undefined;
    category: string;
  }) => (
    <>
      <p className="phone-hint" style={{ marginTop: 6 }}>{title}</p>
      <div className="target-list">
        {options.map((o) => (
          <button
            key={o}
            className={`target-btn ${picked === o ? "selected" : ""}`}
            onClick={() => act({ kind: "forge_pick", category, value: o })}
          >
            <span>{o}</span>
          </button>
        ))}
      </div>
    </>
  );

  if (room.phase === "forge") {
    const o = y.forgeOptions;
    return (
      <>
        <div className="phone-title">⚒️ Forge your legend</div>
        <p className="phone-hint">
          You are {me.name} the <b>{y.classLabel}</b>. Now fill in the embarrassing details:
        </p>
        {o ? (
          <>
            <ForgePicker title="What kind of hero are you?" options={o.adjectives} picked={y.adjective} category="adjective" />
            <ForgePicker title="What do you carry?" options={o.items} picked={y.sigItem} category="item" />
            <ForgePicker title="Why are you even here?" options={o.backstories} picked={y.backstory} category="backstory" />
            {me.done && <p className="phone-hint">Legend forged. Waiting for the others…</p>}
          </>
        ) : (
          <p className="phone-hint">Preparing the forge…</p>
        )}
      </>
    );
  }

  if (room.phase === "intro" || room.phase === "room_intro") {
    return (
      <>
        <div className="phone-title">{room.phase === "intro" ? "Meet your hero" : m.currentRoom?.title ?? "A new chamber"}</div>
        <ClassCard />
        <p className="phone-hint">Listen to the Dungeon Master…</p>
      </>
    );
  }

  if (room.phase === "ended") {
    return (
      <>
        <div className="phone-title">
          {room.winners?.length ? "🏆 The party escaped!" : "💀 The dungeon wins."}
        </div>
        <ClassCard />
      </>
    );
  }

  // Your turn
  if (y.isActive) {
    if (room.phase === "action_pick") {
      return (
        <>
          <div className="phone-title">⚔️ Your trial!</div>
          {m.currentRoom && <p className="phone-hint">{m.currentRoom.challenge}</p>}
          <div className="target-list">
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                className="target-btn action-btn"
                onClick={() => act({ kind: "pick_action", action: a.id })}
              >
                <span style={{ fontSize: 30 }}>{a.icon}</span>
                <span>
                  {a.label}
                  {y.affinity === a.id && (
                    <em style={{ color: "var(--good)" }}> +2 (your specialty)</em>
                  )}
                </span>
              </button>
            ))}
            {m.currentRoom?.situational && (
              <button
                className="target-btn action-btn"
                onClick={() => act({ kind: "pick_action", action: "situational" })}
              >
                <span style={{ fontSize: 30 }}>🎭</span>
                <span>
                  {m.currentRoom.situational.label}
                  {m.currentRoom.situational.description && (
                    <em style={{ color: "var(--ink-dim)" }}> — {m.currentRoom.situational.description}</em>
                  )}
                </span>
              </button>
            )}
          </div>
          <UseItems />
        </>
      );
    }
    if (room.phase === "rolling") {
      return (
        <>
          <div className="phone-title">Fate awaits</div>
          <p className="phone-hint">
            Beat {m.turn?.difficulty}. Your friends are meddling right now.
            {m.turn?.itemUsed && <> Using: <b>{m.turn.itemUsed.name}</b>.</>}
          </p>
          <button className="primary roll-btn" onClick={() => act({ kind: "roll" })}>
            🎲 ROLL
          </button>
          {motionGranted ? (
            <p className="phone-hint">…or shake your phone!</p>
          ) : (
            <button
              onClick={() =>
                (DeviceMotionEvent as unknown as { requestPermission(): Promise<string> })
                  .requestPermission()
                  .then((r) => setMotionGranted(r === "granted"))
                  .catch(() => {})
              }
            >
              📳 Enable shake-to-roll
            </button>
          )}
          <UseItems />
        </>
      );
    }
    return (
      <>
        <div className="phone-title">The dice have spoken</div>
        <p className="phone-hint">All eyes on the big screen.</p>
      </>
    );
  }

  // Spectator (or a KO'd heckler, in standard intensity)
  if (room.phase === "action_pick" || room.phase === "rolling") {
    const heckler = !!y.koed;
    return (
      <>
        <div className="phone-title">{m.activeName} faces the trial</div>
        {heckler ? (
          <p className="phone-hint" style={{ color: "var(--accent)" }}>
            💀 You're knocked out — but as a ghostly heckler you have UNLIMITED charges. Go wild.
          </p>
        ) : (
          <p className="phone-hint">Spend charges to tilt their fate — they refill every room.</p>
        )}
        <button
          className="primary"
          style={{ fontSize: 20, padding: "18px" }}
          disabled={!heckler && (y.buffCharges ?? 0) <= 0}
          onClick={() => act({ kind: "spend", spendKind: "buff" })}
        >
          ▲ BLESS (+2) — {heckler ? "∞" : y.buffCharges} left
        </button>
        <button
          className="danger"
          style={{ fontSize: 20, padding: "18px" }}
          disabled={!heckler && (y.sabCharges ?? 0) <= 0}
          onClick={() => act({ kind: "spend", spendKind: "sabotage" })}
        >
          ▼ SABOTAGE (−2) — {heckler ? "∞" : y.sabCharges} left
        </button>
      </>
    );
  }

  return (
    <>
      <div className="phone-title">The story unfolds…</div>
      <ClassCard />
    </>
  );
}
