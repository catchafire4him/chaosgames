# Per-module ambient music

Each game mode is wired to look for its own looping ambient track:

| Module      | Expected file                  |
|-------------|---------------------------------|
| Mafia (Conspiracy) | `conspiracy-theme.mp3`          |
| Whodunnit   | `whodunnit-theme.mp3`           |
| Dungeon Run | `dungeon-theme.mp3`             |

**You don't need to generate these before the game works.** If a file is
missing, the TV automatically falls back to the shared `Midnight_Ledger.mp3`
track — this was verified live (dev and production both serve a soft
fallback for missing static files, which the client detects via the audio
element's `error` event and swaps to the shared track). Drop a correctly
named file into this folder any time and it's picked up on the next lobby —
no code changes needed.

Each track should be an **instrumental loop, roughly 60–120 seconds**, mixed
so it sits comfortably under narration (the app auto-ducks music to ~30%
volume while the host is speaking, so don't undersell the full-volume version
— it needs presence during quiet lobby/game-over moments too). Export as MP3.

Below are ready-to-paste prompts for a music-generation tool (e.g. Google's
Lyria/MusicFX, Suno, or similar — paste as-is, no editing needed).

## conspiracy-theme.mp3 — gothic parlor mystery

```
A looping instrumental track for a gothic Victorian social-deduction party
game. Mood: quietly sinister, elegant, suspenseful — like a candlelit parlor
where everyone is lying to each other. Slow, deliberate string ostinato
(cello/violin), a music-box-like celeste motif, distant low piano chords,
occasional soft dissonance. No drums, no vocals, no percussion hits — this
plays continuously under spoken narration, so keep it sparse and unobtrusive
rather than cinematic-loud. Tempo ~70 BPM. Seamless loop, 90 seconds.
```

## whodunnit-theme.mp3 — deco manor noir

```
A looping instrumental track for a 1920s-manor murder-mystery party game.
Mood: arch, theatrical noir-detective elegance — smoky drawing room, brass
lamps, everyone a suspect. Muted jazz-noir instrumentation: soft upright
bass walking line, brushed snare (very light, sparse), a lonely clarinet or
muted trumpet motif, occasional noir piano chord stabs. Restrained and moody,
NOT upbeat swing — this needs to sit quietly under spoken narration.
Tempo ~85 BPM. Seamless loop, 90 seconds.
```

## dungeon-theme.mp3 — comedic fantasy tavern/dungeon

```
A looping instrumental track for a comedic fantasy dungeon-crawl party game.
Mood: playful high-fantasy adventure with a wink — a tavern-band energy, not
epic-orchestral bombast. Lute or mandolin melody, light hand percussion
(frame drum, tambourine), a bouncy low string or bassoon countermelody,
medieval-folk flavor. Energetic but NOT loud or busy — it needs to sit under
spoken narration and comedic dice-roll moments without overpowering them.
Tempo ~110 BPM. Seamless loop, 90 seconds.
```

## After generating

1. Export/download each track as MP3.
2. Save into this folder (`client/public/audio/`) with the **exact filename**
   from the table above.
3. Commit and push — Railway's auto-deploy picks it up on the next build.
