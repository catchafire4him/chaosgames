import { useState } from "react";
import type { PublicPlayer, PublicRoom } from "@shared/index";
import type { Send } from "../pages/Play";
import { campaignPortrait } from "../theme";

/** shapes mirror server/src/modules/campaign privateState */
interface Ability { id: string; label: string; cd: number; desc: string }
interface Hero {
  name: string; cls: string; avatar: string;
  stats: Record<string, number>;
  hp: number; maxHp: number; level: number;
  abilities: Ability[];
  inventory: unknown[];
  quirks: { adjective: string; item: string; backstory: string };
}
interface ClassOpt { id: string; label: string; stat: string; role: string; defaultStats: Record<string, number>; abilities: Ability[] }
interface Forge {
  classes: ClassOpt[];
  statArray: number[];
  suggestedClass: string;
  adjectives: string[];
  items: string[];
  backstories: string[];
}
interface You { hero: Hero | null; forge: Forge | null }

const STAT_LABEL: Record<string, string> = { might: "Might", cunning: "Cunning", arcana: "Arcana", heart: "Heart" };

export function CampaignPhone({
  me,
  you,
  send,
}: {
  room: PublicRoom;
  me: PublicPlayer;
  you: unknown;
  send: Send;
}) {
  const y = (you ?? {}) as You;
  if (y.hero) return <Sheet hero={y.hero} avatar={me.avatar} />;
  if (y.forge) return <ForgeView forge={y.forge} avatar={me.avatar} send={send} />;
  return <p className="phone-hint">Gathering the party…</p>;
}

function ForgeView({ forge, avatar, send }: { forge: Forge; avatar: string; send: Send }) {
  const [cls, setCls] = useState(forge.suggestedClass);
  const [adjective, setAdjective] = useState(forge.adjectives[0]);
  const [item, setItem] = useState(forge.items[0]);
  const [backstory, setBackstory] = useState(forge.backstories[0]);
  const chosen = forge.classes.find((c) => c.id === cls) ?? forge.classes[0];

  return (
    <div className="forge">
      <div className="phone-title">Forge your hero</div>

      <div className="forge-portrait">
        <img src={campaignPortrait(cls, avatar)} alt="" />
      </div>

      <div className="host-section">Class</div>
      <div className="class-grid">
        {forge.classes.map((c) => (
          <button
            key={c.id}
            className={c.id === cls ? "primary" : ""}
            onClick={() => setCls(c.id)}
          >
            <b>{c.label}</b>
            <span>{c.role} · {STAT_LABEL[c.stat]}</span>
          </button>
        ))}
      </div>

      <div className="stat-row">
        {Object.entries(chosen.defaultStats).map(([k, v]) => (
          <div key={k} className="stat-pill">
            <span>{STAT_LABEL[k]}</span>
            <b>{v >= 0 ? `+${v}` : v}</b>
          </div>
        ))}
      </div>
      <div className="ability-list">
        {chosen.abilities.map((a) => (
          <div key={a.id} className="ability">
            <b>{a.label}</b> <em>{a.cd === 0 ? "at will" : a.cd === 99 ? "once/fight" : `cd ${a.cd}`}</em>
            <span>{a.desc}</span>
          </div>
        ))}
      </div>

      <div className="host-section">You are…</div>
      <ChipRow options={forge.adjectives} value={adjective} onPick={setAdjective} />
      <div className="host-section">You carry…</div>
      <ChipRow options={forge.items} value={item} onPick={setItem} />
      <div className="host-section">Why you're here</div>
      <ChipRow options={forge.backstories} value={backstory} onPick={setBackstory} />

      <button
        className="primary forge-go"
        onClick={() =>
          send({
            type: "action",
            action: { kind: "forge_submit", cls, stats: chosen.defaultStats, adjective, item, backstory },
          })
        }
      >
        ⚔ Forge my legend
      </button>
    </div>
  );
}

function ChipRow({ options, value, onPick }: { options: string[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="chip-row">
      {options.map((o) => (
        <button key={o} className={o === value ? "primary" : ""} onClick={() => onPick(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Sheet({ hero, avatar }: { hero: Hero; avatar: string }) {
  return (
    <div className="hero-sheet">
      <div className="sheet-head">
        <img src={campaignPortrait(hero.cls, avatar)} alt="" />
        <div>
          <div className="sheet-name">{hero.name}</div>
          <div className="sheet-sub">
            {hero.quirks.adjective} {hero.cls} · lvl {hero.level}
          </div>
          <div className="hp-bar">
            <div className="hp-fill" style={{ width: `${Math.round((hero.hp / hero.maxHp) * 100)}%` }} />
            <span>{hero.hp}/{hero.maxHp} HP</span>
          </div>
        </div>
      </div>

      <div className="stat-row">
        {Object.entries(hero.stats).map(([k, v]) => (
          <div key={k} className="stat-pill">
            <span>{STAT_LABEL[k]}</span>
            <b>{v >= 0 ? `+${v}` : v}</b>
          </div>
        ))}
      </div>

      <div className="host-section">Abilities</div>
      <div className="ability-list">
        {hero.abilities.map((a) => (
          <div key={a.id} className="ability">
            <b>{a.label}</b> <em>{a.cd === 0 ? "at will" : a.cd === 99 ? "once/fight" : `cd ${a.cd}`}</em>
            <span>{a.desc}</span>
          </div>
        ))}
      </div>

      <div className="host-section">Kit</div>
      <p className="phone-hint" style={{ textAlign: "left" }}>
        Carrying {hero.quirks.item}.{" "}
        {hero.inventory.length ? `+${hero.inventory.length} found item(s).` : "No loot yet."}
        <br />
        <em>"{hero.quirks.backstory}"</em>
      </p>
    </div>
  );
}
