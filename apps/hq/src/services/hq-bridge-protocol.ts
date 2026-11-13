/**
 * Typed request/response contract for the HQ bridge data commands.
 * Pure (no DOM, no globals) so it can be unit-tested under node.
 *
 * Host -> HQ:  host:get-panel-data {id, key}
 *              host:run-query {id, tool, args?} | {id, question}
 *              host:get-portfolio-risk {id, positions} | {id, address, chain?}
 * HQ -> host:  hq:panel-data {id, key, data}
 *              hq:query-result {id, result}
 *              hq:error {id, code, message}
 *
 * `id` correlates a reply with its request. Payloads are validated before any
 * work happens; nothing here can move funds.
 */

export type DataCommandType = 'host:get-panel-data' | 'host:run-query' | 'host:get-portfolio-risk';

export interface PanelDataRequest { id: string; key: string }
export interface QueryRequest { id: string; tool?: string; args?: Record<string, unknown>; question?: string }
export interface Position { symbol: string; usd: number; protocol?: string; chain?: string }
export type PortfolioChain = 'solana' | 'evm' | 'ethereum' | 'base' | 'arbitrum' | 'optimism';
export type PortfolioRiskRequest =
  | { id: string; positions: Position[] }
  | { id: string; address: string; chain?: PortfolioChain };

export type DataErrorCode = 'bad_request' | 'unknown_panel' | 'too_large' | 'upstream_failed' | 'timeout';

export interface DataError { code: DataErrorCode; message: string; id: string | null }

export type Validated<T> = { ok: true; value: T } | { ok: false; error: DataError };

export const MAX_POSITIONS = 50;
export const MAX_RESULT_BYTES = 256 * 1024;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOOL_RE = /^[a-z_]{1,40}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const PORTFOLIO_CHAINS: readonly PortfolioChain[] = ['solana', 'evm', 'ethereum', 'base', 'arbitrum', 'optimism'];

/** The agent-tools args for a validated portfolio request. */
export function portfolioRiskArgs(req: PortfolioRiskRequest): Record<string, unknown> {
  if ('address' in req) return req.chain ? { address: req.address, chain: req.chain } : { address: req.address };
  return { positions: req.positions };
}

export const DATA_COMMANDS: readonly string[] = ['host:get-panel-data', 'host:run-query', 'host:get-portfolio-risk'];

export function isDataCommand(type: string): type is DataCommandType {
  return DATA_COMMANDS.includes(type);
}

function fail(message: string, id: string | null, code: DataErrorCode = 'bad_request'): { ok: false; error: DataError } {
  return { ok: false, error: { code, message, id } };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readId(p: Record<string, unknown>): string | null {
  return typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : null;
}

export function validateDataCommand(type: DataCommandType, payload: unknown): Validated<PanelDataRequest | QueryRequest | PortfolioRiskRequest> {
  if (!isRecord(payload)) return fail('payload must be an object', null);
  const id = readId(payload);
  if (!id) return fail('id must be 1-64 characters of letters, digits, _ . : -', null);

  if (type === 'host:get-panel-data') {
    if (typeof payload.key !== 'string' || !KEY_RE.test(payload.key)) return fail('key must be a panel key', id);
    return { ok: true, value: { id, key: payload.key } };
  }

  if (type === 'host:run-query') {
    const hasTool = typeof payload.tool === 'string';
    const hasQuestion = typeof payload.question === 'string';
    if (hasTool === hasQuestion) return fail('send exactly one of tool or question', id);
    if (hasTool) {
      if (!TOOL_RE.test(payload.tool as string)) return fail('tool name is invalid', id);
      if (payload.args !== undefined && !isRecord(payload.args)) return fail('args must be an object', id);
      return { ok: true, value: { id, tool: payload.tool as string, args: (payload.args as Record<string, unknown>) ?? {} } };
    }
    const q = (payload.question as string).trim();
    if (q.length === 0 || q.length > 500) return fail('question must be 1-500 characters', id);
    return { ok: true, value: { id, question: q } };
  }

  if ((payload.address === undefined) === (payload.positions === undefined)) return fail('send exactly one of address or positions', id);
  if (payload.address !== undefined) {
    const address = typeof payload.address === 'string' ? payload.address.trim() : '';
    if (!SOLANA_ADDRESS_RE.test(address) && !EVM_ADDRESS_RE.test(address)) return fail('address must be a Solana (base58) or EVM (0x) address', id);
    if (payload.chain === undefined) return { ok: true, value: { id, address } };
    if (typeof payload.chain !== 'string' || !(PORTFOLIO_CHAINS as readonly string[]).includes(payload.chain)) {
      return fail(`chain must be one of ${PORTFOLIO_CHAINS.join(', ')}`, id);
    }
    return { ok: true, value: { id, address, chain: payload.chain as PortfolioChain } };
  }
  if (payload.chain !== undefined) return fail('chain only applies with address', id);

  const positions = payload.positions;
  if (!Array.isArray(positions) || positions.length === 0 || positions.length > MAX_POSITIONS) {
    return fail(`positions must be an array of 1-${MAX_POSITIONS} entries`, id);
  }
  const clean: Position[] = [];
  for (const raw of positions) {
    if (!isRecord(raw) || typeof raw.symbol !== 'string' || raw.symbol.trim() === '' || raw.symbol.length > 32) {
      return fail('every position needs a symbol', id);
    }
    if (typeof raw.usd !== 'number' || !Number.isFinite(raw.usd) || raw.usd <= 0) return fail('every position needs usd > 0', id);
    const pos: Position = { symbol: raw.symbol.trim(), usd: raw.usd };
    if (typeof raw.protocol === 'string' && raw.protocol.trim()) pos.protocol = raw.protocol.trim().slice(0, 64);
    if (typeof raw.chain === 'string' && raw.chain.trim()) pos.chain = raw.chain.trim().slice(0, 32);
    clean.push(pos);
  }
  return { ok: true, value: { id, positions: clean } };
}

/** Serialise a result and refuse anything too large to post across the frame. */
export function sizeCheck(value: unknown, id: string): { ok: true } | { ok: false; error: DataError } {
  const bytes = JSON.stringify(value)?.length ?? 0;
  return bytes > MAX_RESULT_BYTES ? fail(`result is ${bytes} bytes, limit ${MAX_RESULT_BYTES}`, id, 'too_large') : { ok: true };
}

export const AGENT_TOOL_TIMEOUT_MS = 20000;

/**
 * POST to HQ's own /api/agent-tools and return the parsed result. A failed
 * body read on a 2xx (the abort signal firing mid-body, a proxy's HTML page,
 * a non-object) rejects, so the bridge answers hq:error instead of posting an
 * empty hq:query-result. A TimeoutError is rethrown as-is for the timeout code.
 */
export async function callAgentTool(
  body: Record<string, unknown>,
  { fetchImpl = fetch, timeoutMs = AGENT_TOOL_TIMEOUT_MS }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<unknown> {
  const res = await fetchImpl('/api/agent-tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(typeof json?.error === 'string' ? json.error : `agent-tools HTTP ${res.status}`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw err;
    throw new Error(`agent-tools returned an unreadable body (HTTP ${res.status})`);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error(`agent-tools returned a non-object body (HTTP ${res.status})`);
  }
  return json;
}
