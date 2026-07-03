import type { PublicRoom } from "@shared/index";
import { moduleArt, PlayerGrid } from "../ui";

interface DungeonPublic {
  roomIndex: number;
  roomCount: number;
  encounterInRoom: number;
  encountersPerRoom: number;
  roomArt: string;
  currentRoom: { title: string; description: string; challenge: string } | null;
  activeId: string | null;
  activeName: string | null;
  turn: {
    action: string | null;
    actionLabel: string | null;
    buffNames: string[];
    sabotageNames: string[];
    roll: number | null;
    total: number | null;
    success: boolean | null;
    great: boolean | null;
    crit: "hit" | "fail" | null;
    difficulty: number;
    itemUsed: { id: string; name: string; effect: string } | null;
  } | null;
  items: { id: string; name: string; effect: string }[];
  score: { successes: number; failures: number };
  heroes: Record<string, { classLabel: string; portrait: string; charges: number }>;
}

export function DungeonTv({ room }: { room: PublicRoom }) {
  const m = room.module as DungeonPublic | null;
  if (!m) return null;

  const hero = m.activeId ? room.players.find((p) => p.id === m.activeId) : null;
  const heroInfo = m.activeId ? m.heroes[m.activeId] : null;
  const turn = m.turn;

  const pips = Array.from({ length: m.roomCount }, (_, i) => (
    <span key={i} className={`pip ${i < m.roomIndex ? "done" : i === m.roomIndex ? "now" : ""}`} />
  ));

  if (room.phase === "forge") {
    return (
      <>
        <div className="tv-banner title-font fade-in">⚒️ Forging legends…</div>
        <div className="tv-sub">Heroes are choosing their flaws, trinkets and excuses on their phones.</div>
        <PlayerGrid room={room} art={moduleArt(room)} />
      </>
    );
  }

  if (room.phase === "intro") {
    return (
      <>
        <div className="tv-banner title-font fade-in">The party assembles…</div>
        <PlayerGrid
          room={room}
          art={moduleArt(room)}
          badge={(p) => `⚡${m.heroes[p.id]?.charges ?? 0}`}
        />
      </>
    );
  }

  return (
    <>
      <div className="dungeon-topline">
        <div className="pips">{pips}</div>
        <div className="tv-sub">
          Room {m.roomIndex + 1}/{m.roomCount} · Trial {m.encounterInRoom + 1}/{m.encountersPerRoom}
          {"  ·  "}
          <span style={{ color: "var(--good)" }}>▲ {m.score.successes}</span>{" "}
          <span style={{ color: "var(--danger)" }}>▼ {m.score.failures}</span>
        </div>
      </div>

      {m.currentRoom && (
        <div className="room-card fade-in" key={m.currentRoom.title}>
          <div className="room-title title-font">{m.currentRoom.title}</div>
          <div className="room-challenge">{m.currentRoom.challenge}</div>
        </div>
      )}

      {hero && heroInfo && room.phase !== "room_intro" && (
        <div className="hero-stage fade-in" key={hero.id + room.phase}>
          <img
            className="hero-portrait"
            src={`/img/dnd/portraits/${heroInfo.portrait}.png`}
            alt=""
          />
          <div className="hero-panel">
            <div className="hero-name">
              {hero.name} <em>the {heroInfo.classLabel}</em>
            </div>
            {room.phase === "action_pick" && (
              <div className="tv-sub">is choosing an approach…</div>
            )}
            {room.phase === "rolling" && (
              <div className="tv-sub">
                {turn?.actionLabel} — waiting on the roll! Beat {turn?.difficulty}.
              </div>
            )}
            {room.phase === "outcome" && turn?.roll != null && (
              <div className={`dice-result ${turn.great ? "great" : turn.success ? "win" : "lose"}`}>
                <span className="d20">{turn.total}</span>
                <span className="dice-detail">
                  d20: {turn.roll}
                  {turn.crit === "hit" && " — NAT 20!"}
                  {turn.crit === "fail" && " — NAT 1!"}
                  {turn.great && !turn.crit && " — GREAT SUCCESS!"}
                  {" · needed "}{turn.difficulty}
                </span>
              </div>
            )}
            {(turn?.buffNames.length || turn?.sabotageNames.length) ? (
              <div className="meddlers">
                {turn.buffNames.length > 0 && (
                  <span style={{ color: "var(--good)" }}>▲ {turn.buffNames.join(", ")}</span>
                )}
                {turn.sabotageNames.length > 0 && (
                  <span style={{ color: "var(--danger)" }}>▼ {turn.sabotageNames.join(", ")}</span>
                )}
              </div>
            ) : null}
            {turn?.itemUsed && (
              <div className="meddlers">
                <span style={{ color: "var(--accent)" }}>
                  <img
                    src={`/img/dnd/items/${turn.itemUsed.id}.png`}
                    alt=""
                    style={{ width: 26, height: 26, verticalAlign: "middle", marginRight: 6 }}
                  />
                  {turn.itemUsed.name}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {m.items.length > 0 && (
        <div className="inventory-row">
          <span className="tv-sub" style={{ fontSize: 15 }}>party loot:</span>
          {m.items.map((it, i) => (
            <img
              key={`${it.id}_${i}`}
              src={`/img/dnd/items/${it.id}.png`}
              title={it.name}
              alt={it.name}
            />
          ))}
        </div>
      )}

      {(room.phase === "action_pick" || room.phase === "rolling") && (
        <div className="tv-sub">
          Everyone else: spend a charge to <b style={{ color: "var(--good)" }}>bless</b> or{" "}
          <b style={{ color: "var(--danger)" }}>sabotage</b> them — now!
        </div>
      )}
    </>
  );
}
