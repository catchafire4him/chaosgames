import type { ReactNode } from "react";
import type { PublicRoom } from "@shared/index";
import { heroPortrait } from "../theme";

interface HeroCard {
  id: string; name: string; avatar: string; connected: boolean; ready: boolean;
  cls: string | null; level: number | null; hp: number | null; maxHp: number | null;
  quirks: { adjective: string } | null; portraitAssetId: string | null;
}
interface CombatHero { id: string; name: string; cls: string; avatar: string; portraitAssetId: string | null; hp: number; maxHp: number; zone: string; downed: boolean; defending: boolean }
interface CombatEnemy { id: string; name: string; kind: string; hp: number; maxHp: number; zone: string; alive: boolean; hexed: boolean }
interface Combat {
  status: string; round: number; title: string; activeHeroId: string | null;
  log: string[]; enemies: CombatEnemy[]; heroes: CombatHero[];
}
interface Chapter {
  title: string; hook: string;
  fork: { prompt: string; options: string[]; tally: number[] } | null;
  lastCheck: { name: string; interpretedAs: string; success: boolean; plausible: boolean; total: number; dc: number } | null;
}
interface CampaignPublic {
  name: string; chapterNum: number; phase: string;
  party: HeroCard[]; awaiting: { name: string; cls: string; level: number }[];
  chapter?: Chapter; combat?: Combat;
}

export function CampaignTv({ room }: { room: PublicRoom }) {
  const s = (room.module ?? null) as CampaignPublic | null;
  if (!s) return null;
  if (room.phase === "encounter" && s.combat) return <CombatStrip c={s.combat} />;
  if (s.chapter && (room.phase === "scene" || room.phase === "camp" || room.phase === "chapter_intro" || room.phase === "chapter_end")) {
    return <SceneStage s={s} chapter={s.chapter} />;
  }
  return <Roster s={s} phase={room.phase} />;
}

// ─── Lobby / forge / briefing roster ──────────────────────────────────────────
function Roster({ s, phase }: { s: CampaignPublic; phase: string }) {
  return (
    <div className="campaign-tv">
      <div className="campaign-banner">
        <div className="campaign-title">{s.name}</div>
        <div className="campaign-chapter">{phase === "forge" ? "Forging the party" : `Chapter ${s.chapterNum + 1}`}</div>
      </div>
      <div className="party-grid">
        {s.party.map((h) => (
          <div key={h.id} className={`party-card ${h.ready ? "ready" : "waiting"}`}>
            <img src={h.cls ? heroPortrait(h.portraitAssetId, h.cls, h.avatar) : "/img/dnd/portraits/barbarian_m.png"} alt="" />
            <div className="pc-name">{h.name}</div>
            {h.ready && h.cls ? (
              <>
                <div className="pc-cls">{h.quirks?.adjective} {h.cls}</div>
                <div className="pc-hp">♥ {h.hp}/{h.maxHp} · lvl {h.level}</div>
              </>
            ) : (
              <div className="pc-cls">{phase === "forge" ? "forging…" : "away"}</div>
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
      {phase === "forge" && <p className="tv-sub">Heroes, build your legends on your phones…</p>}
    </div>
  );
}

// ─── Scene stage (free-text play) ─────────────────────────────────────────────
function SceneStage({ s, chapter }: { s: CampaignPublic; chapter: Chapter }) {
  return (
    <div className="campaign-tv">
      <div className="campaign-banner">
        <div className="campaign-title">{chapter.title || s.name}</div>
      </div>
      {chapter.lastCheck && (
        <div className={`check-banner ${!chapter.lastCheck.plausible ? "impossible" : chapter.lastCheck.success ? "success" : "fail"}`}>
          <b>{chapter.lastCheck.name}</b> tried to {chapter.lastCheck.interpretedAs} —{" "}
          {!chapter.lastCheck.plausible ? "impossible!" : chapter.lastCheck.success ? `success (${chapter.lastCheck.total} vs ${chapter.lastCheck.dc})` : `failed (${chapter.lastCheck.total} vs ${chapter.lastCheck.dc})`}
        </div>
      )}
      {chapter.fork && (
        <div className="fork-stage">
          <div className="fork-prompt">{chapter.fork.prompt}</div>
          <div className="fork-options">
            {chapter.fork.options.map((o, i) => (
              <div key={i} className="fork-opt">
                <span>{o}</span>
                <b>{chapter.fork!.tally[i] ?? 0}</b>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="party-strip">
        {s.party.filter((h) => h.ready).map((h) => (
          <div key={h.id} className="party-mini">
            <img src={heroPortrait(h.portraitAssetId, h.cls!, h.avatar)} alt="" />
            <span>{h.name}</span>
          </div>
        ))}
      </div>
      <p className="tv-sub">Tell the DM what you do — on your phones.</p>
    </div>
  );
}

// ─── Combat encounter strip ───────────────────────────────────────────────────
function CombatStrip({ c }: { c: Combat }) {
  const enemyBack = c.enemies.filter((e) => e.zone === "enemy_back");
  const enemyFront = c.enemies.filter((e) => e.zone === "enemy_front");
  const partyFront = c.heroes.filter((h) => h.zone === "party_front");
  const partyBack = c.heroes.filter((h) => h.zone === "party_back");
  const hidden = c.heroes.filter((h) => h.zone === "hidden");

  return (
    <div className="combat-tv">
      <div className="combat-head">
        <span className="combat-title">{c.title}</span>
        <span className="combat-round">Round {c.round}</span>
      </div>
      <div className="zone-strip">
        <Zone label="Enemy Back">{enemyBack.map((e) => <EnemyToken key={e.id} e={e} />)}</Zone>
        <Zone label="Enemy Front">{enemyFront.map((e) => <EnemyToken key={e.id} e={e} />)}</Zone>
        <div className="zone-divider" />
        <Zone label="Front Line">{partyFront.map((h) => <HeroToken key={h.id} h={h} active={h.id === c.activeHeroId} />)}</Zone>
        <Zone label="Back Line">{partyBack.map((h) => <HeroToken key={h.id} h={h} active={h.id === c.activeHeroId} />)}</Zone>
        {hidden.length > 0 && <Zone label="Hidden">{hidden.map((h) => <HeroToken key={h.id} h={h} active={h.id === c.activeHeroId} />)}</Zone>}
      </div>
      <div className="combat-log">
        {c.log.slice(-5).map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}

function Zone({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="zone-col">
      <div className="zone-label">{label}</div>
      <div className="zone-tokens">{children}</div>
    </div>
  );
}

function EnemyToken({ e }: { e: CombatEnemy }) {
  return (
    <div className={`token enemy ${e.alive ? "" : "dead"}`}>
      <div className="token-name">{e.name}{e.hexed ? " 🌀" : ""}</div>
      <Bar hp={e.hp} maxHp={e.maxHp} kind="enemy" />
    </div>
  );
}
function HeroToken({ h, active }: { h: CombatHero; active: boolean }) {
  return (
    <div className={`token hero ${active ? "active" : ""} ${h.downed ? "downed" : ""}`}>
      <img src={heroPortrait(h.portraitAssetId, h.cls, h.avatar)} alt="" />
      <div className="token-name">{h.name}{h.defending ? " 🛡" : ""}</div>
      <Bar hp={h.hp} maxHp={h.maxHp} kind="hero" />
    </div>
  );
}
function Bar({ hp, maxHp, kind }: { hp: number; maxHp: number; kind: "hero" | "enemy" }) {
  return (
    <div className={`token-bar ${kind}`}>
      <div style={{ width: `${Math.max(0, Math.round((hp / maxHp) * 100))}%` }} />
      <span>{Math.max(0, hp)}</span>
    </div>
  );
}
