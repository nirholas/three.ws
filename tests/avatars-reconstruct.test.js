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

describe('dense head fit routing (RECONSTRUCT_DENSE_URL)', () => {
	async function submitTo(env, request) {
		const { vi } = await import('vitest');
		const calls = [];
		vi.resetModules();
		vi.doMock('../api/_lib/upstream-fetch.js', () => ({
			fetchUpstream: async (url) => {
				calls.push(url);
				return { status: 200, ok: true, json: async () => ({ job_id: 'j1' }) };
			},
		}));
		const prior = {};
		const keys = ['GCP_RECONSTRUCTION_KEY', 'GCP_RECONSTRUCTION_URL', 'RECONSTRUCT_DENSE_URL'];
		for (const k of keys) { prior[k] = process.env[k]; delete process.env[k]; }
		Object.assign(process.env, { GCP_RECONSTRUCTION_KEY: 'k', GCP_RECONSTRUCTION_URL: 'https://cpu.example.test', ...env });
		try {
			const { createRegenProvider } = await import('../api/_providers/gcp.js');
			const provider = createRegenProvider();
			await provider.submit(request);
			return { calls };
		} finally {
			for (const k of keys) { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; }
			vi.doUnmock('../api/_lib/upstream-fetch.js');
		}
	}

	const face = { mode: 'reconstruct', sourceUrl: 'https://img.example.test/a.jpg', params: {} };

	it('sends a face job to the CPU service when the dense URL is unset', async () => {
		const { calls } = await submitTo({}, face);
		expect(calls[0]).toBe('https://cpu.example.test/reconstruct');
	});

	it('sends a face job to the dense GPU service when the dense URL is set', async () => {
		const { calls } = await submitTo({ RECONSTRUCT_DENSE_URL: 'https://dense.example.test' }, face);
		expect(calls[0]).toBe('https://dense.example.test/reconstruct');
	});

	it('keeps high-detail jobs on the CPU service even when the dense URL is set', async () => {
		const { calls } = await submitTo(
			{ RECONSTRUCT_DENSE_URL: 'https://dense.example.test' },
			{ ...face, params: { tier: 'ultra' } },
		);
		expect(calls[0]).toBe('https://cpu.example.test/reconstruct');
	});
});
