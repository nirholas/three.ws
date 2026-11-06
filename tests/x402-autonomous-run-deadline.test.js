// run()-style entries own a whole fan-out inside one autonomous tick, and the
// tick's own budget only gated STARTING an entry. Measured 2026-11-06: Sniper
// Intel, Avatar Warmup and Reputation Refresh ran 141 to 151s inside a 120s
// budget, so ticks answered 503 cron_timeout while the handler kept running. The
// cooldown is only written when an entry finishes and the economy tick fires
// every minute, so the next tick started the same entry again on top of itself:
// paid pipelines paid twice, and Ring Reconciliation overlapped its own runs
// despite a 30 minute cooldown.
//
// What must hold: a pipeline stops STARTING paid calls once the tick says stop
// (never aborting one in flight, so no payment is misreported), and one entry
// runs at most once at a time across ticks.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const pay = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../api/_lib/db.js', async (orig) => ({
	...(await orig()),
	sql: vi.fn(async () => Array.from({ length: 6 }, (_, i) => ({
		id: `agent-${i}`, mint: `THREEsynthetic1111${i}`, symbol: `SYN${i}`, name: `Synthetic ${i}`, asset_pubkey: `THREEsynthetic2222${i}`,
		solana_asset: `THREEsynthetic2222${i}`, meta: {},
	}))),
}));
vi.mock('../api/_lib/x402/pay.js', async (orig) => ({
	...(await orig()),
	payX402: vi.fn(async () => {
		pay.calls += 1;
		return { ok: false, status: 503, paid: false, amountAtomic: 0, txSig: null, body: null, errorMsg: 'http_503' };
	}),
}));

const { claimEntryRun, releaseEntryRun, ENTRY_RUN_LEASE_S } = await import('../api/_lib/x402/tick-budget.js');
const pipelines = {
	'sniper-intel-enrich': await import('../api/_lib/x402/pipelines/sniper-intel-enrich.js'),
	'avatar-search-warmup': await import('../api/_lib/x402/pipelines/avatar-search-warmup.js'),
	'reputation-refresh': await import('../api/_lib/x402/pipelines/reputation-refresh.js'),
};

const payCtx = { buyer: {}, conn: {}, blockhash: 'hash', mintInfo: {}, remainingCap: 1_000_000_000 };

describe('run() pipelines honour the tick deadline', () => {
	beforeEach(() => {
		pay.calls = 0;
	});

	for (const [name, mod] of Object.entries(pipelines)) {
		it(`${name} starts no further paid call once the tick says stop`, async () => {
			const out = await mod.run({ ...payCtx, shouldStop: () => pay.calls >= 2 });
			expect(pay.calls).toBe(2);
			expect(out).toBeTruthy();
		});

		it(`${name} still walks its batch when the tick has budget left`, async () => {
			await mod.run({ ...payCtx, shouldStop: () => false });
			expect(pay.calls).toBeGreaterThan(2);
		});
	}
});

function fakeRedis() {
	const store = new Map();
	return {
		store,
		set: vi.fn(async (k, v, opts) => {
			if (opts?.nx && store.has(k)) return null;
			store.set(k, v);
			return 'OK';
		}),
		del: vi.fn(async (k) => (store.delete(k) ? 1 : 0)),
	};
}

describe('one entry runs at most once at a time across ticks', () => {
	const entry = { id: 'ring-reconciliation' };

	it('refuses a second tick while the first still holds the entry', async () => {
		const redis = fakeRedis();
		expect(await claimEntryRun(redis, entry)).toBe(true);
		expect(await claimEntryRun(redis, entry)).toBe(false);
	});

	it('frees the entry when the run ends', async () => {
		const redis = fakeRedis();
		await claimEntryRun(redis, entry);
		await releaseEntryRun(redis, entry);
		expect(await claimEntryRun(redis, entry)).toBe(true);
	});

	it('expires on its own so a killed instance cannot wedge an entry', async () => {
		const redis = fakeRedis();
		await claimEntryRun(redis, entry);
		expect(redis.set.mock.calls[0][2]).toEqual({ nx: true, ex: ENTRY_RUN_LEASE_S });
		expect(ENTRY_RUN_LEASE_S).toBeGreaterThanOrEqual(120);
	});

	it('does not stop the ring when Redis is absent or failing', async () => {
		expect(await claimEntryRun(null, entry)).toBe(true);
		const broken = { set: vi.fn(async () => { throw new Error('redis down'); }), del: vi.fn(async () => { throw new Error('redis down'); }) };
		expect(await claimEntryRun(broken, entry)).toBe(true);
		await expect(releaseEntryRun(broken, entry)).resolves.toBeUndefined();
	});
});
