import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── upstream source mocks ─────────────────────────────────────────────────────

const mintsMock = vi.fn();
const whalesMock = vi.fn();
const claimsMock = vi.fn();

vi.mock('../api/_lib/channel-feed-sources.js', () => ({
	getMints: (...a) => mintsMock(...a),
	getWhales: (...a) => whalesMock(...a),
	getClaims: (...a) => claimsMock(...a),
}));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { mcpIp: vi.fn(async () => ({ success: true })) },
	clientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://test', ISSUER: 'http://test', MCP_RESOURCE: 'http://test' },
}));

const { default: handler } = await import('../api/pump/channel-feed.js');

// ── helpers ────────────────────────────────────────────────────────────────────

function mockRes() {
	const res = {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(b) { this.body = b; },
	};
	return res;
}

function mockReq(search = '') {
	return {
		method: 'GET',
		headers: { host: 'localhost' },
		url: `/api/pump/channel-feed${search}`,
	};
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('channel-feed endpoint', () => {
	beforeEach(() => {
		mintsMock.mockReset();
		whalesMock.mockReset();
		claimsMock.mockReset();
		mintsMock.mockResolvedValue([]);
		whalesMock.mockResolvedValue([]);
		claimsMock.mockResolvedValue([]);
	});

	it('returns 200 with items array', async () => {
		mintsMock.mockResolvedValueOnce([
			{ signature: 'sig1', mint: 'MINT1', timestamp: 1000, name: 'Alpha', symbol: 'ALPHA' },
		]);

		const res = mockRes();
		await handler(mockReq(), res);

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body).toHaveProperty('items');
		expect(Array.isArray(body.items)).toBe(true);
		expect(body.items[0]).toMatchObject({ kind: 'mint', mint: 'MINT1', signature: 'sig1' });
	});

	it('dedupes items sharing a signature across sources', async () => {
		mintsMock.mockResolvedValueOnce([
			{ signature: 'dup', mint: 'MINT1', timestamp: 1000 },
		]);
		whalesMock.mockResolvedValueOnce([
			{ signature: 'dup', mint: 'MINT1', timestamp: 1000 }, // duplicate
			{ signature: 'unique', mint: 'MINT2', timestamp: 2000 },
		]);

		const res = mockRes();
		await handler(mockReq(), res);

		const body = JSON.parse(res.body);
		expect(body.items).toHaveLength(2);
		const sigs = body.items.map((i) => i.signature);
		expect(sigs).toContain('dup');
		expect(sigs).toContain('unique');
		expect(sigs.filter((s) => s === 'dup')).toHaveLength(1);
	});

	it('sorts newest first by ts', async () => {
		mintsMock.mockResolvedValueOnce([
			{ signature: 'old', mint: 'M1', timestamp: 100 },
			{ signature: 'new', mint: 'M2', timestamp: 9000 },
		]);

		const res = mockRes();
		await handler(mockReq(), res);

		const body = JSON.parse(res.body);
		expect(body.items[0].signature).toBe('new');
		expect(body.items[1].signature).toBe('old');
	});

	it('kinds=mint,claim excludes whale events', async () => {
		mintsMock.mockResolvedValueOnce([
			{ signature: 'mint1', mint: 'M1', timestamp: 100 },
		]);
		whalesMock.mockResolvedValueOnce([
			{ signature: 'whale1', mint: 'M2', timestamp: 200 },
		]);
		claimsMock.mockResolvedValueOnce([
			{ tx_signature: 'claim1', mint: 'M3', timestamp: 300 },
		]);

		const res = mockRes();
		await handler(mockReq('?kinds=mint,claim'), res);

		const body = JSON.parse(res.body);
		const kinds = body.items.map((i) => i.kind);
		expect(kinds).not.toContain('whale');
		expect(kinds).toContain('mint');
		expect(kinds).toContain('claim');
		// whale source should not have been called (or its results excluded)
		const hasWhale = body.items.some((i) => i.signature === 'whale1');
		expect(hasWhale).toBe(false);
	});

	it('respects limit param', async () => {
		mintsMock.mockResolvedValueOnce(
			Array.from({ length: 30 }, (_, i) => ({
				signature: `s${i}`,
				mint: `M${i}`,
				timestamp: i,
			})),
		);

		const res = mockRes();
		await handler(mockReq('?limit=5'), res);

		const body = JSON.parse(res.body);
		expect(body.items.length).toBeLessThanOrEqual(5);
	});

	it('normalizes tx_signature fallback', async () => {
		claimsMock.mockResolvedValueOnce([
			{ tx_signature: 'claimsig', mint: 'CM1', timestamp: 500 },
		]);

		const res = mockRes();
		await handler(mockReq(), res);

		const body = JSON.parse(res.body);
		const claim = body.items.find((i) => i.kind === 'claim');
		expect(claim?.signature).toBe('claimsig');
	});

	it('returns empty items when all sources are empty', async () => {
		const res = mockRes();
		await handler(mockReq(), res);

		const body = JSON.parse(res.body);
		expect(body.items).toEqual([]);
	});
});
