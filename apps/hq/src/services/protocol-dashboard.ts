/** Clients for the protocol dashboard, oracle monitor, risk heatmap and Dune proxy endpoints. */

export interface BlockOk { status: 'ok'; [k: string]: unknown }
export interface BlockUnavailable { status: 'unavailable'; reason: string }
export type Block = BlockOk | BlockUnavailable;

export interface ProtocolDashboard {
  timestamp: string;
  slug: string;
  dashboard: string;
  protocol: { name: string; category: string | null; chains: string[]; logo: string | null; url: string | null; symbol: string | null; listedAt: number | null };
  blockOrder: string[];
  blocks: Record<string, Block>;
  sources: string[];
  methodology: string;
}

export interface PickerProtocol { name: string; slug: string; category: string; tvl: number; solanaTvl: number; chains: string[] }

export interface OracleRow {
  oracle: 'Pyth' | 'Chainlink';
  chain: string;
  symbol: string;
  price: number | null;
  reference: number | null;
  referenceVenues: number;
  deviationBps: number | null;
  updatedAtSec: number | null;
  ageSec: number | null;
  heartbeatSec: number;
  status: 'ok' | 'deviation' | 'stale' | 'unknown';
}
export interface OracleReport {
  timestamp: string;
  thresholdBps: number;
  rows: OracleRow[];
  lanes: Record<string, { status: string; reason?: string }>;
  sources: string[];
  methodology: string;
}

export interface RiskCell { risk: number | null; level: 'low' | 'medium' | 'high' | 'unknown'; reason: string }
export interface RiskRow {
  slug: string; name: string; category: string | null; logo: string | null; tvl: number;
  cells: Record<string, RiskCell>;
  overall: { risk: number | null; level: RiskCell['level']; known: number };
}
export interface RiskReport { timestamp: string; chain: string; dimensions: string[]; rows: RiskRow[]; sources: string[]; methodology: string }

export interface DuneResult {
  enabled: boolean;
  reason?: string;
  error?: string;
  queryId?: string;
  executedAt?: string | null;
  columns?: string[];
  rows?: Record<string, unknown>[];
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as T;
}

export const fetchProtocolDashboard = (slug: string, windowDays: number, signal?: AbortSignal) =>
  getJson<ProtocolDashboard>(`/api/protocol-dashboard?slug=${encodeURIComponent(slug)}&window=${windowDays}`, signal);

export async function fetchPickerProtocols(signal?: AbortSignal): Promise<PickerProtocol[]> {
  const json = await getJson<{ protocols: PickerProtocol[] }>('/api/top-protocols', signal);
  return json.protocols || [];
}

export const fetchOracleDeviation = (thresholdBps: number, signal?: AbortSignal) =>
  getJson<OracleReport>(`/api/oracle-deviation?threshold=${thresholdBps}`, signal);

export const fetchRiskHeatmap = (chain: string, signal?: AbortSignal) =>
  getJson<RiskReport>(`/api/risk-heatmap${chain ? `?chain=${encodeURIComponent(chain)}` : ''}`, signal);

export const fetchDune = (queryId: string | null, signal?: AbortSignal) =>
  getJson<DuneResult>(`/api/dune-query${queryId ? `?id=${encodeURIComponent(queryId)}` : ''}`, signal);
