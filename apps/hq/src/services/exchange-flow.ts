export interface ExchangeFlowEntry {
  symbol: string;
  score: number;           // -100 to +100
  direction: 'INFLOW' | 'OUTFLOW' | 'NEUTRAL';
  label: string;
  signals: Record<string, number | string>;
}

export interface ExchangeFlowSummary {
  inflows: number;
  outflows: number;
  neutral: number;
  avgScore: number;
  marketDirection: string;
}

export interface ExchangeFlowResult {
  timestamp: string;
  flows: ExchangeFlowEntry[];
  summary: ExchangeFlowSummary;
  unavailable?: boolean;
}

export async function fetchExchangeFlow(): Promise<ExchangeFlowResult> {
  const res = await fetch('/api/exchange-flow');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
