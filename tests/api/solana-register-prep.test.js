import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

// ── Mocks ─────────────────────────────────────────────────────────────────

const authState = { session: null };

vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => authState.session),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));

const sqlState = { queue: [], calls: [] };
vi.mock('../../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlState.calls.push({ query: strings.join('?'), values });
		if (sqlState.queue.length === 0) return [];
		return sqlState.queue.shift();
	}),
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../../api/_lib/crypto.js', () => ({
	randomToken: vi.fn(async () => 'prep-token-stub'),
}));

vi.mock('../../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://localhost' },
}));

// Metaplex / Umi: stub out so the handler doesn't try to hit a real RPC.
const FAKE_TX = { __tag: 'fake-tx' };
vi.mock('@metaplex-foundation/umi-bundle-defaults', () => ({
	createUmi: vi.fn(() => ({
		use: function () { return this; },
		transactions: {
			serialize: vi.fn((tx) => {
				if (tx !== FAKE_TX) throw new Error('serialize called with unexpected tx');
				return new Uint8Array([1, 2, 3, 4]);
			}),
		},
	})),
}));
vi.mock('@metaplex-foundation/mpl-core', () => ({
	mplCore: vi.fn(() => () => {}),
	createV1: vi.fn(() => ({
		buildAndSign: vi.fn(async () => FAKE_TX),
	})),
	fetchAsset: vi.fn(),
}));
vi.mock('@metaplex-foundation/umi', () => ({
	generateSigner: vi.fn(() => ({ publicKey: 'GeneratedSigner1111111111111111111111111111' })),
	publicKey: vi.fn((s) => s),
	signerIdentity: vi.fn(() => () => {}),
	createNoopSigner: vi.fn((pk) => ({ publicKey: pk })),
}));

const { handleRegisterPrep: handler } = await import('../../api/agents/solana/_handlers.js');

// ── Helpers ──────────────────────────────────────────────────────────────

function makeReq({ method = 'POST', url = '/api/agents/solana-register-prep', body = null } = {}) {
	const base = body ? Readable.from([Buffer.from(JSON.stringify(body))]) : Readable.from([]);
	base.method = method;
	base.url = url;
	base.headers = {
		host: 'localhost',
		'content-type': 'application/json',
		origin: 'http://localhost',
	};
	return base;
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		end(chunk) { if (chunk !== undefined) this.body += chunk; this.writableEnded = true; },
	};
}

async function invoke(reqOpts) {
	const req = makeReq(reqOpts);
	const res = makeRes();
	await handler(req, res);
	return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

// 32-byte base58-ish pubkey (43 chars). Doesn't have to be a valid curve point
// for these unit tests — the handler only checks length + base58.
const VANITY_4 = 'AGNTAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const VANITY_5 = 'AGNTSaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PLAIN_PK = 'JUpiTERaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WALLET   = '11111111111111111111111111111111';

beforeEach(() => {
	authState.session = null;
	sqlState.queue = [];
	sqlState.calls = [];
});

describe('POST /api/agents/solana-register-prep — vanity', () => {
	it('rejects when unauthenticated', async () => {
		const { status, body } = await invoke({
			body: { name: 'A', wallet_address: WALLET, network: 'devnet' },
		});
		expect(status).toBe(401);
		expect(body.error).toBe('unauthorized');
	});

	it('rejects vanity_prefix without asset_pubkey', async () => {
		authState.session = { id: 'u1', plan: 'pro' };
		sqlState.queue.push([{ id: 'wallet-1' }]);
		const { status, body } = await invoke({
			body: { name: 'A', wallet_address: WALLET, network: 'devnet', vanity_prefix: 'AGNT' },
		});
		expect(status).toBe(400);
		expect(body.error).toBe('validation_error');
	});

	it('rejects mismatched prefix and asset_pubkey', async () => {
		authState.session = { id: 'u1', plan: 'pro' };
		sqlState.queue.push([{ id: 'wallet-1' }]);
		const { status, body } = await invoke({
			body: {
				name: 'A', wallet_address: WALLET, network: 'devnet',
				asset_pubkey: PLAIN_PK, vanity_prefix: 'AGNT',
			},
		});
		expect(status).toBe(400);
		expect(body.error_description).toMatch(/does not start with/);
	});

	it('rejects 5-char vanity for free-plan users with 402', async () => {
		authState.session = { id: 'u1', plan: 'free' };
		sqlState.queue.push([{ id: 'wallet-1' }]);
		const { status, body } = await invoke({
			body: {
				name: 'A', wallet_address: WALLET, network: 'devnet',
				asset_pubkey: VANITY_5, vanity_prefix: 'AGNTS',
			},
		});
		expect(status).toBe(402);
		expect(body.error).toBe('payment_required');
	});

	it('accepts 5-char vanity for paid users', async () => {
		authState.session = { id: 'u1', plan: 'pro' };
		sqlState.queue.push([{ id: 'wallet-1' }]); // user_wallets lookup
		sqlState.queue.push([]);                    // pending insert
		const { status, body } = await invoke({
			body: {
				name: 'A', wallet_address: WALLET, network: 'devnet',
				asset_pubkey: VANITY_5, vanity_prefix: 'AGNTS',
			},
		});
		expect(status).toBe(201);
		expect(body.asset_pubkey).toBe(VANITY_5);
		expect(body.tx_base64).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
	});

	it('accepts 4-char vanity for free-plan users', async () => {
		authState.session = { id: 'u1', plan: 'free' };
		sqlState.queue.push([{ id: 'wallet-1' }]);
		sqlState.queue.push([]);
		const { status, body } = await invoke({
			body: {
				name: 'A', wallet_address: WALLET, network: 'devnet',
				asset_pubkey: VANITY_4, vanity_prefix: 'AGNT',
			},
		});
		expect(status).toBe(201);
		expect(body.asset_pubkey).toBe(VANITY_4);
	});

	it('rejects non-base58 asset_pubkey', async () => {
		authState.session = { id: 'u1', plan: 'pro' };
		sqlState.queue.push([{ id: 'wallet-1' }]);
		const { status, body } = await invoke({
			body: {
				name: 'A', wallet_address: WALLET, network: 'devnet',
				asset_pubkey: '0OIl000000000000000000000000000000000000000',
			},
		});
		expect(status).toBe(400);
		expect(body.error).toBe('validation_error');
	});
});
