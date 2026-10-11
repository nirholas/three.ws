import type { ThreeSignalResponse } from '@/types';

/** Solana mint of the $THREE token. */
export const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

export const THREE_SOLSCAN_URL = `https://solscan.io/token/${THREE_MINT}`;

/** three.ws API origin. Override with VITE_THREE_API_ORIGIN. */
export const THREE_API_ORIGIN: string = (
  (import.meta.env.VITE_THREE_API_ORIGIN as string | undefined) || 'https://three.ws'
).replace(/\/+$/, '');

export async function fetchThreeSignal(signal?: AbortSignal): Promise<ThreeSignalResponse> {
  const res = await fetch(`${THREE_API_ORIGIN}/api/three-signal`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`three.ws API returned HTTP ${res.status}`);
  const json = (await res.json()) as Partial<ThreeSignalResponse>;
  return {
    latest: json.latest ?? null,
    history: Array.isArray(json.history) ? json.history : [],
    stale: Boolean(json.stale),
    age_seconds: typeof json.age_seconds === 'number' ? json.age_seconds : null,
  };
}
