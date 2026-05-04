import { describe, it, expect } from 'vitest';
import {
	reactionFor,
	createReactionDispatcher,
	applyReaction,
} from '../../src/widgets/pumpfun-reactions.js';

describe('reactionFor', () => {
	it('returns null for unknown kinds', () => {
		expect(reactionFor('unknown', { mint: 'x' })).toBe(null);
	});

	it('returns null when ev is missing', () => {
		expect(reactionFor('claim', null)).toBe(null);
	});

	describe('graduation', () => {
		it('dances rumba with celebration emote and a speak line', () => {
			const r = reactionFor('graduation', { mint: 'M', symbol: 'WIF' });
			expect(r.gesture.name).toBe('rumba');
			expect(r.emote.trigger).toBe('celebration');
			expect(r.speak.text).toContain('WIF');
			expect(r.priority).toBe(90);
		});

		it('scales duration with MC multiple', () => {
			const small = reactionFor('graduation', {
				mint: 'M',
				market_cap_usd_initial: 10_000,
				usd_market_cap: 12_000,
			});
			const big = reactionFor('graduation', {
				mint: 'M',
				market_cap_usd_initial: 10_000,
				usd_market_cap: 1_000_000,
			});
			expect(big.gesture.duration).toBeGreaterThan(small.gesture.duration);
			expect(big.gesture.duration).toBeLessThanOrEqual(9000);
			expect(small.gesture.duration).toBeGreaterThanOrEqual(4500);
		});
	});

	describe('claim', () => {
		it('first-time GitHub-linked verified claim plays thriller', () => {
			const r = reactionFor('claim', {
				mint: 'M',
				first_time_claim: true,
				github_user: 'alice',
				signal_verified: true,
			});
			expect(r.gesture.name).toBe('thriller');
			expect(r.priority).toBe(85);
		});

		it('first-time GitHub-linked unverified claim plays silly', () => {
			const r = reactionFor('claim', {
				mint: 'M',
				first_time_claim: true,
				github_user: 'alice',
			});
			expect(r.gesture.name).toBe('silly');
		});

		it('first-time non-GitHub claim plays the celebrate clip', () => {
			const r = reactionFor('claim', {
				mint: 'M',
				first_time_claim: true,
				claimer: 'wallet1',
			});
			expect(r.gesture.name).toBe('celebrate');
		});

		it('fake claim plays a head-shake with concern', () => {
			const r = reactionFor('claim', { mint: 'M', fake_claim: true, claimer: 'badactor' });
			expect(r.gesture.name).toBe('shake');
			expect(r.emote.trigger).toBe('concern');
		});

		it('mega tier claims taunt', () => {
			const r = reactionFor('claim', { mint: 'M', tier: 'mega' });
			expect(r.gesture.name).toBe('taunt');
			expect(r.priority).toBe(50);
		});

		it('influencer tier claims play a brief reaction', () => {
			const r = reactionFor('claim', { mint: 'M', tier: 'influencer' });
			expect(r.gesture.name).toBe('reaction');
		});

		it('notable tier claims emote without a gesture', () => {
			const r = reactionFor('claim', { mint: 'M', tier: 'notable' });
			expect(r.gesture).toBeUndefined();
			expect(r.emote.trigger).toBe('curiosity');
		});

		it('untiered repeat claim returns null', () => {
			expect(reactionFor('claim', { mint: 'M' })).toBe(null);
		});
	});

	describe('mint', () => {
		it('reacts to large initial buys', () => {
			const r = reactionFor('mint', { mint: 'M', initial_buy_sol: 7 });
			expect(r.gesture.name).toBe('wave');
		});

		it('quietly notes mid-tier mints', () => {
			const r = reactionFor('mint', { mint: 'M', initial_buy_sol: 1.5 });
			expect(r.gesture).toBeUndefined();
			expect(r.emote.trigger).toBe('curiosity');
		});

		it('ignores small mints', () => {
			expect(reactionFor('mint', { mint: 'M', initial_buy_sol: 0.1 })).toBe(null);
		});
	});
});

describe('createReactionDispatcher', () => {
	it('dedupes the same event within the dedupe window', () => {
		let now = 1000;
		const d = createReactionDispatcher({ now: () => now });
		const ev = { mint: 'M', first_time_claim: true, github_user: 'a' };
		const ran = [];
		expect(d.dispatch('claim', ev, (r) => ran.push(r))).toBe(true);
		now += 5000;
		expect(d.dispatch('claim', ev, (r) => ran.push(r))).toBe(false);
		expect(ran.length).toBe(1);
	});

	it('lets a different mint through immediately', () => {
		let now = 1000;
		const d = createReactionDispatcher({ now: () => now });
		const ran = [];
		d.dispatch('graduation', { mint: 'A', symbol: 'A' }, (r) => ran.push(r));
		now += 100;
		// Same kind, same priority, but cooldown still active. New mint but
		// not higher priority → shouldn't preempt mid-dance.
		const ok = d.dispatch('graduation', { mint: 'B', symbol: 'B' }, (r) => ran.push(r));
		expect(ok).toBe(false);
		expect(ran.length).toBe(1);
	});

	it('higher priority preempts an in-flight lower priority gesture', () => {
		let now = 1000;
		const d = createReactionDispatcher({ now: () => now });
		const ran = [];
		// Influencer claim (pri 35) → 1.8s reaction.
		d.dispatch('claim', { mint: 'A', tier: 'influencer' }, (r) => ran.push(r));
		now += 200;
		// Graduation (pri 90) lands while reaction is still playing.
		const ok = d.dispatch('graduation', { mint: 'B', symbol: 'B' }, (r) => ran.push(r));
		expect(ok).toBe(true);
		expect(ran[1].gesture.name).toBe('rumba');
	});

	it('lets cooldown expire so subsequent reactions can play', () => {
		let now = 1000;
		const d = createReactionDispatcher({ now: () => now });
		const ran = [];
		d.dispatch('claim', { mint: 'A', tier: 'influencer' }, (r) => ran.push(r));
		now += 5000;
		const ok = d.dispatch('claim', { mint: 'B', tier: 'influencer' }, (r) => ran.push(r));
		expect(ok).toBe(true);
		expect(ran.length).toBe(2);
	});
});

describe('applyReaction', () => {
	it('emits emote, gesture, and speak by default', () => {
		const emitted = [];
		const protocol = { emit: (a) => emitted.push(a) };
		applyReaction(protocol, {
			emote: { trigger: 'celebration', weight: 0.9 },
			gesture: { name: 'rumba', duration: 5000 },
			speak: { text: 'hi', sentiment: 0.5 },
		});
		expect(emitted.map((a) => a.type)).toEqual(['emote', 'gesture', 'speak']);
	});

	it('honors flags to suppress channels', () => {
		const emitted = [];
		const protocol = { emit: (a) => emitted.push(a) };
		applyReaction(protocol, {
			emote: { trigger: 'celebration', weight: 0.9 },
			gesture: { name: 'rumba', duration: 5000 },
			speak: { text: 'hi', sentiment: 0.5 },
		}, { speak: false });
		expect(emitted.map((a) => a.type)).toEqual(['emote', 'gesture']);
	});

	it('is safe with a null protocol', () => {
		expect(() => applyReaction(null, { emote: { trigger: 'x', weight: 1 } })).not.toThrow();
	});
});
