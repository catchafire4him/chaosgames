import { useEffect } from "react";

/** Keep the screen awake during a game (phones dim → feels like a disconnect).
 *  Re-acquires the lock when the tab becomes visible again. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: { release(): Promise<void> } | null = null;
    let disposed = false;

    const acquire = async () => {
      try {
        lock = await (navigator as Navigator & {
          wakeLock: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
        }).wakeLock.request("screen");
      } catch {
        /* low battery / unsupported — not fatal */
      }
    };

    const onVisible = () => {
      if (!disposed && document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
