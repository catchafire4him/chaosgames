/**
 * Procedural sound effects — synthesized with WebAudio, so there are zero
 * audio assets to load and everything works offline. Each stinger is a small
 * recipe of oscillators/noise through filters and envelopes.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

let sfxVolume = 0.5;

/** call from a user gesture (the TV's audio gate) */
export function enableSfx(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = sfxVolume;
    master.connect(ctx.destination);
  }
  void ctx.resume();
}

export function setSfxVolume(v: number): void {
  sfxVolume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = sfxVolume;
}

function noiseBuffer(seconds: number): AudioBuffer {
  const buffer = ctx!.createBuffer(1, ctx!.sampleRate * seconds, ctx!.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function env(node: GainNode, t0: number, peak: number, attack: number, decay: number): void {
  node.gain.setValueAtTime(0.0001, t0);
  node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

function thunder(): void {
  const t = ctx!.currentTime;
  const src = ctx!.createBufferSource();
  src.buffer = noiseBuffer(2.6);
  const lp = ctx!.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(60, t + 2.2);
  const g = ctx!.createGain();
  env(g, t, 0.9, 0.02, 2.4);
  src.connect(lp).connect(g).connect(master!);
  src.start(t);
}

function sting(): void {
  const t = ctx!.currentTime;
  for (const [freq, detune] of [[220, 0], [311, 8], [466, -6]] as const) {
    const o = ctx!.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.9);
    o.detune.value = detune;
    const g = ctx!.createGain();
    env(g, t, 0.22, 0.01, 0.9);
    o.connect(g).connect(master!);
    o.start(t);
    o.stop(t + 1.1);
  }
}

function bell(): void {
  const t = ctx!.currentTime;
  for (const [ratio, amp] of [[1, 0.5], [2.76, 0.2], [5.4, 0.09]] as const) {
    const o = ctx!.createOscillator();
    o.type = "sine";
    o.frequency.value = 180 * ratio;
    const g = ctx!.createGain();
    env(g, t, amp, 0.005, 2.6);
    o.connect(g).connect(master!);
    o.start(t);
    o.stop(t + 2.8);
  }
}

function heartbeat(): void {
  for (const delay of [0, 0.28, 1.0, 1.28]) {
    const t = ctx!.currentTime + delay;
    const o = ctx!.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const g = ctx!.createGain();
    env(g, t, 0.8, 0.01, 0.2);
    o.connect(g).connect(master!);
    o.start(t);
    o.stop(t + 0.3);
  }
}

function crowdGasp(): void {
  const t = ctx!.currentTime;
  const src = ctx!.createBufferSource();
  src.buffer = noiseBuffer(1.1);
  const bp = ctx!.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
  bp.frequency.exponentialRampToValueAtTime(700, t + 1.0);
  const g = ctx!.createGain();
  env(g, t, 0.35, 0.25, 0.8);
  src.connect(bp).connect(g).connect(master!);
  src.start(t);
}

function victory(): void {
  const notes = [261.6, 329.6, 392.0, 523.3];
  notes.forEach((freq, i) => {
    const t = ctx!.currentTime + i * 0.13;
    const o = ctx!.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const g = ctx!.createGain();
    env(g, t, 0.3, 0.01, i === notes.length - 1 ? 1.2 : 0.25);
    o.connect(g).connect(master!);
    o.start(t);
    o.stop(t + 1.6);
  });
}

/** dice tumble — used by the Dungeon Run roll animation */
function dice(): void {
  for (let i = 0; i < 7; i++) {
    const t = ctx!.currentTime + i * 0.09 + Math.random() * 0.03;
    const o = ctx!.createOscillator();
    o.type = "square";
    o.frequency.value = 900 + Math.random() * 900;
    const g = ctx!.createGain();
    env(g, t, 0.06, 0.004, 0.05);
    o.connect(g).connect(master!);
    o.start(t);
    o.stop(t + 0.08);
  }
}

const RECIPES: Record<string, () => void> = {
  thunder,
  sting,
  bell,
  heartbeat,
  crowd_gasp: crowdGasp,
  victory,
  dice,
};

export function playSfx(name: string): void {
  if (!ctx || ctx.state !== "running") return;
  try {
    (RECIPES[name] ?? sting)();
  } catch {
    /* never let a stinger break the show */
  }
}
