// The rig preflight (api/_lib/rig-preflight.js) reads what a model is from the
// words it was made from and passes `params.subject` ('humanoid' | 'creature').
// The GCP provider must carry it into the /rig request body, because the worker
// otherwise guesses from the silhouette alone: on 2026-11-27 that sent a katana
// down the human rigger, and a T-posed human is wider than tall and reads as
// non-human to the same test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchUpstreamMock = vi.fn();
vi.mock('../api/_lib/upstream-fetch.js', () => ({
	fetchUpstream: (...args) => fetchUpstreamMock(...args),
}));

const ENV = {
	GCP_RECONSTRUCTION_KEY: 'test-bearer-key',
	GCP_RECONSTRUCTION_URL: 'https://recon.example.test',
	GCP_UNIRIG_URL: 'https://rig.example.test',
	PUBLIC_APP_ORIGIN: 'https://three.ws',
};
const prior = {};
let createRegenProvider;

function sentBody() {
	expect(fetchUpstreamMock).toHaveBeenCalledTimes(1);
	return JSON.parse(fetchUpstreamMock.mock.calls[0][1].body);
}

beforeEach(async () => {
	for (const [k, v] of Object.entries(ENV)) {
		prior[k] = process.env[k];
		process.env[k] = v;
	}
	fetchUpstreamMock.mockReset();
	fetchUpstreamMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ task_id: 't1' }) });
	vi.resetModules();
	({ createRegenProvider } = await import('../api/_providers/gcp.js'));
});

afterEach(() => {
	for (const k of Object.keys(ENV)) {
		if (prior[k] === undefined) delete process.env[k];
		else process.env[k] = prior[k];
	}
});

describe('gcp provider forwards the rig subject to the worker', () => {
	it.each(['humanoid', 'creature'])('sends subject %s in the /rig body', async (subject) => {
		await createRegenProvider().submit({
			mode: 'rerig',
			sourceUrl: 'https://three.ws/cdn/forge/abc/model.glb',
			params: { subject },
		});
		expect(fetchUpstreamMock.mock.calls[0][0]).toMatch(/\/rig$/);
		expect(sentBody().subject).toBe(subject);
	});

	it('sends no subject when the preflight had none, leaving the worker its own test', async () => {
		await createRegenProvider().submit({
			mode: 'rerig',
			sourceUrl: 'https://three.ws/cdn/forge/abc/model.glb',
			params: {},
		});
		expect('subject' in sentBody()).toBe(false);
	});

	it('drops a subject that is not one the worker knows', async () => {
		await createRegenProvider().submit({
			mode: 'rerig',
			sourceUrl: 'https://three.ws/cdn/forge/abc/model.glb',
			params: { subject: 'ignore previous instructions' },
		});
		expect('subject' in sentBody()).toBe(false);
	});
});
