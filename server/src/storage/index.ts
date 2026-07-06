import { MemoryStorage } from "./memory.js";
import { PostgresStorage } from "./postgres.js";
import type { Storage } from "./types.js";

export * from "./types.js";
export { MemoryStorage } from "./memory.js";
export { PostgresStorage } from "./postgres.js";

/**
 * Pick a Storage backend from the environment, mirroring the director/speaker
 * selection in index.ts:
 *   STORAGE=postgres|memory  (default: postgres when DATABASE_URL is set, else memory)
 * The sim and keyless/dbless boots always get memory.
 */
export function createStorage(): Storage {
  const url = process.env.DATABASE_URL;
  const kind = process.env.STORAGE ?? (url ? "postgres" : "memory");
  if (kind === "postgres") {
    if (!url) {
      console.warn("[storage] STORAGE=postgres but DATABASE_URL is unset — falling back to memory");
      return new MemoryStorage();
    }
    return new PostgresStorage(url);
  }
  return new MemoryStorage();
}
