# Chaos Games — Status & Roadmap

> Updated 2026-07-07. Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md)
> (system design) and [CAMPAIGN_DESIGN.md](CAMPAIGN_DESIGN.md) (module 4
> rules + build log). This file is the forward plan — keep it current as
> items land.

## Where we are

**Live in production** (Railway, auto-deploy from `master`):
- **4 game modes**: Conspiracy (social deduction), Whodunnit (murder
  mystery), Dungeon Run (party RPG), and **Chaos Campaign** (persistent
  AI-DM'd D&D — free-text actions, zone combat, chapters that remember,
  generated pixel-art hero portraits).
- **Engine-authoritative core** that has held up across all four modes:
  deterministic server flow, Director/Speaker/Artist pluggable AI, streamed
  TTS with per-beat batching (quota relief), beat interjections + host
  force-advance (no game can strand), themed audio panels, party host
  controls, game-night scoreboard, quick-start guides, mid-game join/rejoin
  QR, per-module ambient music.
- **Persistence layer**: Neon Postgres behind a swappable Storage interface —
  campaigns, heroes, tagged art assets, mid-chapter snapshots (redeploy
  resume). Device identity via `player_key` (the future auth anchor).

**Verification discipline** (keep it): `npm run typecheck` + `npm run sim`
(all modes, offline) + client build before every push; live dev-server pass
for UI; `railway status` + `/healthz` after every deploy.

---

## Next big step (recommended order)

### 1. Close out Campaign phase 8 — make production campaigns REAL ⚡ (small)
The only thing between the campaign and full production readiness:
- [ ] **USER**: paste the Neon `DATABASE_URL` into the Railway dashboard
      variables (until then prod runs `storage=memory` — campaigns playable
      but wiped on redeploy, portraits not persisted).
- [ ] Confirm boot log shows `storage=postgres artist=gemini` (railway logs).
- [ ] Play one real production campaign chapter end-to-end with 2+ phones
      (create → forge → declaration → fork → combat → camp → resume by code).

### 2. Optional accounts, app-wide (task #35) — the retention feature (medium)
Design locked in CAMPAIGN_DESIGN.md §5.3. Login is optional everywhere;
`player_key` stays the runtime identity, login *links* it to an account.
- [ ] Provision Neon Auth (Stack Auth) — note: client is Vite+React, use the
      React SDK, not the Next.js helpers.
- [ ] Additive `players.account_id` migration + link-on-login.
- [ ] "Continue as guest / log in" on the phone join flow (all modes);
      remembered-but-editable display name.
- [ ] Persist cross-session stats (today's in-memory scoreboard → per-player
      rollup) — lights up all 4 modes at once.
- [ ] "My characters" / history view for logged-in players.

### 3. Campaign 5.1 — the tactile table (medium)
The rest of the digital-table vision (§5.4): the phone as your side of the
table, not just menus.
- [ ] **Dice roller**: when the DM calls a check, surface the die + stat;
      tap or shake to roll (engine stays authoritative — the animation
      visualizes the engine's number).
- [ ] **Inventory objects**: tap an item to use / reference it in a
      declaration (feeds the Interpreter).
- [ ] **Scene map**: DM-pinned locations; tapping seeds a declaration.
- [ ] Free-text "describe it" field in combat (mapped to a mechanic, can
      earn situational advantage) — the bridge toward free-text-everywhere.

### 4. Campaign 6.1 — generated scenes & bosses (small-medium)
The Artist adapter + tagged library already support it; wire it in:
- [ ] `getOrCreateAsset` calls in chapter outline / encounter start
      (scene + boss art, campaign-scoped tags so recurring villains recur).
- [ ] TV crossfade when a generated scene lands mid-narration.
- [ ] Item/loot cards as budget allows.

### 5. Party-mode durability (medium)
- [ ] Wrap the 3 party modes' rooms in the snapshot pattern (campaign
      already survives redeploys — extend the same fix so a deploy never
      kills a party game again).

## Backlog / when it hurts
- **TTS quota**: batching shipped (~3-4x fewer calls). If multi-room game
  nights still pinch: check AI Studio tier (tier 2 unlocks at ~$250 spend),
  or add an ElevenLabs/Cloud-TTS Speaker adapter (interface is ready).
- **Campaign balance pass**: playtest-driven tuning (bot win rate ~3:2;
  healer-less parties struggle). Phase-8+ live feedback will guide it.
- **Free-text everywhere + voice input** (§5.4 v2): typed declarations in
  combat; phone mic → transcript → same Interpreter pipeline.
- **Stale painterly portraits**: heroes forged before the pixel-art switch
  keep their old portrait — tiny migration (null out `portrait_asset_id`)
  if it ever matters.
- **Campaign open questions** (CAMPAIGN_DESIGN.md §8): module name, designed
  arc vs open-ended, absent-player policy, party-size floor, tone knob.
- **Grid combat v2**: zone rules were built grid-ready (`{zone, slot}`
  positions) — a tile renderer can slot in without touching the rules.
- **Deferred by choice**: push-to-talk for party modes (user: not
  interested for now).

## Known quirks (documented, low priority)
- Vite dev + prod static server both soft-404 unknown paths (client detects
  undecodable audio/images and falls back — by design).
- Combat isn't snapshotted mid-fight (a redeploy replays the short
  encounter from the scene — deliberate simplification).
- `speech speed` slider trades slight pitch shift at extremes (tape-speed
  effect; client-side playbackRate by design).
