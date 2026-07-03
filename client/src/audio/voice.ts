import type { NarrationLine } from "@shared/index";

interface LineState {
  line: NarrationLine;
  /** base64 PCM chunks not yet scheduled */
  chunks: string[];
  /** server finished streaming this line's audio */
  ended: boolean;
  /** server produced audio at all (false → browser TTS fallback) */
  ok: boolean;
  /** at least one chunk has been scheduled into the audio graph */
  scheduledAny: boolean;
}

/**
 * TV-side voice engine for STREAMED narration.
 * Lines are announced first; their PCM audio arrives in chunks (possibly out
 * of line order — chunks are buffered per line and lines play strictly in
 * announcement order, gaplessly scheduled via Web Audio). Lines whose synth
 * failed fall back to browser speech synthesis. Calls onLineDone(id) after
 * each line so the server can pace the story to the actual voice.
 */
export class VoiceEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private states = new Map<string, LineState>();
  private queue: LineState[] = [];
  private current: LineState | null = null;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;

  onLineStart: (line: NarrationLine) => void = () => {};
  onLineDone: (id: string) => void = () => {};
  onIdle: () => void = () => {};

  private volume = 1;

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /** must be called from a user gesture (autoplay policy) */
  enable(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 24_000 });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance("");
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  }

  get enabled(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  // ─── Incoming protocol events ───────────────────────────────────────────────

  enqueueLine(line: NarrationLine): void {
    const st: LineState = { line, chunks: [], ended: false, ok: false, scheduledAny: false };
    this.states.set(line.id, st);
    this.queue.push(st);
    this.pump();
  }

  addChunk(lineId: string, pcm: string): void {
    const st = this.states.get(lineId);
    if (!st) return; // line was cleared
    st.chunks.push(pcm);
    if (st === this.current) this.drain();
  }

  endLine(lineId: string, ok: boolean): void {
    const st = this.states.get(lineId);
    if (!st) return;
    st.ended = true;
    st.ok = ok;
    if (st === this.current) this.checkAdvance();
  }

  /** Soft: current line finishes, queued lines drop. Hard: cut everything now. */
  clear(hard = false): void {
    this.queue = [];
    for (const id of [...this.states.keys()]) {
      if (id !== this.current?.line.id) this.states.delete(id);
    }
    if (hard) {
      for (const src of this.activeSources) {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      }
      this.activeSources.clear();
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      if (this.ctx) this.nextStartTime = this.ctx.currentTime;
      if (this.current) this.complete(false);
    }
  }

  // ─── Playback ───────────────────────────────────────────────────────────────

  private pump(): void {
    if (this.current || !this.queue.length) {
      if (!this.current && !this.queue.length) this.onIdle();
      return;
    }
    this.current = this.queue.shift()!;
    if (this.ctx) this.nextStartTime = this.ctx.currentTime;
    this.onLineStart(this.current.line);
    this.drain();
    this.checkAdvance();
  }

  /** schedule any buffered chunks for the current line */
  private drain(): void {
    const st = this.current;
    if (!st || !this.ctx) return;
    while (st.chunks.length) {
      this.schedule(st.chunks.shift()!);
      st.scheduledAny = true;
    }
    this.checkAdvance();
  }

  private schedule(base64: string): void {
    const ctx = this.ctx!;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    if (!int16.length) return;
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    const buffer = ctx.createBuffer(1, float32.length, 24_000);
    buffer.copyToChannel(float32, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain!);
    this.activeSources.add(source);
    source.onended = () => this.activeSources.delete(source);
    const startAt = Math.max(this.nextStartTime, ctx.currentTime + 0.03);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
  }

  /** decide whether the current line is finished (or how to finish it) */
  private checkAdvance(): void {
    const st = this.current;
    if (!st || !st.ended) return;
    if (st.chunks.length) return; // still buffered audio to schedule

    if (st.scheduledAny && this.ctx) {
      // wait for the scheduled audio to actually finish playing
      const remainingMs = Math.max(0, (this.nextStartTime - this.ctx.currentTime) * 1000);
      if (this.advanceTimer) clearTimeout(this.advanceTimer);
      this.advanceTimer = setTimeout(() => {
        this.advanceTimer = null;
        if (this.current === st) this.complete(true);
      }, remainingMs + 80);
      return;
    }

    if (!st.ok) {
      // no audio produced — browser TTS fallback
      void this.speak(st.line.text).then(() => {
        if (this.current === st) this.complete(true);
      });
      return;
    }
    this.complete(true);
  }

  private complete(pumpNext: boolean): void {
    const st = this.current;
    if (!st) return;
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
    this.current = null;
    this.states.delete(st.line.id);
    this.onLineDone(st.line.id);
    if (pumpNext) this.pump();
  }

  private speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.pitch = 0.9;
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
      // safety: some browsers never fire onend
      setTimeout(finish, Math.max(4000, text.length * 90));
    });
  }
}

/** Looping lobby music (starts after the audio-enable gesture).
 *  Ducks under the host's voice so narration always cuts through. */
export class Music {
  private el: HTMLAudioElement | null = null;
  private base = 0.2;
  private ducked = false;

  play(src: string, volume = this.base): void {
    this.base = volume;
    if (this.el?.src.endsWith(src)) {
      this.apply();
      return;
    }
    this.stop();
    this.el = new Audio(src);
    this.el.loop = true;
    this.apply();
    void this.el.play().catch(() => {});
  }

  setVolume(v: number): void {
    this.base = Math.max(0, Math.min(1, v));
    this.apply();
  }

  duck(on: boolean): void {
    this.ducked = on;
    this.apply();
  }

  private apply(): void {
    if (this.el) this.el.volume = this.base * (this.ducked ? 0.3 : 1);
  }

  stop(): void {
    this.el?.pause();
    this.el = null;
  }
}
