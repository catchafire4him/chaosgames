// Consistency check: synthesize three lines with DIFFERENT mood tags using the
// same voiceStyle anchor, and write them as .wav files you can listen to.
// Run from server/:  node scripts/tts-consistency.mjs
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";
const VOICE = process.env.GEMINI_TTS_VOICE ?? "Charon";

const CHARACTER =
  `"Grimtongue", an ancient dungeon master: deep, gravelly, resonant, movie-trailer gravitas at a ` +
  `steady rolling pace — grand and booming but never shouty, with dry amusement underneath`;

const LINES = [
  ["deadpan", "The party enters the foyer. It smells aggressively of mushrooms."],
  ["gleeful", "A natural twenty! I haven't seen luck like that since the great dice fire."],
  ["ominous", "Something ancient stirs beneath the floorboards. It has heard your bickering."],
];

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

for (const [mood, text] of LINES) {
  const styled =
    `You are ${CHARACTER}. Keep the EXACT same voice, pitch, pace and character on every line — ` +
    `do not become a different narrator. Read the following line with a subtle ${mood} inflection, ` +
    `staying fully in your usual voice: ${text}`;
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ parts: [{ text: styled }] }],
    config: {
      responseModalities: ["AUDIO"],
      temperature: 0.6,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    },
  });
  const data = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (!data) { console.error(`FAIL: no audio for ${mood}`); process.exit(1); }
  const file = `tts-${mood}.wav`;
  writeFileSync(file, wav(Buffer.from(data, "base64")));
  console.log(`wrote ${file}`);
  await new Promise((r) => setTimeout(r, 7000)); // stay under free-tier RPM
}
console.log("done — listen to the three files back to back");
