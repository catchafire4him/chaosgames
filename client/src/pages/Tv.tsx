import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ModuleInfo, NarrationLine, PublicRoom } from "@shared/index";
import { navigate } from "../App";
import { Music, VoiceEngine } from "../audio/voice";
import { enableSfx, playSfx, setSfxVolume } from "../audio/sfx";
import { useSocket } from "../net/socket";
import { useWakeLock } from "../net/useWakeLock";
import { themeFor, type Theme } from "../theme";
import { moduleArt, PlayerChip, PlayerGrid, SfxFlash, TimerChip } from "../ui";
import { ConspiracyTv } from "../tv/ConspiracyTv";
import { WhodunnitTv } from "../tv/WhodunnitTv";
import { DungeonTv } from "../tv/DungeonTv";
import { CampaignTv } from "../tv/CampaignTv";

export function Tv({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [thinking, setThinking] = useState(false);
  const [sfx, setSfx] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [emotes, setEmotes] = useState<{ id: number; emoji: string; name: string; x: number }[]>([]);
  const emoteId = useRef(0);
  const [showRecap, setShowRecap] = useState(false);
  const [showMixer, setShowMixer] = useState(false);
  const [mix, setMix] = useState<Mix>(() => {
    try {
      return { ...DEFAULT_MIX, ...JSON.parse(localStorage.getItem("chaos_mix") ?? "{}") };
    } catch {
      return DEFAULT_MIX;
    }
  });

  const voiceRef = useRef<VoiceEngine>();
  const musicRef = useRef<Music>();
  if (!voiceRef.current) voiceRef.current = new VoiceEngine();
  if (!musicRef.current) musicRef.current = new Music();

  const sendRef = useRef<(msg: ClientMessage) => void>(() => {});

  const join = useMemo(() => ({ type: "join_tv" as const, roomId }), [roomId]);
  const { send } = useSocket(join, (msg) => {
    switch (msg.type) {
      case "room_state":
        setRoom(msg.room);
        setError(null);
        break;
      case "modules":
        setModules(msg.modules);
        break;
      case "joined_tv":
        sendRef.current({ type: "list_modules" });
        break;
      case "narration":
        voiceRef.current!.enqueueLine(msg.line);
        break;
      case "narration_audio":
        voiceRef.current!.addChunk(msg.lineId, msg.pcm);
        break;
      case "narration_audio_end":
        voiceRef.current!.endLine(msg.lineId, msg.ok);
        break;
      case "narration_clear":
        voiceRef.current!.clear(msg.hard);
        if (msg.hard) setCaption("");
        break;
      case "host_thinking":
        setThinking(msg.on);
        break;
      case "emote": {
        const id = ++emoteId.current;
        setEmotes((list) => [
          ...list.slice(-11),
          { id, emoji: msg.emoji, name: msg.name, x: 8 + Math.random() * 84 },
        ]);
        setTimeout(() => setEmotes((list) => list.filter((e) => e.id !== id)), 3000);
        break;
      }
      case "sfx":
        playSfx(msg.sound);
        setSfx(null);
        requestAnimationFrame(() => setSfx(msg.sound));
        setTimeout(() => setSfx(null), 1200);
        break;
      case "error":
        setError(msg.message);
        break;
    }
  });
  sendRef.current = send;

  // voice engine callbacks
  useEffect(() => {
    const voice = voiceRef.current!;
    voice.onLineStart = (line: NarrationLine) => {
      setCaption(line.text);
      setHistory((h) => [...h.slice(-11), line.text]);
      musicRef.current!.duck(true);
    };
    voice.onLineDone = (id: string) =>
      sendRef.current({ type: "narration_done", lineId: id });
    voice.onIdle = () => musicRef.current!.duck(false);
  }, []);

  // apply + persist the audio mix
  useEffect(() => {
    voiceRef.current!.setVolume(mix.voice);
    voiceRef.current!.setRate(mix.speed);
    musicRef.current!.setVolume(mix.music * 0.45);
    setSfxVolume(mix.sfx);
    localStorage.setItem("chaos_mix", JSON.stringify(mix));
  }, [mix]);

  const captionText = caption || (thinking ? "✒ the host is composing…" : "");

  const theme = themeFor(room?.moduleId);
  useWakeLock(!!room);

  // lobby music (per theme)
  useEffect(() => {
    if (!audioOn || !room) return;
    if ((room.phase === "lobby" || room.phase === "ended") && theme.music) {
      musicRef.current!.play(theme.music, mix.music * 0.45);
    } else {
      musicRef.current!.stop();
    }
  }, [audioOn, room?.phase, theme.music, mix.music]);

  if (error && !room) {
    return (
      <div className="themed" data-theme="neutral">
        <div className="scene" style={{ alignItems: "center", justifyContent: "center", gap: 22 }}>
          <div className="error-banner" style={{ maxWidth: 560, textAlign: "center", lineHeight: 1.5 }}>
            {error.toLowerCase().includes("not found")
              ? "This game session is gone — usually because the server restarted (a deploy, a restart, or the host updated the game). Nobody's fault, just start a fresh one."
              : error}
          </div>
          <button className="primary" style={{ fontSize: 20, padding: "14px 30px" }} onClick={() => navigate("#/")}>
            ← Back to the hub
          </button>
        </div>
      </div>
    );
  }
  if (!room) {
    return (
      <div className="themed" data-theme="neutral">
        <div className="scene" style={{ alignItems: "center", justifyContent: "center" }}>
          <p className="tv-sub">Connecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="themed" data-theme={theme.id} style={{ height: "100%", position: "relative" }}>
      {!audioOn && (
        <div className="audio-gate">
          <h1 className="title-font" style={{ fontSize: 54, color: "var(--accent)" }}>
            {room.moduleName}
          </h1>
          <p className="tv-sub">The host needs a voice.</p>
          <button
            className="primary"
            style={{ fontSize: 26, padding: "18px 44px" }}
            onClick={() => {
              voiceRef.current!.enable();
              enableSfx();
              setAudioOn(true);
            }}
          >
            🔊 Tap to raise the curtain
          </button>
        </div>
      )}
      {room.phase === "lobby" ? (
        <LobbyScene room={room} send={send} theme={theme} modules={modules} />
      ) : (
        <GameScene room={room} send={send} caption={captionText} theme={theme} />
      )}
      <div className="tv-tools">
        <button title="what did he say?" onClick={() => setShowRecap((s) => !s)}>📜</button>
        <button title="audio mix" onClick={() => setShowMixer((s) => !s)}>🔊</button>
      </div>
      {showMixer && (
        <div className="flyout audio-panel">
          <div className="conspiracy-decor tl"></div>
          <div className="conspiracy-decor tr"></div>
          <div className="conspiracy-decor bl"></div>
          <div className="conspiracy-decor br"></div>
          <div className="flyout-title">Audio</div>
          <div className="audio-grid">
            <span className="audio-label label-voice">Voice</span>
            <div className="slider-container">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={mix.voice}
                className="slider-voice"
                style={{ ["--fill" as string]: `${Math.round(mix.voice * 100)}%` }}
                onChange={(e) => setMix((m) => ({ ...m, voice: Number(e.target.value) }))}
              />
            </div>

            <span className="audio-label label-music">Music</span>
            <div className="slider-container">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={mix.music}
                className="slider-music"
                style={{ ["--fill" as string]: `${Math.round(mix.music * 100)}%` }}
                onChange={(e) => setMix((m) => ({ ...m, music: Number(e.target.value) }))}
              />
            </div>

            <span className="audio-label label-sfx">SFX</span>
            <div className="slider-container">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={mix.sfx}
                className="slider-sfx"
                style={{ ["--fill" as string]: `${Math.round(mix.sfx * 100)}%` }}
                onChange={(e) => setMix((m) => ({ ...m, sfx: Number(e.target.value) }))}
              />
            </div>

            <span className="audio-label label-speed">
              Speech speed <span className="speed-val">({mix.speed.toFixed(2)}×)</span>
            </span>
            <div className="slider-container">
              <input
                type="range"
                min={0.75}
                max={1.5}
                step={0.05}
                value={mix.speed}
                className="slider-speed"
                style={{ ["--fill" as string]: `${Math.round(((mix.speed - 0.75) / 0.75) * 100)}%` }}
                onChange={(e) => setMix((m) => ({ ...m, speed: Number(e.target.value) }))}
              />
            </div>
          </div>
          {mix.speed !== 1 && (
            <button className="reset-speed-btn" onClick={() => setMix((m) => ({ ...m, speed: 1 }))}>
              Reset Speed
            </button>
          )}
        </div>
      )}
      {showRecap && (
        <div className="flyout recap">
          <div className="flyout-title">The host said…</div>
          {history.length ? (
            [...history].reverse().map((t, i) => <p key={i}>{t}</p>)
          ) : (
            <p style={{ color: "var(--ink-dim)" }}>Nothing yet.</p>
          )}
        </div>
      )}
      {emotes.map((e) => (
        <div key={e.id} className="emote-float" style={{ left: `${e.x}%` }}>
          <span>{e.emoji}</span>
          <em>{e.name}</em>
        </div>
      ))}
      <SfxFlash sound={sfx} />
      {error && (
        <div className="error-banner" style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}

type Send = (msg: ClientMessage) => void;

interface Mix {
  voice: number;
  music: number;
  sfx: number;
  /** playback rate for the host's voice — 1.0 = normal */
  speed: number;
}
const DEFAULT_MIX: Mix = { voice: 1, music: 0.4, sfx: 0.5, speed: 1 };

function LobbyScene({
  room,
  send,
  theme,
  modules,
}: {
  room: PublicRoom;
  send: Send;
  theme: Theme;
  modules: ModuleInfo[];
}) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(room.joinUrl, { margin: 1, width: 380 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [room.joinUrl]);

  const enough = room.players.length >= 1; // server enforces the real minimum
  const current = modules.find((m) => m.id === room.moduleId);

  return (
    <div className="scene" style={theme.lobbyBg ? { backgroundImage: `url(${theme.lobbyBg})` } : undefined}>
      <div className="tv-header">
        <span className="tv-phase">{room.moduleName}</span>
        <span className="tv-sub">{room.players.length} joined</span>
      </div>
      <div className="tv-main">
        <div className="qr-panel">
          {qr && <img src={qr} alt="join QR" />}
          <div>
            <div className="tv-sub">Scan to join, or visit and enter code</div>
            <div className="room-code">{room.code}</div>
            <div className="tv-sub" style={{ fontSize: 17 }}>{room.joinUrl.replace(/^https?:\/\//, "").split("/#")[0]}</div>
          </div>
        </div>
        <div className="player-grid">
          {room.players.map((p) => (
            <div key={p.id} style={{ position: "relative" }}>
              <PlayerChip
                p={p}
                art={moduleArt(room)?.(p)}
                badge={p.connected ? "" : "disconnected"}
              />
              {!p.connected && (
                <button
                  className="kick-btn"
                  title={`Remove ${p.name}`}
                  onClick={() => send({ type: "tv_command", command: "kick_player", playerId: p.id })}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        {current && <div className="tv-sub" style={{ fontStyle: "italic" }}>{current.tagline}</div>}
        {room.scoreboard.length > 0 && (
          <div className="scoreboard-panel fade-in">
            <div className="flyout-title" style={{ fontSize: 16 }}>🏆 Tonight's leaderboard</div>
            {room.scoreboard.slice(0, 8).map((s, i) => (
              <div className="stat-row" key={s.playerId} style={{ fontSize: 17 }}>
                <span>{i === 0 ? "👑" : `${i + 1}.`} {s.name}</span>
                <span className="stat-value">{s.points} pts</span>
              </div>
            ))}
          </div>
        )}
        <div className="tv-sub" style={{ fontSize: 15 }}>
          pace: {room.settings.pace}
          {room.moduleId === "dungeon" &&
            ` · ${room.settings.dungeonRooms} rooms · ${room.settings.dungeonIntensity === "standard" ? "standard (KOs on)" : "casual"}`}
          {room.moduleId === "whodunnit" && ` · ${room.settings.mysteryRounds} rounds`}
          {room.moduleId === "conspiracy" &&
            ` · ${room.settings.conspiracyRoles === "full" ? "full chaos roles" : "classic roles"}`}
          {"  ·  "}
          {room.players.length
            ? `👑 ${room.players.find((p) => p.id === room.hostPlayerId)?.name ?? "?"} holds the host controls`
            : "first phone to join becomes the party host"}
        </div>
        <button
          className="primary"
          style={{ fontSize: 28, padding: "18px 54px" }}
          disabled={!enough}
          onClick={() => send({ type: "tv_command", command: "start_game" })}
        >
          Begin the game
        </button>
        {/* Campaign rooms are bound to a persisted saga — no mode switching. */}
        {room.moduleId !== "campaign" && modules.length > 1 && (
          <div className="switcher">
            <span className="tv-sub" style={{ fontSize: 16 }}>or play something else:</span>
            {modules
              .filter((m) => m.id !== room.moduleId && m.id !== "campaign")
              .map((m) => (
                <button
                  key={m.id}
                  className="switch-btn"
                  data-theme={m.id}
                  onClick={() => send({ type: "tv_command", command: "switch_module", moduleId: m.id })}
                >
                  {m.name}
                </button>
              ))}
          </div>
        )}
      </div>
      <div className="caption-bar" />
    </div>
  );
}

const PHASE_TITLE: Record<string, string> = {
  role_reveal: "Secret Roles",
  night: "Night Falls",
  day: "Daybreak",
  voting: "The Vote",
  verdict: "The Verdict",
  prologue: "The Crime",
  investigation: "Investigation",
  clue_reveal: "The Evidence",
  accusation: "Accusation",
  revelation: "The Revelation",
  forge: "Forge Your Legend",
  intro: "The Gates",
  room_intro: "A New Chamber",
  action_pick: "Choose Your Move",
  rolling: "The Roll",
  outcome: "The Outcome",
  ended: "Game Over",
};

function GameScene({
  room,
  send,
  caption,
  theme,
}: {
  room: PublicRoom;
  send: Send;
  caption: string;
  theme: Theme;
}) {
  const bg = theme.dynamicBg?.(room) ?? theme.phaseBg[room.phase] ?? theme.fallbackBg;
  return (
    <div className="scene">
      {bg && <Backdrop bg={bg} />}
      <div className="tv-header">
        <span className="tv-phase fade-in" key={room.phase}>
          {PHASE_TITLE[room.phase] ?? room.phase}
        </span>
        <TimerChip room={room} />
      </div>
      <div className="tv-main">
        {room.phase === "ended" ? (
          <GameOver room={room} send={send} />
        ) : room.moduleId === "conspiracy" ? (
          <ConspiracyTv room={room} />
        ) : room.moduleId === "dungeon" ? (
          <DungeonTv room={room} />
        ) : room.moduleId === "campaign" ? (
          <CampaignTv room={room} />
        ) : (
          <WhodunnitTv room={room} />
        )}
      </div>
      <div className="caption-bar">{caption}</div>
      <div className="tv-host-tools">
        <EndGameButton send={send} />
        <button onClick={() => send({ type: "tv_command", command: "skip_narration" })}>
          skip ⏭
        </button>
      </div>
    </div>
  );
}

/** two-tap "end game early" — reverts if not confirmed within 4s */
function EndGameButton({ send }: { send: Send }) {
  const [arming, setArming] = useState(false);
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), 4000);
    return () => clearTimeout(t);
  }, [arming]);
  return (
    <button
      className={arming ? "danger" : ""}
      style={arming ? { opacity: 1 } : undefined}
      onClick={() => {
        if (arming) {
          send({ type: "tv_command", command: "abort_game" });
          setArming(false);
        } else {
          setArming(true);
        }
      }}
    >
      {arming ? "really end it? ✕" : "end game ✕"}
    </button>
  );
}

/** Crossfades between backdrop art instead of hard-swapping. */
function Backdrop({ bg }: { bg: string }) {
  const [layers, setLayers] = useState<string[]>([bg]);
  useEffect(() => {
    setLayers((l) => (l[l.length - 1] === bg ? l : [...l.slice(-1), bg]));
  }, [bg]);
  useEffect(() => {
    if (layers.length > 1) {
      const t = setTimeout(() => setLayers((l) => l.slice(-1)), 950);
      return () => clearTimeout(t);
    }
  }, [layers]);
  return (
    <div className="backdrop">
      {layers.map((src, i) => (
        <img key={src} src={src} alt="" className={i === layers.length - 1 && layers.length > 1 ? "bd-in" : ""} />
      ))}
      <div className="backdrop-vignette" />
    </div>
  );
}

function GameOver({ room, send }: { room: PublicRoom; send: Send }) {
  const stats = (room.module as { stats?: { label: string; value: string }[] | null } | null)
    ?.stats;
  return (
    <>
      <div className="tv-banner title-font fade-in">
        🏆 {room.winners?.length ? room.winners.join(", ") : "Nobody"} wins!
      </div>
      {!!stats?.length && (
        <div className="stats-panel fade-in">
          {stats.map((s) => (
            <div className="stat-row" key={s.label}>
              <span className="stat-label">{s.label}</span>
              <span className="stat-value">{s.value}</span>
            </div>
          ))}
        </div>
      )}
      {!!room.objectives?.length && (
        <div className="stats-panel fade-in" style={{ maxWidth: 900 }}>
          <div className="stat-row">
            <span className="stat-label">🎯 Secret missions</span>
            <span className="stat-value" style={{ color: "var(--ink-dim)" }}>
              (claimed on the honor system — dispute loudly)
            </span>
          </div>
          {room.objectives
            .filter((o) => o.text)
            .map((o) => (
              <div className="stat-row" key={o.name} style={{ fontSize: 18 }}>
                <span>{o.claimed ? "✅" : "❌"} {o.name}</span>
                <span className="stat-value" style={{ fontStyle: "italic" }}>{o.text}</span>
              </div>
            ))}
        </div>
      )}
      <PlayerGrid
        room={room}
        art={moduleArt(room)}
        badge={(p) => (room.winners?.includes(p.name) ? "🏆" : undefined)}
      />
      <button
        className="primary"
        style={{ fontSize: 24, padding: "16px 44px" }}
        onClick={() => send({ type: "tv_command", command: "play_again" })}
      >
        Back to the lobby
      </button>
      <div className="tv-sub" style={{ fontSize: 17 }}>
        same room, same phones — rematch or pick a different game there
      </div>
    </>
  );
}
