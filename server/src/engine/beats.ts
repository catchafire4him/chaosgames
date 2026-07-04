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

export async function runBeat(room: Room, beat: Beat): Promise<void> {
  // A new beat supersedes any narration still on stage.
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
  };

  let result: DirectorResult;
  try {
    result = await room.director.perform(job);
    if (!result.lines.length) throw new Error("director returned no lines");
  } catch (err) {
    console.warn(
      `[room:${room.code}] director failed on "${beat.id}" — using canned lines:`,
      (err as Error).message,
    );
    result = { lines: job.fallbackLines, calls: [], data: undefined };
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

  const lines: NarrationLine[] = result.lines.slice(0, MAX_LINES).flatMap((l) => {
    const text = sanitizeLine(l.text);
    return text ? [{ id: rid("ln"), text, mood: l.mood }] : [];
  });

  // Soft-flush queued narration (current line finishes; skip button hard-cuts).
  if (beat.urgent) room.sendTv({ type: "narration_clear" });
  room.sendTv({ type: "host_thinking", on: false });

  room.remember(beat.id, lines.map((l) => l.text).join(" "));

  // No TV connected (headless sim / everyone navigated away): don't wait on acks.
  const headless = room.tvSockets.size === 0;

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safety);
    room.composing = false;
    if (room.pending?.beatId === beat.id) room.pending = null;
    try {
      beat.after?.(room);
    } catch (err) {
      console.error(`[room:${room.code}] beat "${beat.id}" after() crashed:`, err);
    }
  };

  const remaining = new Set(lines.map((l) => l.id));
  const safety = setTimeout(
    finish,
    headless ? 50 : Math.max(1, lines.length) * LINE_TIMEOUT_MS,
  );

  room.pending = {
    beatId: beat.id,
    remaining,
    done(lineId: string) {
      remaining.delete(lineId);
      if (!remaining.size) finish();
    },
    skip() {
      finish();
    },
    cancel() {
      finished = true;
      clearTimeout(safety);
      room.composing = false;
    },
  };

  if (!headless) {
    // Announce all lines up front (the TV buffers + plays strictly in order),
    // then STREAM each line's audio as the TTS produces it. Line 2 synthesizes
    // while line 1 plays — no more slowest-synth-first silence.
    for (const line of lines) room.sendTv({ type: "narration", line });
    for (const line of lines) {
      void room.speaker
        .synth(
          line.text,
          line.mood,
          (pcm) => room.sendTv({ type: "narration_audio", lineId: line.id, pcm }),
          room.module.voiceStyle,
        )
        .then((ok) =>
          room.sendTv({ type: "narration_audio_end", lineId: line.id, ok }),
        )
        .catch(() =>
          room.sendTv({ type: "narration_audio_end", lineId: line.id, ok: false }),
        );
    }
  }
  room.broadcast();

  if (!lines.length) finish();
}
