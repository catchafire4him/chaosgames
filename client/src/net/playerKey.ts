/**
 * Device identity for the player. A UUID minted once and kept in localStorage;
 * it travels with every join so the server can follow this device across
 * sessions — reclaiming your campaign hero after a redeploy, and (later) the
 * anchor an optional account links to. NOT the per-room playerId.
 */
const KEY = "chaos_player_key";

export function playerKey(): string {
  let k = localStorage.getItem(KEY);
  if (!k) {
    k = crypto.randomUUID();
    localStorage.setItem(KEY, k);
  }
  return k;
}
