// End-to-end smoke test against a running server: creates a room over WS,
// joins a TV + 4 phones, starts a Conspiracy game, plays it to completion.
import WebSocket from "ws";

const URL = `ws://localhost:${process.env.SMOKE_PORT ?? 4399}/ws`;
const send = (ws, msg) => ws.send(JSON.stringify(msg));
const open = () =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });

const log = (...a) => console.log("[smoke]", ...a);

// TV connection
const tv = await open();
let roomState = null;
const narrated = [];
tv.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "room_state") roomState = msg.room;
  if (msg.type === "narration") {
    narrated.push(msg.line.text);
    // ack immediately so beats complete fast
    send(tv, { type: "narration_done", lineId: msg.line.id });
  }
  if (msg.type === "error") log("TV error:", msg.message);
});

const roomCreated = new Promise((resolve) => {
  tv.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "room_created") resolve(msg);
  });
});
send(tv, { type: "create_room", moduleId: "conspiracy" });
const { roomId, code } = await roomCreated;
log("room created:", code);
send(tv, { type: "join_tv", roomId });

// Phones
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
await new Promise((r) => setTimeout(r, 500));
log("players joined:", roomState?.players.map((p) => p.name).join(", "));

send(tv, { type: "tv_command", command: "start_game" });

// bot loop
const start = Date.now();
let lastPhase = "";
while (Date.now() - start < 90_000) {
  await new Promise((r) => setTimeout(r, 200));
  const phase = roomState?.phase;
  if (phase && phase !== lastPhase) {
    log("phase:", phase, "round:", roomState.round);
    lastPhase = phase;
  }
  if (phase === "ended") break;
  for (const p of phones) {
    const me = roomState?.players.find((pl) => pl.id === p.id);
    if (!me || me.status !== "alive" || me.done) continue;
    const alive = roomState.players.filter((pl) => pl.status === "alive" && pl.id !== p.id);
    const target = alive[Math.floor(Math.random() * alive.length)];
    if (phase === "role_reveal") send(p.ws, { type: "action", action: { kind: "ready" } });
    else if (phase === "night" && p.you?.role && p.you.role !== "innocent" && target)
      send(p.ws, { type: "action", action: { kind: "night_pick", targetId: target.id } });
    else if (phase === "day") send(p.ws, { type: "action", action: { kind: "call_vote" } });
    else if (phase === "voting" && target)
      send(p.ws, { type: "action", action: { kind: "vote", targetId: target.id } });
  }
}

if (roomState?.phase !== "ended") {
  console.error("SMOKE FAIL: game did not finish. phase=", roomState?.phase);
  process.exit(1);
}
log("winners:", roomState.winners?.join(", "));
log("narration lines heard by TV:", narrated.length);
log("sample:", narrated[0]);
if (!narrated.length) {
  console.error("SMOKE FAIL: no narration reached the TV");
  process.exit(1);
}
console.log("SMOKE PASS");
process.exit(0);
