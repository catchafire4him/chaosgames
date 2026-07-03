import type { ModuleId, ModuleInfo } from "../../../shared/src/index.js";
import type { GameModule } from "../engine/types.js";
import { conspiracy } from "./conspiracy/index.js";
import { whodunnit } from "./whodunnit/index.js";
import { dungeon } from "./dungeon/index.js";

/** Add a game mode: implement GameModule in its own folder, register here. */
const MODULES: Record<ModuleId, GameModule> = {
  conspiracy,
  whodunnit,
  dungeon,
};

export function getModule(id: ModuleId): GameModule | undefined {
  return MODULES[id];
}

export function listModules(): ModuleInfo[] {
  return Object.values(MODULES).map(({ id, name, tagline, minPlayers, maxPlayers }) => ({
    id,
    name,
    tagline,
    minPlayers,
    maxPlayers,
  }));
}
