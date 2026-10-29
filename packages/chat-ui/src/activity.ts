import { useEffect, useState } from "react";

/** Format completed wall-clock seconds since `startedAtMs` as `0s` / `1m 2s`. */
export function formatElapsed(startedAtMs: number, nowMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, nowMs - startedAtMs) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function useElapsed(startedAtMs?: number): string {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return formatElapsed(startedAtMs ?? mountedAt, now);
}
