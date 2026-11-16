// Per-plan limits for talking-avatar clips (api/_lib/clip-policy.js).

import { describe, it, expect } from 'vitest';
import { CLIP_PLANS, A2F_MAX_SECONDS, CHARS_PER_SECOND, clipPolicy, maxCharsFor, pcmDurationSec } from '../api/_lib/clip-policy.js';

describe('clipPolicy', () => {
	it('gives visitors the anonymous allowance regardless of a claimed plan', () => {
		expect(clipPolicy({ signedIn: false, plan: 'enterprise' })).toEqual({
			plan: 'anonymous',
			perDay: CLIP_PLANS.anonymous.perDay,
			maxSeconds: CLIP_PLANS.anonymous.maxSeconds,
			maxChars: maxCharsFor(CLIP_PLANS.anonymous.maxSeconds),
		});
		expect(clipPolicy().plan).toBe('anonymous');
	});

	it('maps each signed-in plan and falls back to free for unknown plans', () => {
		for (const plan of ['free', 'pro', 'team', 'enterprise']) {
			expect(clipPolicy({ signedIn: true, plan })).toMatchObject({ plan, perDay: CLIP_PLANS[plan].perDay });
		}
		expect(clipPolicy({ signedIn: true, plan: 'legacy' }).plan).toBe('free');
		expect(clipPolicy({ signedIn: true }).plan).toBe('free');
	});

	it('never lets a plan exceed what Audio2Face-3D accepts in one call', () => {
		for (const p of Object.values(CLIP_PLANS)) expect(p.maxSeconds).toBeLessThanOrEqual(A2F_MAX_SECONDS);
	});

	it('orders allowances so upgrading never lowers a limit', () => {
		const order = ['anonymous', 'free', 'pro', 'team', 'enterprise'];
		for (let i = 1; i < order.length; i++) {
			expect(CLIP_PLANS[order[i]].perDay).toBeGreaterThanOrEqual(CLIP_PLANS[order[i - 1]].perDay);
			expect(CLIP_PLANS[order[i]].maxSeconds).toBeGreaterThanOrEqual(CLIP_PLANS[order[i - 1]].maxSeconds);
		}
	});
});

describe('duration helpers', () => {
	it('converts seconds to a character budget', () => {
		expect(maxCharsFor(30)).toBe(30 * CHARS_PER_SECOND);
		expect(maxCharsFor(0)).toBe(CHARS_PER_SECOND);
	});

	it('measures s16 PCM duration', () => {
		expect(pcmDurationSec(32000, 16000)).toBe(1);
		expect(pcmDurationSec(176400, 44100, 2)).toBe(1);
		expect(pcmDurationSec(32001, 16000)).toBe(1); // odd trailing byte ignored
		expect(pcmDurationSec(100, 0)).toBe(0);
	});
});
