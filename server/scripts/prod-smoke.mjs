// Smoke test against the deployed Railway server (wss).
import WebSocket from "ws";

const HOST = process.argv[2] ?? "chaosgames-production.up.railway.app";
const URL = `wss://${HOST}/ws`;
const send = (ws, msg) => ws.send(JSON.stringify(msg));
const open = () =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });

const tv = await open();
let roomState = null;
const narrated = [];
tv.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "room_state") roomState = msg.room;
  if (msg.type === "narration") {
    narrated.push(msg.line.text);
    send(tv, { type: "narration_done", lineId: msg.line.id });
  }
});

const created = new Promise((resolve) => {
  tv.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "room_created") resolve(msg);
  });
});
send(tv, { type: "create_room", moduleId: "conspiracy" });
const { roomId, code } = await created;
console.log(`[prod-smoke] room created: ${code} — join URL should be https://${HOST}/#/play/${code}`);
send(tv, { type: "join_tv", roomId });

const phones = [];
for (const name of ["Ana", "Bo", "Cy", "Di", "Ev"]) {
  const ws = await open();
  const phone = { name, ws, you: null, room: null, id: null };
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "joined_player") phone.id = msg.playerId;
    if (msg.type === "room_state") {
      phone.room = msg.room;
      phone.you = msg.you;
    }
  });
  send(ws, { type: "join_player", room: code, name });
  phones.push(phone);
}
await new Promise((r) => setTimeout(r, 800));
console.log(`[prod-smoke] players joined: ${roomState?.players.map((p) => p.name).join(", ")}`);
console.log(`[prod-smoke] join URL confirmed on room: ${roomState?.joinUrl}`);

send(tv, { type: "tv_command", command: "start_game" });

const start = Date.now();
let lastPhase = "";
while (Date.now() - start < 90_000) {
  await new Promise((r) => setTimeout(r, 250));
  const phase = roomState?.phase;
  if (phase && phase !== lastPhase) {
    console.log(`[prod-smoke] phase: ${phase} round: ${roomState.round}`);
    lastPhase = phase;
  }
  if (phase === "ended") break;
  for (const p of phones) {
    const me = roomState?.players.find((pl) => pl.id === p.id);
    if (!me || me.status !== "alive" || me.done) continue;
    const alive = roomState.players.filter((pl) => pl.status === "alive" && pl.id !== p.id);
    const target = alive[Math.floor(Math.random() * alive.length)];
    if (phase === "role_reveal") send(p.ws, { type: "action", action: { kind: "ready" } });
    else if (phase === "night" && p.you?.role && p.you.role !== "innocent" && p.you.role !== "jester" && target)
      send(p.ws, { type: "action", action: { kind: "night_pick", targetId: target.id } });
    else if (phase === "day") send(p.ws, { type: "action", action: { kind: "call_vote" } });
    else if (phase === "voting" && target)
      send(p.ws, { type: "action", action: { kind: "vote", targetId: target.id } });
  }
}

if (roomState?.phase !== "ended") {
  console.error("PROD SMOKE FAIL: game did not finish. phase=", roomState?.phase);
  process.exit(1);
}
console.log(`[prod-smoke] winners: ${roomState.winners?.join(", ")}`);
console.log(`[prod-smoke] narration lines: ${narrated.length}`);
console.log(`[prod-smoke] sample: ${narrated[0]}`);
if (!narrated.length) {
  console.error("PROD SMOKE FAIL: no narration reached the TV — check GEMINI_API_KEY/DIRECTOR on Railway");
  process.exit(1);
}
console.log("PROD SMOKE PASS");
process.exit(0);
