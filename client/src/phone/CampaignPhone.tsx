import { useState } from "react";
import type { PublicPlayer, PublicRoom } from "@shared/index";
import type { Send } from "../pages/Play";
import { campaignPortrait, heroPortrait } from "../theme";

/** shapes mirror server/src/modules/campaign privateState */
interface Ability { id: string; label: string; cd: number; desc: string; ready?: boolean }
interface Hero {
  name: string; cls: string; avatar: string;
  stats: Record<string, number>;
  hp: number; maxHp: number; level: number;
  abilities: Ability[]; inventory: unknown[];
  quirks: { adjective: string; item: string; backstory: string };
  portraitAssetId?: string | null;
}
interface ClassOpt { id: string; label: string; stat: string; role: string; defaultStats: Record<string, number>; abilities: Ability[] }
interface Forge { classes: ClassOpt[]; statArray: number[]; suggestedClass: string; adjectives: string[]; items: string[]; backstories: string[] }
interface Combat {
  yourTurn: boolean; downed: boolean; zone: string;
  enemies: { id: string; name: string; zone: string; inReach: boolean }[];
  allies: { id: string; name: string }[];
  abilities: Ability[];
  canMoveTo: string[];
}
interface Chapter { canDeclare: boolean; fork: { prompt: string; options: string[]; yourVote: number | null } | null }
interface You { hero: Hero | null; forge: Forge | null; combat?: Combat | null; chapter?: Chapter | null }

const STAT_LABEL: Record<string, string> = { might: "Might", cunning: "Cunning", arcana: "Arcana", heart: "Heart" };
const ZONE_LABEL: Record<string, string> = { enemy_back: "enemy back", enemy_front: "enemy front", party_front: "front line", party_back: "back line", hidden: "hidden" };

export function CampaignPhone({
  room, me, you, send,
}: {
  room: PublicRoom; me: PublicPlayer; you: unknown; send: Send;
}) {
  const y = (you ?? {}) as You;
  const isHost = room.hostPlayerId === me.id;

  if (room.phase === "forge") {
    if (y.hero) return <Sheet hero={y.hero} avatar={me.avatar} note="Forged! Waiting for the party…" />;
    if (y.forge) return <ForgeView forge={y.forge} avatar={me.avatar} send={send} />;
    return <p className="phone-hint">Gathering the party…</p>;
  }
  if (!y.hero) return <p className="phone-hint">Watching the tale unfold…</p>;

  if (room.phase === "encounter" && y.combat) {
    return <CombatView combat={y.combat} hero={y.hero} avatar={me.avatar} send={send} />;
  }
  if (room.phase === "scene") {
    return <SceneView hero={y.hero} avatar={me.avatar} chapter={y.chapter ?? null} send={send} />;
  }
  if (room.phase === "briefing") {
    return (
      <div className="hero-sheet">
        {isHost ? (
          <button className="primary forge-go" onClick={() => send({ type: "action", action: { kind: "begin_chapter" } })}>
            ▶ Begin the chapter
          </button>
        ) : (
          <p className="phone-hint">The host will begin the chapter. Watch the big screen.</p>
        )}
        <Sheet hero={y.hero} avatar={me.avatar} />
      </div>
    );
  }
  // chapter_intro / camp / chapter_end / aftermath — narration on the TV
  return <Sheet hero={y.hero} avatar={me.avatar} note="Watch the big screen…" />;
}

// ─── Scene: free-text declaration + party fork ────────────────────────────────
function SceneView({ hero, avatar, chapter, send }: { hero: Hero; avatar: string; chapter: Chapter | null; send: Send }) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    send({ type: "action", action: { kind: "declare", text: t } });
    setText("");
  };
  return (
    <div className="scene-phone">
      <div className="phone-title">What do you do?</div>
      <textarea
        className="declare-box"
        placeholder="Describe your action in your own words…"
        maxLength={300}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      <button className="primary" disabled={!text.trim()} onClick={submit}>Declare</button>

      {chapter?.fork && (
        <div className="fork-box">
          <div className="host-section">{chapter.fork.prompt}</div>
          <div className="chip-row">
            {chapter.fork.options.map((o, i) => (
              <button
                key={i}
                className={chapter.fork!.yourVote === i ? "primary" : ""}
                onClick={() => send({ type: "action", action: { kind: "fork_vote", option: i } })}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}

      <MiniSheet hero={hero} avatar={avatar} />
    </div>
  );
}

// ─── Combat: tap actions ──────────────────────────────────────────────────────
function CombatView({ combat, hero, avatar, send }: { combat: Combat; hero: Hero; avatar: string; send: Send }) {
  const act = (action: Record<string, unknown>) => send({ type: "action", action: { kind: "combat_action", ...action } });
  if (combat.downed) {
    return (
      <div className="combat-phone">
        <div className="phone-title">💀 You're down</div>
        <p className="phone-hint">Cheer your party on — an ally can revive you.</p>
        <MiniSheet hero={hero} avatar={avatar} />
      </div>
    );
  }
  if (!combat.yourTurn) {
    return (
      <div className="combat-phone">
        <div className="phone-title">Battle underway…</div>
        <p className="phone-hint">You're at the {ZONE_LABEL[combat.zone] ?? combat.zone}. Wait for your turn.</p>
        <MiniSheet hero={hero} avatar={avatar} />
      </div>
    );
  }
  return (
    <div className="combat-phone">
      <div className="phone-title">Your turn!</div>
      {combat.canMoveTo.length > 0 && (
        <>
          <div className="host-section">Move (optional)</div>
          <div className="chip-row">
            {combat.canMoveTo.map((z) => (
              <button key={z} onClick={() => act({ action: "defend", moveZone: z })}>→ {ZONE_LABEL[z] ?? z}</button>
            ))}
          </div>
        </>
      )}
      <div className="host-section">Attack</div>
      <div className="chip-row">
        {combat.enemies.map((e) => (
          <button key={e.id} className={e.inReach ? "primary" : ""} onClick={() => act({ action: "attack", targetId: e.id })}>
            ⚔ {e.name}{e.inReach ? "" : " (far)"}
          </button>
        ))}
      </div>
      <div className="host-section">Abilities</div>
      <div className="ability-list">
        {combat.abilities.map((a) => (
          <button key={a.id} className="ability" disabled={!a.ready} onClick={() => act({ action: "ability", abilityId: a.id })}>
            <b>{a.label}</b> <em>{a.ready ? "ready" : "cooldown"}</em>
            <span>{a.desc}</span>
          </button>
        ))}
      </div>
      <div className="chip-row">
        {combat.allies.length > 0 && (
          <button onClick={() => act({ action: "help", targetId: combat.allies[0].id })}>🤝 Help {combat.allies[0].name}</button>
        )}
        <button onClick={() => act({ action: "defend" })}>🛡 Defend</button>
      </div>
    </div>
  );
}

// ─── Forge (from phase 2) ─────────────────────────────────────────────────────
function ForgeView({ forge, avatar, send }: { forge: Forge; avatar: string; send: Send }) {
  const [cls, setCls] = useState(forge.suggestedClass);
  const [adjective, setAdjective] = useState(forge.adjectives[0]);
  const [item, setItem] = useState(forge.items[0]);
  const [backstory, setBackstory] = useState(forge.backstories[0]);
  const chosen = forge.classes.find((c) => c.id === cls) ?? forge.classes[0];
  return (
    <div className="forge">
      <div className="phone-title">Forge your hero</div>
      <div className="forge-portrait"><img src={campaignPortrait(cls, avatar)} alt="" /></div>
      <div className="host-section">Class</div>
      <div className="class-grid">
        {forge.classes.map((c) => (
          <button key={c.id} className={c.id === cls ? "primary" : ""} onClick={() => setCls(c.id)}>
            <b>{c.label}</b><span>{c.role} · {STAT_LABEL[c.stat]}</span>
          </button>
        ))}
      </div>
      <div className="stat-row">
        {Object.entries(chosen.defaultStats).map(([k, v]) => (
          <div key={k} className="stat-pill"><span>{STAT_LABEL[k]}</span><b>{v >= 0 ? `+${v}` : v}</b></div>
        ))}
      </div>
      <div className="host-section">You are…</div>
      <ChipRow options={forge.adjectives} value={adjective} onPick={setAdjective} />
      <div className="host-section">You carry…</div>
      <ChipRow options={forge.items} value={item} onPick={setItem} />
      <div className="host-section">Why you're here</div>
      <ChipRow options={forge.backstories} value={backstory} onPick={setBackstory} />
      <button className="primary forge-go" onClick={() => send({ type: "action", action: { kind: "forge_submit", cls, stats: chosen.defaultStats, adjective, item, backstory } })}>
        ⚔ Forge my legend
      </button>
    </div>
  );
}

function ChipRow({ options, value, onPick }: { options: string[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="chip-row">
      {options.map((o) => (
        <button key={o} className={o === value ? "primary" : ""} onClick={() => onPick(o)}>{o}</button>
      ))}
    </div>
  );
}

// ─── Sheets ───────────────────────────────────────────────────────────────────
function MiniSheet({ hero, avatar }: { hero: Hero; avatar: string }) {
  return (
    <div className="mini-sheet">
      <img src={heroPortrait(hero.portraitAssetId, hero.cls, avatar)} alt="" />
      <div className="hp-bar">
        <div className="hp-fill" style={{ width: `${Math.round((hero.hp / hero.maxHp) * 100)}%` }} />
        <span>{hero.hp}/{hero.maxHp} HP · lvl {hero.level}</span>
      </div>
      <div className="stat-row">
        {Object.entries(hero.stats).map(([k, v]) => (
          <div key={k} className="stat-pill"><span>{STAT_LABEL[k]}</span><b>{v >= 0 ? `+${v}` : v}</b></div>
        ))}
      </div>
    </div>
  );
}

function Sheet({ hero, avatar, note }: { hero: Hero; avatar: string; note?: string }) {
  return (
    <div className="hero-sheet">
      {note && <p className="phone-hint">{note}</p>}
      <div className="sheet-head">
        <img src={heroPortrait(hero.portraitAssetId, hero.cls, avatar)} alt="" />
        <div>
          <div className="sheet-name">{hero.name}</div>
          <div className="sheet-sub">{hero.quirks.adjective} {hero.cls} · lvl {hero.level}</div>
          <div className="hp-bar">
            <div className="hp-fill" style={{ width: `${Math.round((hero.hp / hero.maxHp) * 100)}%` }} />
            <span>{hero.hp}/{hero.maxHp} HP</span>
          </div>
        </div>
      </div>
      <div className="stat-row">
        {Object.entries(hero.stats).map(([k, v]) => (
          <div key={k} className="stat-pill"><span>{STAT_LABEL[k]}</span><b>{v >= 0 ? `+${v}` : v}</b></div>
        ))}
      </div>
      <div className="host-section">Abilities</div>
      <div className="ability-list">
        {hero.abilities.map((a) => (
          <div key={a.id} className="ability"><b>{a.label}</b> <em>{a.cd === 0 ? "at will" : a.cd === 99 ? "once/fight" : `cd ${a.cd}`}</em><span>{a.desc}</span></div>
        ))}
      </div>
      <div className="host-section">Kit</div>
      <p className="phone-hint" style={{ textAlign: "left" }}>
        Carrying {hero.quirks.item}.{" "}{hero.inventory.length ? `+${hero.inventory.length} found.` : "No loot yet."}
        <br /><em>"{hero.quirks.backstory}"</em>
      </p>
    </div>
  );
}
