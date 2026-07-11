# Chaos Games — Architecture (v2, fresh design)

Voice-driven, AI-hosted digital tabletop party game. One TV ("the theater"),
players join on their phones by scanning a QR code. A live AI Game Master
narrates aloud, calls players by name, and reacts to everything — while a
deterministic game engine guarantees the show never stalls.

## Why this design (lessons from the whisper-wit prototype)
The old build streamed game state at a **realtime Gemini Live session** and
hoped the AI called the right tools (with stall-detection nudges). That single
decision caused every major pain point: session caps/resumption bugs, silent
stalls, phase-flow flakiness, untestability, and live-session cost.

**v2 inverts control:**
- **The engine runs the game.** Phases, timers, night resolution, vote
  tallies, win checks — deterministic server code. When the last vote lands,
  the story advances *immediately and automatically*. No human babysitting,
  no AI in the critical path.
- **The AI is the Director** — called at story beats with a bounded job:
  "narrate this dawn", "author a murder scenario as JSON", "write the killer
  a cover clue". Plain request→response with structured output. Each response
  may include **tool calls** (sfx, private whispers, spotlights) so the host
  feels alive — but every story-critical continuation has a server-side
  safety timeout, so a bad AI response can never freeze the game.
- **Voice is a pipeline, not a session.** Director lines → TTS adapter →
  audio queued to the TV over WebSocket with captions. The TV reports when
  each line finishes playing so the engine can pace the story to the voice.
  A failed synth = one silently retried line, never a dead host.

Cost: ~15–30 Flash-class LLM calls + ~$0.15 TTS per game (well under
$0.50/game), $0 while idle.

## Stack
| Layer | Choice |
|---|---|
| Language | TypeScript everywhere — npm workspaces `shared/`, `server/`, `client/` |
| Server | Node 22 + `ws`. One process: static files, WebSockets, in-memory rooms, AI calls |
| State | In-memory, authoritative on server. Rooms are ephemeral; phones/TV reconnect with tokens |
| Client | Vite + React SPA (hash routing): `/#/` landing, `/#/tv/:roomId`, `/#/play/:code` |
| Brain | `Director` interface → `GeminiDirector` (structured JSON output) or `MockDirector` (canned, offline) |
| Voice | `Speaker` interface → `GeminiTtsSpeaker` (24kHz PCM) or none (TV falls back to browser TTS) |
| Hosting | Railway (single container, long-lived WebSockets). QR encodes the public URL → phones on cellular work |

## Repo layout
```
chaosgames/
  shared/src/        types.ts, protocol.ts — the client<->server contract
  server/src/
    index.ts         HTTP static + WS server, message routing
    roomManager.ts   room registry, join codes, idle cleanup
    engine/
      room.ts        Room: players, state, timers, broadcast, narration queue
      beats.ts       Beat runner: director call -> validate -> narrate -> tools -> continue
      types.ts       GameModule / Beat / HostTool interfaces
    director/        types.ts, gemini.ts, mock.ts
    speaker/         types.ts, geminiTts.ts, none.ts
    modules/
      registry.ts    MODULES map — add a mode = add a folder + one line
      conspiracy/    Module 1: social deduction
      whodunnit/     Module 2: murder mystery
    sim/runGame.ts   headless bot game (no keys needed) — the main dev test
  client/
    src/net/         WS hook with reconnect
    src/theme.ts     per-module theming (hub stays neutral; game themes snap in)
    src/audio/       PCM player + browser-TTS fallback + narration queue
    src/pages/       Landing, Tv, Play
    src/tv/          per-module TV scenes
    src/phone/       per-module phone controllers
    public/          generated art reused from whisper-wit (bg, portraits, locations, audio)
  Dockerfile, railway.toml
```

## The beat model
A **beat** is one hosted moment. The engine calls
`playBeat(room, beat)`:
1. Build context: module persona + compact state snapshot + recent-narration
   memory + the beat's instruction.
2. `director.perform(job)` → `{ lines[], calls[], data? }` (JSON-schema
   enforced). `data` is used by authoring beats (scenario, clues).
3. Validate tool calls against the beat's whitelist; execute
   (`trigger_sfx`, `send_private_message`, `spotlight_player`, + module tools).
4. Synthesize lines (parallel), queue to the TV; TV plays sequentially and
   acks each line.
5. When the last line is acked — or a safety timeout fires — run
   `beat.after(room)` (the story continuation).

Director failure → module's canned fallback lines are used; game never blocks.

## Module framework
```ts
interface GameModule {
  id, name, tagline, minPlayers, maxPlayers
  persona: string                       // host personality for this mode
  setup(room)                           // roles, initial phase
  onAction(room, player, action)        // phone taps (server-validated)
  onTimer(room, label)                  // phase timers expiring
  publicState(room)                     // what the TV/room sees
  privateState(room, player)            // what ONE phone sees
  buildContext(room): string            // state snapshot for the Director
  canned(beatId, room): lines           // offline/fallback narration
}
```
Modules fire beats via `room.play(beatId)` from their own flow code.
Everything else (lobby, QR join, reconnects, voice, timers) is engine.

### Module 1 — Mafia (social deduction)
Roles (scaled 4→16 players, gated by the `conspiracyRoles` setting — classic
vs. full chaos): mafia (1–4), godfather (reads INNOCENT to the
detective), doctor, detective(s), vigilante (one bullet; guilt kills them if
they shoot an innocent), jester (neutral — wins only by being voted out),
mayor (vote counts as two), consigliere (learns a player's exact role each
night), innocents. `lobby → role_reveal → night → day → voting → … → ended`.
Night actions/votes on phones; server resolves; Director narrates dawn and
verdicts. Discussion ends by timer **or** when a majority taps "call the
vote". Dead players bet on outcomes for ghost points and may leave last words.

### Module 2 — Whodunnit (murder mystery)
`lobby → prologue → investigation → accusation → verdict → … → revelation → ended`.
Director authors the scenario as JSON (victim, setting, comedic character
name + quirk per player, gender-matched to each player's avatar) and, each
round, public clues per occupied location and private clues per player
(killer gets cover material). Players roam six locations (the location art),
then accuse; trials vote guilty/innocent (the accused writes a free-text
alibi and may counter-accuse someone else, which lingers as a clue into later
rounds); wrong convictions cost reputation and burn one of `mysteryRounds`
(2–4, host-configurable). 7+ players adds an accomplice who protects the
killer without exposing themselves.

## Running it
```powershell
npm install
npm run dev            # server :4321 + vite :5173
npm run sim            # headless full-game bot test, no API keys
npm run build && npm start   # production single process
```
`server/.env`: `GEMINI_API_KEY` (optional — omit for mock/canned mode),
`PORT`, `PUBLIC_URL` (Railway URL for the QR code),
`DIRECTOR=gemini|mock`, `SPEAKER=gemini|none`.

### Module 3 — Dungeon Run (party RPG)
`lobby → forge → intro → room_intro → action_pick → rolling → outcome → … → ended`.
Players forge their legend mad-libs style (quirky adjective, signature item,
backstory — class comes from their lobby avatar), then `dungeonRooms` (4/5/7,
host-configurable) AI-authored rooms, two trials each. One hero acts per turn
(Brute Force / Magic / Chaos + a d20, with class-affinity bonuses, party loot
items, and shake-to-roll); every other player spends BUFF (+2) / SABOTAGE (−2)
charges in real time (2+2, refilled every room, net swing capped at ±6).
Totals ≥20 hit the GREAT SUCCESS band. **Standard intensity** (host setting,
default Casual) adds comedic KOs — a natural 1 knocks the hero out for the
rest of the run and turns them into an unlimited-charge heckler — plus a
Director-invented 4th situational action per room. The server owns all dice
math; the Director authors each room live and
narrates outcomes weaving roll, meddlers, quirks and signature items. Uses the
generated D&D art (class portraits + room paintings + item icons).

## v2+ ideas
- Player voice input (push-to-talk clips transcribed into the Director context)
- Shake-to-roll on the phone (DeviceMotion; needs an iOS permission flow)
- Claude Director adapter; ElevenLabs Speaker adapter
- Room snapshots to disk to survive server restarts
