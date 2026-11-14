import { describe, it, expect } from 'vitest';
import { fingerprintOf, readIdempotencyKey, publicRecord } from '../api/_lib/evm-launch-records.js';
import {
	startTickFor, marketCapEthAt, timelockUnlockAt, FEE_TIERS, LOCK_MODES, LAUNCH_DEADLINE_SECONDS, MIN_LOCK_DAYS, MAX_LOCK_DAYS,
} from '../api/_lib/evm-leg/uniswap-config.js';
import { lanesMarkdown, formatAmount } from '../api/_lib/launch-lanes.js';
import { feeAmount, launchCostLine } from '../src/launch/lane-picker.js';

describe('Idempotency-Key', () => {
	it('reads a valid key and ignores a missing one', () => {
		expect(readIdempotencyKey({ headers: { 'idempotency-key': ' abcd-1234 ' } })).toBe('abcd-1234');
		expect(readIdempotencyKey({ headers: {} })).toBeNull();
		expect(readIdempotencyKey({ headers: { 'idempotency-key': '   ' } })).toBeNull();
	});
	it('refuses a key that is too short, too long or has spaces', () => {
		for (const bad of ['short', 'x'.repeat(129), 'has space in it']) {
			expect(() => readIdempotencyKey({ headers: { 'idempotency-key': bad } })).toThrow(/Idempotency-Key/);
		}
	});
});

describe('fingerprintOf', () => {
	const base = { lane: 'uniswap', agentId: 'a1', body: { name: 'X', lock: { mode: 'none' }, symbol: 'XX' } };
	it('ignores key order', () => {
		const reordered = { ...base, body: { symbol: 'XX', lock: { mode: 'none' }, name: 'X' } };
		expect(fingerprintOf(reordered)).toBe(fingerprintOf(base));
	});
	it('changes with lane, agent or body', () => {
		const f = fingerprintOf(base);
		expect(fingerprintOf({ ...base, lane: 'paired' })).not.toBe(f);
		expect(fingerprintOf({ ...base, agentId: 'a2' })).not.toBe(f);
		expect(fingerprintOf({ ...base, body: { ...base.body, name: 'Y' } })).not.toBe(f);
	});
});

describe('publicRecord', () => {
	it('flags only finalized records as finalized', () => {
		expect(publicRecord({ id: '1', status: 'finalized' }).finalized).toBe(true);
		expect(publicRecord({ id: '1', status: 'submitted' }).finalized).toBe(false);
	});
});

describe('start tick', () => {
	it('lands on the tier tick spacing for every tier', () => {
		for (const tier of FEE_TIERS) {
			expect(Math.abs(startTickFor(4, tier.tickSpacing) % tier.tickSpacing)).toBe(0);
		}
	});
	it('round-trips to within one tick of the requested market cap', () => {
		for (const tier of FEE_TIERS) {
			const tick = startTickFor(4, tier.tickSpacing);
			const back = marketCapEthAt(tick);
			expect(Math.abs(back - 4) / 4).toBeLessThan(1.0001 ** tier.tickSpacing - 1 + 1e-9);
		}
	});
	it('offers none, timelock and permanent locks', () => {
		expect(LOCK_MODES.map((m) => m.id)).toEqual(['none', 'timelock', 'permanent']);
	});
});

describe('timelock unlock time', () => {
	// ThreeWsUniswapLauncher._validate: block.timestamp + MIN_LOCK <= unlockAt <= block.timestamp + MAX_LOCK.
	const DAY = 86_400;
	const accepted = (unlockAt, ts) => unlockAt >= BigInt(ts + MIN_LOCK_DAYS * DAY) && unlockAt <= BigInt(ts + MAX_LOCK_DAYS * DAY);
	// The launch mines at most LAUNCH_DEADLINE_SECONDS after it is built (the contract enforces the
	// deadline), and a block timestamp can trail the server clock by up to a minute.
	const blockTimes = (now) => [now - 60, now, now + 1, now + 2, now + LAUNCH_DEADLINE_SECONDS / 2, now + LAUNCH_DEADLINE_SECONDS];
	const now = 1_790_000_000;

	it('the minimum lock is accepted in any block before the deadline', () => {
		const unlockAt = timelockUnlockAt(MIN_LOCK_DAYS, now);
		for (const ts of blockTimes(now)) expect(accepted(unlockAt, ts), `block at now${ts - now >= 0 ? '+' : ''}${ts - now}s`).toBe(true);
	});
	it('the maximum lock is accepted in any block before the deadline', () => {
		const unlockAt = timelockUnlockAt(MAX_LOCK_DAYS, now);
		for (const ts of blockTimes(now)) expect(accepted(unlockAt, ts), `block at now${ts - now >= 0 ? '+' : ''}${ts - now}s`).toBe(true);
	});
	it('a lock in between ends on the day the owner picked', () => {
		expect(Number(timelockUnlockAt(30, now)) - (now + 30 * DAY)).toBe(0);
	});
});

const lane = (over = {}) => ({
	id: 'x',
	label: 'Lane X',
	default: false,
	available: true,
	chain: { slug: 'base', name: 'Base', chain_id: 8453 },
	signer: 'Agent',
	supply: '1,000',
	fees: [{ id: 'l', label: 'Launch fee', when: 'launch', payer: 'creator', amount: { kind: 'eth', value: '0.001' }, note: 'Flat.' }],
	creator_share: { bps: 7000, label: 'Share', paid_in: 'WETH' },
	graduation: 'None',
	liquidity: { custody: 'Held', lock_options: [{ id: 'p', label: 'Permanent' }] },
	...over,
});

describe('lane docs and picker', () => {
	it('renders every fee and says when a lane is closed', () => {
		const md = lanesMarkdown([lane(), lane({ id: 'y', label: 'Lane Y', available: false, unavailable_reason: 'Not deployed.' })]);
		expect(md).toContain('| Launch fee | launch | creator | 0.001 ETH | Flat. |');
		expect(md).toContain('Not available right now: Not deployed.');
	});
	it('formats amounts the same way in the doc and the picker', () => {
		expect(formatAmount({ kind: 'bps', value: 150 })).toBe(feeAmount({ kind: 'bps', value: 150 }));
		expect(feeAmount({ kind: 'eth', value: '0.5' })).toBe('0.5 ETH');
	});
	it('summarises the launch cost', () => {
		expect(launchCostLine(lane())).toBe('Launch fee: 0.001 ETH');
		expect(launchCostLine(lane({ fees: [] }))).toBe('Shown once the lane opens');
	});
});
