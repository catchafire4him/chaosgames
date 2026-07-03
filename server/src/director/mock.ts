import type { Director, DirectorJob, DirectorResult } from "./types.js";

/** Keyless offline Director: performs every beat with the module's canned
 *  lines and canned data. Makes the whole game playable with no API key and
 *  lets the sim harness run full games in seconds. */
export class MockDirector implements Director {
  readonly kind = "mock";

  async perform(job: DirectorJob): Promise<DirectorResult> {
    return {
      lines: job.fallbackLines,
      calls: [],
      data: job.fallbackData,
    };
  }
}
