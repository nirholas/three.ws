// @vitest-environment jsdom
// src/agent-resolver.js turns an `agent-id` into the manifest <agent-3d> boots
// from. It must read the agent from the three.ws origin it is handed, never the
// host page's origin, and it reads the public manifest because that document is
// the one served with an open CORS policy to any embedding site.
import { describe, it, expect, vi } from 'vitest';
import { resolveAgentById, resolveByAvatarId, AgentResolveError } from '../../src/agent-resolver.js';

const AGENT_ID = '27a0f649-3b59-4552-bb0b-faf616ac448b';
const API = 'https://three.ws';

function jsonResponse(status, body) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function publicManifest(overrides = {}) {
	return {
		spec: 'agent-manifest/0.1',
		id: AGENT_ID,
		name: 'AxisXV',
		description: 'Evidence-first Signal Cards.',
		body: { uri: 'https://cdn.example/axis.glb', format: 'model/gltf-binary' },
		skills: ['greet', 'remember'],
		registrations: [],
		voice: { provider: 'browser' },
		...overrides,
	};
}

describe('resolveAgentById', () => {
	it('reads the public manifest from the API origin, not the page origin, without cookies', async () => {
		expect(location.origin).not.toBe(API); // jsdom page origin stands in for the host site
		const fetchFn = vi.fn(async () => jsonResponse(200, publicManifest()));
		await resolveAgentById(AGENT_ID, { origin: API, fetchFn });
		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, init] = fetchFn.mock.calls[0];
		expect(url).toBe(`${API}/api/agents/${AGENT_ID}/manifest`);
		expect(init.credentials).toBe('omit');
	});

	it('builds the boot manifest: real name, body, skills, and URLs rooted at the API origin', async () => {
		const fetchFn = vi.fn(async () => jsonResponse(200, publicManifest()));
		const m = await resolveAgentById(AGENT_ID, { origin: API, fetchFn });
		expect(m.name).toBe('AxisXV');
		expect(m.id.agentId).toBe(AGENT_ID);
		expect(m.body).toEqual({ uri: 'https://cdn.example/axis.glb', format: 'gltf-binary' });
		expect(m.skills).toEqual([{ name: 'greet' }, { name: 'remember' }]);
		expect(m.memory).toEqual({ mode: 'local', namespace: AGENT_ID });
		expect(m._baseURI).toBe(`${API}/agent/${AGENT_ID}/`);
		expect(m._source).toBe('agent-id');
		expect(m.voice.tts).toEqual({ provider: 'browser' });
	});

	it('routes an ElevenLabs voice through the API origin with the owner-tuned delivery', async () => {
		const fetchFn = vi.fn(async () =>
			jsonResponse(
				200,
				publicManifest({
					voice: {
						provider: 'elevenlabs',
						voice_id: 'voice-abc',
						model: 'eleven_turbo_v2_5',
						settings: { stability: 0.4, similarity_boost: 0.8, use_speaker_boost: true },
					},
				}),
			),
		);
		const m = await resolveAgentById(AGENT_ID, { origin: API, fetchFn });
		expect(m.voice.tts).toEqual({
			provider: 'elevenlabs',
			voiceId: 'voice-abc',
			proxyURL: `${API}/api/tts/eleven`,
			agentId: AGENT_ID,
			modelId: 'eleven_turbo_v2_5',
			stability: 0.4,
			similarityBoost: 0.8,
			useSpeakerBoost: true,
		});
	});

	it('carries the owner gesture slots and routines the element applies at boot', async () => {
		const slots = { greet: 'wave' };
		const routines = [{ name: 'welcome', steps: [] }];
		const fetchFn = vi.fn(async () =>
			jsonResponse(200, publicManifest({ animationSlots: slots, choreographies: routines })),
		);
		const m = await resolveAgentById(AGENT_ID, { origin: API, fetchFn });
		expect(m.animationSlots).toEqual(slots);
		expect(m.choreographies).toEqual(routines);
	});

	it('reports a missing agent as not_found (404, and the 400 a non-uuid id gets)', async () => {
		for (const status of [404, 400]) {
			const fetchFn = vi.fn(async () => jsonResponse(status, { error: 'x' }));
			await expect(resolveAgentById(AGENT_ID, { origin: API, fetchFn })).rejects.toMatchObject({
				name: 'AgentResolveError',
				code: 'not_found',
				status,
			});
		}
	});

	it('reports an agent with no body as no_avatar rather than booting an empty frame', async () => {
		const fetchFn = vi.fn(async () => jsonResponse(200, publicManifest({ body: undefined })));
		await expect(resolveAgentById(AGENT_ID, { origin: API, fetchFn })).rejects.toBeInstanceOf(
			AgentResolveError,
		);
		await expect(resolveAgentById(AGENT_ID, { origin: API, fetchFn })).rejects.toMatchObject({
			code: 'no_avatar',
		});
	});

	it('turns a network failure into a typed error the element can fall back on', async () => {
		const fetchFn = vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		await expect(resolveAgentById(AGENT_ID, { origin: API, fetchFn })).rejects.toMatchObject({
			code: 'network',
		});
	});
});

describe('resolveByAvatarId', () => {
	it('reads the avatar from the API origin it is given, without cookies', async () => {
		const fetchFn = vi.fn(async () =>
			jsonResponse(200, { avatar: { name: 'Body', url: 'https://cdn.example/body.glb' } }),
		);
		const m = await resolveByAvatarId('22222222-2222-4222-8222-222222222222', { origin: API, fetchFn });
		const [url, init] = fetchFn.mock.calls[0];
		expect(url).toBe(`${API}/api/avatars/22222222-2222-4222-8222-222222222222`);
		expect(init.credentials).toBe('omit');
		expect(m.body.uri).toBe('https://cdn.example/body.glb');
	});
});
