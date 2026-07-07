import { useState } from "react";
import type { ModuleId, ModuleInfo, ServerMessage } from "@shared/index";
import { navigate } from "../App";
import { useSocket } from "../net/socket";

/** key art shown on each module card (the game's world, not the neutral hub) */
const CARD_ART: Record<string, string> = {
  conspiracy: "/img/bg/night.png",
  whodunnit: "/img/locations/library.png",
  dungeon: "/img/dnd/rooms/room_4.png",
  campaign: "/img/dnd/rooms/room_2.png",
};

export function Landing() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<ModuleId | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [resumeCode, setResumeCode] = useState("");
  const [campaignOpen, setCampaignOpen] = useState(false);

  const { send, connected } = useSocket({ type: "list_modules" }, (msg: ServerMessage) => {
    if (msg.type === "modules") setModules(msg.modules);
    else if (msg.type === "room_created") navigate(`#/tv/${msg.roomId}`);
    else if (msg.type === "error") {
      setError(msg.message);
      setCreating(null);
    }
  });

  return (
    <div className="landing themed" data-theme="neutral">
      <div className="landing-bg" />
      <div className="landing-vignette" />
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className="ember"
          style={{
            left: `${(i * 83) % 100}%`,
            animationDelay: `${(i * 1.9) % 11}s`,
            animationDuration: `${9 + (i % 5) * 2.5}s`,
          }}
        />
      ))}

      <div className="landing-content">
        <div className="logo-kicker">A voice-hosted party for your living room</div>
        <h1 className="logo">Chaos Games</h1>
        <div className="logo-rule">
          <span /><em>choose tonight's game</em><span />
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="module-cards">
          {modules.map((m) => (
            <button
              key={m.id}
              className="module-card fade-in"
              data-theme={m.id}
              disabled={!!creating}
              onClick={() => {
                if (m.id === "campaign") {
                  setCampaignOpen(true);
                } else {
                  setCreating(m.id);
                  send({ type: "create_room", moduleId: m.id });
                }
              }}
            >
              <img className="card-art" src={CARD_ART[m.id] ?? ""} alt="" />
              <div className="card-scrim" />
              <div className="card-body">
                <div className="m-name">{m.name}</div>
                <div className="m-tag">{m.tagline}</div>
                <div className="m-meta">
                  {m.minPlayers}–{m.maxPlayers} players · AI-hosted
                </div>
                <div className="m-cta">
                  {m.id === "campaign"
                    ? creating === "campaign"
                      ? "Summoning…"
                      : "Play the saga →"
                    : creating === m.id
                    ? "Setting the stage…"
                    : "Host on this screen →"}
                </div>
              </div>
            </button>
          ))}
          {!modules.length && (
            <p className="phone-hint">{connected ? "Loading games…" : "Connecting…"}</p>
          )}
        </div>

        {campaignOpen && (
          <div className="modal-overlay" onClick={() => setCampaignOpen(false)}>
            <div className="modal-dialog" data-theme="campaign" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setCampaignOpen(false)}>×</button>
              <h2>Chaos Campaign</h2>
              <p style={{ color: "var(--ink-dim)", fontSize: "14px", lineHeight: "1.4" }}>
                A persistent saga across game nights — your heroes level up and the story remembers.
              </p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "18px", marginTop: "8px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)", fontWeight: "bold" }}>
                    Start a New Journey
                  </label>
                  <div className="cl-row">
                    <input
                      placeholder="Name your campaign"
                      maxLength={40}
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && campaignName.trim() && !creating) {
                          setCreating("campaign");
                          send({ type: "create_campaign", name: campaignName.trim() });
                        }
                      }}
                    />
                    <button
                      className="primary"
                      disabled={!campaignName.trim() || !!creating}
                      onClick={() => {
                        setCreating("campaign");
                        send({ type: "create_campaign", name: campaignName.trim() });
                      }}
                    >
                      {creating === "campaign" ? "Summoning…" : "New campaign"}
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ flex: 1, height: "1px", background: "var(--line)" }} />
                  <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--ink-dim)", letterSpacing: "0.1em" }}>or</span>
                  <span style={{ flex: 1, height: "1px", background: "var(--line)" }} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={{ fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)", fontWeight: "bold" }}>
                    Resume a Campaign
                  </label>
                  <div className="cl-row">
                    <input
                      placeholder="Resume code"
                      maxLength={4}
                      value={resumeCode}
                      onChange={(e) => setResumeCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && resumeCode.length === 4 && !creating) {
                          setCreating("campaign");
                          send({ type: "resume_campaign", code: resumeCode });
                        }
                      }}
                    />
                    <button
                      disabled={resumeCode.length !== 4 || !!creating}
                      onClick={() => {
                        setCreating("campaign");
                        send({ type: "resume_campaign", code: resumeCode });
                      }}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="join-glass">
          <div className="join-label">Joining from your phone?</div>
          <div className="join-panel">
            <input
              placeholder="CODE"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length === 4) navigate(`#/play/${code}`);
              }}
            />
            <button
              className="primary"
              disabled={code.length !== 4}
              onClick={() => navigate(`#/play/${code}`)}
            >
              Join
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
