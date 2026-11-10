// POST /api/marketplace/purchase-bundle (create): the quote a buyer pays against.
//
// Covers: an inactive or unknown bundle is rejected, a buyer who already owns
// every priced skill is told so instead of getting a second pending row, and the
// platform fee is resolved with the argument the resolver actually takes. The
// handler once passed { priceAmount, currencyMint, chain } to a resolver that
// reads { grossAtomics } and then read fields it never returns, so on a no-fee
// deployment it dereferenced null and every bundle checkout answered 500.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';

const BUNDLE_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const PAYOUT = Keypair.generate().publicKey.toBase58();
const TREASURY = Keypair.generate().publicKey.toBase58();

const db = { bundle: null, ownedSkills: [], inserts: [] };

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn((strings, ...values) => {
		const text = (Array.isArray(strings) ? strings.join('?') : String(strings)).toLowerCase();
		if (/from skill_bundles/.test(text)) return Promise.resolve(db.bundle ? [db.bundle] : []);
		if (/from agent_payout_wallets/.test(text)) return Promise.resolve([{ address: PAYOUT }]);
		if (/from skill_purchases/.test(text)) return Promise.resolve(db.ownedSkills.map((skill) => ({ skill })));
		if (/from agent_skill_prices/.test(text)) return Promise.resolve(db.pricedSkills.map((skill) => ({ skill })));
		if (/insert into bundle_purchases/.test(text)) {
			db.inserts.push(values);
			return Promise.resolve([{ id: '22222222-2222-4222-8222-222222222222' }]);
		}
		return Promise.resolve([]);
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => ({ id: 'user-1' })),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));

const { default: handler } = await import('../api/marketplace/purchase-bundle.js');

function makeRes() {
	return {
		statusCode: 0, payload: null, headers: {},
		setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this.headers[String(k).toLowerCase()]; },
		removeHeader(k) { delete this.headers[String(k).toLowerCase()]; },
		writeHead(code) { this.statusCode = code; return this; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		end(chunk) {
			if (chunk) { try { this.payload = JSON.parse(String(chunk)); } catch { this.payload = String(chunk); } }
			return this;
		},
	};
}

async function create(body = { bundle_id: BUNDLE_ID }) {
	const res = makeRes();
	const raw = JSON.stringify(body);
	const req = {
		method: 'POST', url: '/api/marketplace/purchase-bundle',
		headers: { 'content-type': 'application/json' },
		on(ev, cb) { if (ev === 'data') cb(Buffer.from(raw)); if (ev === 'end') cb(); return this; },
		[Symbol.asyncIterator]: async function* () { yield Buffer.from(raw); },
	};
	await handler(req, res);
	return res;
}

beforeEach(() => {
	db.bundle = {
		id: BUNDLE_ID, agent_id: AGENT_ID, price_amount: '2400000',
		currency_mint: THREE, chain: 'solana', skills: ['research', 'summarize'],
	};
	db.ownedSkills = [];
	db.pricedSkills = ['research', 'summarize'];
	db.inserts = [];
	delete process.env.MARKETPLACE_PLATFORM_FEE_BPS;
	delete process.env.MARKETPLACE_PLATFORM_FEE_WALLET;
});

describe('purchase-bundle create', () => {
	it('rejects an inactive or unknown bundle', async () => {
		db.bundle = null;
		const res = await create();
		expect(res.statusCode).toBe(404);
		expect(db.inserts).toHaveLength(0);
	});

	it('does not open a second purchase for a buyer who owns every priced skill', async () => {
		db.ownedSkills = ['research', 'summarize'];
		const res = await create();
		expect(res.statusCode).toBe(200);
		expect(res.payload.data.already_owned).toBe(true);
		expect(db.inserts).toHaveLength(0);
	});

	it('still sells a bundle to a buyer who owns only some of its skills', async () => {
		db.ownedSkills = ['research'];
		const res = await create();
		expect(res.statusCode).toBe(201);
	});

	it('quotes a full-price transfer when no platform fee is configured', async () => {
		const res = await create();
		expect(res.statusCode).toBe(201);
		const d = res.payload.data;
		expect(d.fee_amount).toBe(0);
		expect(d.fee).toBeNull();
		expect(d.creator_amount).toBe('2400000');
		expect(d.recipient).toBe(PAYOUT);
		expect(d.purchase_id).toBeTruthy();
	});

	it('splits the platform fee off the bundle price when one is configured', async () => {
		process.env.MARKETPLACE_PLATFORM_FEE_BPS = '250';
		process.env.MARKETPLACE_PLATFORM_FEE_WALLET = TREASURY;
		const res = await create();
		expect(res.statusCode).toBe(201);
		const d = res.payload.data;
		expect(d.fee_amount).toBe(60000);
		expect(d.treasury).toBe(TREASURY);
		expect(d.fee).toEqual({ recipient: TREASURY, amount: '60000', bps: 250 });
		expect(d.creator_amount).toBe('2340000');
	});
});
