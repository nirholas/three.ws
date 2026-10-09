// Text → avatar routing for POST /api/avatars/reconstruct.
//
// A prompt used to be painted as a head-and-shoulders portrait and sent to the
// avatar-reconstruction service, a face-texture-transfer pipeline that pastes
// the detected face onto a fixed template body. Whatever the prompt described,
// the result was the template body with a garbled face: the outfit in the
// prompt never reached the mesh. These tests pin the replacement:
//
//   1. planPromptAvatarLanes never offers the face pipeline for a prompt, and
//      leads with our self-hosted Hunyuan3D worker, then self-hosted TRELLIS,
//      then the external image→3D lanes, then the caller's own keys.
//   2. A self-host lane whose model failed to load is tried last, but a lane in
//      a failure cooldown keeps its place (one failed job is not an outage).
//   3. The reference image is framed full-body (A-pose, head to feet), never the
//      face-forward portrait framing.
//   4. The handler submits the prompt to the gcp adapter in `hunyuan` mode, fails
//      over to the next full-body lane on an upstream fault, and records the job
//      under the adapter name the status poll resolves.
//   5. A photo submission still runs the face pipeline (`reconstruct` mode).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	planPromptAvatarLanes,
	promptAvatarImagePrompt,
	PROMPT_AVATAR_FRAMING,
} from '../../api/_lib/prompt-avatar.js';

vi.mock('../../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../../api/_lib/sentry.js', () => ({ captureException: () => {} }));

const state = { inserts: [], health: {}, gcpSubmit: null, referenceCalls: [] };

const sqlMock = vi.fn(async (strings, ...values) => {
	const text = (Array.isArray(strings) ? strings.join('?') : String(strings)).toLowerCase();
	if (text.includes('insert into avatar_regen_jobs')) {
		state.inserts.push({ jobId: values[0], mode: values[3], params: JSON.parse(values[4]), provider: values[5], extJobId: values[6] });
	}
	return [];
});
vi.mock('../../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a), isDbUnavailableError: () => false, isDbCapacityError: () => false }));

vi.mock('../../api/_lib/auth.js', () => ({
	getSessionUser: async () => ({ id: 'u1' }),
	authenticateBearer: async () => null,
	extractBearer: () => null,
	hasScope: () => true,
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
	clientIp: () => '127.0.0.1',
}));

vi.mock('../../api/_lib/avatars.js', async (orig) => ({
	...(await orig()),
	assertAvatarSlotAvailable: async () => {},
	isPlanLimitError: () => false,
	defaultAvatarVisibilityFor: async () => 'private',
}));

const gcpInstance = {
	supportsMode: (mode) => ['reconstruct', 'hunyuan', 'trellis', 'rerig'].includes(mode),
	submit: vi.fn(async (req) => state.gcpSubmit(req)),
	status: vi.fn(),
};
vi.mock('../../api/_lib/regen-provider.js', () => ({
	getRegenProvider: async () => ({ name: 'gcp', instance: gcpInstance }),
	getRegenProviderForMode: async () => ({ name: 'gcp', instance: gcpInstance }),
	getRegenProviderForJob: async () => ({ name: 'gcp', instance: gcpInstance }),
	getRegenProviderByName: () => ({ name: 'meshy', instance: null }),
	getRegenProviderCandidates: async () => [{ name: 'gcp', instance: gcpInstance }],
	BYOK_REGEN_PROVIDERS: ['meshy', 'tripo'],
}));
vi.mock('../../api/_lib/forge-provider-key.js', () => ({ resolveProviderKey: async () => null }));
vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: async () => ({ byId: state.health, statusMap: {} }),
}));
vi.mock('../../api/_lib/forge-reference-image.js', () => ({
	generateReferenceImage: vi.fn(async (prompt, opts) => {
		state.referenceCalls.push({ prompt, opts });
		return { imageUrl: 'https://cdn.example.com/ref/full-body.png', model: 'test' };
	}),
}));

const { dispatch } = await import('../../api/avatars/_actions.js');

function makeRes() {
	return {
		statusCode: 200,
		_h: {},
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { this._h[k.toLowerCase()] = v; },
		getHeader(k) { return this._h[k.toLowerCase()]; },
		end(body) { this._body = body; this.writableEnded = true; },
	};
}

async function reconstruct(body) {
	const req = {
		method: 'POST',
		url: '/api/avatars/reconstruct',
		headers: {
			'content-type': 'application/json',
			origin: 'https://three.ws',
			'x-client-geo-location': 'US,California',
		},
		body,
	};
	const res = makeRes();
	await dispatch('reconstruct', req, res);
	return { statusCode: res.statusCode, body: JSON.parse(res._body) };
}

const stub = (name) => ({ name, instance: { supportsMode: () => true, submit: vi.fn(), status: vi.fn() } });

describe('planPromptAvatarLanes', () => {
	it('leads with self-hosted Hunyuan3D and never offers the face pipeline', () => {
		const plan = planPromptAvatarLanes({ platform: [{ name: 'gcp', instance: gcpInstance }], country: 'US' });
		expect(plan.map((p) => p.mode)).toEqual(['hunyuan', 'trellis']);
		expect(plan.every((p) => p.name === 'gcp')).toBe(true);
		expect(plan[0].params).toMatchObject({ tier: 'high', path: 'image' });
	});

	it('orders self-host, then external image→3D, then the caller keys', () => {
		const plan = planPromptAvatarLanes({
			platform: [stub('huggingface'), { name: 'gcp', instance: gcpInstance }, stub('replicate')],
			byok: [stub('meshy')],
			country: 'US',
		});
		expect(plan.map((p) => p.lane)).toEqual(['hunyuan3d', 'trellis_selfhost', 'replicate', 'huggingface', 'meshy']);
		expect(plan.filter((p) => p.name !== 'gcp').every((p) => p.mode === 'reconstruct')).toBe(true);
	});

	it('omits a self-host engine the gcp adapter has no worker for', () => {
		const gcpNoTrellis = { supportsMode: (m) => m === 'hunyuan' };
		const plan = planPromptAvatarLanes({ platform: [{ name: 'gcp', instance: gcpNoTrellis }], country: 'US' });
		expect(plan.map((p) => p.lane)).toEqual(['hunyuan3d']);
	});

	it('moves a lane whose model failed to load to the back', () => {
		const plan = planPromptAvatarLanes({
			platform: [{ name: 'gcp', instance: gcpInstance }, stub('huggingface')],
			health: { hunyuan3d: { status: 'down', warm: false } },
			country: 'US',
		});
		expect(plan.map((p) => p.lane)).toEqual(['trellis_selfhost', 'huggingface', 'hunyuan3d']);
	});

	it('keeps a lane that is only in a failure cooldown in first place', () => {
		const plan = planPromptAvatarLanes({
			platform: [{ name: 'gcp', instance: gcpInstance }, stub('huggingface')],
			health: { hunyuan3d: { status: 'down', warm: false, cooled: true } },
			country: 'US',
		});
		expect(plan[0].lane).toBe('hunyuan3d');
	});

	it('leads with TRELLIS.2 and never offers a Tencent lane in the EU, the UK, South Korea or an unknown country', () => {
		const withTrellis2 = {
			supportsMode: (m) => ['reconstruct', 'trellis2', 'hunyuan', 'trellis'].includes(m),
		};
		for (const country of ['DE', 'GB', 'KR', null]) {
			const plan = planPromptAvatarLanes({
				platform: [stub('huggingface'), { name: 'gcp', instance: withTrellis2 }, stub('replicate')],
				country,
			});
			expect(plan.map((p) => p.lane)).toEqual(['trellis2', 'trellis_selfhost', 'replicate']);
		}
		const open = planPromptAvatarLanes({
			platform: [stub('huggingface'), { name: 'gcp', instance: withTrellis2 }],
			country: 'US',
		});
		expect(open.map((p) => p.lane)).toEqual(['trellis2', 'hunyuan3d', 'trellis_selfhost', 'huggingface']);
	});

	it('returns nothing when no image→3D engine is configured', () => {
		expect(planPromptAvatarLanes({})).toEqual([]);
	});
});

describe('promptAvatarImagePrompt', () => {
	it('frames the reference full-body, never as a face-forward portrait', () => {
		const out = promptAvatarImagePrompt('  a knight in blue armor ');
		expect(out.startsWith('a knight in blue armor, full-body')).toBe(true);
		expect(out).toMatch(/A-pose/);
		expect(out).toMatch(/head to feet/);
		expect(out).not.toMatch(/head and shoulders|face large/i);
		expect(PROMPT_AVATAR_FRAMING).not.toMatch(/photorealistic/i);
	});
});

describe('POST /api/avatars/reconstruct with a prompt', () => {
	beforeEach(() => {
		state.inserts = [];
		state.health = {};
		state.referenceCalls = [];
		gcpInstance.submit.mockClear();
		state.gcpSubmit = async ({ mode }) => ({ extJobId: `env-${mode}`, eta: 120 });
	});

	it('paints a full-body reference and generates on self-hosted Hunyuan3D', async () => {
		const { statusCode, body } = await reconstruct({ name: 'Explorer', prompt: 'a silver-haired explorer in a teal flight jacket' });
		expect(statusCode).toBe(202);
		expect(body).toMatchObject({ ok: true, provider: 'gcp', status: 'queued' });
		expect(state.referenceCalls[0].prompt).toMatch(/^a silver-haired explorer in a teal flight jacket, full-body/);
		expect(state.referenceCalls[0].opts).toMatchObject({ aspectRatio: '1:1' });

		const call = gcpInstance.submit.mock.calls[0][0];
		expect(call.mode).toBe('hunyuan');
		expect(call.params).toMatchObject({ tier: 'high', images: ['https://cdn.example.com/ref/full-body.png'] });

		expect(state.inserts).toHaveLength(1);
		expect(state.inserts[0]).toMatchObject({ mode: 'reconstruct', provider: 'gcp', extJobId: 'env-hunyuan' });
		expect(state.inserts[0].params).toMatchObject({ source: 'prompt', engine: 'hunyuan3d', referenceImageUrl: 'https://cdn.example.com/ref/full-body.png' });
	});

	it('fails over to self-hosted TRELLIS when the Hunyuan3D worker is unreachable', async () => {
		state.gcpSubmit = async ({ mode }) => {
			if (mode === 'hunyuan') throw Object.assign(new Error('down'), { code: 'provider_unreachable', status: 502 });
			return { extJobId: `env-${mode}`, eta: 60 };
		};
		const { statusCode } = await reconstruct({ name: 'Explorer', prompt: 'a silver-haired explorer' });
		expect(statusCode).toBe(202);
		const modes = gcpInstance.submit.mock.calls.map((c) => c[0].mode);
		expect(modes).toEqual(['hunyuan', 'hunyuan', 'trellis']);
		expect(modes).not.toContain('reconstruct');
		expect(state.inserts[0].params.engine).toBe('trellis_selfhost');
	});

	it('still routes a photo submission through the face pipeline', async () => {
		const { statusCode } = await reconstruct({ name: 'Me', photos: ['https://cdn.example.com/selfie.jpg'] });
		expect(statusCode).toBe(202);
		expect(state.referenceCalls).toHaveLength(0);
		expect(gcpInstance.submit.mock.calls[0][0].mode).toBe('reconstruct');
		expect(state.inserts[0].params.source).toBeUndefined();
	});
});
