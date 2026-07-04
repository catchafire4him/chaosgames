# Module 4 — Chaos Campaign (working title) — DESIGN

> Status: **design phase** — nothing built yet. This doc is the collaborative
> source of truth for gameplay rules; edit freely.
>
> Decisions locked with the user (2026-07-03):
> - **Own module**, not an extension of Dungeon Run (which stays the 20-min party bit)
> - **Zone combat now, grid-ready data structures** for a possible v2 tile map
> - **Multi-session chapters** (~60 min per game night, story + heroes carry over)
> - **Middle crunch**: 4 stats, HP, class abilities with cooldowns, slot inventory
> - **Persistence is in scope**: real database now (also unlocks room-crash
>   recovery + the deferred retention/auth goals)

---

## 1. The pitch

A persistent, AI-DM'd fantasy campaign for 2–6 players played across game
nights. Each night is one **chapter**: a self-contained ~60-minute adventure
with a beginning and a cliffhanger, authored live by the Director from the
campaign's running story log. Heroes have real character sheets — stats, HP,
abilities, gear — that survive between sessions and level up.

Dungeon Run is the party game; Campaign is the *series*. Same engine, same
voice, same phones-vs-TV setup, same comedy DNA — but everyone plays every
round, choices persist, and dying matters (a little).

## 2. Heroes

### 2.1 Stats (4, not 6)
| Stat | Governs |
|---|---|
| **MIGHT** | melee attacks, feats of strength, intimidation |
| **CUNNING** | initiative, ranged attacks, stealth, traps, lies |
| **ARCANA** | spells, lore, weird item identification |
| **HEART** | healing, persuasion, rallying, animal nonsense |

At creation the player assigns the array **[+2, +1, +0, −1]** to the four
stats (class suggests a default; one tap accepts it). Levels add points.

### 2.2 Classes (6 launch classes, reusing dungeon art)
Every class = 1 signature stat, 1 role, 2 starting abilities. Quirks/mad-libs
carry over from Dungeon Run for flavor.

| Class | Stat | Role | Starting abilities (cooldown in rounds) |
|---|---|---|---|
| **Barbarian** | MIGHT | striker | Big Swing (hits 2 enemies in reach, CD 3) · Unreasonable Anger (self +2 dmg this encounter, CD ∞/enc) |
| **Knight** | MIGHT | defender | Intervene (redirect a hit from an ally to self, CD 2) · Shield Wall (party front takes −2 dmg 1 round, CD 3) |
| **Rogue** | CUNNING | skirmisher | Vanish (move to HIDDEN zone free, CD 3) · Backstab (+4 dmg from HIDDEN, then revealed, CD 2) |
| **Wizard** | ARCANA | blaster | Firebolt-ish (ranged, ignores zone limits, CD 0) · Probably-Fireball (hits a whole zone, friendly fire on a fumble, CD 4) |
| **Hedge Witch** | HEART | healer | Dubious Brew (heal ally 2d4, on nat1 it's a poison, CD 2) · Hex (enemy −2 to rolls 2 rounds, CD 3) |
| **Bard** | HEART | support | Inspire (ally's next roll +3, CD 2) · Devastating Limerick (CHA attack, dmg + target skips move, CD 3) |

### 2.3 HP, death, and consequences
- **Max HP** = `8 + 2×MIGHT + 2×level` (floor 6).
- **0 HP → DOWNED**: hero is out of the fight; an ally can spend an action
  adjacent to revive at 3 HP. Comedic, not gory.
- **TPK / chapter failure never ends the campaign** — the Director writes the
  failure into the story (captured, robbed, humiliated, rescued at a cost)
  and the next chapter opens from the consequences. Failing forward, always.
- Full heal at each chapter start (a night's rest); mid-chapter healing is
  scarce (Witch, potions, camp scenes).

### 2.4 Leveling (milestone, not XP-counting)
- +1 level per completed chapter (cap ~6 for now).
- Each level: **+1 stat point** and **+2 max HP**; levels 3 and 5 add a new
  ability (pick 1 of 2 offered — a real choice, small enough for a phone).

### 2.5 Inventory
- **4 personal slots** per hero + a **party stash** (TV-visible, anyone can
  grab at camp). Items are engine-typed (weapon / armor / consumable / weird)
  with Director-authored names and flavor.
- No encumbrance math, no gold ledger in v1 — loot is picked up, argued
  over, and used. (Gold + shops are a v2 camp-scene candidate.)

## 3. Resolution rules

Everything is the familiar d20, server-rolled, Director-narrated.

### 3.1 Skill checks (out of combat)
`d20 + stat` vs a **DC the engine sets** from the Director's structured
output (`easy 8 / tricky 12 / hard 16 / heroic 20`). Same crit rules as
Dungeon Run: nat 1 always comedic disaster, nat 20 always legendary.
Director authors *which stat and DC* a challenge wants; server validates
and rolls. Group checks: everyone rolls, majority carries.

### 3.2 Combat — zones now, grid later
The battlefield is an ordered strip of **zones**:

```
[ENEMY BACK] [ENEMY FRONT] [PARTY FRONT] [PARTY BACK]   + [HIDDEN]
```

- **Position** is stored as `{ zone: ZoneId, slot: number }` — v2 can map
  zones onto tile regions without touching the rules. No rule may reference
  anything finer than a zone. (This is the grid-ready contract.)
- **Move**: 1 zone per turn, free alongside your action. HIDDEN is
  enterable only via abilities/stealth checks.
- **Reach**: melee hits an adjacent zone; ranged/spells hit anywhere except
  from HIDDEN (leaving HIDDEN to attack reveals you unless an ability says
  otherwise).
- **Initiative**: `d20 + CUNNING` once per encounter, fixed order, enemies
  interleaved. TV shows the order rail.
- **A turn** = move (optional) + one action:
  **Attack** (`d20 + stat` vs the target's DEF; hit = weapon/ability damage,
  nat 20 = double) · **Ability** (if off cooldown) · **Item** · **Help**
  (ally's next roll +2) · **Defend** (+3 DEF until next turn — also the
  auto-action when a turn timer expires, so stalls never block).
- **Damage is flat per source** (e.g. sword 4, firebolt 3, boss slam 6) —
  one roll per turn keeps phone pacing snappy; the d20 is the drama, not
  the damage dice.

### 3.3 Enemies
- The **engine owns stat blocks**: a small template bestiary
  (`minion / bruiser / caster / lurker / boss`) with HP/DEF/damage scaled by
  party level and size. Simple behavior scripts (bruisers push to front,
  casters focus the back line, lurkers go for HIDDEN heroes).
- The **Director skins them**: names, descriptions, attack narration — so
  the same `bruiser` template is a troll tonight and a tax golem next week.
  Server math never depends on the skin. (Same referee/performer split as
  everything else in the app.)

## 4. Chapter structure (~60 min)

```
recap → scene 1 (hook/roleplay + checks) → scene 2 (complication:
encounter OR dilemma) → scene 3 (climax: combat set-piece) → camp
(loot, level-up, banter, choice for next time) → cliffhanger + save
```

- **Beat budget**: ~14–18 Director beats per chapter (cost comparable to a
  long Dungeon Run).
- **Recap** beat opens every session — Director retells last chapter from
  the campaign log, "previously on…" style.
- **Party choices**: at least one real fork per chapter (vote on phones;
  ties broken by the party's designated leader — rotates every chapter).
  The Director records choices in the log; later chapters must honor them.
- **Private whispers**: stat-gated secrets pushed to specific phones (high
  CUNNING spots the ambush, high ARCANA reads the sigil) — reuses the
  existing whisper tool.
- **Camp scene** closes the night: distribute loot, pick level-up options,
  one roleplay prompt each ("what does your hero do around the fire?" —
  tap-to-pick, feeds the Director's memory of who these people are).

### 4.1 Campaign memory (what the Director sees)
A **campaign log** persisted in the DB and compacted per chapter:
- one-paragraph chapter summaries (Director-authored at chapter end)
- open threads / promises / enemies made
- per-hero moments (running gags, near-deaths, catchphrases)
The next chapter's authoring beat receives the log + party sheet and returns
a structured chapter outline (scenes, encounter templates, the fork). Server
validates the outline like any other structured output.

## 5. Persistence & accounts (the new infrastructure)

### 5.1 Database
- **Neon Postgres** (user's choice 2026-07-03 — serverless, and Neon Auth
  is the intended path for real accounts later). One `DATABASE_URL` env var
  (Neon pooled connection string; set locally in `server/.env` and in the
  Railway dashboard for production — never as a CLI argument). Behind a
  thin `Storage` interface so the DB is swappable and the sim runs on an
  in-memory fake.
- Tables (sketch):
  - `players` — `player_key` (UUID minted on first visit, kept in phone
    localStorage), display name, created_at. **Auth-lite**: no passwords or
    email in v1; the key IS the identity. A future real-auth pass attaches
    email/OAuth to the same row — schema is ready for it.
  - `campaigns` — id, join code, name, settings, chapter_num, status,
    campaign_log (jsonb), created_at.
  - `characters` — id, campaign_id, player_key, name/class/avatar, stats,
    hp/level, abilities, inventory, quirks (jsonb).
  - `assets` — tagged generated-art library (see §6.2): scope
    (campaign-id or shared), kind, tags, style_key, prompt, image bytes,
    times_used.
  - `snapshots` — campaign_id, chapter, full serialized room state (jsonb),
    updated_at. Autosaved at every scene boundary → **a redeploy mid-chapter
    resumes from the last scene** instead of wiping the night. (This is the
    fix for the "room not found" class of bug, scoped to campaigns first.)
- Reconnect flow: phone presents `player_key` → server finds their hero in
  the campaign → seat restored. No more name-matching.

### 5.2 What this unlocks beyond the campaign
- The `players` table is the seed of the retention/auth work (night-log
  history, scoreboards across evenings) — same identity, more tables later.
- The snapshot pattern can later wrap the other three modules' rooms.

### 5.3 Optional accounts — APP-WIDE (planned, not v1-blocking)
> User intent (2026-07-03): login should be **optional across ALL modules**,
> not just Campaign. If you log in, the app remembers your name, and tracks
> your stats, the characters you've created, and more — but you can still
> change your display name each session (it's half the fun). Anonymous play
> stays the default everywhere; login only ever *adds*.

Nothing here needs building now — but it's the reason the phase-1 identity
model looks the way it does, and it constrains a few current choices:

- **`player_key` is the anchor, login is a claim, not a replacement.** The
  device-minted `player_key` (localStorage) stays the runtime identity in
  every module. Logging in **links** that key to an account; the account
  can own several keys (phone + laptop) and inherits their history. So the
  campaign shell's player-key plumbing (phase 2) is *also* the auth plumbing
  — build it once, cleanly.
- **Provider: Neon Auth (Stack Auth)** — native to our DB, provisionable via
  the Neon MCP (`provision_neon_auth`), which creates a `neon_auth.users_sync`
  table. That becomes the account anchor; add a nullable `account_id` (→
  `users_sync.id`) to `players` in an additive migration when we build it.
  Postgres handles the nullable-column add with zero rework to phase 1.
- **Display name stays mutable** — already a separate column from identity,
  so "remember my name but let me rename per game" is a default, not a
  special case. Don't ever key anything on display name.
- **Stats/characters need identity-keyed persistence to survive.** Campaign
  characters already are (keyed by `player_key`). The party-night scoreboard
  is currently an in-memory `Map` (ephemeral by design) — turning that into
  cross-session stats = persist it keyed by `player_key`, additive, no game-
  logic change. Do NOT special-case this into any module now; it's one later
  pass that lights up all modules at once.
- **Sequencing recommendation**: do the auth pass as its own slice right
  AFTER phase 2 (once player-key plumbing exists and is proven), before it's
  worth persisting cross-module stats. It is not a phase-1/2 blocker; keep
  building the campaign, just don't key anything on display name or assume
  a `player_key` maps to exactly one human.

## 5.4 Input model — the digital table (free-text + tactile) — DIRECTION LOCKED
> User intent (2026-07-03): campaign should feel like traditional in-person
> D&D with an AI host. Players **type what they want to do in their own words**
> and the DM reacts and adapts around it — while the app removes the table's
> friction (dice, math, HP, tracking). The phone is the player's **side of the
> table**: tactile objects they'd physically have — a die to roll, collected
> items, maps, their character sheet. The AI improvises options and story
> around what players do and what they pick up. Target = free-text EVERYWHERE;
> **start HYBRID** (free-text in exploration/social/puzzle scenes; keep the
> phase-3 tap actions in combat) because it's easier to land first, then widen.
> Voice input is text-only for v1 (design the pipeline so mic→transcript is a
> drop-in later).

**Why this is safe (not the whisper-wit trap):** the old pain was the AI being
in the flow-control critical path. Here the AI only **interprets intent and
narrates**; the ENGINE still owns every die, HP total, DC, and turn. Phases 1–3
(persistence + authoritative rules) are precisely what make free-text safe —
the engine is the guardrail that keeps the DM an improv partner, not a pushover.

### The Interpreter loop
```
player types intent  →  Director "interpret" beat (structured, cheap) →
engine rolls + applies rules  →  Director narrates the ENGINE's verdict
```
- **Interpret beat** returns small structured JSON, e.g.
  `{ interpretedAs, stat: "heart", difficulty: "hard", plausible: true,
     targets?, mechanic?: "attack|ability|move|skill", grantsAdvantage?: bool }`.
  The Director may NOT decide success — it only classifies the attempt. If
  something is impossible it returns `plausible:false` and the DM says so in
  character. This is the anti-"talk the AI into winning" guardrail.
- **Engine resolves** via `skillCheck()` / combat (phase 3) and hands back the
  outcome; **Director narrates that outcome** and may offer follow-on options.
- **Cost control**: interpret is a tiny flash-lite call fired only on genuine
  declarations (not keystrokes); narration is the existing beat. Combat stays
  structured in the hybrid start to avoid a call per swing.

### The phone as a tactile table
Always-available objects (not just menus):
- **Dice** — a physical-feeling roller; when the DM calls for a check the phone
  surfaces the die + the relevant stat, player taps to roll (engine is still
  authoritative — the animation just visualizes the engine's number). Shake-to-
  roll reuses the dungeon DeviceMotion hook.
- **Inventory / items** — tap an item to use or to reference it in a declaration
  ("I hold up the {sentient map}"); using an item feeds the Interpreter.
- **Map** — a simple scene/region map the DM can pin locations onto; tapping a
  place can seed a declaration ("I head to the {crypt}").
- **Character sheet** — stats/HP/abilities (already built in phase 2).
- A **free-text "what do you do?" field** is the primary verb everywhere; the
  DM can also *impromptu* offer tappable choice chips when it wants to pace a
  moment or present a fork.

### Rollout
- **Hybrid v1**: free-text Interpreter drives scene beats (phase 4); combat
  keeps phase-3 tap actions; dice + inventory + sheet tactile objects on the
  phone (phase 5). A typed action in combat is a stretch goal (map it to a
  mechanic + optional advantage).
- **Free-text-everywhere v2**: typed declarations in combat too, mapped onto
  the mechanics with situational advantage; voice input.

## 6. TV & phone UX (v1 sketch)

- **TV**: scene art + narration as today; in combat, an **encounter strip**
  (zone columns with hero/enemy tokens using existing portraits), HP bars,
  initiative rail, floating damage numbers. No tile map in v1.
- **Phone**: a **character sheet tab** (stats, HP, gear — always available)
  and an **action tab** (contextual: check button, combat actions with
  cooldown badges, vote cards for forks). Downed heroes get a spectator
  view with a "yell encouragement" emote (no charges economy here — everyone
  plays every round, so Dungeon Run's buff/sabotage layer stays exclusive
  to Dungeon Run).
- **Art**: see §6.1 — generated on the fly, with the existing dungeon art
  as the always-available fallback.

### 6.1 Live art — the Artist adapter (gemini-3.1-flash-lite-image)
Sub-2s latency and ~$0.034 per 1024px image make on-the-fly asset
generation viable (a full chapter's art ≈ $0.30–0.50 — comparable to the
existing LLM+TTS budget per game).

- **`Artist` interface** alongside `Director`/`Speaker`: `GeminiArtist` +
  `NullArtist` (sim/offline). Same pluggable pattern, same rule: art
  NEVER blocks a beat — if an image isn't ready or fails, the module's
  stock art shows instead (the canned-lines/fallback-music pattern).
- **Latency cover**: generation is kicked off the moment a beat's
  structured output lands, and runs during the 10–30s of narration; the
  image crossfades in mid-speech.
- **Style anchor** (the TTS-voice-drift lesson, applied to pixels): one
  persistent per-module style string repeated verbatim in every prompt,
  optionally plus a stock-art reference image as input, so stateless calls
  don't reinvent the art style each time.
- **What gets generated**, in priority order:
  1. **Hero portraits at the forge** — the player's mad-libs hero appears
     on the TV seconds after creation, and persists for the whole campaign
     (stored in the DB; one-time cost, permanent ownership — a retention
     feature disguised as art).
  2. **Scene art + bosses per chapter** — the Director invents it, the TV
     shows it. Multi-turn editing allows cheap variants (wounded hero,
     burning village) from a stored base image.
  3. Items/loot cards as budget allows.
- **Storage**: generated images live in Postgres alongside the campaign
  (~200KB compressed each; Railway's container FS is redeploy-ephemeral).
- **Portability**: once the adapter exists, Dungeon Run room paintings and
  Whodunnit scenario art can opt in with a one-line beat change.

### 6.2 Tagged asset library (generate once, encounter again)
Every generated image is saved with tags and reused — a cache hit is free,
instant, and *visually consistent* (the recurring villain looks identical
because it IS the same image). Reuse is a continuity feature first and a
cost saver second.

- **`assets` table**: id, scope, kind (`portrait/enemy/boss/scene/item`),
  `tags text[]` (e.g. `["goblin","chief","scarred","cave"]`), style_key
  (per-module style anchor used), source prompt, image bytes, times_used.
- **Lookup before generate**: an authoring beat's asset requests carry
  Director-emitted tags; the engine tag-matches against the library first.
  Hit → reuse; miss → generate, tag, store. The Director's structured
  output already exists — tags are one extra schema field.
- **Two scopes**:
  - **Campaign-scoped** — this party's world. Named NPCs, their nemesis,
    the tavern they keep coming back to. The chapter-authoring beat is
    TOLD what's in the campaign library ("these people/places exist —
    prefer weaving them back in"), so the asset cache and the campaign
    log reinforce each other: recurring art *causes* recurring story.
  - **Shared library (per module style)** — generic enemies, rooms, and
    items reusable across all campaigns/rooms. Pure cost/latency saver.
- **Anti-samey guard**: named/boss assets always reuse (consistency is the
  point); generic assets reuse at a capped rate (~50%) so the world doesn't
  ossify — and multi-turn editing lets a cached base image become a cheap
  variant ("the same throne room, ransacked") instead of a rerun.

## 7. Build phases (each independently verifiable)

1. **Storage layer** — Postgres on Railway, `Storage` interface +
   in-memory fake, `players` auth-lite keys, migration script. Sim-testable.
2. **Campaign shell** — create/resume campaign flow, hero forge (stats
   array, class, mad-libs), character sheet phone tab, DB round-trip.
3. **Rules engine** — checks, zones, initiative, turns, enemy templates +
   behaviors, abilities/cooldowns, items. Headless sim plays a full combat
   with bots (MockDirector) — the main test.
4. **Chapter director** — outline authoring beat, scene/camp/recap beats,
   campaign log compaction, structured-output schemas + canned fallbacks.
5. **TV/phone combat UI** — encounter strip, initiative rail, action tab.
6. **Artist adapter** — `GeminiArtist`/`NullArtist`, style anchor, hero
   portraits at the forge + chapter scene art, stock-art fallback path.
7. **Snapshots + resume** — scene-boundary autosave, redeploy-survival test.
8. **Live verification** — real Gemini chapter, then a 2-chapter campaign
   across a simulated "two game nights" (resume from DB) before deploy.

## 7.1 Build rules (read before touching code)

- **Branch policy**: the live MVP on `master` must never break. All
  campaign work happens on the **`campaign` branch**; Railway auto-deploys
  `master` only. Merge to master ONLY changes that are provably safe for
  the live modules (verified via typecheck + `npm run sim` + client build
  first). The campaign module stays unregistered in `modules/registry.ts`
  on master until it's playable end-to-end.
- **Database**: Neon (see §5.1). Use the Neon MCP tools to manage it
  (project `chaosgames`). Auth later = Neon Auth / Stack; v1 = auth-lite
  player keys.
- **Verification per phase** is mandatory (see each phase's gate in §7);
  the sim (`npm run sim`) must always pass with the in-memory storage fake
  and MockDirector — no API keys or DB required for CI-style checks.
- **Handoff**: keep §9 (build log) current — future agents resume from it.

- **2026-07-03** — PHASE 2 COMPLETE (task #28). Campaign SHELL + HERO FORGE
  (lobby → forge → briefing). Server: `server/src/modules/campaign/index.ts`
  (6 classes w/ stats+2 abilities each, 4-stat forge, HP = 8+2·MIGHT+2·lvl,
  mad-libs quirks; setup() hydrates from DB → forge for a new party or straight
  to briefing on resume; forge persists every hero via `upsertCharacter`).
  Identity: `ServerPlayer.playerKey` + `Room.campaignId`/`Room.storage`;
  join_player carries `playerKey`, server `getOrCreatePlayer` + reclaims a
  hero by device key. New protocol msgs `create_campaign`/`resume_campaign`
  → `RoomManager.createCampaign/resumeCampaign` (campaign join code = room
  code). `create_room`/`switch_module` guard campaign so it's ONLY reachable
  via the campaign create/resume flow. `ModuleId += "campaign"` (shared).
  Client: `net/playerKey.ts` (localStorage UUID), `phone/CampaignPhone.tsx`
  (forge + always-on character sheet), `tv/CampaignTv.tsx` (party roster),
  campaign theme in theme.ts + styles.css, hub launch panel in Landing.tsx,
  switches in Play/Tv. VERIFIED: `npm run sim campaign` forges + persists 4
  heroes to memory storage AND resumes a fresh room with 4/4 heroes
  reattached by player_key (no re-forge); all other sims still green;
  server typecheck + client build clean. NOT yet done (deferred): custom
  stat re-assignment (phase-2 ships one-tap class-default spread — design §2.1
  allows this; free-assign is a polish follow-up); full live browser forge
  (two-client flow — belongs to phase 8 live verification; dev port was held
  by another process this session). Still on campaign branch; nothing merged.
  Next: phase 3 (task #29, rules engine) — or the auth slice (#35) which is
  now unblocked.
  BRANCH STATE for the phase-8 merge agent: `master` holds the live MVP +
  the audio-mixer/slider work (currently at a "resolve slider thumb…" commit)
  and contains ZERO campaign code — verified via `git log master..campaign`.
  The `campaign` branch was cut from an EARLIER slider commit, so
  client/src/pages/Tv.tsx and client/src/styles.css DIVERGE between the two
  branches (both touched the audio-mixer markup/CSS). My campaign edits to
  those two files are purely additive (a CampaignTv import+switch branch; an
  appended `[data-theme="campaign"]` + campaign component CSS block). At merge
  time, take MASTER's version of the audio-mixer/slider code and re-apply
  those two additive campaign hunks on top. Everything else on campaign is new
  files or non-overlapping edits.

- **2026-07-03** — PHASE 3 COMPLETE (task #29). Rules engine, all server-side,
  fully sim-verified. `server/src/modules/campaign/heroes.ts` (extracted from
  index.ts to break a circular dep — classes now carry `weaponDmg`) +
  `combat.ts` (the engine). Implemented: skill checks (`skillCheck`, d20+stat
  vs DC bands easy8/tricky12/hard16/heroic20, nat1/nat20 override — exported
  for phase 4 scenes); zone combat over `[enemy_back, enemy_front, party_front,
  party_back]` + HIDDEN, positions never referenced finer than a zone (grid-
  ready contract); initiative (d20+CUNNING heroes / d20+2 enemies), fixed order,
  round tracking; turns = optional 1-zone move + one action (Attack d20+signature
  stat vs enemy DEF, flat weaponDmg, nat20 doubles / Ability / Help +2 / Defend
  +3 DEF, the auto-action on the 40s turn-timer so nothing stalls); all 12 class
  abilities with cooldowns (big_swing, anger, intervene, shield_wall, vanish,
  backstab, firebolt, fireball w/ friendly-fire-on-fumble, brew heal, hex,
  inspire, limerick); enemy templates minion/bruiser/caster/lurker/boss scaled
  by party size+level with per-kind targeting behavior (bruiser→front,
  caster→back, lurker→HIDDEN, boss→lowest HP); downed at 0 HP (skipped, revivable
  later), TPK→"lost", clear→"won". Combat decoupled from flow via
  `setEncounterEndHandler` (module drops to an "aftermath" beat on end).
  Module wiring: onAction `combat_action`→heroAction, onTimer `combat_turn`→
  auto-defend, publicState/privateState expose combat views (`combatPublic/
  combatPrivate`) for the phase-5 UI. `demoEncounter(room)` = a scaled starter
  fight the sim triggers (NOT auto-wired into flow — briefing is still the live
  terminal until phase 4 chapters call startEncounter). VERIFIED: `npm run sim
  campaign` forges→persists→resumes→runs a FULL combat to a terminal every run
  (~3:2 win:loss for bot-piloted healer-less parties — competitive, not broken;
  real balance tuning is a phase-8 concern). All other sims green; server
  typecheck + client build clean. No client combat UI yet (phase 5) — the
  engine is complete and headless-tested. Next: phase 4 (chapters) or phase 5
  (combat UI) or the auth slice (#35).

- **2026-07-03** — PHASE 4 COMPLETE (task #30). Intent-driven chapter director,
  the digital-table loop, validated on BOTH MockDirector AND real Gemini.
  `server/src/modules/campaign/chapter.ts`. Flow: beginChapter → (recap if
  chapterNum>0) → chapter_outline (authoring, OUTLINE_SCHEMA) → scene_intro →
  [THE INTERPRETER LOOP] + party fork → climax combat (phase-3) → camp (milestone
  level-up: +1 lvl, +1 signature stat, +2 maxHp, full heal on a win; fail-forward
  on a loss) → chapter_end (log compaction) → briefing. THE INTERPRETER LOOP is a
  TWO-beat design that keeps the engine authoritative: `declare_interpret`
  (INTERPRET_SCHEMA → {interpretedAs, stat, difficulty, plausible}; the Director
  may NOT decide success) → engine `skillCheck()` rolls → `declare_narrate`
  narrates the ENGINE's verdict. plausible:false → DM rules it out in character.
  Campaign log (chapters[] summaries + openThreads + choices) compacted at
  chapter end, persisted to campaigns.campaign_log + chapterNum, and fed into
  buildContext so later chapters (and the recap beat) build on it. New actions:
  begin_chapter (host), declare {text}, fork_vote {option}, advance_scene (host).
  ENGINE FIX (helps real gameplay too): `Room.composing` flag set at runBeat
  entry (before the Director call returns and sets `pending`) → callers can tell
  the host is busy DURING the in-flight API call, not just after. Without it, a
  fast actor (or the sim under real latency) fires into the compose window and
  supersedes the beat. VERIFIED: `npm run sim campaign` plays forge→persist→
  resume→FULL chapter (declaration + fork + climax + camp + level-up)→2nd chapter
  that recaps chapter 1, chapterNum+log+levels persisted; AND `DIRECTOR=gemini
  npm run sim campaign` ran a real-Gemini chapter (both new schemas produce valid
  structured output; Director authored "The Spooning of Destiny" riffing on a
  hero's cursed spoon). All other sims green; typecheck + client build clean.
  NO client UI for scenes/chapters yet (phase 5) — engine + Director loop complete
  and dual-validated headless. Next: phase 5 (combat + tactile phone UI), or #35 auth.

- **2026-07-03** — PHASE 5 (task #31): TV + phone campaign UI, LIVE-VERIFIED
  against real Gemini. `client/src/phone/CampaignPhone.tsx` rebuilt: phase-aware —
  forge (phase 2) / SCENE (free-text "what do you do?" textarea → declare + fork
  chips + mini-sheet) / COMBAT (tap actions: move chips, attack targets, ability
  buttons w/ cooldown state, help, defend; downed spectator) / briefing (host
  "Begin the chapter" button) / always the character sheet. `client/src/tv/
  CampaignTv.tsx` rebuilt: Roster (forge/briefing) / SceneStage (title + check-
  result banner + fork tally + party strip) / CombatStrip (zone columns
  enemy_back|enemy_front | party_front|party_back + hidden, hero/enemy tokens
  w/ HP bars, active-hero gold outline, downed dim, combat-log tail, round).
  Campaign CSS appended to styles.css. Fixed: TV lobby no longer offers module-
  switching for campaign rooms (and campaign is filtered out of other rooms'
  switch targets). Dev util `server/scripts/mkcampaign.mjs` (create+forge+drive,
  like mkroom). LIVE PROOF (dev server + real Gemini + Neon, screenshots taken):
  lobby roster → forge → SCENE STAGE with the Interpreter loop working ("Ada
  tried to [search for a weak plank] — success 15 vs 12", DM narrated it) →
  COMBAT STRIP ("The Spoon Tax": Tax Collector Greg + Bureaucratic Guard vs the
  party in zones, HP bars, active outline, log "…hits Ada for 6 (8/14)", turn
  timer). Phone components are build-verified + shape-matched to the server
  views + sim-verified action kinds; a two-client phone screenshot is left to
  phase 8. typecheck + client build + all sims green. STILL DEFERRED (noted for
  a phase-5.1/later): the tactile objects from §5.4 — standalone dice roller,
  tap-item-to-use/reference, scene map — the playable core (text + combat +
  fork + sheet) shipped; those are enrichment. Campaign remains unreachable on
  master. Next: phase 6 (art), 7 (snapshots), 8 (live+merge), or #35 auth.

- **2026-07-03** — PHASE 7 COMPLETE (task #33). Snapshots + redeploy resume —
  the "room not found" fix, scoped to campaigns. `chapter.ts saveScene(room,
  phase)` serializes { phase, chapter (ChapterState), heroes (live hero objects
  keyed by playerKey), round } to the snapshots table. Snapshot points:
  openScene ("scene" — the resume target) and chapter_end ("briefing" — which
  overwrites/invalidates the stale scene snapshot so a finished chapter resumes
  to the lobby, not a replayed scene). DELIBERATELY not snapshotting mid-combat:
  combat state is keyed by the in-memory playerId, which changes on a fresh
  room, so a redeploy during combat (or the brief camp window) resumes at the
  SCENE and replays the short encounter — correct, zero lost progress. Resume:
  `index.ts tryResume()` runs in setup() BEFORE the normal briefing/forge path;
  if the latest snapshot's phase is "scene", it overlays the snapshot's live
  hero HP/level onto the roster, restores room.state.chapter (clearing stale
  playerId-keyed fork votes), setPhase("scene"), and re-fires scene_intro to
  re-set the scene for returning players. Reconnect is by player_key (phase 2).
  VERIFIED: `npm run sim campaign` — reach a scene, wound a hero to 5 HP,
  saveScene, DESTROY the room ("server dies"), spin up a fresh room on the same
  campaignId → resumes into the same chapter ("The Rusted Crown") with the
  wounded hero still at 5 HP. All other sims green; typecheck + client build
  clean. This pattern can later wrap the other 3 modules' rooms (noted, not
  built). Next: phase 6 (art), phase 8 (live + safe master merge), or #35 auth.

- **2026-07-04** — PHASE 6 (task #32): Artist adapter + tagged asset library,
  live-validated. New third pluggable brain `server/src/artist/`: `Artist`
  interface + `GeminiArtist` (gemini-3.1-flash-lite-image via generateContent
  responseModalities:["IMAGE"], model fallback chain, returns null on any
  failure) + `NullArtist` (sim/keyless). `ARTIST=gemini|none` (default gemini
  when a key is present). `getOrCreateAsset(storage, artist, spec)` = the
  library: LOOK UP BY TAGS FIRST (hit = free/instant/identical), generate+store
  on a miss, null → stock art. Wired through Room.artist / RoomManager / boot
  (log now shows `artist=`). Storage gained `getAsset(id)`; new HTTP route
  `GET /asset/:id` serves image bytes from Postgres (immutable cache). FIRST
  integration = HERO PORTRAITS (priority 1, persists = retention): after forge,
  `generatePortraits()` fires per hero (non-blocking, broadcasts as each lands
  so stock class art swaps to the real face mid-lobby), tagged
  [cls, sex, pk:<playerKey>] so it's UNIQUE per hero AND a cache hit on resume;
  stored on Hero.portraitAssetId + the characters row (survives chapter-end +
  resume — fixed two upserts that were writing null). Client: `heroPortrait()`
  → /asset/:id when present else stock; used in CampaignTv (roster/scene/combat
  tokens) + CampaignPhone (sheets). VALIDATED live (throwaway probe, deleted):
  GeminiArtist generated a valid 756KB JPEG portrait in 3.3s, and a second call
  with identical tags was a CACHE HIT (same id, 0ms, times_used incremented).
  Sim green (NullArtist → portraits skipped, stock art untouched); typecheck +
  client build clean. DEFERRED (phase 6.1): scene/boss/item art generation (the
  adapter + library + endpoint all support it — just add getOrCreateAsset calls
  in applyOutline/startEncounter + push an assetId to the TV to crossfade); a
  live portrait-on-TV screenshot (dev server was down) → phase 8. Master
  untouched. Remaining: phase 8 (live + safe merge), #35 auth.

## 8. Open questions (to settle before/while building)

- **Name**: "Chaos Campaign"? "Deep Run"? Something else — it's on the hub.
- **Party size floor**: 2 players OK, or require 3+?
- **Late joiners**: can a new player join an in-progress campaign with a
  fresh level-matched hero? (Proposal: yes, at any chapter start.)
- **Absent players**: hero "stays at camp" (skipped, safe) or bot-controlled?
  (Proposal: stays at camp — bots rolling a friend's hero feels bad.)
- **Chapter count**: open-ended, or campaigns with a designed arc (e.g.
  5 chapters then a finale + retirement to a hall of fame)?
- **Content rating knob**: campaigns invite darker stakes than party modes —
  keep the same comedic register, or add a tone setting?

## 9. Build log (handoff state — keep this current)

> Each agent working on this module appends dated entries here: what was
> built, what was verified and how, and what's next. Task list in the
> session tracker mirrors the phases.

- **2026-07-03** — Design complete (this doc). Decisions locked: own
  module, zones-now/grid-later, multi-session chapters, middle crunch,
  Neon DB now, Artist adapter + tagged asset library. Open questions in §8
  unanswered. Build starting: `campaign` branch created; phase 1 (storage
  layer) in progress. Nothing merged to master yet.
- **2026-07-03** — PHASE 1 COMPLETE (task #27). Neon project `chaosgames`
  created (project_id `jolly-hall-24115322`, org "Ajay", db `neondb`) via
  the Neon MCP. Schema applied (6 tables: players, campaigns, characters,
  assets, snapshots, schema_version). Files added:
  `server/src/storage/{types,memory,postgres,index}.ts` + `schema.sql`,
  `server/scripts/migrate.mjs`, `server/.env.example`. `Storage` interface
  with two backends selected by env (`STORAGE=postgres|memory`, default
  postgres when `DATABASE_URL` set). `createStorage()` wired into
  `index.ts` boot (awaits `init()`; a DB failure logs + degrades, never
  crashes the live party modules); threaded into `RoomManager` as an
  optional 4th ctor arg (unused by existing modules). Verified: full
  Storage-contract round-trip passed IDENTICALLY on memory + real Neon
  (throwaway script, deleted); `npm run typecheck -w server` clean;
  `npm run sim` all green (memory fallback); boot logs `storage=postgres`
  from server dir and `storage=memory` (graceful) without DATABASE_URL.
  `DATABASE_URL` is in `server/.env` (gitignored). NOTE for next agent:
  memory backend preserves Buffer for `assets.image` (structuredClone
  would downgrade to Uint8Array) so both backends yield identical types.
  NEON GOTCHA: MCP `run_sql` runs ONE statement only ("cannot insert
  multiple commands into a prepared statement") — use migrate.mjs (pg
  simple-query) for multi-statement DDL. Next: phase 2 (task #28).
