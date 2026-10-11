/**
 * Protocol health scores from /api/protocol-health.
 * Composite 0-100 heuristic derived server-side from DeFiLlama data.
 */

export interface ProtocolHealthEntry {
  name: string;
  slug: string;
  logo: string | null;
  category: string;
  chainCount: number;
  topChains: string[];
  tvl: number;
  change1d: number | null;
  change7d: number | null;
  mcap: number | null;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  url: string | null;
}

export interface ProtocolHealthReport {
  timestamp: string;
  count: number;
  categories: string[];
  methodology: string;
  protocols: ProtocolHealthEntry[];
}

export async function fetchProtocolHealth(signal?: AbortSignal): Promise<ProtocolHealthReport> {
  const res = await fetch('/api/protocol-health', { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
