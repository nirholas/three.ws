import { describe, expect, it } from 'vitest';
import { hostedFallbackFor } from '../src/forge-modly.js';

// The engine picker as /forge builds it: cloud lanes from the catalog, then one
// button per Modly model on the user's own GPU.
const ENGINES = [
	{ backend: 'trellis', disabled: false, modly: false, byok: '', houseKey: false },
	{ backend: 'hunyuan3d', disabled: false, modly: false, byok: '', houseKey: false },
	{ backend: 'meshy', disabled: false, modly: false, byok: 'meshy', houseKey: false },
	{ backend: 'modly:triposg', disabled: false, modly: true, byok: '', houseKey: false },
];

describe('hostedFallbackFor', () => {
	it('offers the standing photo engine when a local run fails for any reason but a cancel', () => {
		for (const code of ['NOT_RUNNING', 'BLOCKED', 'TIMEOUT', 'GENERATION_FAILED', 'UNKNOWN_MODEL', 'RUN_LOST', 'HTTP', 'NOT_GLB']) {
			expect(hostedFallbackFor({ code }, ENGINES, 'hunyuan3d')?.backend, code).toBe('hunyuan3d');
		}
	});

	it('offers nothing when the person cancelled', () => {
		expect(hostedFallbackFor({ code: 'CANCELLED' }, ENGINES, 'trellis')).toBeNull();
	});

	it('never offers another local engine or one that needs the user’s own key', () => {
		const onlyLocalAndKeyed = ENGINES.filter((e) => e.modly || e.byok);
		expect(hostedFallbackFor({ code: 'GENERATION_FAILED' }, onlyLocalAndKeyed, 'meshy')).toBeNull();
		const houseKeyed = [{ backend: 'meshy', disabled: false, modly: false, byok: 'meshy', houseKey: true }];
		expect(hostedFallbackFor({ code: 'GENERATION_FAILED' }, houseKeyed, 'trellis')?.backend).toBe('meshy');
	});

	it('skips a lane that is down and falls through to the next hosted one', () => {
		const down = ENGINES.map((e) => (e.backend === 'hunyuan3d' ? { ...e, disabled: true } : e));
		expect(hostedFallbackFor({ code: 'NOT_RUNNING' }, down, 'hunyuan3d')?.backend).toBe('trellis');
		expect(hostedFallbackFor({ code: 'NOT_RUNNING' }, ENGINES.map((e) => ({ ...e, disabled: true })), 'trellis')).toBeNull();
	});

	it('handles a missing error or engine list without throwing', () => {
		expect(hostedFallbackFor(null, ENGINES, '')?.backend).toBe('trellis');
		expect(hostedFallbackFor({ code: 'TIMEOUT' }, undefined, 'trellis')).toBeNull();
	});
});
