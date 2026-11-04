/**
 * Compound alert rules for the HQ alerts panel. Pure logic (no DOM, no
 * network, no storage) so it is unit-testable under node.
 *
 * A rule joins one to four clauses with ALL or ANY. Each clause compares one
 * live metric (a coin price, a perp funding rate, or Ethereum gas) against a
 * threshold.
 */

export type Metric = 'price' | 'funding' | 'gas';
export type Operator = 'above' | 'below';
export type Join = 'all' | 'any';

export interface Clause {
  metric: Metric;
  /** Asset symbol for price and funding. Unused for gas (Ethereum). */
  symbol: string;
  op: Operator;
  value: number;
}

export interface AlertRule {
  id: string;
  name: string;
  join: Join;
  clauses: Clause[];
  enabled: boolean;
  triggered: boolean;
  /** Opt-in: when the rule fires inside an embedded HQ, hand it to the host's agent as a proposal. */
  handoff: boolean;
  createdAt: string;
}

/** Latest readings, keyed by `${metric}:${SYMBOL}` (gas uses `gas:ETH`). */
export type Readings = Record<string, number | undefined>;

export const MAX_CLAUSES = 4;

export function readingKey(metric: Metric, symbol: string): string {
  return metric === 'gas' ? 'gas:ETH' : `${metric}:${symbol.trim().toUpperCase()}`;
}

export function evaluateClause(clause: Clause, readings: Readings): boolean | null {
  const v = readings[readingKey(clause.metric, clause.symbol)];
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return clause.op === 'above' ? v >= clause.value : v <= clause.value;
}

/**
 * Evaluate a rule. Returns null when the outcome cannot be decided yet: for
 * ALL, any missing reading blocks (and a false clause decides false); for ANY,
 * a true clause decides true even if others are unknown.
 */
export function evaluateRule(rule: AlertRule, readings: Readings): boolean | null {
  const results = rule.clauses.map((c) => evaluateClause(c, readings));
  if (rule.join === 'any') {
    if (results.some((r) => r === true)) return true;
    return results.every((r) => r === false) ? false : null;
  }
  if (results.some((r) => r === false)) return false;
  return results.every((r) => r === true) ? true : null;
}

export function validateClause(c: unknown): Clause | null {
  if (typeof c !== 'object' || c === null) return null;
  const r = c as Record<string, unknown>;
  if (r.metric !== 'price' && r.metric !== 'funding' && r.metric !== 'gas') return null;
  if (r.op !== 'above' && r.op !== 'below') return null;
  const value = typeof r.value === 'number' ? r.value : Number.NaN;
  if (!Number.isFinite(value)) return null;
  if ((r.metric === 'price' || r.metric === 'gas') && value <= 0) return null;
  const symbol = typeof r.symbol === 'string' ? r.symbol.trim().toUpperCase().slice(0, 16) : '';
  if (r.metric !== 'gas' && !/^[A-Z0-9]{1,16}$/.test(symbol)) return null;
  return { metric: r.metric, symbol: r.metric === 'gas' ? 'ETH' : symbol, op: r.op, value };
}

export function describeClause(c: Clause): string {
  const cmp = c.op === 'above' ? '>=' : '<=';
  if (c.metric === 'gas') return `ETH gas ${cmp} ${c.value} gwei`;
  if (c.metric === 'funding') return `${c.symbol} funding ${cmp} ${c.value}%`;
  return `${c.symbol} price ${cmp} $${c.value}`;
}

export function describeRule(rule: AlertRule): string {
  const joiner = rule.join === 'all' ? ' AND ' : ' OR ';
  return rule.clauses.map(describeClause).join(joiner);
}

export function validateRule(raw: unknown, makeId: () => string, now: () => string): AlertRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.clauses) || r.clauses.length === 0 || r.clauses.length > MAX_CLAUSES) return null;
  const clauses: Clause[] = [];
  for (const c of r.clauses) {
    const ok = validateClause(c);
    if (!ok) return null;
    clauses.push(ok);
  }
  return {
    id: typeof r.id === 'string' && r.id ? r.id : makeId(),
    name: typeof r.name === 'string' ? r.name.trim().slice(0, 60) : '',
    join: r.join === 'any' ? 'any' : 'all',
    clauses,
    enabled: r.enabled !== false,
    triggered: r.triggered === true,
    handoff: r.handoff === true,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now(),
  };
}

/** Which live feeds a set of rules needs, so the panel only fetches what it uses. */
export function neededFeeds(rules: AlertRule[]): { prices: string[]; funding: boolean; gas: boolean } {
  const prices = new Set<string>();
  let funding = false;
  let gas = false;
  for (const rule of rules) {
    if (!rule.enabled || rule.triggered) continue;
    for (const c of rule.clauses) {
      if (c.metric === 'price') prices.add(c.symbol);
      else if (c.metric === 'funding') funding = true;
      else gas = true;
    }
  }
  return { prices: [...prices], funding, gas };
}

/**
 * Migrate the legacy single-condition alerts ({symbol, targetPrice, condition})
 * to one-clause rules. Malformed entries are dropped, never guessed at.
 */
export function migrateLegacyAlerts(raw: unknown, makeId: () => string, now: () => string): AlertRule[] {
  if (!Array.isArray(raw)) return [];
  const out: AlertRule[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as Record<string, unknown>;
    const rule = validateRule(
      {
        id: typeof a.id === 'string' ? a.id : undefined,
        name: '',
        join: 'all',
        clauses: [{ metric: 'price', symbol: a.symbol, op: a.condition, value: a.targetPrice }],
        enabled: a.enabled !== false,
        triggered: a.triggered === true,
        handoff: false,
        createdAt: typeof a.createdAt === 'string' ? a.createdAt : undefined,
      },
      makeId,
      now,
    );
    if (rule) out.push(rule);
  }
  return out;
}

/** Map a fired rule to an autopilot proposal. Only reversible kinds are produced. */
export function proposalForRule(rule: AlertRule): { kind: 'briefing'; params: { summary: string; cadence: 'once'; topic: string }; context: string } {
  const what = describeRule(rule);
  const label = rule.name ? `${rule.name}: ` : '';
  return {
    kind: 'briefing',
    params: { summary: `${label}HQ alert fired (${what}). Review the market and tell me what to do.`.slice(0, 300), cadence: 'once', topic: what.slice(0, 200) },
    context: `HQ alert rule fired: ${what}.`,
  };
}
