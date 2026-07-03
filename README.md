# Chaos Games

Voice-driven, AI-hosted digital tabletop party game. One shared big screen,
players join on their phones via QR code, and an AI Game Master narrates the
whole thing out loud. See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

**Game modes:** Conspiracy (social deduction) · Whodunnit (murder mystery) · Dungeon Run (party RPG)

## Run locally
```powershell
npm install
npm run dev        # server on :4321, client dev on :5173
```
Open http://localhost:5173, pick a game — that tab is the TV. Phones on the
same network scan the QR (or open the URL and enter the 4-letter code).

`server/.env`:
```
GEMINI_API_KEY=...   # optional — omit for the keyless canned host
PORT=4321
# PUBLIC_URL=https://your-app.up.railway.app   # set in production
# DIRECTOR=gemini|mock     SPEAKER=gemini|none
# GEMINI_MODEL=gemini-3.1-flash-lite            # director brain (default)
# GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview # host voice (default)
# GEMINI_TTS_VOICE=Charon
```
Both adapters try a fallback chain of models, so a retired preview model
degrades gracefully instead of killing the host.
Without a key the game still fully works: canned narration + browser
text-to-speech on the TV.

## Test (no keys, no browser)
```powershell
npm run sim              # full bot games through both modules
npm run sim conspiracy   # just one
DIRECTOR=gemini npm run sim   # smoke-test real AI authoring
```
With a server running there are also live checks:
```powershell
node server/scripts/smoke.mjs      # real WS clients play a full game (server on :4399)
node server/scripts/tts-check.mjs  # verify Gemini TTS returns audio (run from server/)
```

## Deploy to Railway
```powershell
railway init     # once, in this folder
railway up
```
Then in the Railway dashboard set variables:
- `GEMINI_API_KEY` — your key
- `PUBLIC_URL` — the public URL Railway gave the service (e.g. `https://chaosgames-production.up.railway.app`)

The QR code on the TV encodes `PUBLIC_URL`, so phones on any network can join.

## Adding a game mode
Implement `GameModule` (see `server/src/engine/types.ts`) in a new folder under
`server/src/modules/`, register it in `modules/registry.ts`, add TV/phone
components in `client/src/tv/` + `client/src/phone/`, and switch on the new
`moduleId` in `Tv.tsx`/`Play.tsx`. Give it a visual identity by adding an entry
in `client/src/theme.ts` (scene artwork, music) and a `[data-theme="<id>"]`
block in `client/src/styles.css` (palette + typography). The hub and phone join
flow stay neutral; the theme takes over the moment a room's game is known.
The engine, voice pipeline, lobby, QR join, timers and reconnects are all shared.
