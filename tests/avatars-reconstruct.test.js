// POST /api/avatars/reconstruct accepts a free-form `params` record. Only an
// allowlist of tuning keys may reach the provider; platform-owned keys (tier,
// path, steps, file locations) must never be caller-controlled.

import { describe, it, expect } from 'vitest';
import { pickReconstructParams } from '../api/_lib/reconstruct-params.js';

describe('pickReconstructParams', () => {
	it('drops every key outside the allowlist', () => {
		const out = pickReconstructParams({ tier: 'ultra', path: '/etc/passwd', steps: 9999, images: ['x'], output_dir: '/tmp', __proto__: { a: 1 } });
		expect(out).toEqual({});
	});

	it('keeps allowlisted keys and clamps them', () => {
		expect(pickReconstructParams({ target_polycount: 50_000, seed: 7 })).toEqual({ target_polycount: 50_000, seed: 7 });
		expect(pickReconstructParams({ target_polycount: 1e12 })).toEqual({ target_polycount: 500_000 });
		expect(pickReconstructParams({ target_polycount: -5 })).toEqual({ target_polycount: 1_000 });
	});

	it('ignores non-numeric values and non-object input', () => {
		expect(pickReconstructParams({ target_polycount: 'lots', seed: {} })).toEqual({});
		expect(pickReconstructParams(null)).toEqual({});
		expect(pickReconstructParams([1, 2])).toEqual({});
		expect(pickReconstructParams('tier')).toEqual({});
	});
});

describe('reconstruct handler wiring', () => {
	it('spreads caller params only through pickReconstructParams', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(new URL('../api/avatars/_actions.js', import.meta.url), 'utf8');
		expect(src).toContain('...pickReconstructParams(body.params)');
		expect(src).not.toMatch(/\.\.\.\(body\.params \?\? \{\}\), \.\.\.provider\.params/);
	});
});
