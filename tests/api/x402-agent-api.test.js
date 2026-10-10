// Sell a whole agent as a paid x402 API: POST /api/x402/agents/:id.
//
// Drives the real route (api/x402/agents.js) through the real paidEndpoint()
// wrapper against an in-process Postgres (PGlite) holding the tables it reads
// and writes, so the revenue insert, its ON CONFLICT against the partial unique
// index, and the spent-payment guard all run as real SQL. The only mocked seams
// are the facilitator (verifyPayment / settlePayment), the LLM chain, and the
// notification + audit sinks.

import { Readable } from 'node:stream';
import { Keypair } from '@solana/web3.js';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

const verifyPayment = vi.fn();
const settlePayment = vi.fn();
vi.mock('../../api/_lib/x402-spec.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, verifyPayment, settlePayment };
});

const llmComplete = vi.fn();
vi.mock('../../api/_lib/llm.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, llmComplete };
});

const notifications = [];
vi.mock('../../api/_lib/notify.js', () => ({
	insertNotification: (userId, type, payload) => notifications.push({ userId, type, payload }),
}));
vi.mock('../../api/_lib/x402/audit-log.js', async (importActual) => ({
	...(await importActual()),
	logPaymentEvent: () => {},
}));
vi.mock('../../api/_lib/patronage.js', () => ({
	patronStanding: async () => ({ usd: 0 }),
	listPerks: async () => [],
	entitledPerks: () => [],
	patronChatContext: async () => null,
}));
vi.mock('@coinbase/x402', () => ({ createCdpAuthHeaders: vi.fn(async () => ({})) }));
const authState = vi.hoisted(() => ({ session: null }));
vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: async () => authState.session,
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));

const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OWNER = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const AGENT_WALLET = Keypair.generate().publicKey.toBase58();
const PAYOUT_WALLET = Keypair.generate().publicKey.toBase58();
const BUYER = Keypair.generate().publicKey.toBase58();
const FEE_PAYER = Keypair.generate().publicKey.toBase58();

const DDL = `
	create table agent_identities (
		id uuid primary key, user_id uuid, name text, description text, meta jsonb,
		skills text[], embed_policy jsonb, is_public boolean, deleted_at timestamptz,
		avatar_url text, profile_image_url text, wallet_address text,
		updated_at timestamptz default now()
	);
	create table agent_payout_wallets (
		id serial primary key, agent_id uuid, user_id uuid, chain text, address text,
		is_default boolean default false, created_at timestamptz default now(),
		approved_at timestamptz default now(), effective_at timestamptz not null default now()
	);
	create table agent_skill_prices (agent_id uuid, skill text, is_active boolean);
	create table agent_revenue_events (
		id uuid primary key default gen_random_uuid(), agent_id uuid, intent_id text, skill text,
		gross_amount bigint, fee_amount bigint, net_amount bigint, currency_mint text, chain text,
		payer_address text, created_at timestamptz default now(),
		platform_fee_amount bigint not null default 0, owner_user_id uuid,
		settled_to_wallet boolean not null default false,
		check (gross_amount = fee_amount + net_amount + platform_fee_amount)
	);
	create unique index agent_revenue_events_intent_uniq on agent_revenue_events (intent_id) where intent_id is not null;
	create table x402_spent_payments (
		payment_hash text primary key, endpoint text, amount_atomics text, created_at timestamptz default now()
	);
`;

function mockReqRes({ method = 'POST', headers = {}, url = `/api/x402/agents/${AGENT}`, body } = {}) {
	const lower = {};
	for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
	const req = Object.assign(new Readable({ read() {} }), {
		method,
		url,
		headers: lower,
		query: {},
		connection: { remoteAddress: '127.0.0.1' },
		socket: { remoteAddress: '127.0.0.1' },
	});
	if (body !== undefined) req.push(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
	req.push(null);
	const chunks = [];
	const resHeaders = {};
	const res = {
		statusCode: 200,
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) {
			resHeaders[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return resHeaders[k.toLowerCase()];
		},
		end(b) {
			if (b !== undefined) chunks.push(b);
			res.writableEnded = true;
		},
		write(c) {
			chunks.push(c);
		},
		get body() {
			return chunks.join('');
		},
	};
	return { req, res };
}

function paymentHeader(salt) {
	return Buffer.from(
		JSON.stringify({ x402Version: 2, scheme: 'exact', network: SOLANA, payload: { transaction: `tx-${salt}` } }),
	).toString('base64');
}

function challengeOf(res) {
	return JSON.parse(Buffer.from(String(res.getHeader('payment-required')), 'base64').toString('utf8'));
}

async function seedAgent({ service, isPublic = true, embedPolicy = null, payout = true, solanaAddress = AGENT_WALLET } = {}) {
	await holder.db.query(
		`insert into agent_identities (id, user_id, name, description, meta, skills, embed_policy, is_public, wallet_address)
		 values ($1, $2, 'Oracle Ada', 'A research agent', $3, '{}', $4, $5, '0x49da9e65CfA25B13732A46ddB2D2cEEADa14F65e')`,
		[
			AGENT,
			OWNER,
			JSON.stringify({
				solana_address: solanaAddress,
				brain: { instructions: 'You are Ada.' },
				...(service ? { api_service: service } : {}),
			}),
			embedPolicy ? JSON.stringify(embedPolicy) : null,
			isPublic,
		],
	);
	if (payout) {
		await holder.db.query(
			`insert into agent_payout_wallets (agent_id, user_id, chain, address, is_default) values ($1, $2, 'solana', $3, true)`,
			[AGENT, OWNER, PAYOUT_WALLET],
		);
	}
}

const ACTIVE = { active: true, price_usd: 0.25, description: 'Ask Ada anything about on-chain research.' };

let handler;
let ownerHandler;
let cacheMod;
const ORIG_ENV = { ...process.env };

beforeAll(async () => {
	const { createPgliteSql } = await import('../_helpers/pglite-sql.js');
	holder.db = createPgliteSql();
	await holder.db.exec(DDL);
	process.env.X402_ALLOW_MEMORY_FALLBACK = '1';
	handler = (await import('../../api/x402/agents.js')).default;
	ownerHandler = (await import('../../api/agents/[id]/api-service.js')).default;
	cacheMod = await import('../../api/_lib/x402/idempotency-cache.js');
});

beforeEach(async () => {
	await holder.db.exec(
		'truncate agent_identities, agent_payout_wallets, agent_skill_prices, agent_revenue_events, x402_spent_payments',
	);
	process.env.X402_ASSET_MINT_SOLANA = USDC;
	process.env.X402_FEE_PAYER_SOLANA = FEE_PAYER;
	delete process.env.X402_PAY_TO_BASE;
	delete process.env.X402_ACCEPT_THREE_SOLANA;
	delete process.env.X402_BUILDER_CODE_APP;
	cacheMod._resetMemoryStore();
	notifications.length = 0;
	authState.session = null;
	verifyPayment.mockReset();
	settlePayment.mockReset();
	llmComplete.mockReset();
	verifyPayment.mockImplementation(async ({ requirements }) => ({
		paymentPayload: {},
		requirement: requirements[0],
		payer: BUYER,
	}));
	settlePayment.mockImplementation(async () => ({
		success: true,
		transaction: 'SettleSig111111111111111111111111111111111111',
		network: SOLANA,
		payer: BUYER,
	}));
	llmComplete.mockImplementation(async () => ({
		text: 'Hello from Ada.',
		model: 'claude-haiku-4-5-20251001',
		usage: { input_tokens: 12, output_tokens: 4 },
	}));
});

afterAll(() => {
	for (const k of Object.keys(process.env)) if (!(k in ORIG_ENV)) delete process.env[k];
	Object.assign(process.env, ORIG_ENV);
});

// onSettled is fire-and-forget; let its insert land before asserting on it.
async function flushHooks() {
	for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

describe('POST /api/x402/agents/:id without payment', () => {
	it('answers 402 with Solana USDC first, the agent payout wallet as payTo, and the configured price', async () => {
		await seedAgent({ service: ACTIVE });
		const { req, res } = mockReqRes({ body: 'message=hi', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
		await handler(req, res);
		expect(res.statusCode).toBe(402);
		const challenge = challengeOf(res);
		expect(challenge.accepts[0].network.startsWith('solana:')).toBe(true);
		expect(challenge.accepts[0].asset).toBe(USDC);
		expect(challenge.accepts[0].payTo).toBe(PAYOUT_WALLET);
		expect(challenge.accepts[0].amount).toBe('250000');
		// No $THREE accept on a per-agent price, no Base leg without a Base payout.
		expect(challenge.accepts.every((a) => a.asset === USDC)).toBe(true);
		expect(llmComplete).not.toHaveBeenCalled();
	});

	it("falls back to the agent's own Solana wallet, never its EVM wallet_address", async () => {
		await seedAgent({ service: ACTIVE, payout: false });
		const { req, res } = mockReqRes();
		await handler(req, res);
		expect(res.statusCode).toBe(402);
		expect(challengeOf(res).accepts[0].payTo).toBe(AGENT_WALLET);
	});

	it('404s an agent that is not on sale, private, brainless, or has no Solana wallet', async () => {
		const cases = [
			{ service: { ...ACTIVE, active: false }, code: 'service_inactive' },
			{ service: ACTIVE, isPublic: false, code: 'service_unavailable' },
			{ service: ACTIVE, embedPolicy: { brain: { mode: 'none' } }, code: 'service_unavailable' },
			{ service: ACTIVE, payout: false, solanaAddress: null, code: 'service_unavailable' },
		];
		for (const c of cases) {
			await holder.db.exec('truncate agent_identities, agent_payout_wallets');
			await seedAgent(c);
			const { req, res } = mockReqRes();
			await handler(req, res);
			expect(res.statusCode).toBe(404);
			expect(JSON.parse(res.body).error).toBe(c.code);
		}
	});
});

describe('POST /api/x402/agents/:id with payment', () => {
	it('runs one turn, settles, returns { reply, model, usage } and records revenue net of the platform fee', async () => {
		await seedAgent({ service: ACTIVE });
		const { req, res } = mockReqRes({
			headers: { 'content-type': 'application/json', 'x-payment': paymentHeader('ok') },
			body: { message: 'hi', history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'noted' }] },
		});
		await handler(req, res);
		expect(res.statusCode).toBe(200);
		const out = JSON.parse(res.body);
		expect(out).toMatchObject({ reply: 'Hello from Ada.', model: 'claude-haiku-4-5-20251001', agent_id: AGENT });
		expect(out.usage).toEqual({ input_tokens: 12, output_tokens: 4 });
		expect(settlePayment).toHaveBeenCalledTimes(1);
		// The turn saw the persona and the folded history.
		const call = llmComplete.mock.calls[0][0];
		expect(call.system).toContain('You are Ada.');
		expect(call.user).toContain('User: earlier');
		expect(call.user).toContain('Assistant: noted');
		expect(call.track).toMatchObject({ agentId: AGENT, tool: 'agent.api' });

		await flushHooks();
		const rows = await holder.db.query('select * from agent_revenue_events');
		expect(rows).toHaveLength(1);
		const fee = Math.floor((250000 * Number(process.env.PLATFORM_FEE_BPS ?? 250)) / 10000);
		expect(rows[0]).toMatchObject({
			agent_id: AGENT,
			skill: 'agent-api',
			intent_id: 'x402:SettleSig111111111111111111111111111111111111',
			chain: 'solana',
			currency_mint: USDC,
			payer_address: BUYER,
			owner_user_id: OWNER,
			settled_to_wallet: true,
		});
		expect(Number(rows[0].gross_amount)).toBe(250000);
		expect(Number(rows[0].fee_amount)).toBe(fee);
		expect(Number(rows[0].net_amount)).toBe(250000 - fee);
		expect(notifications).toHaveLength(1);
	});

	it('a failed turn is never charged: no settlement, no revenue, a 503 the buyer can act on', async () => {
		const { LlmUnavailableError } = await import('../../api/_lib/llm.js');
		llmComplete.mockImplementation(async () => {
			throw new LlmUnavailableError();
		});
		await seedAgent({ service: ACTIVE });
		const { req, res } = mockReqRes({
			headers: { 'content-type': 'application/json', 'x-payment': paymentHeader('down') },
			body: { message: 'hi' },
		});
		await handler(req, res);
		expect(res.statusCode).toBe(503);
		expect(JSON.parse(res.body).error).toBe('llm_unavailable');
		expect(settlePayment).not.toHaveBeenCalled();
		await flushHooks();
		expect(await holder.db.query('select * from agent_revenue_events')).toHaveLength(0);
	});

	it('a malformed body is refused before the payment is verified', async () => {
		await seedAgent({ service: ACTIVE });
		for (const body of ['{not json', { history: [] }, { message: 'x'.repeat(4001) }, { message: 'hi', history: [{ role: 'system', content: 'x' }] }]) {
			const { req, res } = mockReqRes({
				headers: { 'content-type': 'application/json', 'x-payment': paymentHeader('bad') },
				body,
			});
			await handler(req, res);
			expect(res.statusCode).toBe(400);
		}
		expect(verifyPayment).not.toHaveBeenCalled();
	});

	it('the same settlement recorded twice credits once (idempotent on the transaction)', async () => {
		await seedAgent({ service: ACTIVE });
		const { recordAgentApiSale } = await import('../../api/_lib/agent-api-service.js');
		const agent = { id: AGENT, user_id: OWNER, name: 'Oracle Ada' };
		const sale = { agent, payer: BUYER, network: SOLANA, txHash: 'DupSig', amountAtomics: '250000', asset: USDC };
		expect(await recordAgentApiSale(sale)).toBeTruthy();
		expect(await recordAgentApiSale(sale)).toBeNull();
		expect(await holder.db.query('select * from agent_revenue_events')).toHaveLength(1);
	});
});

describe('GET /api/x402/agents', () => {
	it('lists only sellable agents, with price, network and input schema', async () => {
		await seedAgent({ service: ACTIVE });
		const { req, res } = mockReqRes({ method: 'GET', url: '/api/x402/agents' });
		await handler(req, res);
		expect(res.statusCode).toBe(200);
		const out = JSON.parse(res.body);
		expect(out.count).toBe(1);
		expect(out.services[0]).toMatchObject({
			agent_id: AGENT,
			price_usd: 0.25,
			price_atomics: '250000',
			network_label: 'solana-mainnet',
			pay_to: PAYOUT_WALLET,
			method: 'POST',
		});
		expect(out.input_schema.required).toEqual(['message']);

		await holder.db.exec('truncate agent_identities, agent_payout_wallets');
		await seedAgent({ service: ACTIVE, isPublic: false });
		const second = mockReqRes({ method: 'GET', url: '/api/x402/agents' });
		await handler(second.req, second.res);
		expect(JSON.parse(second.res.body).count).toBe(0);
	});
});

describe('GET|PUT /api/agents/:id/api-service (owner switch)', () => {
	async function owner(method, body) {
		const { req, res } = mockReqRes({
			method,
			url: `/api/agents/${AGENT}/api-service?id=${AGENT}`,
			headers: body ? { 'content-type': 'application/json' } : {},
			body,
		});
		req.query = { id: AGENT };
		await ownerHandler(req, res);
		return { status: res.statusCode, body: JSON.parse(res.body) };
	}

	it('hides the agent from anyone but its owner', async () => {
		await seedAgent({});
		expect((await owner('GET')).status).toBe(401);
		authState.session = { id: '33333333-3333-4333-8333-333333333333' };
		expect((await owner('GET')).status).toBe(404);
	});

	it('returns the endpoint, payout, sellability and zeroed earnings for a fresh agent', async () => {
		await seedAgent({});
		authState.session = { id: OWNER };
		const { status, body } = await owner('GET');
		expect(status).toBe(200);
		expect(body.service.active).toBe(false);
		expect(body.endpoint_url).toMatch(new RegExp(`/api/x402/agents/${AGENT}$`));
		expect(body.pay_to.solana).toBe(PAYOUT_WALLET);
		expect(body.sellable).toEqual({ ok: true, reasons: [] });
		expect(body.earnings.calls).toBe(0);
		expect(body.limits.min_price_usd).toBeGreaterThan(0);
	});

	it('validates the price and description server-side', async () => {
		await seedAgent({});
		authState.session = { id: OWNER };
		expect((await owner('PUT', { active: true, price_usd: 0, description: 'Long enough text' })).body.error).toBe('invalid_price');
		expect((await owner('PUT', { active: true, price_usd: 999, description: 'Long enough text' })).body.error).toBe('invalid_price');
		expect((await owner('PUT', { active: true, price_usd: 0.1, description: 'short' })).body.error).toBe('invalid_description');
	});

	it('refuses to activate a private agent and says why', async () => {
		await seedAgent({ isPublic: false });
		authState.session = { id: OWNER };
		const { status, body } = await owner('PUT', ACTIVE);
		expect(status).toBe(409);
		expect(body.error).toBe('not_sellable');
		expect(body.reasons[0]).toMatch(/private/);
	});

	it('stores an active config on meta.api_service and the paid route picks it up', async () => {
		await seedAgent({});
		authState.session = { id: OWNER };
		const { status, body } = await owner('PUT', { active: true, price_usd: 0.05, description: '  Ask   Ada anything. ' });
		expect(status).toBe(200);
		expect(body.service).toMatchObject({ active: true, price_usd: 0.05, description: 'Ask Ada anything.' });
		const [row] = await holder.db.query('select meta from agent_identities where id = $1', [AGENT]);
		expect(row.meta.solana_address).toBe(AGENT_WALLET);
		expect(row.meta.api_service.active).toBe(true);

		const { req, res } = mockReqRes();
		await handler(req, res);
		expect(res.statusCode).toBe(402);
		expect(challengeOf(res).accepts[0].amount).toBe('50000');
	});
});
