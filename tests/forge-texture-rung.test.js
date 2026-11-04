import { describe, expect, it } from 'vitest';
import { textureModeFor, TEXTURE_MODE_DEFAULT, TEXTURE_MODE_ULTRATEX } from '../api/_lib/forge-tiers.js';
import { createRegenProvider } from '../api/_providers/gcp.js';

const URL_ENV = { GCP_TEXTURE_ULTRATEX_URL: 'https://ultratex.example.run.app' };

describe('textureModeFor', () => {
	it('defaults to the SDXL texture worker with no env at all', () => {
		expect(textureModeFor({ env: {} })).toBe(TEXTURE_MODE_DEFAULT);
		expect(textureModeFor({ tier: 'high', env: {} })).toBe(TEXTURE_MODE_DEFAULT);
	});

	it('stays on SDXL when the flag is on but the worker URL is missing', () => {
		expect(textureModeFor({ env: { FORGE_TEXTURE_ULTRATEX: '1' } })).toBe(TEXTURE_MODE_DEFAULT);
	});

	it('stays on SDXL when the URL is set but the flag is off', () => {
		expect(textureModeFor({ env: { ...URL_ENV } })).toBe(TEXTURE_MODE_DEFAULT);
		expect(textureModeFor({ env: { ...URL_ENV, FORGE_TEXTURE_ULTRATEX: 'true' } })).toBe(TEXTURE_MODE_DEFAULT);
	});

	it('routes to UltraTex when flag and URL are both present and no tier is given', () => {
		expect(textureModeFor({ env: { ...URL_ENV, FORGE_TEXTURE_ULTRATEX: '1' } })).toBe(TEXTURE_MODE_ULTRATEX);
	});

	it('honours the tier list, defaulting to high only', () => {
		const env = { ...URL_ENV, FORGE_TEXTURE_ULTRATEX: '1' };
		expect(textureModeFor({ tier: 'high', env })).toBe(TEXTURE_MODE_ULTRATEX);
		expect(textureModeFor({ tier: 'standard', env })).toBe(TEXTURE_MODE_DEFAULT);
		expect(textureModeFor({ tier: 'standard', env: { ...env, FORGE_TEXTURE_ULTRATEX_TIERS: 'standard, high' } })).toBe(TEXTURE_MODE_ULTRATEX);
	});
});

describe('gcp provider texture modes', () => {
	it('supports retex_ultratex only when its own URL is configured', () => {
		const prev = { k: process.env.GCP_RECONSTRUCTION_KEY, u: process.env.GCP_TEXTURE_ULTRATEX_URL };
		process.env.GCP_RECONSTRUCTION_KEY = 'k';
		try {
			delete process.env.GCP_TEXTURE_ULTRATEX_URL;
			expect(createRegenProvider().supportsMode('retex_ultratex')).toBe(false);
			process.env.GCP_TEXTURE_ULTRATEX_URL = URL_ENV.GCP_TEXTURE_ULTRATEX_URL;
			expect(createRegenProvider().supportsMode('retex_ultratex')).toBe(true);
		} finally {
			for (const [k, v] of [['GCP_RECONSTRUCTION_KEY', prev.k], ['GCP_TEXTURE_ULTRATEX_URL', prev.u]]) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		}
	});
});

describe('A/B harness report', () => {
	it('never invents quality numbers when no scorer ran', async () => {
		const { summarize, renderReport } = await import('../scripts/forge-texture-ab.mjs');
		const rows = [
			{ id: 'a', worker: 'sdxl', status: 'done', elapsedMs: 40000 },
			{ id: 'a', worker: 'ultratex', status: 'failed', error: 'submit HTTP 503 license_gate_closed', elapsedMs: 300 },
		];
		const summaries = { sdxl: summarize([rows[0]]), ultratex: summarize([rows[1]]) };
		expect(summaries.sdxl.meanClip).toBeNull();
		const md = renderReport({ date: '2026-11-04', workers: ['sdxl', 'ultratex'], summaries, rows, scorerUsed: false });
		expect(md).toContain('no quality claim is made');
		expect(md).toContain('not measured');
		expect(md).toContain('license_gate_closed');
	});
});
