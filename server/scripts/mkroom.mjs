// Create an empty room (no bots) and print its join code.
import WebSocket from "ws";
const ws = new WebSocket(`ws://localhost:${process.env.SMOKE_PORT ?? 4321}/ws`);
ws.on("open", () =>
  ws.send(JSON.stringify({ type: "create_room", moduleId: process.argv[2] ?? "dungeon" })),
);
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "room_created") {
    console.log(`ROOM: ${msg.code} (${msg.roomId})`);
    ws.close();
    process.exit(0);
  }
});
