// One-off check that Gemini TTS works with the configured key/voice.
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const res = await ai.models.generateContent({
  model: process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview",
  contents: [{ parts: [{ text: "Say in an eerie tone, as a theatrical game host: Welcome to Grimsby Hollow." }] }],
  config: {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE ?? "Charon" } } },
  },
});
const data = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
if (!data) {
  console.error("TTS FAIL — no audio in response");
  process.exit(1);
}
console.log(`TTS PASS — ${Math.round((data.length * 3) / 4 / 1024)}KB of PCM audio returned`);
