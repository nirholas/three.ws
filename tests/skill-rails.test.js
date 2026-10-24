// One paid skill, four rails: x402, MPP, A2A and AP2 all answer at
// /api/skills/:id/invoke, price from one quote, and write the same receipt row.
//
// The counterparties are local: the router, rail library, mandate and cart
// signing, spend ledger and royalty accrual all run for real. Only the database
// driver and the facilitator verify/settle calls (which would otherwise hit a
// Solana RPC) are replaced, and the replacements record what they were handed so
// each test can assert the receipt and split that came out.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { Challenge } from 'mppx';
import { solanaChargeAuthorization } from '../api/_lib/mpp-solana.js';

const { state } = vi.hoisted(() => {
	process.env.JWT_SECRET = 'skill-rails-test-secret-0123456789abcdef';
	process.env.A2A_MANDATE_SECRET = 'skill-rails-mandate-secret-0123456789abcdef';
	process.env.PUBLIC_APP_ORIGIN = 'https://three.test';
	process.env.X402_FEE_PAYER_SOLANA = 'THREEsynthetic2222222222222222222222222222';
	process.env.X402_ASSET_MINT_SOLANA = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
	return {
		state: {
			skill: null,
			agent: null,
			inserts: [],
			ledger: [],
			facilitatorCalls: [],
			settleFails: false,
		},
	};
});

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...vals) => {
		const text = strings.join('?').replace(/\s+/g, ' ').trim().toLowerCase();
		if (text.startsWith('insert into x402_receipts')) {
			state.inserts.push({ vals });
			return Promise.resolve([{ id: `receipt-${state.inserts.length}` }]);
		}
		if (text.startsWith('insert into x402_spent_payments')) return Promise.resolve([{ payment_hash: String(vals[0]) }]);
		if (text.startsWith('insert into royalty_ledger')) {
			state.ledger.push({ vals });
			return Promise.resolve([{ id: `ledger-${state.ledger.length}` }]);
		}
		if (text.includes('from marketplace_skills')) return Promise.resolve(state.skill ? [state.skill] : []);
		if (text.includes('from agent_identities')) return Promise.resolve(state.agent ? [state.agent] : []);
		return Promise.resolve([]);
	};
	return { sql, default: sql };
});

vi.mock('../api/_lib/x402-spec.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		verifyPayment: vi.fn(async ({ paymentHeader, requirements }) => {
			const payload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
			const all = Array.isArray(requirements) ? requirements : [requirements];
			const requirement = all.find((r) => r.network === payload.network) || all[0];
			state.facilitatorCalls.push({ step: 'verify', requirement, payload });
			return { payer: payload.payer, requirement, paymentPayload: payload };
		}),
		settlePayment: vi.fn(async ({ verified }) => {
			state.facilitatorCalls.push({ step: 'settle', requirement: verified.requirement });
			if (state.settleFails) throw new actual.X402Error('settle_failed', 'facilitator refused', 402);
			return { transaction: `tx-${verified.requirement.network}-${state.facilitatorCalls.length}`, network: verified.requirement.network, payer: verified.payer };
		}),
	};
});

const { default: invoke } = await import('../api/skills/[id]/invoke.js');
const { default: card } = await import('../api/skills/[id]/card.js');
const rails = await import('../api/_lib/skill-rails.js');
const { issueIntentMandate } = await import('../api/_lib/a2a/mandate.js');
const { _resetMemoryStore } = await import('../api/_lib/a2a/spend-ledger.js');
const { A2A_X402_EXTENSION_URI } = await import('../api/_lib/x402/a2a-server.js');

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SKILL_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const AGENT_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OWNER_ID = '11111111-2222-4333-8444-555555555555';
const PAYER = 'THREEsynthetic1111111111111111111111111111';

function baseSkill(over = {}) {
	return {
		id: SKILL_ID,
		slug: 'synthetic-quote',
		name: 'Synthetic Quote',
		description: 'A synthetic priced skill for rail tests.',
		category: 'general',
		rails: ['x402', 'mpp', 'a2a', 'ap2'],
		schema_json: [{ type: 'function', function: { name: 'quote', description: 'q', parameters: {} } }],
		content: '# Synthetic Quote',
		price_per_call_usd: 0.01,
		author_id: OWNER_ID,
		author_payto_base: null,
		author_payto_solana: THREE_MINT,
		...over,
	};
}

function makeReq({ method = 'GET', query = {}, headers = {}, body } = {}) {
	const payload = body === undefined ? '' : JSON.stringify(body);
	const req = Readable.from(payload ? [Buffer.from(payload)] : []);
	req.method = method;
	req.url = `/api/skills/${SKILL_ID}/invoke`;
	req.query = { id: SKILL_ID, ...query };
	req.headers = { origin: 'https://three.ws', ...headers };
	if (payload) req.headers['content-type'] = 'application/json';
	return req;
}

function makeRes() {
	return {
		statusCode: 200,
		_body: '',
		_headers: {},
		setHeader(k, v) { this._headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this._headers[String(k).toLowerCase()]; },
		removeHeader(k) { delete this._headers[String(k).toLowerCase()]; },
		writeHead(code, h) { this.statusCode = code; for (const [k, v] of Object.entries(h || {})) this.setHeader(k, v); return this; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		end(chunk) { this._body = chunk ? String(chunk) : ''; return this; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

async function call(handler, opts) {
	const res = makeRes();
	await handler(makeReq(opts), res);
	return res;
}

let proofSeq = 0;
const paymentHeader = (network = 'solana') =>
	Buffer.from(JSON.stringify({ x402Version: 2, network, payer: PAYER, scheme: 'exact', nonce: ++proofSeq })).toString('base64');

function mppAuthorization(res) {
	const [challenge] = Challenge.fromHeadersList(new Headers({ 'www-authenticate': res.getHeader('www-authenticate') }));
	return solanaChargeAuthorization({ challenge, transaction: 'dGVzdC10cmFuc2FjdGlvbg==', source: PAYER });
}

function a2aBody(metadata = {}) {
	return {
		jsonrpc: '2.0',
		id: 1,
		method: 'message/send',
		params: { message: { kind: 'message', role: 'user', messageId: 'm1', parts: [{ kind: 'text', text: 'run' }], metadata } },
	};
}

const a2aHeaders = { 'x-a2a-extensions': A2A_X402_EXTENSION_URI };

beforeEach(() => {
	state.skill = baseSkill();
	state.agent = { id: AGENT_ID, meta: {} };
	state.inserts.length = 0;
	state.ledger.length = 0;
	state.facilitatorCalls.length = 0;
	state.settleFails = false;
	_resetMemoryStore();
});

describe('normalizeRails and the rails column', () => {
	it('keeps canonical order, drops duplicates, and rejects unknown or empty input', () => {
		expect(rails.normalizeRails(['ap2', 'x402', 'x402'])).toEqual(['x402', 'ap2']);
		expect(rails.normalizeRails([])).toBeNull();
		expect(rails.normalizeRails(['x402', 'swift'])).toBeNull();
		expect(rails.normalizeRails('x402')).toBeNull();
	});

	it('defaults a row that predates the column to x402 and a2a', () => {
		expect(rails.enabledRails({})).toEqual(['x402', 'a2a']);
		expect(rails.enabledRails({ rails: ['mpp'] })).toEqual(['mpp']);
	});
});

describe('rail detection', () => {
	it('reads the rail from the shape of the request', () => {
		const d = (req, body) => rails.detectRail({ query: {}, headers: {}, ...req }, body).rail;
		expect(d({})).toBe('x402');
		expect(d({ headers: { authorization: 'Payment abc' } })).toBe('mpp');
		expect(d({}, { jsonrpc: '2.0' })).toBe('a2a');
		expect(d({ headers: { 'x-ap2-mandate': 'jws' } })).toBe('ap2');
		expect(d({ query: { rail: 'mpp' } })).toBe('mpp');
		expect(rails.detectRail({ query: { rail: 'swift' }, headers: {} }).unknown).toBe('swift');
	});
});

describe('dry run: the same split on every rail', () => {
	it('prices each enabled rail from one quote and moves no funds', async () => {
		const table = [];
		for (const rail of ['x402', 'mpp', 'a2a', 'ap2']) {
			const res = await call(invoke, { query: { dry_run: '1', rail } });
			expect(res.statusCode, rail).toBe(200);
			expect(res.json.dry_run).toBe(true);
			expect(res.json.rail).toBe(rail);
			table.push({ rail, ...res.json.quote });
		}
		console.table(table);
		const [first] = table;
		expect(first.price_atomics).toBe('10000');
		expect(BigInt(first.author_atomics) + BigInt(first.platform_atomics)).toBe(10000n);
		for (const row of table) {
			expect(row.price_atomics).toBe(first.price_atomics);
			expect(row.author_atomics).toBe(first.author_atomics);
			expect(row.platform_atomics).toBe(first.platform_atomics);
		}
		expect(state.facilitatorCalls).toHaveLength(0);
		expect(state.inserts).toHaveLength(0);
	});
});

describe('challenges', () => {
	it('x402: a bare request gets a 402 with Solana first', async () => {
		const res = await call(invoke);
		expect(res.statusCode).toBe(402);
		const accepts = res.json?.accepts ?? JSON.parse(Buffer.from(res.getHeader('payment-required') || '', 'base64').toString() || '{}').accepts;
		expect(accepts[0].network).toMatch(/^solana/);
		expect(String(accepts[0].amount ?? accepts[0].maxAmountRequired)).toBe('10000');
		expect(accepts[0].payTo).toBe(THREE_MINT);
	});

	it('mpp: answers 402 with a spec Payment challenge for a Solana charge', async () => {
		const res = await call(invoke, { headers: { 'x-payment-rail': 'mpp' } });
		expect(res.statusCode).toBe(402);
		const www = res.getHeader('www-authenticate');
		expect(www).toMatch(/^Payment id="/);
		const [challenge] = Challenge.fromHeadersList(new Headers({ 'www-authenticate': www }));
		expect(challenge.method).toBe('solana');
		expect(challenge.intent).toBe('charge');
		expect(challenge.request.amount).toBe('10000');
		expect(challenge.request.recipient).toBe(THREE_MINT);
		expect(challenge.request.methodDetails.decimals).toBe(6);
	});

	it('a2a: a JSON-RPC call without payment gets a payment-required task', async () => {
		const res = await call(invoke, { method: 'POST', headers: a2aHeaders, body: a2aBody() });
		expect(res.statusCode, res._body).toBe(200);
		const task = res.json.result;
		expect(task.status.state).toBe('input-required');
		expect(task.status.message.metadata['x402.payment.status']).toBe('payment-required');
		expect(res.getHeader('x-a2a-extensions')).toBe(A2A_X402_EXTENSION_URI);
	});

	it('ap2: no mandate gets a mandate request', async () => {
		const res = await call(invoke, { headers: { 'x-payment-rail': 'ap2' } });
		expect(res.statusCode).toBe(402);
		expect(res.json.error).toBe('mandate_required');
		expect(res.json.ap2.constraints.amountAtomics).toBe('10000');
	});
});

describe('settlement writes one receipt shape on every rail', () => {
	async function settleOn(rail) {
		if (rail === 'x402') return call(invoke, { headers: { 'x-payment': paymentHeader() } });
		if (rail === 'mpp') {
			const challenge = await call(invoke, { headers: { 'x-payment-rail': 'mpp' } });
			return call(invoke, { headers: { authorization: mppAuthorization(challenge) } });
		}
		if (rail === 'a2a') {
			return call(invoke, {
				method: 'POST',
				headers: a2aHeaders,
				body: a2aBody({
					'x402.payment.status': 'payment-submitted',
					'x402.payment.payload': { x402Version: 2, network: 'solana', payer: PAYER, scheme: 'exact' },
				}),
			});
		}
		const { jws } = await issueIntentMandate({
			ownerUserId: OWNER_ID,
			subjectAgentId: AGENT_ID,
			maxAtomics: '1000000',
			perCallAtomics: '50000',
			networks: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
			resources: ['https://three.test/'],
			ttlSec: 600,
		});
		const leg1 = await call(invoke, { headers: { 'x-ap2-mandate': jws } });
		expect(leg1.statusCode).toBe(402);
		expect(leg1.json.ap2.cart_mandate).toBeTruthy();
		return call(invoke, {
			headers: { 'x-ap2-mandate': jws, 'x-ap2-cart': leg1.json.ap2.cart_mandate, 'x-payment': paymentHeader(leg1.json.accepts[0].network) },
		});
	}

	for (const rail of ['x402', 'mpp', 'a2a', 'ap2']) {
		it(`${rail}: verifies, settles, delivers the skill, and records the split`, async () => {
			const res = await settleOn(rail);
			expect(res.statusCode, res._body).toBe(200);
			const body = res.json;
			const delivered = rail === 'a2a' ? body.result.artifacts?.[0]?.parts?.[0]?.data ?? body.result.status?.message?.parts?.[0]?.data : body;
			expect(delivered?.skill?.slug ?? body.skill?.slug).toBe('synthetic-quote');

			const rows = state.inserts.filter((i) => i.vals.includes(rail));
			expect(rows, 'skill receipt row for the rail').toHaveLength(1);
			const v = rows[0].vals;
			expect(v).toContain(String(SKILL_ID));
			expect(v).toContain('three.ws/skill-invoke/v1');
			expect(v).toContain('10000');
			expect(v).toContain('9750');
			expect(v).toContain('250');
			expect(state.ledger.at(-1).vals).toContain(rail);
		});
	}

	it('a settle failure releases the AP2 budget so the mandate can retry', async () => {
		state.settleFails = true;
		const { jws } = await issueIntentMandate({
			ownerUserId: OWNER_ID,
			subjectAgentId: AGENT_ID,
			maxAtomics: '10000',
			perCallAtomics: '10000',
			networks: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
			resources: ['https://three.test/'],
			ttlSec: 600,
		});
		const leg1 = await call(invoke, { headers: { 'x-ap2-mandate': jws } });
		const headers = { 'x-ap2-mandate': jws, 'x-ap2-cart': leg1.json.ap2.cart_mandate, 'x-payment': paymentHeader(leg1.json.accepts[0].network) };
		const failed = await call(invoke, { headers });
		expect(failed.statusCode).toBe(402);
		state.settleFails = false;
		const retry = await call(invoke, { headers });
		expect(retry.statusCode, retry._body).toBe(200);
	});

	it('ap2 refuses a frozen agent', async () => {
		state.agent = { id: AGENT_ID, meta: { spend_limits: { frozen: true }, spendLimits: { frozen: true } } };
		const { jws } = await issueIntentMandate({
			ownerUserId: OWNER_ID,
			subjectAgentId: AGENT_ID,
			maxAtomics: '10000',
			perCallAtomics: '10000',
			resources: ['https://three.test/'],
			ttlSec: 600,
		});
		const res = await call(invoke, { headers: { 'x-ap2-mandate': jws } });
		expect([402, 403]).toContain(res.statusCode);
	});
});

describe('mpp credentials', () => {
	it('rejects a credential whose challenge terms were altered', async () => {
		const challenge = await call(invoke, { headers: { 'x-payment-rail': 'mpp' } });
		const [c] = Challenge.fromHeadersList(new Headers({ 'www-authenticate': challenge.getHeader('www-authenticate') }));
		c.request = { ...c.request, amount: '1' };
		const forged = solanaChargeAuthorization({ challenge: c, transaction: 'dGVzdA==' });
		const res = await call(invoke, { headers: { authorization: forged } });
		expect(res.statusCode).toBe(401);
		expect(res.json.error).toBe('challenge_mismatch');
		expect(state.facilitatorCalls).toHaveLength(0);
	});

	it('treats an expired challenge as payment required again', () => {
		const requirement = { amount: '10000', asset: 'USDC', payTo: THREE_MINT, network: 'solana', scheme: 'exact' };
		const c = rails.buildMppChallenge({ requirement, description: 'd', nowSec: 1000 });
		const auth = solanaChargeAuthorization({ challenge: c.challenge, transaction: 'dGVzdA==' });
		expect(rails.parseMppCredential(auth, { nowSec: 1001 }).ok).toBe(true);
		const late = rails.parseMppCredential(auth, { nowSec: c.expires + 1 });
		expect(late.ok).toBe(false);
		expect(late.code).toBe('challenge_expired');
	});
});

describe('disabling a rail', () => {
	it('answers 404 on that rail and removes it from the agent card', async () => {
		state.skill = baseSkill({ rails: ['x402', 'a2a'] });

		for (const opts of [
			{ headers: { 'x-payment-rail': 'mpp' } },
			{ headers: { authorization: 'Payment abc' } },
			{ headers: { 'x-ap2-mandate': 'jws' } },
			{ query: { rail: 'mpp', dry_run: '1' } },
		]) {
			const res = await call(invoke, opts);
			expect(res.statusCode).toBe(404);
			expect(res.json.error).toBe('rail_disabled');
			expect(res.json.enabled_rails).toEqual(['x402', 'a2a']);
		}

		const res = await call(card);
		expect(res.statusCode).toBe(200);
		expect(Object.keys(res.json['x-three-ws'].rails)).toEqual(['x402', 'a2a']);
		expect(res.json['x-three-ws'].enabled_rails).toEqual(['x402', 'a2a']);
	});

	it('also closes the bare x402 path when x402 is off', async () => {
		state.skill = baseSkill({ rails: ['mpp'] });
		const res = await call(invoke);
		expect(res.statusCode).toBe(404);
		expect(res.json.error).toBe('rail_disabled');
	});

	it('answers 404 for a rail that does not exist', async () => {
		const res = await call(invoke, { query: { rail: 'swift' } });
		expect(res.statusCode).toBe(404);
		expect(res.json.error).toBe('unknown_rail');
	});

	it('answers 409 for a free skill', async () => {
		state.skill = baseSkill({ price_per_call_usd: 0 });
		const res = await call(invoke);
		expect(res.statusCode).toBe(409);
	});
});

describe('agent card', () => {
	it('lists every enabled rail with its endpoint and the price split', async () => {
		const res = await call(card);
		expect(res.statusCode).toBe(200);
		const x = res.json['x-three-ws'];
		expect(x.enabled_rails).toEqual(['x402', 'mpp', 'a2a', 'ap2']);
		for (const rail of x.enabled_rails) {
			expect(x.rails[rail].url).toContain(`/api/skills/${SKILL_ID}/invoke`);
			expect(x.rails[rail].protocol).toBeTruthy();
		}
		expect(x.price.price_atomics).toBe('10000');
		expect(x.price.author_atomics).toBe('9750');
		expect(x.receipt_format).toBe('three.ws/skill-invoke/v1');
	});

	it('404s for an unknown skill', async () => {
		state.skill = null;
		const res = await call(card);
		expect(res.statusCode).toBe(404);
	});
});
