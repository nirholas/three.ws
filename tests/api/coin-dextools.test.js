// /api/coin/dextools: every DEXTools link on three.ws lands on the right pair
// page, and every landing is counted.
//
// The contract is "a visitor always reaches DEXTools": a resolved pool goes to
// its pair page, an unresolvable one goes to the token-keyed pair-explorer
// route DEXTools resolves itself, and a dead database never blocks the
// redirect. The counter row is what the DEXTools partnership is measured in, so
// its key (network, token, surface) is part of the contract too.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: () => {} }));
vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { marketDataIp: async () => ({ success: true }) },
	clientIp: () => '203.0.113.1',
}));

let topPoolForToken = vi.fn();
vi.mock('../../api/_lib/market/ohlcv.js', () => ({
	topPoolForToken: (...a) => topPoolForToken(...a),
}));

let sqlCalls = [];
let sqlImpl = async () => [];
vi.mock('../../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		sqlCalls.push({ text: strings.join('?'), values });
		return sqlImpl();
	},
	isDbUnavailableError: (err) => err?.code === 'db_unavailable',
}));

const handler = (await import('../../api/coin/dextools.js')).default;

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const THREE_PAIR = 'CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa';
// Clearly synthetic, so the generic path is exercised without a real third-party mint.
const SOL_TOKEN = 'THREEsynthetic1111111111111111111111111111';
const SOL_POOL = 'THREEsyntheticPoo11111111111111111111111111';
const EVM_TOKEN = '0x1234567890abcdef1234567890abcdef12345678';
const EVM_POOL = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; },
	};
}
async function call(query) {
	const res = makeRes();
	await handler({ url: `/api/coin/dextools?${query}`, method: 'GET', headers: {} }, res);
	return res;
}

describe('/api/coin/dextools', () => {
	beforeEach(() => {
		topPoolForToken = vi.fn();
		sqlCalls = [];
		sqlImpl = async () => [];
	});

	it('redirects a Solana mint to its top pool on DEXTools and counts the visit', async () => {
		topPoolForToken.mockResolvedValue(SOL_POOL);
		const res = await call(`address=${SOL_TOKEN}&from=launch-detail`);
		expect(res.statusCode).toBe(302);
		expect(res.getHeader('location')).toBe(`https://www.dextools.io/app/solana/pair-explorer/${SOL_POOL}`);
		expect(res.getHeader('cache-control')).toBe('no-store');
		expect(topPoolForToken).toHaveBeenCalledWith(SOL_TOKEN, 'solana');
		expect(sqlCalls).toHaveLength(1);
		expect(sqlCalls[0].text).toMatch(/insert into dextools_referrals/);
		expect(sqlCalls[0].values).toEqual(['solana', SOL_TOKEN, 'launch-detail']);
	});

	it('pins $THREE to the pair its Social Boost wins were credited to', async () => {
		topPoolForToken.mockResolvedValue(SOL_POOL);
		const res = await call(`address=${THREE_MINT}&from=three-token`);
		expect(res.getHeader('location')).toBe(`https://www.dextools.io/app/solana/pair-explorer/${THREE_PAIR}`);
		expect(topPoolForToken).not.toHaveBeenCalled();
		expect(sqlCalls[0].values).toEqual(['solana', THREE_MINT, 'three-token']);
	});

	it('maps EVM networks to DEXTools chain slugs', async () => {
		topPoolForToken.mockResolvedValue(EVM_POOL);
		const eth = await call(`address=${EVM_TOKEN}&network=eth`);
		expect(eth.getHeader('location')).toBe(`https://www.dextools.io/app/ether/pair-explorer/${EVM_POOL}`);
		const bsc = await call(`address=${EVM_TOKEN}&network=bsc`);
		expect(bsc.getHeader('location')).toBe(`https://www.dextools.io/app/bnb/pair-explorer/${EVM_POOL}`);
	});

	it('still lands on DEXTools, keyed by the token, when no pool resolves', async () => {
		topPoolForToken.mockRejectedValue(Object.assign(new Error('no pool'), { status: 404 }));
		const res = await call(`address=${SOL_TOKEN}`);
		expect(res.statusCode).toBe(302);
		expect(res.getHeader('location')).toBe(`https://www.dextools.io/app/solana/pair-explorer/${SOL_TOKEN}`);
	});

	it('never blocks the redirect on a database failure', async () => {
		topPoolForToken.mockResolvedValue(THREE_PAIR);
		sqlImpl = async () => { throw Object.assign(new Error('down'), { code: 'db_unavailable' }); };
		const res = await call(`address=${THREE_MINT}`);
		expect(res.statusCode).toBe(302);
		expect(res.getHeader('location')).toContain(THREE_PAIR);
	});

	it('files an unrecognised surface label under "direct"', async () => {
		topPoolForToken.mockResolvedValue(THREE_PAIR);
		await call(`address=${THREE_MINT}&from=${encodeURIComponent('<script>')}`);
		expect(sqlCalls[0].values[2]).toBe('direct');
	});

	it('rejects a malformed address before any lookup', async () => {
		const res = await call('address=not-a-mint');
		expect(res.statusCode).toBe(400);
		expect(topPoolForToken).not.toHaveBeenCalled();
		expect(sqlCalls).toHaveLength(0);
	});

	it('rejects an unknown network', async () => {
		const res = await call(`address=${THREE_MINT}&network=tron`);
		expect(res.statusCode).toBe(400);
	});
});
