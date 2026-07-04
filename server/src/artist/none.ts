import type { Artist } from "./types.js";

/** No-op Artist: always null → stock art. Used in the sim and keyless boots. */
export class NullArtist implements Artist {
  readonly kind = "none";
  async generate(): Promise<null> {
    return null;
  }
}
