import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ModuleId, PublicRoom, RoomSettings } from "@shared/index";
import { useSocket } from "../net/socket";
import { useWakeLock } from "../net/useWakeLock";
import { avatarSrc } from "../ui";
import { themedAvatarSrc } from "../theme";
import { ConspiracyPhone } from "../phone/ConspiracyPhone";
import { WhodunnitPhone } from "../phone/WhodunnitPhone";
import { DungeonPhone } from "../phone/DungeonPhone";

export type Send = (msg: ClientMessage) => void;

export function Play({ code }: { code: string }) {
  const storageKey = `chaos_${code}`;
  const [name, setName] = useState("");
  const [joinedName, setJoinedName] = useState<string | null>(() => {
    return localStorage.getItem(`${storageKey}_name`);
  });
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [you, setYou] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const join = useMemo(() => {
    if (!joinedName) return null;
    return {
      type: "join_player" as const,
      room: code,
      name: joinedName,
      playerId: localStorage.getItem(storageKey) ?? undefined,
    };
  }, [code, joinedName, storageKey]);

  const { send, connected } = useSocket(join, (msg) => {
    switch (msg.type) {
      case "joined_player":
        localStorage.setItem(storageKey, msg.playerId);
        setError(null);
        break;
      case "room_state":
        setRoom(msg.room);
        if (msg.you !== undefined) setYou(msg.you);
        break;
      case "private_message":
        setToast(msg.text);
        if (navigator.vibrate) navigator.vibrate(120);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 6000);
        break;
      case "error":
        setError(msg.message);
        if (msg.message.includes("not found") || msg.message.includes("started")) {
          setJoinedName(null);
        }
        break;
    }
  });

  useWakeLock(!!room);

  const roomGone = !!error && error.toLowerCase().includes("not found");

  if (!joinedName) {
    return (
      <div className="phone themed" data-theme="neutral">
        <div className="phone-main" style={{ justifyContent: "center" }}>
          <div className="phone-title">Chaos Games</div>
          {roomGone ? (
            <p className="phone-hint">
              This game session is gone — usually because the server restarted (a deploy or
              restart). The room code <b style={{ color: "var(--accent)" }}>{code}</b> no longer
              exists. Ask the TV to open a fresh room and scan the new code.
            </p>
          ) : (
            <p className="phone-hint">
              Joining room <b style={{ color: "var(--accent)" }}>{code}</b>. What's your name?
            </p>
          )}
          {error && !roomGone && <div className="error-banner">{error}</div>}
          {!roomGone && (
            <>
              <input
                autoFocus
                placeholder="Your name"
                maxLength={16}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) {
                    localStorage.setItem(`${storageKey}_name`, name.trim());
                    setJoinedName(name.trim());
                  }
                }}
              />
              <button
                className="primary"
                disabled={!name.trim()}
                onClick={() => {
                  localStorage.setItem(`${storageKey}_name`, name.trim());
                  setJoinedName(name.trim());
                }}
              >
                Join the game
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const myId = localStorage.getItem(storageKey);
  const me = room?.players.find((p) => p.id === myId) ?? null;
  const isHost = !!me && room?.hostPlayerId === me.id;
  const yg = (you ?? {}) as { __objective?: string | null; __objectiveClaimed?: boolean };

  return (
    <div className="phone themed" data-theme={room ? room.moduleId : "neutral"}>
      {!connected && <div className="reconnect-banner">Reconnecting…</div>}
      <div className="phone-header">
        {me && <img src={themedAvatarSrc(room?.moduleId, me.avatar)} alt="" />}
        <div>
          <div className="ph-name">{me?.name ?? joinedName}</div>
          <div className="ph-tag">{me?.tag ?? (connected ? room?.moduleName ?? "" : "reconnecting...")}</div>
        </div>
        {room?.timer && <PhoneTimer endsAt={room.timer.endsAt} />}
      </div>
      <div className="phone-main">
        {error && <div className="error-banner">{error}</div>}
        {!room && <p className="phone-hint">Connecting...</p>}
        {room && room.phase !== "lobby" && room.phase !== "ended" && yg.__objective && (
          <div className="objective-card">
            <span>🎯 Secret mission: {yg.__objective}</span>
            <button
              className={yg.__objectiveClaimed ? "primary" : ""}
              disabled={yg.__objectiveClaimed}
              onClick={() => send({ type: "action", action: { kind: "claim_objective" } })}
            >
              {yg.__objectiveClaimed ? "claimed ✓" : "I did it"}
            </button>
          </div>
        )}
        {room && room.phase === "lobby" && (
          <>
            <div className="phone-title">You're in!</div>
            {me && (
              <button
                className="avatar-pick"
                onClick={() => send({ type: "action", action: { kind: "cycle_avatar" } })}
              >
                <img src={themedAvatarSrc(room.moduleId, me.avatar)} alt="" />
                <span>
                  {room.moduleId === "dungeon"
                    ? "tap to change your hero"
                    : "tap to change your look"}
                </span>
              </button>
            )}
            <p className="phone-hint">
              Watch the big screen — the host will start the game.
              <br />({room.players.length} player{room.players.length === 1 ? "" : "s"} in the room)
            </p>
          </>
        )}
        {room && room.phase !== "lobby" && me && (
          room.moduleId === "conspiracy" ? (
            <ConspiracyPhone room={room} me={me} you={you} send={send} />
          ) : room.moduleId === "dungeon" ? (
            <DungeonPhone room={room} me={me} you={you} send={send} />
          ) : (
            <WhodunnitPhone room={room} me={me} you={you} send={send} />
          )
        )}
      </div>
      {room && room.phase !== "lobby" && (
        <div className="emote-bar">
          {["😂", "😱", "👏", "🔪", "🤡", "❤️"].map((e) => (
            <button key={e} onClick={() => send({ type: "emote", emoji: e })}>
              {e}
            </button>
          ))}
        </div>
      )}
      {isHost && room && <HostPanel room={room} send={send} />}
      {toast && <div className="toast" onClick={() => setToast(null)}>🤫 {toast}</div>}
    </div>
  );
}

// ─── Party host controls (first player to join) ───────────────────────────────

const PACES: RoomSettings["pace"][] = ["relaxed", "standard", "fast"];

function HostPanel({ room, send }: { room: PublicRoom; send: Send }) {
  const [open, setOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => {
    if (!confirmEnd) return;
    const t = setTimeout(() => setConfirmEnd(false), 4000);
    return () => clearTimeout(t);
  }, [confirmEnd]);

  const host = (msg: Omit<Extract<ClientMessage, { type: "host_command" }>, "type">) =>
    send({ type: "host_command", ...msg });
  const setSetting = (key: keyof RoomSettings, value: string) =>
    host({ command: "set_setting", setting: { key, value } });

  const inLobby = room.phase === "lobby";
  const s = room.settings;

  return (
    <>
      <button className="host-fab" onClick={() => setOpen((o) => !o)} title="party host controls">
        👑
      </button>
      {open && (
        <div className="host-panel">
          <div className="flyout-title">👑 Party host</div>

          {inLobby ? (
            <>
              <button
                className="primary"
                onClick={() => host({ command: "start_game" })}
              >
                ▶ Start the game
              </button>

              <div className="host-section">Pace</div>
              <div className="seg-row">
                {PACES.map((p) => (
                  <button
                    key={p}
                    className={s.pace === p ? "primary" : ""}
                    onClick={() => setSetting("pace", p)}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {room.moduleId === "dungeon" && (
                <>
                  <div className="host-section">Dungeon length</div>
                  <div className="seg-row">
                    {[4, 5, 7].map((n) => (
                      <button
                        key={n}
                        className={s.dungeonRooms === n ? "primary" : ""}
                        onClick={() => setSetting("dungeonRooms", String(n))}
                      >
                        {n} rooms
                      </button>
                    ))}
                  </div>
                  <div className="host-section">Intensity</div>
                  <div className="seg-row">
                    {(["casual", "standard"] as const).map((mode) => (
                      <button
                        key={mode}
                        className={s.dungeonIntensity === mode ? "primary" : ""}
                        onClick={() => setSetting("dungeonIntensity", mode)}
                      >
                        {mode === "casual" ? "casual" : "standard (KOs)"}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {room.moduleId === "whodunnit" && (
                <>
                  <div className="host-section">Investigation rounds</div>
                  <div className="seg-row">
                    {[2, 3, 4].map((n) => (
                      <button
                        key={n}
                        className={s.mysteryRounds === n ? "primary" : ""}
                        onClick={() => setSetting("mysteryRounds", String(n))}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {room.moduleId === "conspiracy" && (
                <>
                  <div className="host-section">Roles</div>
                  <div className="seg-row">
                    {(["classic", "full"] as const).map((mode) => (
                      <button
                        key={mode}
                        className={s.conspiracyRoles === mode ? "primary" : ""}
                        onClick={() => setSetting("conspiracyRoles", mode)}
                      >
                        {mode === "classic" ? "classic" : "full chaos"}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="host-section">Switch game</div>
              <div className="seg-row">
                {(["conspiracy", "whodunnit", "dungeon"] as ModuleId[])
                  .filter((m) => m !== room.moduleId)
                  .map((m) => (
                    <button key={m} onClick={() => host({ command: "switch_module", moduleId: m })}>
                      {m === "dungeon" ? "Dungeon Run" : m}
                    </button>
                  ))}
              </div>

              {room.players.some((p) => !p.connected) && (
                <>
                  <div className="host-section">Remove disconnected</div>
                  {room.players
                    .filter((p) => !p.connected)
                    .map((p) => (
                      <button
                        key={p.id}
                        className="danger"
                        onClick={() => host({ command: "kick_player", playerId: p.id })}
                      >
                        ✕ {p.name}
                      </button>
                    ))}
                </>
              )}
            </>
          ) : room.phase === "ended" ? (
            <button className="primary" onClick={() => host({ command: "play_again" })}>
              ↺ Back to the lobby
            </button>
          ) : (
            <>
              <button onClick={() => host({ command: "skip_narration" })}>⏭ Skip narration</button>
              <button disabled={!room.timer} onClick={() => host({ command: "extend_timer" })}>
                ⏳ +30 seconds
              </button>
              <button
                className={confirmEnd ? "danger" : ""}
                onClick={() => {
                  if (confirmEnd) {
                    host({ command: "abort_game" });
                    setConfirmEnd(false);
                    setOpen(false);
                  } else setConfirmEnd(true);
                }}
              >
                {confirmEnd ? "really end it? ✕" : "✕ End game early"}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function PhoneTimer({ endsAt }: { endsAt: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(h);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  return (
    <div style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 20 }}>⏳{left}</div>
  );
}
