import type { PublicRoom } from "@shared/index";
import { campaignPortrait } from "../theme";

interface HeroCard {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
  ready: boolean;
  cls: string | null;
  level: number | null;
  hp: number | null;
  maxHp: number | null;
  stats: Record<string, number> | null;
  quirks: { adjective: string; item: string; backstory: string } | null;
}
interface CampaignPublic {
  name: string;
  chapterNum: number;
  phase: string;
  party: HeroCard[];
  awaiting: { name: string; cls: string; level: number }[];
}

export function CampaignTv({ room }: { room: PublicRoom }) {
  const s = (room.module ?? null) as CampaignPublic | null;
  if (!s) return null;

  return (
    <div className="campaign-tv">
      <div className="campaign-banner">
        <div className="campaign-title">{s.name}</div>
        <div className="campaign-chapter">
          {s.phase === "forge" ? "Forging the party" : `Chapter ${s.chapterNum + 1}`}
        </div>
      </div>

      <div className="party-grid">
        {s.party.map((h) => (
          <div key={h.id} className={`party-card ${h.ready ? "ready" : "waiting"}`}>
            <img src={h.cls ? campaignPortrait(h.cls, h.avatar) : `/img/dnd/portraits/barbarian_m.png`} alt="" />
            <div className="pc-name">{h.name}</div>
            {h.ready && h.cls ? (
              <>
                <div className="pc-cls">
                  {h.quirks?.adjective} {h.cls}
                </div>
                <div className="pc-hp">
                  ♥ {h.hp}/{h.maxHp} · lvl {h.level}
                </div>
              </>
            ) : (
              <div className="pc-cls">{room.phase === "forge" ? "forging…" : "away"}</div>
            )}
            {!h.connected && <div className="pc-off">offline</div>}
          </div>
        ))}
        {s.awaiting.map((a, i) => (
          <div key={`await-${i}`} className="party-card waiting">
            <div className="pc-name">{a.name}</div>
            <div className="pc-cls">lvl {a.level} {a.cls}</div>
            <div className="pc-off">not yet joined</div>
          </div>
        ))}
      </div>

      {room.phase === "forge" && (
        <p className="tv-sub">Heroes, build your legends on your phones…</p>
      )}
    </div>
  );
}
