// The grind-bounty ledger lives in Postgres, not Redis. Runs the real store
// against a real (PGlite) schema built from the shipped migration. Redis is
// wired to throw if touched: the lifecycle must survive a total Redis flush
// because the store never depends on it.

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/redis.js', () => ({
	getRedis: () => {
		throw new Error('the bounty store must not depend on Redis');
	},
}));

const migration = readFileSync('api/_lib/migrations/20261105120000_vanity_bounties.sql', 'utf8');
let store;

const DAY = 86_400_000;
const rec = (over = {}) => ({
	id: 'b1',
	protocol: 'vanity-bounty/1',
	pattern: 'abc',
	recipient: 'RecipientPublicKey',
	amountAtomics: 5_000_000,
	asset: 'USDC',
	network: 'solana',
	status: 'escrow_pending',
	createdAt: Date.now(),
	expiresAt: Date.now() + DAY,
	...over,
});

beforeAll(async () => {
	store = await import('../api/_lib/vanity-bounty-store.js');
});
beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(migration);
});

describe('vanity bounty store on Postgres', () => {
	it('create stays invisible until activation, then is on the board and claimable', async () => {
		await store.createBounty(rec());
		expect((await store.queryBounties({})).total).toBe(0);
		expect(await store.listClaimable()).toEqual([]);
		expect(await store.activateBounty({ id: 'b1', escrowTx: 'tx1', escrowNetwork: 'solana' })).toBe('live');
		expect(await store.activateBounty({ id: 'b1' })).toBe('live');
		const board = await store.queryBounties({});
		expect(board.total).toBe(1);
		expect(board.bounties[0].id).toBe('b1');
		expect(board.bounties[0].sealedSecret).toBeUndefined();
		expect((await store.getBountyRecord('b1')).escrowTx).toBe('tx1');
		expect((await store.listClaimable()).map((b) => b.id)).toEqual(['b1']);
	});

	it('rejects a duplicate id with 409', async () => {
		await store.createBounty(rec());
		await expect(store.createBounty(rec())).rejects.toMatchObject({ status: 409, code: 'duplicate_bounty' });
	});

	it('exactly one of two concurrent claims wins, and a replay of the winner is idempotent', async () => {
		await store.createBounty(rec({ status: 'open' }));
		const [a, b] = await Promise.all([
			store.claimBounty({ id: 'b1', claimDigest: 'dA', winnerAddress: 'addrA', workerId: 'wA', sealedSecret: { ct: 'x' } }),
			store.claimBounty({ id: 'b1', claimDigest: 'dB', winnerAddress: 'addrB', workerId: 'wB', sealedSecret: { ct: 'y' } }),
		]);
		expect([a, b].sort()).toEqual(['lost', 'won']);
		const winner = a === 'won' ? 'dA' : 'dB';
		expect(await store.claimBounty({ id: 'b1', claimDigest: winner, winnerAddress: 'z', sealedSecret: {} })).toBe('won');
		const saved = await store.getBountyRecord('b1');
		expect(saved.status).toBe('settled');
		expect(saved.sealedSecret).toBeTruthy();
		expect(await store.claimBounty({ id: 'nope', claimDigest: 'd', winnerAddress: 'a', sealedSecret: {} })).toBe('missing');
	});

	it('payout survives and feeds the leaderboard once, even if recorded twice', async () => {
		await store.createBounty(rec({ status: 'open' }));
		await store.claimBounty({ id: 'b1', claimDigest: 'd', winnerAddress: 'a', workerId: 'w1', sealedSecret: {} });
		await store.recordPayout({ id: 'b1', payoutTx: 'pay1', workerId: 'w1', amountAtomics: 5_000_000 });
		await store.recordPayout({ id: 'b1', payoutTx: 'pay1', workerId: 'w1', amountAtomics: 5_000_000 });
		expect((await store.getBountyRecord('b1')).payoutTx).toBe('pay1');
		expect(await store.topGrinders(5)).toEqual([{ workerId: 'w1', earnedAtomics: 5_000_000 }]);
		const stats = await store.bountyStats();
		expect(stats).toMatchObject({ settled: 1, paidOutAtomics: 5_000_000, total: 1 });
	});

	it('expired unclaimed bounty becomes refundable once and can no longer be claimed', async () => {
		await store.createBounty(rec({ status: 'open', expiresAt: Date.now() - 1000 }));
		expect(await store.claimBounty({ id: 'b1', claimDigest: 'd', winnerAddress: 'a', sealedSecret: {} })).toBe('closed');
		expect(await store.markRefundable('b1')).toBe('refundable');
		expect(await store.markRefundable('b1')).toBe('refundable');
		await store.recordRefund({ id: 'b1', refundTx: 'ref1' });
		expect((await store.getBountyRecord('b1'))).toMatchObject({ status: 'refunded', refundTx: 'ref1' });
		expect(await store.claimBounty({ id: 'b1', claimDigest: 'd', winnerAddress: 'a', sealedSecret: {} })).toBe('closed');
	});

	it('an unexpired bounty is not refundable, and a settled one never refunds', async () => {
		await store.createBounty(rec({ status: 'open' }));
		expect(await store.markRefundable('b1')).toBe('ineligible');
		await store.claimBounty({ id: 'b1', claimDigest: 'd', winnerAddress: 'a', sealedSecret: {} });
		expect(await store.markRefundable('b1')).toBe('ineligible');
	});

	it('void blocks activation, claim and board listing', async () => {
		await store.createBounty(rec());
		expect(await store.voidBounty({ id: 'b1', reason: 'settle failed' })).toBe('void');
		expect(await store.activateBounty({ id: 'b1' })).toBe('ineligible');
		expect(await store.claimBounty({ id: 'b1', claimDigest: 'd', winnerAddress: 'a', sealedSecret: {} })).toBe('closed');
		expect((await store.queryBounties({ status: 'all' })).total).toBe(0);
		expect(await store.voidBounty({ id: 'zzz' })).toBe('missing');
	});

	it('sorts and pages the board, and writes an audit event per transition', async () => {
		const t = Date.now();
		await store.createBounty(rec({ id: 'lo', status: 'open', amountAtomics: 1, createdAt: t - 2, expiresAt: t + 5 * DAY }));
		await store.createBounty(rec({ id: 'hi', status: 'open', amountAtomics: 9, createdAt: t - 1, expiresAt: t + DAY }));
		expect((await store.queryBounties({ sort: 'reward' })).bounties.map((b) => b.id)).toEqual(['hi', 'lo']);
		expect((await store.queryBounties({ sort: 'expiry' })).bounties.map((b) => b.id)).toEqual(['hi', 'lo']);
		expect((await store.queryBounties({ sort: 'recency', limit: 1 })).hasMore).toBe(true);
		await store.claimBounty({ id: 'hi', claimDigest: 'd', winnerAddress: 'a', sealedSecret: {} });
		const kinds = await holder.db.query("select kind from vanity_bounty_events where bounty_id = 'hi' order by id");
		expect(kinds.map((k) => k.kind)).toEqual(['created', 'settled']);
		const events = await holder.db.query("select data::text as d from vanity_bounty_events where bounty_id = 'hi'");
		expect(events.some((e) => e.d.includes('sealedSecret'))).toBe(false);
	});
});
