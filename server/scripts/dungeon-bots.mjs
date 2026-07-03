// Creates a Dungeon Run room and drives 3 bot phones — YOU join as the TV:
// open /#/tv/<roomId> (printed below), tap the audio gate, press Begin.
// Pass "standard" as argv[2] to test KOs + the situational 4th action.
import WebSocket from "ws";

const intensity = process.argv[2] === "standard" ? "standard" : "casual";
const URL = `ws://localhost:${process.env.SMOKE_PORT ?? 4321}/ws`;
const send = (ws, msg) => ws.send(JSON.stringify(msg));
const open = () =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });

const creator = await open();
const created = new Promise((resolve) => {
  creator.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "room_created") resolve(msg);
  });
});
send(creator, { type: "create_room", moduleId: "dungeon" });
const { roomId, code } = await created;
send(creator, { type: "join_tv", roomId });
if (intensity === "standard") {
  send(creator, {
    type: "tv_command",
    command: "set_setting",
    setting: { key: "dungeonIntensity", value: "standard" },
  });
}
console.log(`ROOM: ${code} (intensity=${intensity})`);
console.log(`TV URL HASH: #/tv/${roomId}`);

for (const name of ["Brix", "Moxie", "Thorn"]) {
  const ws = await open();
  const bot = { name, id: null, room: null, you: null };
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "joined_player") bot.id = msg.playerId;
    if (msg.type === "room_state") {
      bot.room = msg.room;
      bot.you = msg.you;
    }
  });
  send(ws, { type: "join_player", room: code, name });

  // humanlike pacing: check every 2s, act with delays
  setInterval(() => {
    const { room, you } = bot;
    if (!room || !you) return;
    const m = room.module ?? {};
    if (room.phase === "action_pick" && you.isActive) {
      const options = ["brute", "magic", "chaos"];
      if (m.currentRoom?.situational && Math.random() < 0.25) options.push("situational");
      const pick = options[Math.floor(Math.random() * options.length)];
      setTimeout(
        () => send(ws, { type: "action", action: { kind: "pick_action", action: pick } }),
        1200,
      );
    } else if (room.phase === "rolling" && you.isActive) {
      setTimeout(() => send(ws, { type: "action", action: { kind: "roll" } }), 2000);
    } else if (
      ["action_pick", "rolling"].includes(room.phase) &&
      !you.isActive &&
      ((you.buffCharges ?? 0) > 0 || (you.sabCharges ?? 0) > 0 || you.koed) &&
      Math.random() < 0.4
    ) {
      send(ws, {
        type: "action",
        action: { kind: "spend", spendKind: Math.random() < 0.5 ? "buff" : "sabotage" },
      });
    }
  }, 1800);
}
console.log("3 bots seated. Waiting for the TV to start the game… (Ctrl+C to stop)");
