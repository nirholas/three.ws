// The segment worker reports `single_part` and a plain-language `note` when a
// model is one continuous surface with nothing to split. The gcp provider must
// carry both across the hop, or the page shows a lone giant "part" with no word
// of why (work order 134, 2026-11-27).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchUpstreamMock = vi.fn();
vi.mock('../api/_lib/upstream-fetch.js', () => ({
	fetchUpstream: (...args) => fetchUpstreamMock(...args),
}));

const ENV_KEYS = ['GCP_RECONSTRUCTION_KEY', 'GCP_SEGMENT_URL'];
const prior = {};
let createRegenProvider;

function envelope(payload) {
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function workerAnswers(data) {
	fetchUpstreamMock.mockResolvedValue({ status: 200, ok: true, json: async () => data });
}

beforeEach(async () => {
	for (const k of ENV_KEYS) prior[k] = process.env[k];
	process.env.GCP_RECONSTRUCTION_KEY = 'test-bearer-key';
	process.env.GCP_SEGMENT_URL = 'https://segment.example.test';
	fetchUpstreamMock.mockReset();
	vi.resetModules();
	({ createRegenProvider } = await import('../api/_providers/gcp.js'));
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (prior[k] === undefined) delete process.env[k];
		else process.env[k] = prior[k];
	}
});

const JOB = () =>
	envelope({ mode: 'segment', taskId: 't1', baseUrl: 'https://segment.example.test', resultKey: 'result_url' });

describe('gcp provider status(): segment single_part', () => {
	it('relays single_part and note from a finished segment task', async () => {
		workerAnswers({
			status: 'done',
			result_url: 'https://storage.googleapis.com/b/segment/t1.glb',
			manifest_url: 'https://storage.googleapis.com/b/segment/t1.parts.json',
			parts: [{ id: 'part_01', name: 'core', face_count: 900 }],
			part_count: 1,
			source_faces: 900,
			method: 'auto',
			single_part: true,
			note: 'This model is one continuous surface.',
		});
		const out = await createRegenProvider().status(JOB());
		expect(out.status).toBe('done');
		expect(out.partCount).toBe(1);
		expect(out.singlePart).toBe(true);
		expect(out.note).toBe('This model is one continuous surface.');
	});

	it('leaves both unset for a normal multi-part split', async () => {
		workerAnswers({
			status: 'done',
			result_url: 'https://storage.googleapis.com/b/segment/t1.glb',
			parts: [{ id: 'part_01' }, { id: 'part_02' }],
			part_count: 2,
			single_part: false,
			note: null,
		});
		const out = await createRegenProvider().status(JOB());
		expect(out.partCount).toBe(2);
		expect(out.singlePart).toBeUndefined();
		expect(out.note).toBeUndefined();
	});
});
