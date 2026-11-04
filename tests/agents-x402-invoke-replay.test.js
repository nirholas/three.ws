// POST /api/agents/x402/invoke: a paid call whose response is lost can be
// collected again, never re-charged and never re-run.
//
// The buyer pays on chain, gets an intent, and calls with `x-payment-intent`.
// The route consumes the intent before the skill runs, so a retry after a
// dropped response used to find the intent `consumed`, fail verifyPaid, and be
// told to pay again for work it had already paid for. The route now runs the
// paid path through the shared idempotency store (api/_lib/idempotency.js
// runOnce, keyed per caller on the intent id or an `Idempotency-Key` header).
//
// What runs for real here: the route, api/_lib/x402.js, api/_lib/idempotency.js
// and the in-memory side of api/_lib/cache.js. What is stubbed: the database (a
// small stateful fake of the four tables the route touches), auth, rate limits,
// the access gate, and the skill runtime (a spy, so executions can be counted).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
	// The idempotency store must be the per-process memory one, never a real Redis.
	for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_CACHE_REST_URL', 'UPSTASH_CACHE_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) {
		delete process.env[k];
	}
});

const AGENT_ID = '7c1f3c1e-2b54-4d7a-9a0e-3f5d2b8c9a11';
const OWNER_ID = 'b0b0b0b0-0000-4000-8000-000000000001';
const BUYER_ID = 'b0b0b0b0-0000-4000-8000-000000000002';
const OTHER_ID = 'b0b0b0b0-0000-4000-8000-000000000003';
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const PAYOUT = 'THREEsynthetic1111111111111111111111111111';
const BUYER_WALLET = 'THREEsyntheticBuyer11111111111111111111111';

const db = vi.hoisted(() => ({ intents: new Map(), revenue: [] }));

vi.mock('../api/_lib/db.js', () => {
	const sql = vi.fn(async (strings, ...values) => {
		const q = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
		if (q.startsWith('select id, user_id, name, meta, skills from agent_identities')) {
			return values[0] === AGENT_ID ? [agentRow()] : [];
		}
		if (q.startsWith('select id, name, meta from agent_identities')) {
			return values[0] === AGENT_ID ? [agentRow()] : [];
		}
		if (q.startsWith('select amount, currency_mint, chain, is_active from agent_skill_prices')) {
			return [{ amount: '250000', currency_mint: THREE_MINT, chain: 'solana', is_active: true }];
		}
		if (q.startsWith('select amount, currency_mint, chain from agent_skill_prices')) {
			return [{ amount: '250000', currency_mint: THREE_MINT, chain: 'solana' }];
		}
		if (q.includes('from agent_payment_intents')) {
			const row = db.intents.get(values[0]);
			return row && row.agent_id === values[1] ? [{ ...row }] : [];
		}
		if (q.startsWith("update agent_payment_intents set status = 'consumed'")) {
			const row = db.intents.get(values[0]);
			if (row?.status !== 'paid') return [];
			row.status = 'consumed';
			return [{ id: row.id }];
		}
		if (q.startsWith("update agent_payment_intents set status = 'paid'")) {
			const row = db.intents.get(values[0]);
			if (row?.status !== 'consumed') return [];
			row.status = 'paid';
			return [{ id: row.id }];
		}
		if (q.startsWith('insert into agent_revenue_events')) {
			const intentId = values[1];
			if (!db.revenue.some((r) => r.intent_id === intentId)) db.revenue.push({ intent_id: intentId, gross: values[3] });
			return [];
		}
		throw new Error(`unexpected query in test: ${q.slice(0, 120)}`);
	});
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false, isStoragePressured: () => false };
});

function agentRow() {
	return {
		id: AGENT_ID,
		user_id: OWNER_ID,
		name: 'Summariser',
		skills: ['summarize'],
		meta: { payments: { configured: true, receiver: PAYOUT } },
	};
}

vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: async () => null,
	extractBearer: (req) => {
		const h = req.headers?.authorization || '';
		return h.startsWith('Bearer ') ? h.slice(7) : null;
	},
	authenticateBearer: async (token) => (token ? { userId: token, scope: 'read generate' } : null),
}));

vi.mock('../api/_lib/rate-limit.js', () => ({
	clientIp: () => '198.51.100.7',
	limits: { authIp: async () => ({ success: true }), publicIp: async () => ({ success: true }) },
}));

vi.mock('../api/_lib/skill-access.js', () => ({
	hasSkillAccess: async () => ({ paid: false, owned: false }),
	consumeTrialUse: async () => {},
	logSkillUsage: () => {},
}));
vi.mock('../api/_lib/skill-license-verify.js', () => ({ enforceOnchainLicense: async () => ({ blocked: false }) }));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));
vi.mock('../api/_lib/payout.js', () => ({ resolvePayoutAddress: async () => PAYOUT }));

const skillInvoke = vi.fn();
vi.mock('../api/_lib/skill-runtime.js', () => ({
	makeRuntime: () => ({ invoke: (...a) => skillInvoke(...a) }),
}));

const { default: handler } = await import('../api/agents/x402/[action].js');

// ── harness ──────────────────────────────────────────────────────────────────

function mkReq({ user = BUYER_ID, intent, idemKey, body, method = 'POST', url = '/api/agents/x402/invoke', action = 'invoke' }) {
	const payload = body === undefined ? null : JSON.stringify(body);
	const headers = { host: 'three.ws', 'content-type': 'application/json' };
	if (user) headers.authorization = `Bearer ${user}`;
	if (intent) headers['x-payment-intent'] = intent;
	if (idemKey !== undefined) headers['idempotency-key'] = idemKey;
	return {
		method,
		url,
		headers,
		query: { action },
		body: payload ? JSON.parse(payload) : undefined,
		on() {},
		[Symbol.asyncIterator]: async function* () {
			if (payload) yield Buffer.from(payload);
		},
	};
}

function mkRes() {
	const headers = {};
	return {
		statusCode: 200,
		headers,
		body: '',
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { headers[k.toLowerCase()] = v; },
		getHeader(k) { return headers[k.toLowerCase()]; },
		removeHeader(k) { delete headers[k.toLowerCase()]; },
		writeHead(s, h) { this.statusCode = s; if (h) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return this; },
		write(c) { this.body += String(c); return true; },
		end(c) { if (c) this.body += String(c); this.headersSent = true; this.writableEnded = true; return this; },
	};
}

async function call(opts) {
	const res = mkRes();
	await handler(mkReq(opts), res);
	let parsed = null;
	try { parsed = JSON.parse(res.body); } catch { /* non-JSON body */ }
	return { status: res.statusCode, body: parsed, headers: res.headers };
}

let intentSeq = 0;
function payIntent(payer = BUYER_ID) {
	intentSeq += 1;
	const id = `c0ffee00-0000-4000-8000-${String(intentSeq).padStart(12, '0')}`;
	db.intents.set(id, {
		id,
		agent_id: AGENT_ID,
		payer_user_id: payer,
		currency_mint: THREE_MINT,
		amount: '250000',
		status: 'paid',
		paid_at: new Date(),
		end_time: null,
		payload: { skill: 'summarize', wallet_address: BUYER_WALLET },
	});
	return id;
}

const ARGS = { text: 'the quick brown fox', _tool: 'summarize' };
const invokeBody = (args = ARGS) => ({ agent_id: AGENT_ID, skill: 'summarize', args });

beforeEach(() => {
	db.intents.clear();
	db.revenue.length = 0;
	skillInvoke.mockReset();
	skillInvoke.mockImplementation(async (_name, args) => ({ ok: true, summary: `summary of ${args.text}` }));
});

// ── cases ────────────────────────────────────────────────────────────────────

describe('POST /api/agents/x402/invoke, lost-response replay', () => {
	it('answers a retry of a delivered call with the same result, marked replayed, without running or charging twice', async () => {
		const intent = payIntent();
		const first = await call({ intent, body: invokeBody() });
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({ ok: true, intent_id: intent, replayed: false, result: { summary: 'summary of the quick brown fox' } });

		// The response above never reached the buyer; the client retries as-is.
		const retry = await call({ intent, body: invokeBody() });
		expect(retry.status).toBe(200);
		expect(retry.body.replayed).toBe(true);
		const { replayed: _a, ...firstRest } = first.body;
		const { replayed: _b, ...retryRest } = retry.body;
		expect(retryRest).toEqual(firstRest);
		expect(retry.headers['idempotent-replayed']).toBe('true');

		expect(skillInvoke).toHaveBeenCalledTimes(1);
		expect(db.revenue).toHaveLength(1);
		expect(db.intents.get(intent).status).toBe('consumed');
	});

	it('refuses the same intent sent with different args as a conflict, not a replay', async () => {
		const intent = payIntent();
		expect((await call({ intent, body: invokeBody() })).status).toBe(200);

		const other = await call({ intent, body: invokeBody({ text: 'a different document', _tool: 'summarize' }) });
		expect(other.status).toBe(409);
		expect(other.body.error).toBe('idempotency_conflict');
		expect(skillInvoke).toHaveBeenCalledTimes(1);
		expect(db.revenue).toHaveLength(1);
	});

	it('serves the replay only to the account that paid: another account holding the intent id gets the 402', async () => {
		const intent = payIntent();
		expect((await call({ intent, body: invokeBody() })).status).toBe(200);

		const thief = await call({ user: OTHER_ID, intent, body: invokeBody() });
		expect(thief.status).toBe(402);
		expect(thief.body.replayed).toBeUndefined();
		expect(thief.body.result).toBeUndefined();
		expect(skillInvoke).toHaveBeenCalledTimes(1);
	});

	it('tells a concurrent duplicate to retry, then hands it the first call’s result', async () => {
		const intent = payIntent();
		let finish;
		skillInvoke.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));

		const firstP = call({ intent, body: invokeBody() });
		await vi.waitFor(() => expect(skillInvoke).toHaveBeenCalledTimes(1));

		const dup = await call({ intent, body: invokeBody() });
		expect(dup.status).toBe(409);
		expect(dup.body.error).toBe('idempotency_in_progress');
		expect(dup.body.retry).toBe(true);

		finish({ ok: true, summary: 'slow summary' });
		const first = await firstP;
		expect(first.status).toBe(200);

		const after = await call({ intent, body: invokeBody() });
		expect(after.status).toBe(200);
		expect(after.body).toMatchObject({ replayed: true, result: { summary: 'slow summary' } });
		expect(skillInvoke).toHaveBeenCalledTimes(1);
		expect(db.revenue).toHaveLength(1);
	});

	it('keeps a failed call retryable: the intent goes back to paid and nothing is stored', async () => {
		const intent = payIntent();
		skillInvoke.mockRejectedValueOnce(new Error('runtime crashed'));
		const failed = await call({ intent, body: invokeBody() });
		expect(failed.status).toBeGreaterThanOrEqual(500);
		expect(db.intents.get(intent).status).toBe('paid');

		const retry = await call({ intent, body: invokeBody() });
		expect(retry.status).toBe(200);
		expect(retry.body.replayed).toBe(false);
		expect(skillInvoke).toHaveBeenCalledTimes(2);
		expect(db.revenue).toHaveLength(1);
	});

	it('lets an Idempotency-Key header win over the intent id', async () => {
		const intent = payIntent();
		expect((await call({ intent, idemKey: 'buyer-chosen-key-1', body: invokeBody() })).status).toBe(200);

		// Same header, a fresh intent: the stored call is the answer and the new
		// payment is left untouched for a later call.
		const second = payIntent();
		const retry = await call({ intent: second, idemKey: 'buyer-chosen-key-1', body: invokeBody() });
		expect(retry.status).toBe(200);
		expect(retry.body).toMatchObject({ replayed: true, intent_id: intent });
		expect(db.intents.get(second).status).toBe('paid');
		expect(skillInvoke).toHaveBeenCalledTimes(1);
	});

	it('rejects an Idempotency-Key longer than the shared maximum', async () => {
		const intent = payIntent();
		const res = await call({ intent, idemKey: 'k'.repeat(201), body: invokeBody() });
		expect(res.status).toBe(400);
		expect(res.body.error).toBe('invalid_idempotency_key');
		expect(skillInvoke).not.toHaveBeenCalled();
		expect(db.intents.get(intent).status).toBe('paid');
	});
});

describe('the replay contract is advertised', () => {
	const IDEMPOTENCY = { header: 'Idempotency-Key', ttl_seconds: 86400, replay_field: 'replayed' };

	it('GET /api/agents/x402/manifest carries the idempotency block', async () => {
		const res = await call({
			method: 'GET',
			action: 'manifest',
			url: `/api/agents/x402/manifest?agent_id=${AGENT_ID}&skill=summarize`,
		});
		expect(res.status).toBe(200);
		expect(res.body.idempotency).toEqual(IDEMPOTENCY);
	});

	it('the 402 challenge carries the same block', async () => {
		const res = await call({ body: invokeBody() });
		expect(res.status).toBe(402);
		expect(res.body.idempotency).toEqual(IDEMPOTENCY);
	});
});
