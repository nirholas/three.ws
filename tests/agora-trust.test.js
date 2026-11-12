import { describe, it, expect } from 'vitest';
import {
	computeTrust,
	weighVouches,
	PER_VOUCHER_CAP,
	RECIPROCAL_POOL_CAP,
} from '../api/_lib/agora-trust.js';

const human = (id, extra = {}) => ({ voucherId: id, voucherKind: 'human', voucherOwner: `u-${id}`, ...extra });

describe('agora trust grade', () => {
	it('leaves a citizen with no vouches and no verified work ungraded', () => {
		const t = computeTrust({ citizenId: 'c1', reputation: 0 });
		expect(t.grade).toBeNull();
		expect(t.graded).toBe(false);
		expect(t.label).toBe('Ungraded');
	});

	it('grades an honest history highly and a thin one low', () => {
		const honest = computeTrust({
			citizenId: 'c1', reputation: 80, verifiedCompletions: 12, attemptedTasks: 12,
			vouches: [human('h1'), human('h2'), human('h3')],
		});
		const thin = computeTrust({ citizenId: 'c2', reputation: 5, verifiedCompletions: 1, attemptedTasks: 1 });
		expect(['A', 'B']).toContain(honest.grade);
		expect(honest.score).toBeGreaterThan(thin.score);
		expect(['D', 'E']).toContain(thin.grade);
	});

	it('ignores self and same-owner vouches', () => {
		const w = weighVouches({
			citizenId: 'c1', ownerId: 'u1',
			vouches: [human('c1'), { voucherId: 'sock', voucherKind: 'human', voucherOwner: 'u1' }],
		});
		expect(w.total).toBe(0);
		expect(w.ignored).toBe(2);
	});

	it('caps one voucher at a single standard vouch however heavy its edge', () => {
		const w = weighVouches({ citizenId: 'c1', vouches: [human('h1', { weight: 50 })] });
		expect(w.total).toBe(PER_VOUCHER_CAP);
	});

	it('discounts a voucher who is also the citizen\'s hirer', () => {
		const plain = weighVouches({ citizenId: 'c1', vouches: [human('h1')] }).total;
		const hirer = weighVouches({ citizenId: 'c1', vouches: [human('h1')], hirerIds: ['h1'] }).total;
		expect(hirer).toBeLessThan(plain);
	});

	it('a ring of 10 mutual vouches never out-weighs one honest vouch', () => {
		const ring = Array.from({ length: 10 }, (_, i) => `r${i}`);
		const subject = ring[0];
		const others = ring.slice(1);
		const ringInput = {
			citizenId: subject,
			vouches: others.map((id) => ({ voucherId: id, voucherKind: 'agent', voucherVerified: 9, voucherOwner: `owner-${id}` })),
			vouchedByCitizen: others,
		};
		const ringWeight = weighVouches(ringInput).total;
		const honestWeight = weighVouches({ citizenId: 'solo', vouches: [human('h1')] }).total;
		expect(ringWeight).toBeLessThanOrEqual(RECIPROCAL_POOL_CAP);
		expect(ringWeight).toBeLessThan(honestWeight);

		const ringGrade = computeTrust({ ...ringInput, reputation: 10, verifiedCompletions: 2, attemptedTasks: 2 });
		const honestGrade = computeTrust({
			citizenId: 'solo', reputation: 10, verifiedCompletions: 2, attemptedTasks: 2, vouches: [human('h1')],
		});
		expect(ringGrade.components.vouches).toBeLessThan(honestGrade.components.vouches);
		expect(ringGrade.score).toBeLessThan(honestGrade.score);
	});

	it('a directed cycle of work-less agents earns little', () => {
		const w = weighVouches({
			citizenId: 'a',
			vouches: [{ voucherId: 'b', voucherKind: 'agent', voucherVerified: 0, voucherOwner: 'ob' }],
		});
		expect(w.total).toBeLessThanOrEqual(0.25);
	});

	it('a slash drags the score down hard', () => {
		const base = { citizenId: 'c1', reputation: 60, verifiedCompletions: 10, attemptedTasks: 10, vouches: [human('h1'), human('h2')] };
		const clean = computeTrust(base);
		const slashed = computeTrust({ ...base, slashes: 1 });
		expect(slashed.score).toBeLessThan(clean.score - 15);
		expect(slashed.components.slashes).toBe(-20);
	});

	it('clamps the score to 0..100 and always returns a letter once graded', () => {
		const t = computeTrust({ citizenId: 'c1', verifiedCompletions: 1, attemptedTasks: 1, slashes: 5 });
		expect(t.score).toBe(0);
		expect(t.grade).toBe('E');
	});
});
