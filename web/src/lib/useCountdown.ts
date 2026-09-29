import { useEffect, useState } from 'react';

function secondsUntil(target: number | null): number {
  if (target === null || Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

/** Seconds remaining until `expiresAt` (ISO string), updated every second; 0 once expired. */
export function useCountdown(expiresAt: string | null | undefined): number {
  const target = expiresAt === null || expiresAt === undefined ? null : Date.parse(expiresAt);
  const [remaining, setRemaining] = useState<number>(() => secondsUntil(target));

  useEffect(() => {
    setRemaining(secondsUntil(target));
    if (target === null) return;
    const timer = setInterval(() => {
      const next = secondsUntil(target);
      setRemaining(next);
      if (next <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [target]);

  return remaining;
}
