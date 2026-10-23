// Landing race: real JSON-RPC over local HTTP servers (no mocks of our own
// modules). Each fake node speaks the Solana JSON-RPC methods the engine calls
// and shares one "chain" so a landing on any node is visible to the others.

import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Connection, Keypair, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { resolveTipLamports, submitProtected } from '../api/_lib/execution-engine.js';
import {
	LandingStats,
	createSqlStatsStore,
	getLandingStats,
	raceLanes,
	resetLandingStats,
	rpcLane,
	rpcProbe,
} from '../api/_lib/landing-race.js';
import { resolveLandingProviders } from '../api/_lib/landing-providers.js';

const servers = [];

/** A Solana-speaking node. `delayMs` slows every answer, `failSend` makes sendTransaction 500. */
function fakeNode({ delayMs = 0, failSend = false, landOnSend = true, healthy = true, chain }) {
	const state = { sends: 0, requests: 0 };
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			state.requests += 1;
			const { id, method, params } = JSON.parse(body);
			const reply = (result) => {
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
			};
			setTimeout(() => {
				if (!healthy) {
					res.statusCode = 503;
					return res.end('down');
				}
				if (method === 'sendTransaction') {
					state.sends += 1;
					if (failSend) {
						res.statusCode = 500;
						return res.end('boom');
					}
					try {
						const tx = VersionedTransaction.deserialize(Buffer.from(params[0], 'base64'));
						if (landOnSend) chain.landed.set(bs58.encode(tx.signatures[0]), 100 + chain.landed.size);
					} catch {
						// not a transaction: nothing to land
					}
					return reply('ok');
				}
				if (method === 'getSignatureStatuses') {
					return reply({
						context: { slot: 99 },
						value: (params[0] || []).map((sig) =>
							chain.landed.has(sig)
								? { slot: chain.landed.get(sig), confirmations: null, err: null, confirmationStatus: 'confirmed' }
								: null,
						),
					});
				}
				if (method === 'getLatestBlockhash')
					return reply({ context: { slot: 99 }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 10_000 } });
				if (method === 'simulateTransaction')
					return reply({ context: { slot: 99 }, value: { err: null, logs: [], unitsConsumed: 40_000 } });
				if (method === 'getRecentPrioritizationFees') return reply([{ slot: 1, prioritizationFee: 2000 }]);
				if (method === 'getBlockHeight') return reply(50);
				return reply(null);
			}, delayMs);
		});
	});
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			servers.push(server);
			resolve({ url: `http://127.0.0.1:${server.address().port}`, state, server });
		});
	});
}

function newChain() {
	return { landed: new Map() };
}

afterEach(async () => {
	await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
	resetLandingStats();
	delete process.env.LANDING_EXTRA_RPC_URL;
	delete process.env.LANDING_MAX_TIP_LAMPORTS;
});

describe('raceLanes', () => {
	it('slow provider loses, failing provider is recorded lost, one confirmation is reported', async () => {
		const chain = newChain();
		const sig = 'SIGfast';
		const fast = await fakeNode({ chain });
		const slow = await fakeNode({ chain, delayMs: 700, landOnSend: false });
		const bad = await fakeNode({ chain, failSend: true });
		chain.landed.set(sig, 7);
		const stats = new LandingStats({ network: 'devnet' });
		const raw = new Uint8Array([1, 2, 3]);
		const lanes = [
			rpcLane({ name: 'bad', url: bad.url, rawTx: raw, signature: sig }),
			rpcLane({ name: 'slow', url: slow.url, rawTx: raw, signature: sig, confirmTimeoutMs: 5_000 }),
			rpcLane({ name: 'fast', url: fast.url, rawTx: raw, signature: sig }),
		];
		const race = await raceLanes({ lanes, stats });
		console.log('RACE', JSON.stringify(race));
		expect(race.winner.name).toBe('fast');
		expect(race.winner.slot).toBe(7);
		expect(race.lanes.filter((l) => l.outcome === 'landed')).toHaveLength(1);
		expect(race.lanes.find((l) => l.name === 'bad').outcome).toBe('lost');
		expect(race.lanes.find((l) => l.name === 'slow').outcome).toBe('outpaced');
		const snap = Object.fromEntries(stats.snapshot().map((r) => [r.provider, r]));
		expect(snap.fast.landed).toBe(1);
		expect(snap.bad.lost).toBe(1);
		expect(snap.bad.streak).toBe(1);
		expect(snap.slow.outpaced).toBe(1);
		expect(snap.slow.lost).toBe(0);
	});

	it('an on-chain revert from any lane is terminal', async () => {
		const stats = new LandingStats({ network: 'devnet' });
		const revert = Object.assign(new Error('reverted'), { code: 'TX_ERR' });
		await expect(
			raceLanes({
				lanes: [
					{ name: 'a', run: async () => { throw revert; } },
					{ name: 'b', run: () => new Promise((r) => setTimeout(() => r({ landed: true, slot: 1 }), 200)) },
				],
				stats,
			}),
		).rejects.toBe(revert);
	});

	it('returns no winner when every lane fails', async () => {
		const race = await raceLanes({
			lanes: [{ name: 'a', run: async () => ({ landed: false, slot: null }) }, { name: 'b', run: async () => { throw new Error('x'); } }],
		});
		expect(race.winner).toBeNull();
	});
});

describe('LandingStats skip and probe', () => {
	it('skips after a failure streak, orders by success, and rejoins once a probe passes', async () => {
		let t = 1_000_000;
		const stats = new LandingStats({ network: 'devnet', now: () => t });
		stats.recordLanded('good', 120);
		stats.recordLanded('good', 100);
		for (let i = 0; i < 3; i++) stats.recordLost('dead', 'LANDING_HTTP');
		expect(stats.rank(['dead', 'good', 'new'])).toEqual(['good', 'new', 'dead']);
		expect(stats.isSkipped('dead')).toBe(true);
		expect(stats.isSkipped('good')).toBe(false);

		const node = await fakeNode({ chain: newChain(), healthy: false });
		expect(await stats.probe('dead', rpcProbe(node.url))).toBe(false);
		expect(stats.isSkipped('dead')).toBe(true);
		node.server.removeAllListeners('request');
		const healthy = await fakeNode({ chain: newChain() });
		t += 31_000;
		expect(stats.probeDue('dead')).toBe(true);
		expect(await stats.probe('dead', rpcProbe(healthy.url))).toBe(true);
		expect(stats.isSkipped('dead')).toBe(false);
	});
});

describe('provider table', () => {
	it('lists keyed providers disabled with the env var that enables them', () => {
		const list = resolveLandingProviders('mainnet', {});
		const helius = list.find((p) => p.name === 'helius');
		expect(helius.enabled).toBe(false);
		expect(helius.disabledReason).toBe('set HELIUS_API_KEY to enable');
		expect(list.find((p) => p.name === 'jito').enabled).toBe(true);
		const withKey = resolveLandingProviders('mainnet', { HELIUS_API_KEY: 'k' }).find((p) => p.name === 'helius');
		expect(withKey.enabled).toBe(true);
		expect(withKey.endpoint).toContain('api-key=k');
		expect(resolveLandingProviders('devnet', {}).find((p) => p.name === 'jito').enabled).toBe(false);
	});
});

describe('stats persistence', () => {
	it('upserts per-provider counters into landing_provider_stats and reloads them', async () => {
		const db = new PGlite();
		await db.exec(readFileSync(new URL('../api/_lib/migrations/20261023190000_landing_provider_stats.sql', import.meta.url), 'utf8'));
		const store = createSqlStatsStore(async (t, p) => (await db.query(t, p)).rows);
		const a = new LandingStats({ network: 'devnet', store });
		a.recordLanded('rpc', 150);
		a.recordLost('extra_rpc', 'LANDING_HTTP');
		a.recordOutpaced('extra_rpc');
		await a.flush();
		a.recordLanded('rpc', 250);
		await a.flush();
		const rows = (await db.query('select provider, landed, lost, outpaced, streak, latency_ms from landing_provider_stats order by provider')).rows;
		console.log('STATS_TABLE', JSON.stringify(rows));
		expect(rows).toEqual([
			{ provider: 'extra_rpc', landed: 0, lost: 1, outpaced: 1, streak: 1, latency_ms: null },
			{ provider: 'rpc', landed: 2, lost: 0, outpaced: 0, streak: 0, latency_ms: 180 },
		]);
		const b = new LandingStats({ network: 'devnet', store });
		await b.hydrate();
		expect(b.snapshot().find((r) => r.provider === 'rpc').landed).toBe(2);
	});
});

describe('submitProtected through the landing race', () => {
	async function engineRun({ primary, extra, opts = {} }) {
		const chain = newChain();
		const primaryNode = await fakeNode({ chain, ...primary });
		const extraNode = await fakeNode({ chain, ...extra });
		process.env.LANDING_EXTRA_RPC_URL = extraNode.url;
		const payer = Keypair.generate();
		const connection = new Connection(primaryNode.url, 'confirmed');
		const ix = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1000 });
		const result = await submitProtected({ network: 'devnet', connection, payer, instructions: [ix], opts: { confirmTimeoutMs: 4_000, ...opts } });
		return { result, primaryNode, extraNode };
	}

	beforeEach(() => resetLandingStats());

	it('reports a single landing from the faster extra provider while the slow primary is outpaced', async () => {
		const { result, primaryNode, extraNode } = await engineRun({
			primary: { delayMs: 300, landOnSend: false },
			extra: {},
		});
		console.log('ENGINE', JSON.stringify({ route: result.route, landedBy: result.landedBy, lanes: result.lanes }));
		expect(result.landedBy).toBe('extra_rpc');
		expect(result.lanes.find((l) => l.name === 'rpc').outcome).not.toBe('landed');
		expect(extraNode.state.sends).toBe(1);
		expect(primaryNode.state.sends).toBeLessThanOrEqual(1);
		expect(result.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
	});
});

describe('per-trade tip ceiling', () => {
	it('clamps every mode and attempt to the ceiling, and never exceeds the mode ceiling without one', () => {
		for (const mode of ['economy', 'turbo']) {
			for (let attempt = 0; attempt < 3; attempt++) {
				expect(resolveTipLamports(mode, 400_000n, attempt, 50_000n)).toBeLessThanOrEqual(50_000n);
			}
		}
		expect(resolveTipLamports('turbo', 10_000_000n, 2)).toBe(5_000_000n);
		expect(resolveTipLamports('economy', null, 0, 20_000n)).toBe(15_000n);
		expect(resolveTipLamports('economy', null, 0, 5_000n)).toBe(5_000n);
	});
});
