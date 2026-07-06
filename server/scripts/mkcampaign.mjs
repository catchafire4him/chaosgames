// Live-drive a campaign for UI verification: create a campaign, join N bots,
// forge them, begin the chapter, make one declaration + fork vote (→ combat),
// then stay connected so the TV can be inspected. Prints the roomId/code.
//   node server/scripts/mkcampaign.mjs
import WebSocket from "ws";
const PORT = process.env.SMOKE_PORT ?? 4321;
const NAMES = ["Ada", "Bruno", "Cleo"];
const url = `ws://localhost:${PORT}/ws`;
const send = (ws, m) => ws.send(JSON.stringify(m));

const tv = new WebSocket(url);
tv.on("open", () => send(tv, { type: "create_campaign", name: "The Verification Saga" }));
tv.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "room_created") {
    console.log(`CAMPAIGN roomId=${msg.roomId} code=${msg.code}`);
    send(tv, { type: "join_tv", roomId: msg.roomId });
    joinPlayers(msg.code);
  }
});

const players = [];
let began = false, declared = false, voted = false;

function joinPlayers(code) {
  NAMES.forEach((name, i) => {
    const ws = new WebSocket(url);
    const p = { ws, name, id: null, key: `livekey-${i}`, forged: false };
    players.push(p);
    ws.on("open", () => send(ws, { type: "join_player", room: code, name, playerKey: p.key }));
    ws.on("message", (raw) => onPlayerMsg(p, JSON.parse(raw.toString())));
  });
}

function onPlayerMsg(p, msg) {
  if (msg.type === "joined_player") { p.id = msg.playerId; return; }
  if (msg.type !== "room_state") return;
  const room = msg.room;
  const you = msg.you ?? {};
  const phase = room.phase;

  // host starts the game once everyone's in
  if (phase === "lobby" && room.hostPlayerId === p.id && room.players.length >= NAMES.length && !p.started) {
    p.started = true;
    setTimeout(() => send(p.ws, { type: "host_command", command: "start_game" }), 400);
  }
  // forge
  if (phase === "forge" && you.forge && !p.forged) {
    p.forged = true;
    const f = you.forge;
    const cls = f.classes.find((c) => c.id === f.suggestedClass);
    send(p.ws, { type: "action", action: { kind: "forge_submit", cls: f.suggestedClass, stats: cls?.defaultStats, adjective: f.adjectives[0], item: f.items[0], backstory: f.backstories[0] } });
  }
  // host begins the chapter
  if (phase === "briefing" && room.hostPlayerId === p.id && !began) {
    began = true;
    setTimeout(() => send(p.ws, { type: "action", action: { kind: "begin_chapter" } }), 500);
  }
  // one declaration, then everyone votes the fork → combat
  if (phase === "scene") {
    if (room.hostPlayerId === p.id && !declared) {
      declared = true;
      setTimeout(() => send(p.ws, { type: "action", action: { kind: "declare", text: "I scan the bridge for a weak plank to exploit" } }), 800);
    }
    const chapter = you.chapter;
    if (chapter?.fork && !p.voted) {
      p.voted = true;
      setTimeout(() => send(p.ws, { type: "action", action: { kind: "fork_vote", option: 0 } }), 2500);
    }
    // host forces the climax a few seconds in (resolves any fork, else advances)
    if (room.hostPlayerId === p.id && !p.advanced) {
      p.advanced = true;
      setTimeout(() => send(p.ws, { type: "action", action: { kind: "advance_scene" } }), 6000);
    }
  }
  if (phase === "encounter" && !voted) { voted = true; console.log("REACHED COMBAT"); }
}

setInterval(() => {}, 1 << 30); // keep alive
