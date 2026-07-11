/** Text-to-speech adapter. Streams base64 24kHz 16-bit mono PCM chunks via
 *  `emit` as they're produced. Returns true if any audio was emitted —
 *  false means "no audio", and the TV speaks the line with browser TTS. */
export interface Speaker {
  readonly kind: string;
  synth(
    text: string,
    mood: string | undefined,
    emit: (pcmBase64: string) => void,
    /** stable voice-character description (per module) — keeps delivery
     *  consistent across otherwise-stateless per-line TTS requests */
    voiceStyle?: string,
    /** Checked when the job reaches the front of the (quota-paced) queue —
     *  return false to skip synthesis entirely. Lets a superseded beat's
     *  stale jobs drain instantly instead of starving live narration. */
    stillWanted?: () => boolean,
  ): Promise<boolean>;
}

export class NullSpeaker implements Speaker {
  readonly kind = "none";
  async synth(): Promise<boolean> {
    return false;
  }
}
