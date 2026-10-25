// The gcp regen provider packs {mode, taskId, baseUrl, resultKey} into an
// unsigned base64url job id and sends GCP_RECONSTRUCTION_KEY as a bearer token
// when polling. The poll base URL must therefore come from configured env, never
// from the (client-supplied) job id.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchUpstreamMock = vi.fn();
vi.mock('../api/_lib/upstream-fetch.js', () => ({
	fetchUpstream: (...args) => fetchUpstreamMock(...args),
}));

const ENV_KEYS = ['GCP_RECONSTRUCTION_KEY', 'GCP_RECONSTRUCTION_URL', 'GCP_REMESH_URL'];
const prior = {};

function forge(payload) {
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

let createRegenProvider;

beforeEach(async () => {
	for (const k of ENV_KEYS) prior[k] = process.env[k];
	process.env.GCP_RECONSTRUCTION_KEY = 'test-bearer-key';
	process.env.GCP_RECONSTRUCTION_URL = 'https://recon.example.test';
	process.env.GCP_REMESH_URL = 'https://remesh.example.test/';
	fetchUpstreamMock.mockReset();
	fetchUpstreamMock.mockResolvedValue({
		status: 200,
		ok: true,
		json: async () => ({ status: 'running' }),
	});
	vi.resetModules();
	({ createRegenProvider } = await import('../api/_providers/gcp.js'));
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (prior[k] === undefined) delete process.env[k];
		else process.env[k] = prior[k];
	}
});

describe('gcp provider status(): job id envelope', () => {
	it('never sends the bearer key to a baseUrl taken from the job id', async () => {
		const provider = createRegenProvider();
		const id = forge({
			mode: 'remesh',
			taskId: 't1',
			baseUrl: 'https://attacker.example.test',
			resultKey: 'clip_url',
		});
		const out = await provider.status(id);
		expect(out.status).toBe('failed');
		expect(fetchUpstreamMock).not.toHaveBeenCalled();
	});

	it('rejects internal addresses in the envelope', async () => {
		const provider = createRegenProvider();
		const id = forge({
			mode: 'remesh',
			taskId: 't1',
			baseUrl: 'http://169.254.169.254',
			resultKey: 'x',
		});
		const out = await provider.status(id);
		expect(out.status).toBe('failed');
		expect(fetchUpstreamMock).not.toHaveBeenCalled();
	});

	it('still polls the configured service for a legitimate job id', async () => {
		const provider = createRegenProvider();
		const id = forge({
			mode: 'remesh',
			taskId: 't1',
			baseUrl: 'https://remesh.example.test/',
			resultKey: 'result_url',
		});
		const out = await provider.status(id);
		expect(out.status).toBe('running');
		expect(fetchUpstreamMock).toHaveBeenCalledTimes(1);
		expect(fetchUpstreamMock.mock.calls[0][0]).toBe('https://remesh.example.test/tasks/t1');
	});

	it('honours a reconstructUrl override that matches the envelope', async () => {
		const provider = createRegenProvider({ reconstructUrl: 'https://alt.example.test' });
		const id = forge({
			mode: 'reconstruct',
			taskId: 't2',
			baseUrl: 'https://alt.example.test',
			resultKey: 'glb_url',
		});
		await provider.status(id);
		expect(fetchUpstreamMock.mock.calls[0][0]).toBe('https://alt.example.test/jobs/t2');
	});
});
