/**
 * A poll reveals nothing to a caller who does not own the job.
 *
 * GET /api/forge?job= is answered for whoever holds the job handle: the handle
 * is an HMAC-signed bearer capability, deliberately shared with every caller an
 * identical request was coalesced onto. What it must never hand a stranger is
 * the owner's data. The creation row is looked up scoped to the poller's own
 * client key, so a different client gets the job's status and nothing that
 * describes the owner's creation: no prompt-derived reference view, no creation
 * id (and so no manage token), no lane provenance. A handle that was tampered
 * with, or signed with another secret, is refused outright before anything is
 * polled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

Object.assign(process.env, {
	APP_ORIGIN: 'https://three.ws',
	JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	GCP_HUNYUAN3D_URL: 'https://hunyuan3d.example.run.app',
	GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
});

const workerStatus = vi.fn(async () => ({ status: 'running' }));
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({ submit: vi.fn(), status: (...a) => workerStatus(...a) }),
}));

const TASK = 'gcp-owned-task';
const OWNER_ROW = {
	id: 'creation-owned',
	status: 'generating',
	backend: 'hunyuan3d',
	tier: 'standard',
	path: 'image',
	prompt: 'my secret prototype',
	preview_image_url: 'https://cdn.example/private-ref.png',
	views_requested: 1,
	views_used: 1,
	multiview: false,
	created_at: new Date(Date.now() - 60_000).toISOString(),
	superseded_by: null,
};
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	ownerClientKey: (k) => (typeof k === 'string' && k && k !== 'client:anon' ? k : null),
	createCreation: vi.fn(),
	materializeCreation: vi.fn(async () => null),
	markFailed: vi.fn(async () => {}),
	markSupersededBy: vi.fn(async () => true),
	// Scoped exactly like the real query: replicate_job_id AND client_key.
	findByJob: vi.fn(async ({ replicateJobId, clientKey }) =>
		replicateJobId === TASK && clientKey === 'client:owner' ? OWNER_ROW : null,
	),
}));

vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
	laneCooldownKey: (id) => `forge-lane:${id}`,
}));

vi.mock('../../api/_lib/forge-failover.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, resolveLiveJob: vi.fn(async () => null), bindJobSuccessor: vi.fn(async () => true) };
});

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: { ...actual.limits, mcp3dStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })) },
		clientIp: () => '203.0.113.9',
	};
});

const { default: handler } = await import('../../api/forge.js');
const { encodeJobToken } = await import('../../api/_lib/forge-job-token.js');

const JOB = encodeJobToken({ provider: 'gcp', taskId: TASK });

async function poll(jobId, client) {
	const res = {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) {
			this.headers[String(name).toLowerCase()] = value;
		},
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
	await handler(
		{
			method: 'GET',
			url: `/api/forge?job=${encodeURIComponent(jobId)}`,
			headers: client ? { 'x-forge-client': client } : {},
			on(event, cb) {
				if (event === 'end') cb();
			},
		},
		res,
	);
	return res;
}

const OWNER_FIELDS = ['creation_id', 'manage_token', 'preview_image_url', 'prompt', 'backend', 'tier', 'path', 'views_used', 'elapsed_seconds'];

beforeEach(() => workerStatus.mockClear());

describe('poll privacy', () => {
	it('the owner sees their own job described', async () => {
		const res = await poll(JOB, 'owner');
		expect(res.body.status).toBe('running');
		expect(res.body.preview_image_url).toBe(OWNER_ROW.preview_image_url);
		expect(res.body.backend).toBe('hunyuan3d');
	});

	it('another client polling the same handle learns only the status', async () => {
		const res = await poll(JOB, 'stranger');
		expect(res.statusCode).toBe(200);
		expect(res.body.status).toBe('running');
		for (const field of OWNER_FIELDS) expect(res.body).not.toHaveProperty(field);
		expect(JSON.stringify(res.body)).not.toContain('private-ref');
	});

	it('a caller with no client id learns only the status', async () => {
		const res = await poll(JOB, null);
		for (const field of OWNER_FIELDS) expect(res.body).not.toHaveProperty(field);
	});

	it('a tampered handle is refused before any worker is asked', async () => {
		const forged = Buffer.from(JSON.stringify({ p: 'gcp', t: 'someone-elses-task' })).toString('base64url');
		const res = await poll(`f1.${forged}.${JOB.split('.')[2]}`, 'owner');
		expect(res.statusCode).toBe(400);
		expect(res.body).toEqual({ error: 'invalid_job', message: 'Malformed job id.' });
		expect(workerStatus).not.toHaveBeenCalled();
	});

	it('a handle signed with another secret is refused before any worker is asked', async () => {
		const payload = Buffer.from(JSON.stringify({ p: 'gcp', t: TASK })).toString('base64url');
		const sig = createHmac('sha256', 'not-the-server-secret-but-just-as-long-1234').update(payload).digest('base64url');
		const res = await poll(`f1.${payload}.${sig}`, 'owner');
		expect(res.statusCode).toBe(400);
		expect(res.body.error).toBe('invalid_job');
		expect(workerStatus).not.toHaveBeenCalled();
	});
});
