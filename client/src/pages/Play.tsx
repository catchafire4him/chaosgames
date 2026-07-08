import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ModuleId, PublicRoom, RoomSettings } from "@shared/index";
import { useSocket } from "../net/socket";
import { useWakeLock } from "../net/useWakeLock";
import { avatarSrc } from "../ui";
import { themedAvatarSrc } from "../theme";
import { ConspiracyPhone } from "../phone/ConspiracyPhone";
import { WhodunnitPhone } from "../phone/WhodunnitPhone";
import { DungeonPhone } from "../phone/DungeonPhone";
import { CampaignPhone } from "../phone/CampaignPhone";
import { playerKey } from "../net/playerKey";
import { useSession, signIn, signUp, signOut, getAuthToken } from "../net/auth";

export type Send = (msg: ClientMessage) => void;

/** career stats echoed back on join (optional accounts; guests get it too) */
type Account = { name?: string; email?: string; stats?: { games: number; wins: number; points: number } };

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
  // remembered seat id — MUST live in state so reconnects re-send it. (Reading
  // localStorage inside the memo captured `undefined` on first join and never
  // updated, so every lobby reconnect created a brand-new player.)
  const [playerId, setPlayerId] = useState<string | null>(() => localStorage.getItem(storageKey));
  // Optional accounts: JWT captured once at join time (stable, so it doesn't
  // churn the socket). null = guest. Account echo drives the "career" line.
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  const join = useMemo(() => {
    if (!joinedName) return null;
    return {
      type: "join_player" as const,
      room: code,
      name: joinedName,
      playerId: playerId ?? undefined,
      playerKey: playerKey(),
      authToken: authToken ?? undefined,
    };
  }, [code, joinedName, playerId, authToken]);

  const { send, connected } = useSocket(join, (msg) => {
    switch (msg.type) {
      case "joined_player":
        localStorage.setItem(storageKey, msg.playerId);
        setPlayerId(msg.playerId);
        if (msg.account) setAccount(msg.account);
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

  const { data: session } = useSession();

  // Guests join instantly (one tap). Only signed-in players pay for a token
  // fetch — and even that fails soft (null → server treats them as a guest).
  const commitJoin = async (finalName: string) => {
    localStorage.setItem(`${storageKey}_name`, finalName);
    if (session?.user) setAuthToken(await getAuthToken());
    setJoinedName(finalName);
  };

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
                  if (e.key === "Enter" && name.trim()) commitJoin(name.trim());
                }}
              />
              <button
                className="primary"
                disabled={!name.trim()}
                onClick={() => commitJoin(name.trim())}
              >
                Join the game
              </button>
              <AccountPanel
                onPrefillName={(n) => setName((prev) => prev || n)}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  const myId = playerId;
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
            {account?.stats && account.stats.games > 0 && (
              <p className="phone-hint" style={{ opacity: 0.8 }}>
                🏅 career: {account.stats.points} pts · {account.stats.wins} win
                {account.stats.wins === 1 ? "" : "s"} in {account.stats.games} game
                {account.stats.games === 1 ? "" : "s"}
              </p>
            )}
          </>
        )}
        {room && room.phase !== "lobby" && me && (
          room.moduleId === "conspiracy" ? (
            <ConspiracyPhone room={room} me={me} you={you} send={send} />
          ) : room.moduleId === "dungeon" ? (
            <DungeonPhone room={room} me={me} you={you} send={send} />
          ) : room.moduleId === "campaign" ? (
            <CampaignPhone room={room} me={me} you={you} send={send} />
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

              {room.moduleId !== "campaign" && (
                <>
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
                </>
              )}

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
                title="stuck? finish the narration and expire the phase timer now"
                onClick={() => host({ command: "force_advance" })}
              >
                ⏩ Force next phase
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

// ─── Optional accounts (collapsed under the guest flow; never adds friction) ──

function AccountPanel({ onPrefillName }: { onPrefillName: (name: string) => void }) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // prefill the name field from the account (still editable — changing your
  // name each session is a feature, not a bug)
  useEffect(() => {
    if (session?.user?.name) onPrefillName(session.user.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.name]);

  if (session?.user) {
    return (
      <p className="phone-hint" style={{ marginTop: 12 }}>
        Signed in as <b style={{ color: "var(--accent)" }}>{session.user.email}</b>
        {" · "}
        <button
          onClick={() => signOut()}
          style={{
            background: "none", border: "none", padding: 0,
            color: "var(--accent)", textDecoration: "underline",
            font: "inherit", cursor: "pointer", width: "auto",
          }}
        >
          sign out
        </button>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "none", border: "none", marginTop: 12,
          color: "var(--fg-dim, #888)", textDecoration: "underline",
          font: "inherit", cursor: "pointer",
        }}
      >
        have an account? sign in
      </button>
    );
  }

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res: any =
        mode === "in"
          ? await signIn.email({ email: email.trim(), password })
          : await signUp.email({
              email: email.trim(),
              password,
              name: displayName.trim() || email.split("@")[0],
            });
      if (res?.error) setErr(res.error.message ?? "Something went wrong.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="seg-row">
        <button className={mode === "in" ? "primary" : ""} onClick={() => setMode("in")}>
          sign in
        </button>
        <button className={mode === "up" ? "primary" : ""} onClick={() => setMode("up")}>
          sign up
        </button>
      </div>
      {err && <div className="error-banner">{err}</div>}
      <input
        placeholder="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        placeholder="password"
        type="password"
        autoComplete={mode === "in" ? "current-password" : "new-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {mode === "up" && (
        <input
          placeholder="display name (optional)"
          maxLength={24}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      )}
      <button
        className="primary"
        disabled={busy || !email.trim() || !password}
        onClick={submit}
      >
        {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
      </button>
      <button onClick={() => signIn.social({ provider: "google", callbackURL: location.href })}>
        Continue with Google
      </button>
      <button
        onClick={() => setOpen(false)}
        style={{
          background: "none", border: "none",
          color: "var(--fg-dim, #888)", font: "inherit", cursor: "pointer",
        }}
      >
        cancel
      </button>
    </div>
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
