// Graduation cards on the live pump.fun feed are enriched with the coin record
// and the creator's launch history. On 2026-11-25 pump.fun retired both routes
// the enrichment read (GET /coins-v2/<mint> and /coins/user-created-coins/<C>,
// each now 404), so every graduation rendered bare: no name, image, ATH or
// "creator has launched N coins". The coin now comes from the search route
// (exact mint match) and the creator's coins from GET /coins?creator=<C>.

import { describe, it, expect, vi } from 'vitest';

class FakeWS {
	constructor(url) {
		this.url = url;
		this.sent = [];
		this._h = {};
		FakeWS.instances.push(this);
	}
	on(ev, cb) { (this._h[ev] ||= []).push(cb); return this; }
	emit(ev, ...args) { (this._h[ev] || []).forEach((cb) => cb(...args)); }
	send(data) { this.sent.push(JSON.parse(data)); }
	close() { this.emit('close'); }
}
FakeWS.instances = [];

vi.mock('ws', () => ({ default: FakeWS }));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
vi.mock('../api/_lib/env.js', () => ({ env: { DATABASE_URL: 'postgres://test', APP_ORIGIN: 'http://test' } }));

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const CREATOR = 'THREEsyntheticCreator111111111111111111111';
const SIBLING = 'THREEsynthetic11111111111111111111111111pump';

const seen = [];
function jres(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}
globalThis.fetch = vi.fn(async (url) => {
	const u = new URL(String(url));
	seen.push(u);
	if (u.hostname.includes('coingecko')) return jres({ solana: { usd: 150 } });
	if (u.hostname === 'frontend-api-v3.pump.fun') {
		if (u.pathname === '/coins/search-unrestricted' && u.searchParams.get('searchTerm') === THREE) {
			return jres([{ mint: THREE, name: 'three.ws', symbol: 'three', creator: CREATOR, complete: true, usd_market_cap: 420000, ath_market_cap: 16_000_000, image_uri: 'https://ipfs.io/ipfs/bafy-three', pump_swap_pool: 'PoolSynthetic', created_timestamp: 1777441309000 }]);
		}
		if (u.pathname === '/coins' && u.searchParams.get('creator') === CREATOR) {
			return jres([
				{ mint: THREE, name: 'three.ws', symbol: 'three', creator: CREATOR, complete: true, usd_market_cap: 420000 },
				{ mint: SIBLING, name: 'synthetic', symbol: 'SYN', creator: CREATOR, complete: false, usd_market_cap: 4000 },
			]);
		}
		return jres({ statusCode: 404, message: `Cannot GET ${u.pathname}` }, 404);
	}
	return jres({}, 404);
});

const { connectPumpFunFeed } = await import('../api/_lib/pumpfun-ws-feed.js');

describe('graduation enrichment', () => {
	it('reads the coin from pump.fun search and the creator history from /coins?creator', async () => {
		const events = [];
		const stop = connectPumpFunFeed({ kind: 'graduation', onEvent: (e) => events.push(e) });
		const ws = FakeWS.instances[0];
		ws.emit('open');
		ws.emit('message', JSON.stringify({ txType: 'migrate', mint: THREE, signature: 'sig-grad-1', pool: 'pump-amm' }));
		await vi.waitFor(() => expect(events.find((e) => e.kind === 'graduation')).toBeTruthy());
		stop();

		const g = events.find((e) => e.kind === 'graduation').data;
		expect(g).toMatchObject({
			mint: THREE,
			name: 'three.ws',
			symbol: 'three',
			creator: CREATOR,
			image_uri: 'https://ipfs.io/ipfs/bafy-three',
			ath_market_cap: 16_000_000,
			creator_launches: 2,
			creator_graduated: 1,
		});
		expect(g.creator_tokens.map((t) => t.symbol)).toEqual(['three', 'SYN']);
		const creatorCall = seen.find((u) => u.pathname === '/coins' && u.searchParams.get('creator') === CREATOR);
		expect(creatorCall.searchParams.get('includeNsfw')).toBe('true');
	});
});
