// POST /api/motion-swap forwards the 360 fields (contract C3) to the
// video2motion worker, validates their ranges, and GET returns the reframe the
// worker produced. The handler and the gcp provider are the real ones; only the
// rate limiter (Redis), the signed-in caller and the single upstream HTTP call
// are stubbed, so the assertions cover the exact JSON the worker would receive.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

process.env.GCP_VIDEO2MOTION_URL = 'https://v2m.example.test';
process.env.GCP_RECONSTRUCTION_KEY = 'test-bearer-key';

const fetchUpstreamMock = vi.fn();
vi.mock('../../api/_lib/upstream-fetch.js', () => ({
	fetchUpstream: (...args) => fetchUpstreamMock(...args),
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		upload: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		mcp3dStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
	},
	clientIp: vi.fn(() => '203.0.113.7'),
}));

vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'user-motion' }),
	getSessionUser: async () => ({ id: 'user-motion' }),
}));

const { default: handler } = await import('../../api/motion-swap.js');

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(k, v) {
			this.headers[String(k).toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[String(k).toLowerCase()];
		},
		end(body) {
			this.body = body ?? null;
		},
	};
}

function makeReq(method, url, body) {
	const req = Readable.from(body ? [Buffer.from(JSON.stringify(body), 'utf8')] : []);
	req.method = method;
	req.url = url;
	req.headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' };
	return req;
}

async function post(body) {
	const res = makeRes();
	await handler(makeReq('POST', '/api/motion-swap', body), res);
	return { status: res.statusCode, json: JSON.parse(res.body) };
}

const VIDEO = 'https://cdn.example.com/clip360.mp4';

beforeEach(() => {
	fetchUpstreamMock.mockReset();
	fetchUpstreamMock.mockResolvedValue({
		status: 200,
		ok: true,
		json: async () => ({ task_id: 'task-equirect-0001' }),
	});
});

function workerBody() {
	expect(fetchUpstreamMock).toHaveBeenCalledTimes(1);
	return JSON.parse(fetchUpstreamMock.mock.calls[0][1].body);
}

describe('POST /api/motion-swap with projection', () => {
	it('forwards projection and subject to the worker', async () => {
		const out = await post({
			video_url: VIDEO,
			projection: 'equirect',
			subject: { yaw_deg: -120.5, pitch_deg: 10 },
		});
		expect(out.status).toBe(202);
		const body = workerBody();
		expect(body.projection).toBe('equirect');
		expect(body.subject).toEqual({ yaw_deg: -120.5, pitch_deg: 10 });
	});

	it('sends no 360 fields for ordinary video, so the worker default is untouched', async () => {
		const out = await post({ video_url: VIDEO });
		expect(out.status).toBe(202);
		const body = workerBody();
		expect('projection' in body).toBe(false);
		expect('subject' in body).toBe(false);
	});

	it('treats an explicit perspective projection like the default', async () => {
		await post({ video_url: VIDEO, projection: 'perspective' });
		expect('projection' in workerBody()).toBe(false);
	});

	it('accepts equirect without a subject (the worker acquires the person itself)', async () => {
		const out = await post({ video_url: VIDEO, projection: 'equirect' });
		expect(out.status).toBe(202);
		const body = workerBody();
		expect(body.projection).toBe('equirect');
		expect('subject' in body).toBe(false);
	});

	it.each([
		['unknown projection', { projection: 'cubemap' }, 'invalid_projection'],
		['non-string projection', { projection: 7 }, 'invalid_projection'],
		['yaw above range', { projection: 'equirect', subject: { yaw_deg: 181, pitch_deg: 0 } }, 'invalid_subject'],
		['yaw below range', { projection: 'equirect', subject: { yaw_deg: -180.1, pitch_deg: 0 } }, 'invalid_subject'],
		['pitch above range', { projection: 'equirect', subject: { yaw_deg: 0, pitch_deg: 91 } }, 'invalid_subject'],
		['pitch below range', { projection: 'equirect', subject: { yaw_deg: 0, pitch_deg: -90.5 } }, 'invalid_subject'],
		['string yaw', { projection: 'equirect', subject: { yaw_deg: '10', pitch_deg: 0 } }, 'invalid_subject'],
		['missing pitch', { projection: 'equirect', subject: { yaw_deg: 10 } }, 'invalid_subject'],
		['NaN yaw', { projection: 'equirect', subject: { yaw_deg: null, pitch_deg: 0 } }, 'invalid_subject'],
	])('rejects %s with 400 and never calls the worker', async (_n, extra, code) => {
		const out = await post({ video_url: VIDEO, ...extra });
		expect(out.status).toBe(400);
		expect(out.json.error).toBe(code);
		expect(fetchUpstreamMock).not.toHaveBeenCalled();
	});

	it('accepts the exact boundary values', async () => {
		const out = await post({
			video_url: VIDEO,
			projection: 'equirect',
			subject: { yaw_deg: 180, pitch_deg: -90 },
		});
		expect(out.status).toBe(202);
	});
});

describe('GET /api/motion-swap returns the reframe', () => {
	it('surfaces reframe_url, subject_track and track_stats', async () => {
		const submitted = await post({ video_url: VIDEO, projection: 'equirect' });
		const track = [
			{ t: 0, yaw_deg: -120, pitch_deg: 4, fov_deg: 78 },
			{ t: 0.04, yaw_deg: -119.2, pitch_deg: 4.1, fov_deg: 78 },
		];
		fetchUpstreamMock.mockReset();
		fetchUpstreamMock.mockResolvedValue({
			status: 200,
			ok: true,
			json: async () => ({
				status: 'done',
				result_url: 'https://cdn.example.com/clip.json',
				reframe_url: 'https://cdn.example.com/reframe.mp4',
				subject_track: track,
				track_stats: { detected_ratio: 0.97 },
				frames: 2,
				fps: 24,
			}),
		});
		const res = makeRes();
		await handler(
			makeReq('GET', `/api/motion-swap?job=${submitted.json.job_id}`),
			res,
		);
		const json = JSON.parse(res.body);
		expect(json.status).toBe('done');
		expect(json.reframe_url).toBe('https://cdn.example.com/reframe.mp4');
		expect(json.subject_track).toEqual(track);
		expect(json.track_stats).toEqual({ detected_ratio: 0.97 });
	});

	it('returns null reframe fields for a perspective job', async () => {
		const submitted = await post({ video_url: VIDEO });
		fetchUpstreamMock.mockReset();
		fetchUpstreamMock.mockResolvedValue({
			status: 200,
			ok: true,
			json: async () => ({ status: 'done', result_url: 'https://cdn.example.com/clip.json' }),
		});
		const res = makeRes();
		await handler(makeReq('GET', `/api/motion-swap?job=${submitted.json.job_id}`), res);
		const json = JSON.parse(res.body);
		expect(json.reframe_url).toBeNull();
		expect(json.subject_track).toBeNull();
		expect(json.track_stats).toBeNull();
	});
});
