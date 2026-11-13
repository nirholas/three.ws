// agora-citizens single-owner lease. With signers derived from one seed, a local
// run and the deployed service hold the same keypairs; without a lease both would
// claim the same tasks and race each other's transactions on-chain.

import { describe, it, expect } from 'vitest';
import { leaseKey, leaseTtlMs, leaseRenewMs, takeLease } from '../workers/agora-citizens/lease.js';

const SEED = 'synthetic-test-seed-one-0000000000000000';

describe('lease key', () => {
	it('is scoped to the signer set: same seed shares a key, other seeds and hosts do not', () => {
		const a = leaseKey({ signerSeed: SEED }, 'host-a');
		expect(leaseKey({ signerSeed: SEED }, 'host-b')).toBe(a);
		expect(leaseKey({ signerSeed: SEED.replace('one', 'two') }, 'host-a')).not.toBe(a);
		expect(a).toMatch(/^agora-citizens:seed-[0-9a-f]{12}$/);
		expect(a).not.toContain(SEED);
		expect(leaseKey({ signerSeed: '' }, 'host-a')).toBe('agora-citizens:local-host-a');
	});

	it('expires after three missed renewals, never sooner than 90s', () => {
		expect(leaseRenewMs({ heartbeatMs: 30_000 })).toBe(30_000);
		expect(leaseTtlMs({ heartbeatMs: 30_000 })).toBe(90_000);
		expect(leaseTtlMs({ heartbeatMs: 60_000 })).toBe(180_000);
		expect(leaseTtlMs({ heartbeatMs: 5_000 })).toBe(90_000);
	});
});

describe('takeLease', () => {
	const quietLog = { info() {}, warn() {} };

	it('returns at once when the lease is free', async () => {
		const r = await takeLease({ acquire: async () => ({ held: true }), intervalMs: 1, log: quietLog });
		expect(r.held).toBe(true);
	});

	it('waits in standby while another engine holds it, then takes over', async () => {
		let calls = 0;
		const acquire = async () => (++calls < 3 ? { held: false, holder: 'old-revision', ageMs: 10 } : { held: true });
		const r = await takeLease({ acquire, intervalMs: 1, log: quietLog });
		expect(r.held).toBe(true);
		expect(calls).toBe(3);
	});

	it('a one-shot run refuses instead of queueing behind a live fleet', async () => {
		const acquire = async () => ({ held: false, holder: 'cloud-run-abc' });
		await expect(takeLease({ acquire, intervalMs: 1, wait: false, log: quietLog })).rejects.toThrow(/cloud-run-abc.*double-drive/);
	});

	it('gives up cleanly when asked to stop while in standby', async () => {
		let stop = false;
		const acquire = async () => {
			stop = true;
			return { held: false, holder: 'x' };
		};
		const r = await takeLease({ acquire, intervalMs: 1, isStopped: () => stop, log: quietLog });
		expect(r).toBeNull();
	});
});
