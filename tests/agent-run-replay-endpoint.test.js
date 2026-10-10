// /api/agent-run-replay: the Runs tab's data source (api/agent-run-replay.js).
// The run library is stubbed at its boundary; receipts and trace pairing run
// for real, so a tampered step is caught exactly as it would be in production.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stepReceipt } from '../api/_lib/agents-v1/run-receipts.js';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ sql: sqlMock, isDbUnavailableError: () => false, isDbCapacityError: () => false }));

const getSessionUserMock = vi.fn();
const authenticateBearerMock = vi.fn();
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: (...a) => getSessionUserMock(...a),
	authenticateBearer: (...a) => authenticateBearerMock(...a),
	extractBearer: () => null,
}));

const requireCsrfMock = vi.fn(async () => true);
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: (...a) => requireCsrfMock(...a) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	clientIp: () => '127.0.0.1',
	limits: { widgetRead: async () => ({ success: true }), authIp: async () => ({ success: true }) },
}));

const { ApiError } = await import('../api/_lib/agents-v1/http.js');
const loadOwnedAgentMock = vi.fn();
vi.mock('../api/_lib/agents-v1/agents.js', () => ({ loadOwnedAgent: (...a) => loadOwnedAgentMock(...a) }));

const getOwnedRunMock = vi.fn();
const listRunStepsMock = vi.fn();
const cancelRunMock = vi.fn();
vi.mock('../api/_lib/agents-v1/runs.js', () => ({
	getOwnedRun: (...a) => getOwnedRunMock(...a),
	listRunSteps: (...a) => listRunStepsMock(...a),
	cancelRun: (...a) => cancelRunMock(...a),
	serializeRun: (r) => ({ id: r.id, status: r.status, maxSteps: r.max_steps, cancelRequested: Boolean(r.cancel_requested_at) }),
	TERMINAL_RUN_STATUSES: new Set(['completed', 'failed', 'cancelled', 'budget_exhausted']),
}));

const { default: handler } = await import('../api/agent-run-replay.js');

function mkReq({ method = 'GET', url }) {
	return { method, url, headers: {}, on() {}, destroy() {} };
}
function mkRes() {
	return {
		statusCode: 200, headers: {}, body: undefined, writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(b) { this.body = b; this.writableEnded = true; },
	};
}
async function call(opts) {
	const res = mkRes();
	await handler(mkReq(opts), res);
	return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined, headers: res.headers };
}

const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// A chained trace: status, model turn, one tool call and its result, final.
function chain(runId) {
	const raw = [
		{ seq: 1, kind: 'status', tool: null, input: null, output: { status: 'queued' } },
		{ seq: 2, kind: 'model_call', tool: null, input: null, output: { text: 'Asked for token_price' } },
		{ seq: 3, kind: 'tool_call', tool: 'token_price', input: { query: 'SOL' }, output: null },
		{ seq: 4, kind: 'tool_result', tool: 'token_price', input: null, output: { priceUsd: 110 }, latencyMs: 140 },
		{ seq: 5, kind: 'final', tool: null, input: null, output: { text: 'SOL is $110.' } },
	];
	let prev = null;
	return raw.map((s) => {
		const receipt = stepReceipt({ prev, runId, ...s });
		prev = receipt;
		return { ...s, receipt };
	});
}

beforeEach(() => {
	sqlMock.mockReset().mockResolvedValue([]);
	getSessionUserMock.mockReset().mockResolvedValue({ id: 'user-1' });
	authenticateBearerMock.mockReset().mockResolvedValue(null);
	requireCsrfMock.mockReset().mockResolvedValue(true);
	loadOwnedAgentMock.mockReset().mockResolvedValue({ id: AGENT });
	getOwnedRunMock.mockReset().mockResolvedValue({ id: RUN, status: 'completed', max_steps: 4 });
	listRunStepsMock.mockReset().mockResolvedValue(chain(RUN));
	cancelRunMock.mockReset();
});

describe('GET /api/agent-run-replay?run=', () => {
	it('returns steps, paired tool traces with receipts, and a verified chain', async () => {
		const { status, body, headers } = await call({ url: `/api/agent-run-replay?run=${RUN}` });
		expect(status).toBe(200);
		expect(headers['cache-control']).toBe('no-store');
		const d = body.data;
		expect(d.live).toBe(false);
		expect(d.steps).toHaveLength(5);
		expect(d.receiptChain).toEqual({ verified: true, checked: 5, brokenAt: null });
		expect(d.toolTraces).toHaveLength(1);
		expect(d.toolTraces[0]).toMatchObject({ tool: 'token_price', status: 'ok', input: { query: 'SOL' }, output: { priceUsd: 110 }, callSeq: 3, resultSeq: 4 });
		expect(d.toolTraces[0].receipt).toBe(d.steps[3].receipt);
		expect(d.nextAfter).toBe(5);
		expect(listRunStepsMock).toHaveBeenCalledWith(RUN, 'user-1', { after: 0, limit: 501 });
	});

	it('reports the step where an edited output breaks the chain', async () => {
		const steps = chain(RUN);
		steps[3] = { ...steps[3], output: { priceUsd: 999 } };
		listRunStepsMock.mockResolvedValue(steps);
		const { body } = await call({ url: `/api/agent-run-replay?run=${RUN}` });
		expect(body.data.receiptChain).toEqual({ verified: false, checked: 3, brokenAt: 4 });
	});

	it('polls incrementally with after= and leaves verification to a full read', async () => {
		getOwnedRunMock.mockResolvedValue({ id: RUN, status: 'running', max_steps: 4 });
		listRunStepsMock.mockResolvedValue(chain(RUN).slice(3));
		const { body } = await call({ url: `/api/agent-run-replay?run=${RUN}&after=3` });
		expect(listRunStepsMock).toHaveBeenCalledWith(RUN, 'user-1', { after: 3, limit: 501 });
		expect(body.data.live).toBe(true);
		expect(body.data.receiptChain).toBeNull();
		expect(body.data.nextAfter).toBe(5);
	});

	it('maps a run the caller does not own to its library error', async () => {
		getOwnedRunMock.mockRejectedValue(new ApiError(404, 'not_found', 'No run with that id.'));
		const { status, body } = await call({ url: `/api/agent-run-replay?run=${RUN}` });
		expect(status).toBe(404);
		expect(body.error).toBe('not_found');
	});
});

describe('GET /api/agent-run-replay?agent=', () => {
	it('lists runs newest first with model turns, and pages with before=', async () => {
		const rows = Array.from({ length: 26 }, (_, i) => ({ id: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}`, status: 'completed', max_steps: 3, turns: 2 }));
		sqlMock.mockResolvedValueOnce(rows);
		const { status, body } = await call({ url: `/api/agent-run-replay?agent=${AGENT}` });
		expect(status).toBe(200);
		expect(loadOwnedAgentMock).toHaveBeenCalledWith(AGENT, 'user-1');
		expect(body.data.runs).toHaveLength(25);
		expect(body.data.runs[0]).toMatchObject({ maxSteps: 3, turns: 2 });
		expect(body.data.hasMore).toBe(true);
		expect(body.data.nextBefore).toBe(rows[24].id);
	});

	it('rejects a before= cursor from another agent', async () => {
		sqlMock.mockResolvedValueOnce([]);
		const { status, body } = await call({ url: `/api/agent-run-replay?agent=${AGENT}&before=${RUN}` });
		expect(status).toBe(400);
		expect(body.error).toBe('invalid_cursor');
	});
});

describe('auth and validation', () => {
	it('401s without a session or bearer', async () => {
		getSessionUserMock.mockResolvedValue(null);
		const { status, body } = await call({ url: `/api/agent-run-replay?run=${RUN}` });
		expect(status).toBe(401);
		expect(body.error).toBe('unauthorized');
	});

	it('accepts a bearer token in place of a session', async () => {
		getSessionUserMock.mockResolvedValue(null);
		authenticateBearerMock.mockResolvedValue({ userId: 'user-2' });
		await call({ url: `/api/agent-run-replay?run=${RUN}` });
		expect(getOwnedRunMock).toHaveBeenCalledWith(RUN, 'user-2');
	});

	it('400s on a malformed id and on a missing selector', async () => {
		expect((await call({ url: '/api/agent-run-replay?run=not-a-uuid' })).status).toBe(400);
		expect((await call({ url: '/api/agent-run-replay' })).status).toBe(400);
	});
});

describe('POST /api/agent-run-replay?run=&action=cancel', () => {
	it('cancels a queued run outright', async () => {
		cancelRunMock.mockResolvedValue({ id: RUN, status: 'cancelled', max_steps: 4 });
		const { status, body } = await call({ method: 'POST', url: `/api/agent-run-replay?run=${RUN}&action=cancel` });
		expect(status).toBe(200);
		expect(cancelRunMock).toHaveBeenCalledWith(RUN, 'user-1');
		expect(body.data.status).toBe('cancelled');
	});

	it('reports cancel_requested for a run mid-step', async () => {
		cancelRunMock.mockResolvedValue({ id: RUN, status: 'running', max_steps: 4, cancel_requested_at: new Date() });
		const { body } = await call({ method: 'POST', url: `/api/agent-run-replay?run=${RUN}&action=cancel` });
		expect(body.data.status).toBe('cancel_requested');
		expect(body.data.run.cancelRequested).toBe(true);
	});

	it('stops at the CSRF check before touching the run', async () => {
		requireCsrfMock.mockImplementation(async (_req, res) => {
			res.statusCode = 403;
			res.end(JSON.stringify({ error: 'csrf_failed' }));
			return false;
		});
		const { status } = await call({ method: 'POST', url: `/api/agent-run-replay?run=${RUN}&action=cancel` });
		expect(status).toBe(403);
		expect(cancelRunMock).not.toHaveBeenCalled();
	});

	it('refuses any other POST action', async () => {
		const { status } = await call({ method: 'POST', url: `/api/agent-run-replay?run=${RUN}&action=delete` });
		expect(status).toBe(400);
		expect(cancelRunMock).not.toHaveBeenCalled();
	});
});
