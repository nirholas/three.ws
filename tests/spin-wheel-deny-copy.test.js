// @vitest-environment jsdom
//
// The paid Wheel of Fortune is refused with token_unavailable when the world
// server has no treasury configured (multiplayer/src/spin-wheel.js), the
// production state on 2026-11-04. The modal called that "unavailable right
// now", and the treasury_unavailable / rewards_unavailable codes "briefly
// unavailable, try again in a moment", so players waited on a retry that could
// not succeed until an operator set the wallet. Each now says paid spins are
// not switched on yet and points at the free spin, which still works.

import { describe, it, expect, beforeAll, vi } from 'vitest';

function makeNet() {
	return {
		on: () => () => {},
		isLive: () => true,
		spinInfo: () => true,
		requestProfile: () => true,
	};
}

let wheel;
beforeAll(async () => {
	const noop = () => {};
	const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 0 }) : noop), set: () => true });
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
	const mod = await import('../src/game/spin-wheel-ui.js');
	wheel = mod.openSpinWheel({ net: makeNet() });
});

describe('spin wheel refusal copy for an unconfigured $THREE rail', () => {
	for (const reason of ['token_unavailable', 'treasury_unavailable', 'rewards_unavailable']) {
		it(`${reason} says paid spins are not switched on yet, without a retry`, () => {
			const text = wheel._denyText({ reason });
			expect(text).toMatch(/not switched on yet/i);
			expect(text).toMatch(/free spin/i);
			expect(text).not.toMatch(/briefly|try again|right now/i);
		});
	}

	it('keeps the retry wording for a transient price feed outage', () => {
		expect(wheel._denyText({ reason: 'price_unavailable' })).toMatch(/try again/i);
	});
});
