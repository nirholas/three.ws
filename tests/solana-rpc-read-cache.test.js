// The fresh-read cache and in-flight coalescing in front of the Solana RPC
// lanes (api/_lib/solana/connection.js), plus the per-route call accounting that
// counts what reached a provider and what was saved (api/_lib/solana/rpc-spend.js).
//
// What must hold: identical concurrent reads cost one upstream call; a hot read is
// reused only inside its method's TTL; `fresh: true` always goes upstream; an
// error is never cached; and writes (sendTransaction, simulateTransaction) are
// never shared, however identical.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	makeRotatingFetch,
	readShareKey,
	readCacheTtlMs,
	_resetReadCache,
} from '../api/_lib/solana/connection.js';
import { readRpcSpend, summarizeRpcSpend, _resetRpcSpend } from '../api/_lib/solana/rpc-spend.js';
import { runWithRpcCaller } from '../api/_lib/request-context.js';
import { sharedRpcRead, sharedReadKey } from '../api/_lib/solana/shared-reads.js';
import { cacheDel } from '../api/_lib/cache.js';

const OWNER = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const rpcBody = (method, params, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const post = (body, extra = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body, ...extra });
const ok = (result, id = 1) =>
	new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, headers: { 'content-type': 'application/json' } });

let seq = 0;
const chain = () => {
	seq += 1;
	return [`https://cache-a${seq}.test/`, `https://cache-b${seq}.test/`];
};

describe('Solana RPC fresh-read cache and coalescing', () => {
	let origFetch;
	beforeEach(() => {
		origFetch = global.fetch;
		_resetReadCache();
		_resetRpcSpend();
	});
	afterEach(() => {
		global.fetch = origFetch;
		vi.useRealTimers();
	});

	it('serves a repeat read inside the TTL from cache, re-addressed to the new id', async () => {
		const fetchSpy = vi.fn(async () => ok({ context: { slot: 1 }, value: 42 }));
		global.fetch = fetchSpy;
		const rf = makeRotatingFetch(chain());
		const a = await rf(null, post(rpcBody('getBalance', [OWNER], 7)));
		const b = await rf(null, post(rpcBody('getBalance', [OWNER], 8)));
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect((await a.json()).id).toBe(7);
		expect(b.headers.get('x-solana-rpc-cache')).toBe('hit');
		const bj = await b.json();
		expect(bj.id).toBe(8);
		expect(bj.result.value).toBe(42);
	});

	it('expires an entry after its method TTL and goes upstream again', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
		const fetchSpy = vi.fn(async () => ok({ blockhash: 'h', lastValidBlockHeight: 1 }));
		global.fetch = fetchSpy;
		const rf = makeRotatingFetch(chain());
		const body = rpcBody('getLatestBlockhash', [{ commitment: 'confirmed' }]);
		await rf(null, post(body));
		vi.setSystemTime(new Date('2026-11-04T10:00:01.500Z'));
		await rf(null, post(body));
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		// getLatestBlockhash lives 2s, never longer.
		vi.setSystemTime(new Date('2026-11-04T10:00:02.100Z'));
		await rf(null, post(body));
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('keys on params, commitment included', async () => {
		const fetchSpy = vi.fn(async () => ok({ context: { slot: 1 }, value: 1 }));
		global.fetch = fetchSpy;
		const rf = makeRotatingFetch(chain());
		await rf(null, post(rpcBody('getBalance', [OWNER, { commitment: 'confirmed' }])));
		await rf(null, post(rpcBody('getBalance', [OWNER, { commitment: 'finalized' }])));
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('never shares a read across two different endpoint chains', async () => {
		const fetchSpy = vi.fn(async () => ok({ context: { slot: 1 }, value: 1 }));
		global.fetch = fetchSpy;
		const body = rpcBody('getBalance', [OWNER]);
		await makeRotatingFetch(chain())(null, post(body));
		await makeRotatingFetch(chain())(null, post(body));
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('bypasses both cache and coalescing for a fresh connection', async () => {
		const fetchSpy = vi.fn(async () => ok({ context: { slot: 1 }, value: 5 }));
		global.fetch = fetchSpy;
		const eps = chain();
		const shared = makeRotatingFetch(eps);
		const fresh = makeRotatingFetch(eps, { fresh: true });
		const body = rpcBody('getBalance', [OWNER]);
		await shared(null, post(body));
		await fresh(null, post(body));
		await Promise.all([fresh(null, post(body)), fresh(null, post(body))]);
		expect(fetchSpy).toHaveBeenCalledTimes(4);
	});

	it('does not cache an error answer', async () => {
		let n = 0;
		global.fetch = vi.fn(async () => {
			n += 1;
			// Deterministic JSON-RPC error: handed back to the caller, never rotated.
			return new Response(
				JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid param: WrongSize' } }),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			);
		});
		const rf = makeRotatingFetch(chain());
		const body = rpcBody('getAccountInfo', ['not-a-key']);
		const first = await (await rf(null, post(body))).json();
		expect(first.error.code).toBe(-32602);
		await rf(null, post(body));
		expect(n).toBe(2);
	});

	it('does not cache a thrown failure: the next caller retries upstream', async () => {
		let healthy = false;
		global.fetch = vi.fn(async () =>
			healthy ? ok({ context: { slot: 1 }, value: 9 }) : new Response('', { status: 503 }),
		);
		const rf = makeRotatingFetch(chain());
		const body = rpcBody('getTokenAccountsByOwner', [OWNER, { programId: 'Tokenkeg' }, { encoding: 'jsonParsed' }]);
		await expect(rf(null, post(body))).rejects.toThrow();
		healthy = true;
		const out = await (await rf(null, post(body))).json();
		expect(out.result.value).toBe(9);
	});

	it('coalesces identical concurrent reads into one upstream call', async () => {
		let release;
		const gate = new Promise((r) => {
			release = r;
		});
		const fetchSpy = vi.fn(async () => {
			await gate;
			return ok({ context: { slot: 1 }, value: { lamports: 1 } });
		});
		global.fetch = fetchSpy;
		const rf = makeRotatingFetch(chain());
		const calls = [1, 2, 3, 4].map((id) =>
			rf(null, post(rpcBody('getAccountInfo', [OWNER, { encoding: 'base64' }], id))),
		);
		release();
		const out = await Promise.all(calls.map(async (p) => (await p).json()));
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(out.map((o) => o.id)).toEqual([1, 2, 3, 4]);
	});

	it('a follower that aborts gives up alone; the leader still gets its answer', async () => {
		let release;
		const gate = new Promise((r) => {
			release = r;
		});
		global.fetch = vi.fn(async () => {
			await gate;
			return ok({ context: { slot: 1 }, value: 3 });
		});
		const rf = makeRotatingFetch(chain());
		const body = rpcBody('getBalance', [OWNER]);
		const leader = rf(null, post(body));
		const ac = new AbortController();
		const follower = rf(null, post(body, { signal: ac.signal }));
		ac.abort();
		await expect(follower).rejects.toThrow();
		release();
		expect((await (await leader).json()).result.value).toBe(3);
	});

	it('never coalesces or caches sendTransaction or simulateTransaction', async () => {
		const fetchSpy = vi.fn(async () => ok('sig'));
		global.fetch = fetchSpy;
		const rf = makeRotatingFetch(chain());
		const send = rpcBody('sendTransaction', ['AQID', { encoding: 'base64' }]);
		const sim = rpcBody('simulateTransaction', ['AQID', { encoding: 'base64' }]);
		await Promise.all([rf(null, post(send)), rf(null, post(send))]);
		await rf(null, post(send));
		await Promise.all([rf(null, post(sim)), rf(null, post(sim))]);
		expect(fetchSpy).toHaveBeenCalledTimes(5);
		expect(readShareKey(JSON.parse(send))).toBeNull();
		expect(readShareKey(JSON.parse(sim))).toBeNull();
	});

	it('never shares a batch', async () => {
		const batchBody = JSON.stringify([
			{ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [OWNER] },
			{ jsonrpc: '2.0', id: 2, method: 'getBalance', params: [OWNER] },
		]);
		const fetchSpy = vi.fn(
			async () =>
				new Response(
					JSON.stringify([
						{ jsonrpc: '2.0', id: 1, result: { value: 1 } },
						{ jsonrpc: '2.0', id: 2, result: { value: 1 } },
					]),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
		);
		global.fetch = fetchSpy;
		const rf = makeRotatingFetch(chain());
		await rf(null, post(batchBody));
		await rf(null, post(batchBody));
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('caches getSignatureStatuses only once every status is finalized', () => {
		expect(readCacheTtlMs('getSignatureStatuses', { value: [null] })).toBe(0);
		expect(readCacheTtlMs('getSignatureStatuses', { value: [{ confirmationStatus: 'confirmed' }] })).toBe(0);
		expect(
			readCacheTtlMs('getSignatureStatuses', {
				value: [{ confirmationStatus: 'finalized' }, { confirmationStatus: 'processed' }],
			}),
		).toBe(0);
		expect(readCacheTtlMs('getSignatureStatuses', { value: [{ confirmationStatus: 'finalized' }] })).toBe(30_000);
	});

	it('keeps every method TTL inside the bound the work order sets', () => {
		expect(readCacheTtlMs('getLatestBlockhash', {})).toBe(2_000);
		for (const m of ['getBalance', 'getTokenAccountsByOwner', 'getAccountInfo']) {
			const ttl = readCacheTtlMs(m, {});
			expect(ttl).toBeGreaterThanOrEqual(3_000);
			expect(ttl).toBeLessThanOrEqual(5_000);
		}
		expect(readCacheTtlMs('getTransaction', {})).toBe(0);
		expect(readCacheTtlMs('getSignaturesForAddress', [])).toBe(0);
	});
});

describe('Solana RPC call accounting', () => {
	let origFetch;
	beforeEach(() => {
		origFetch = global.fetch;
		_resetReadCache();
		_resetRpcSpend();
	});
	afterEach(() => {
		global.fetch = origFetch;
	});

	it('counts upstream calls by caller, method and lane, and saved reads separately', async () => {
		global.fetch = vi.fn(async () => ok({ context: { slot: 1 }, value: 1 }));
		const eps = chain();
		const rf = makeRotatingFetch(eps);
		await runWithRpcCaller('/api/test/route', async () => {
			await rf(null, post(rpcBody('getBalance', [OWNER])));
			await rf(null, post(rpcBody('getBalance', [OWNER])));
			await rf(null, post(rpcBody('sendTransaction', ['AQID'])));
		});
		const { rows } = await readRpcSpend({ hours: 1 });
		const lane = new URL(eps[0]).host;
		const find = (method, l) =>
			rows.find((r) => r.caller === '/api/test/route' && r.method === method && r.lane === l);
		expect(find('getBalance', lane)?.calls).toBe(1);
		expect(find('getBalance', 'cache')?.calls).toBe(1);
		expect(find('sendTransaction', lane)?.calls).toBe(1);
		const summary = summarizeRpcSpend(rows);
		expect(summary.calls).toBe(2);
		expect(summary.saved).toBe(1);
		expect(summary.topCaller).toEqual({ caller: '/api/test/route', calls: 2 });
	});

	it('meters each member of a batch, because providers bill them individually', async () => {
		const batchBody = JSON.stringify([
			{ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [OWNER] },
			{ jsonrpc: '2.0', id: 2, method: 'getAccountInfo', params: [OWNER] },
			{ jsonrpc: '2.0', id: 3, method: 'getBalance', params: ['THREEsynthetic11111111111111111111111111111'] },
		]);
		global.fetch = vi.fn(
			async () =>
				new Response(JSON.stringify([1, 2, 3].map((id) => ({ jsonrpc: '2.0', id, result: { value: id } }))), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
		);
		const rf = makeRotatingFetch(chain());
		await runWithRpcCaller('cron:batch', () => rf(null, post(batchBody)));
		const { rows } = await readRpcSpend({ hours: 1 });
		const byMethod = Object.fromEntries(
			rows.filter((r) => r.caller === 'cron:batch').map((r) => [r.method, r.calls]),
		);
		expect(byMethod).toEqual({ getBalance: 2, getAccountInfo: 1 });
	});
});

// The fleet-wide tier (api/_lib/solana/shared-reads.js) behind /api/crypto/holders
// and /api/crypto/security: one mint scanned on both routes, possibly on two
// instances, must cost one getAccountInfo and one getTokenLargestAccounts.
describe('shared mint reads across routes and instances', () => {
	let origFetch;
	const keys = [];
	beforeEach(() => {
		origFetch = global.fetch;
		_resetReadCache();
		_resetRpcSpend();
	});
	afterEach(async () => {
		global.fetch = origFetch;
		for (const k of keys.splice(0)) await cacheDel(k);
	});
	const track = (method, params) => {
		const k = sharedReadKey(method, params);
		keys.push(k);
		return k;
	};

	it('serves the second caller from the shared cache, even through a different rotating fetch', async () => {
		const params = [OWNER, { encoding: 'jsonParsed', commitment: 'confirmed' }];
		track('getAccountInfo', params);
		const fetchSpy = vi.fn(async () => ok({ context: { slot: 9 }, value: { lamports: 1 } }));
		global.fetch = fetchSpy;
		const eps = chain();
		const a = await sharedRpcRead(makeRotatingFetch(eps), 'getAccountInfo', params, { ttlSeconds: 30 });
		// A different instance has its own process cache; simulate it by clearing ours.
		_resetReadCache();
		const b = await sharedRpcRead(makeRotatingFetch(eps), 'getAccountInfo', params, { ttlSeconds: 30 });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(b).toEqual(a);
		const { rows } = await readRpcSpend({ hours: 1 });
		expect(rows.find((r) => r.method === 'getAccountInfo' && r.lane === 'cache')?.calls).toBe(1);
	});

	it('never stores a JSON-RPC error, so the next caller retries upstream', async () => {
		const params = ['THREEsynthetic11111111111111111111111111111', { commitment: 'confirmed' }];
		track('getTokenLargestAccounts', params);
		let n = 0;
		global.fetch = vi.fn(async () => {
			n += 1;
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid param: not a Token mint' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		});
		const rf = makeRotatingFetch(chain());
		const first = await sharedRpcRead(rf, 'getTokenLargestAccounts', params, { ttlSeconds: 30 });
		_resetReadCache();
		await sharedRpcRead(rf, 'getTokenLargestAccounts', params, { ttlSeconds: 30 });
		expect(first.error.code).toBe(-32602);
		expect(n).toBe(2);
	});

	it('never republishes a stale last-good answer into the shared tier', async () => {
		const params = [OWNER, { encoding: 'base64', commitment: 'confirmed' }];
		track('getAccountInfo', params);
		let n = 0;
		const staleFetch = vi.fn(async () => {
			n += 1;
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: null } }), {
				status: 200,
				headers: { 'content-type': 'application/json', 'x-solana-rpc-stale': '120000' },
			});
		});
		await sharedRpcRead(staleFetch, 'getAccountInfo', params, { ttlSeconds: 30 });
		await sharedRpcRead(staleFetch, 'getAccountInfo', params, { ttlSeconds: 30 });
		expect(n).toBe(2);
	});

	it('keys on params, so a different mint or encoding is a different entry', () => {
		const a = sharedReadKey('getAccountInfo', [OWNER, { encoding: 'jsonParsed' }]);
		expect(sharedReadKey('getAccountInfo', [OWNER, { encoding: 'base64' }])).not.toBe(a);
		expect(sharedReadKey('getAccountInfo', ['THREEsynthetic11111111111111111111111111111', { encoding: 'jsonParsed' }])).not.toBe(a);
		expect(sharedReadKey('getTokenLargestAccounts', [OWNER, { encoding: 'jsonParsed' }])).not.toBe(a);
		expect(sharedReadKey('getAccountInfo', [OWNER, { encoding: 'jsonParsed' }])).toBe(a);
	});
});
