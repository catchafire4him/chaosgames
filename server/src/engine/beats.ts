import type { NarrationLine } from "../../../shared/src/index.js";
import type { DirectorJob, DirectorResult } from "../director/types.js";
import { rid, type Room } from "./room.js";
import type { Beat, HostTool } from "./types.js";

/** Tracks narration lines awaiting TV playback acks for one beat. */
export interface PendingNarration {
  beatId: string;
  remaining: Set<string>;
  done(lineId: string): void;
  /** force-complete now (skip button / new urgent beat) */
  skip(): void;
  /** abandon without running the continuation (room reset) */
  cancel(): void;
}

/** Stage tools every module gets for free. */
export function defaultTools(): HostTool[] {
  return [
    {
      name: "trigger_sfx",
      description: "Play a sound effect on the big screen at the start of your narration.",
      parameters: {
        type: "object",
        properties: {
          sound: {
            type: "string",
            enum: ["thunder", "sting", "bell", "heartbeat", "crowd_gasp", "victory"],
          },
        },
        required: ["sound"],
      },
      handle: (room, args) => {
        if (typeof args.sound === "string") room.sfx(args.sound);
      },
    },
    {
      name: "send_private_message",
      description:
        "Whisper a short secret message to ONE player's phone. Use sparingly for drama or hints.",
      parameters: {
        type: "object",
        properties: {
          playerId: { type: "string" },
          text: { type: "string" },
        },
        required: ["playerId", "text"],
      },
      handle: (room, args) => {
        if (typeof args.playerId === "string" && typeof args.text === "string") {
          room.whisper(args.playerId, args.text.slice(0, 300));
        }
      },
    },
    {
      name: "spotlight_player",
      description:
        "Visually highlight one player on the big screen while you talk about them. Pass an empty playerId to clear.",
      parameters: {
        type: "object",
        properties: { playerId: { type: "string" } },
        required: ["playerId"],
      },
      handle: (room, args) => {
        for (const p of room.players.values()) {
          p.spotlight = p.id === args.playerId;
        }
        room.broadcast();
      },
    },
  ];
}

/** strip artifacts a model might emit that shouldn't be spoken */
function sanitizeLine(text: string): string {
  return text
    .replace(/\[[^\]]{0,40}\]/g, "") // [SYSTEM]-style bracketed markers
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 400);
}

const MAX_LINES = 8;
/** generous per-line playback allowance before the safety timeout fires */
const LINE_TIMEOUT_MS = 20_000;
/** beats with this many lines or more are voiced by ONE TTS request
 *  (quota relief + a single continuous performance, zero mid-beat drift) */
const TTS_BATCH_MIN = 3;

/** stream one line's audio to the TV as the TTS produces it.
 *  `live` lets the (quota-paced) TTS queue skip this job if the beat has
 *  been superseded by the time it reaches the front. */
function synthLine(room: Room, line: NarrationLine, live: () => boolean): void {
  void room.speaker
    .synth(
      line.text,
      line.mood,
      (pcm) => room.sendTv({ type: "narration_audio", lineId: line.id, pcm }),
      room.module.voiceStyle,
      live,
    )
    .then((ok) => room.sendTv({ type: "narration_audio_end", lineId: line.id, ok }))
    .catch(() => room.sendTv({ type: "narration_audio_end", lineId: line.id, ok: false }));
}

/** batch several lines into ONE TTS request (quota relief + one continuous
 *  performance); the audio streams under the leader's id and the TV advances
 *  the follower captions on an estimated schedule */
function synthBatch(room: Room, batch: NarrationLine[], live: () => boolean): void {
  const leader = batch[0];
  const fullText = batch.map((l) => l.text).join(" ");
  void room.speaker
    .synth(
      fullText,
      leader.mood,
      (pcm) => room.sendTv({ type: "narration_audio", lineId: leader.id, pcm }),
      room.module.voiceStyle,
      live,
    )
    .then((ok) => {
      // ok=false → every line falls back to browser TTS individually
      for (const line of batch) room.sendTv({ type: "narration_audio_end", lineId: line.id, ok });
    })
    .catch(() => {
      for (const line of batch) room.sendTv({ type: "narration_audio_end", lineId: line.id, ok: false });
    });
}

export async function runBeat(room: Room, beat: Beat, waited = 0): Promise<void> {
  // Interjections (ghost last words, ...) must NOT supersede a story beat —
  // cancelling it would drop its after() continuation and strand the game.
  // Wait for the stage to free up (up to ~20s), then perform; else drop.
  if (beat.interject && (room.pending || room.composing)) {
    if (waited < 20_000) {
      setTimeout(() => {
        void runBeat(room, beat, waited + 1000).catch(() => {});
      }, 1000);
    } else {
      console.warn(`[room:${room.code}] interjection "${beat.id}" dropped — stage never freed`);
    }
    return;
  }

  // A new beat supersedes any beat still composing or on stage.
  if (room.pending) {
    console.warn(
      `[room:${room.code}] beat "${beat.id}" superseded pending "${room.pending.beatId}"`,
    );
    room.pending.cancel();
    room.pending = null;
  }

  // Show "the host is composing…" while the Director call is in flight.
  room.composing = true;
  room.sendTv({ type: "host_thinking", on: true });

  // No TV connected (headless sim / everyone navigated away): don't wait on acks.
  const headless = room.tvSockets.size === 0;

  // Urgent beats soft-flush the previous beat's queued narration — but only
  // right before OUR first line lands, so the old beat keeps playing (and
  // acking) through the compose gap instead of leaving dead air.
  let flushed = false;
  const flushIfUrgent = () => {
    if (flushed || !beat.urgent || headless) return;
    flushed = true;
    room.sendTv({ type: "narration_clear" });
  };

  // ── Narration lifecycle ─────────────────────────────────────────────────
  // The pending tracker exists for the WHOLE beat — from the Director call
  // through playback — so early streamed lines can be acked (or the beat
  // cleanly cancelled) even while the rest of the response is generating.
  const lines: NarrationLine[] = []; // everything dispatched to the TV, in order
  const remaining = new Set<string>();
  let sealed = false; // all lines are known; finish when acks drain
  let finished = false;
  let cancelled = false;
  let safety: NodeJS.Timeout | null = null;

  const finish = () => {
    if (finished) return;
    finished = true;
    if (safety) clearTimeout(safety);
    room.composing = false;
    if (room.pending === pending) room.pending = null;
    try {
      beat.after?.(room);
    } catch (err) {
      console.error(`[room:${room.code}] beat "${beat.id}" after() crashed:`, err);
    }
  };
  const seal = () => {
    sealed = true;
    if (!remaining.size) return finish();
    safety = setTimeout(finish, headless ? 50 : Math.max(1, lines.length) * LINE_TIMEOUT_MS);
  };

  const pending: PendingNarration = {
    beatId: beat.id,
    remaining,
    done(lineId: string) {
      remaining.delete(lineId);
      if (sealed && !remaining.size) finish();
    },
    skip() {
      // only once playback started — skipping mid-compose would advance the
      // story before authored data (scenario, clues, ...) exists
      if (sealed) finish();
    },
    cancel() {
      cancelled = true;
      finished = true;
      if (safety) clearTimeout(safety);
      room.composing = false;
    },
  };
  room.pending = pending;

  const tools = [...defaultTools(), ...(beat.tools ?? [])];
  const job: DirectorJob = {
    roomId: room.id,
    beatId: beat.id,
    persona: room.module.persona,
    context: room.module.buildContext(room) + room.memoryContext(),
    instruction: beat.instruction,
    tools: tools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    schema: beat.schema,
    fallbackLines: room.module.canned(beat.id, room),
    fallbackData: room.module.cannedData?.(beat.id, room),
    // STREAMING: put the first line on stage the moment the model authors it,
    // while the rest of the response (and any authored data) still generates.
    onLine: headless
      ? undefined
      : (l) => {
          if (cancelled || finished || lines.length) return; // first line only
          const text = sanitizeLine(l.text);
          if (!text) return;
          const line: NarrationLine = { id: rid("ln"), text, mood: l.mood };
          lines.push(line);
          remaining.add(line.id);
          flushIfUrgent();
          room.sendTv({ type: "host_thinking", on: false }); // the host is speaking
          room.sendTv({ type: "narration", line });
          synthLine(room, line, () => !cancelled);
        },
  };

  let result: DirectorResult;
  try {
    result = await room.director.perform(job);
    if (cancelled) return;
    if (!result.lines.length && !lines.length) throw new Error("director returned no lines");
  } catch (err) {
    if (cancelled) return;
    if (lines.length) {
      // the first line already played — don't bolt canned lines onto it
      console.warn(
        `[room:${room.code}] director failed on "${beat.id}" after the first line was staged:`,
        (err as Error).message,
      );
      result = { lines: [], calls: [], data: undefined };
    } else {
      console.warn(
        `[room:${room.code}] director failed on "${beat.id}" — using canned lines:`,
        (err as Error).message,
      );
      result = { lines: job.fallbackLines, calls: [], data: undefined };
    }
  }

  // Authored content (scenario, clues, ...) — module validates; canned fallback.
  if (beat.schema && beat.onAuthored) {
    try {
      beat.onAuthored(room, result.data ?? job.fallbackData);
    } catch (err) {
      console.warn(
        `[room:${room.code}] authored data rejected on "${beat.id}" — using canned:`,
        (err as Error).message,
      );
      beat.onAuthored(room, job.fallbackData);
    }
  }

  // Stage tool calls — validated against this beat's whitelist.
  for (const call of result.calls ?? []) {
    const tool = tools.find((t) => t.name === call.name);
    if (!tool) continue;
    try {
      tool.handle(room, call.args);
    } catch (err) {
      console.warn(`[room:${room.code}] tool ${call.name} failed:`, err);
    }
  }

  // Lines not yet on stage — the streamed first line stands in for the
  // model's first line, so the rest of the response starts after it.
  const early = lines.length;
  const rest: NarrationLine[] = result.lines
    .slice(early, MAX_LINES)
    .flatMap((l) => {
      const text = sanitizeLine(l.text);
      return text ? [{ id: rid("ln"), text, mood: l.mood }] : [];
    });
  lines.push(...rest);
  for (const line of rest) remaining.add(line.id);

  room.sendTv({ type: "host_thinking", on: false });
  room.remember(beat.id, lines.map((l) => l.text).join(" "));

  if (!headless && rest.length) {
    flushIfUrgent();
    // Batch the remainder into one TTS request when it's long enough (quota:
    // TTS preview models allow ~10 req/min, shared across rooms); otherwise
    // stream each line's audio individually.
    const live = () => !cancelled;
    const batched = rest.length >= (early ? 2 : TTS_BATCH_MIN);
    if (batched) {
      const leader = rest[0];
      for (const line of rest) {
        room.sendTv({
          type: "narration",
          line: line === leader ? line : { ...line, audioFrom: leader.id },
        });
      }
      synthBatch(room, rest, live);
    } else {
      // announce all lines up front (the TV buffers + plays strictly in
      // order), then stream each line's audio as the TTS produces it
      for (const line of rest) room.sendTv({ type: "narration", line });
      for (const line of rest) synthLine(room, line, live);
    }
  }
  room.broadcast();
  seal();
}
