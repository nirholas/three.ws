// Resolve a hosted agent by id against the backend API, producing an in-memory
// manifest shaped like a file-based one so the rest of the <agent-3d> boot
// path (manifest.body.uri, manifest.brain, manifest.skills, manifest._baseURI)
// works unchanged.

export class AgentResolveError extends Error {
	constructor(code, message, { status } = {}) {
		super(message);
		this.name = 'AgentResolveError';
		this.code = code;
		if (status !== undefined) this.status = status;
	}
}

// Map a stored ElevenLabs voice_settings object (snake_case, as persisted by
// PUT /api/agents/:id/voice) to the camelCase options ElevenLabsTTS accepts.
// Omits absent fields so the TTS client falls back to its own defaults.
function voiceSettingsToConfig(vs) {
	if (!vs || typeof vs !== 'object') return {};
	const out = {};
	if (vs.stability != null) out.stability = vs.stability;
	if (vs.similarity_boost != null) out.similarityBoost = vs.similarity_boost;
	if (vs.style != null) out.style = vs.style;
	if (vs.use_speaker_boost != null) out.useSpeakerBoost = vs.use_speaker_boost;
	return out;
}

function ttsConfigFromManifestVoice(voice, { origin, agentId }) {
	const provider = voice?.provider || 'browser';
	if (provider !== 'elevenlabs' || !voice?.voice_id) return { provider: 'browser' };
	return {
		provider: 'elevenlabs',
		voiceId: voice.voice_id,
		proxyURL: `${origin}/api/tts/eleven`,
		// Lets the proxy serve this clip on the owner's own ElevenLabs key, so an
		// embed speaks for visitors too.
		agentId,
		...(voice.model ? { modelId: voice.model } : {}),
		...voiceSettingsToConfig(voice.settings),
	};
}

/**
 * Resolve a hosted agent id to the in-memory manifest the element boots from.
 *
 * Reads the agent's public manifest, GET {origin}/api/agents/:id/manifest. That
 * document is the embed contract: anonymous, CDN-cacheable, and served with
 * `access-control-allow-origin: *`, so the same request works from three.ws and
 * from any third-party page. It also carries the owner's gesture slots and
 * routines, which the element applies at boot.
 *
 * `origin` must be the three.ws API base the element was loaded from, never the
 * host page's origin: on example.com a site-absolute path asks example.com for
 * the agent, 404s, and the embed falls back to a default body named "Agent".
 *
 * @param {string} agentId
 * @param {{ origin?: string, fetchFn?: typeof fetch, signal?: AbortSignal }} [opts]
 */
export async function resolveAgentById(
	agentId,
	{
		origin = typeof location !== 'undefined' ? location.origin : '',
		fetchFn = fetch,
		signal,
	} = {},
) {
	if (!agentId) throw new AgentResolveError('not_found', 'agentId required');

	const boundFetch = fetchFn.bind(typeof globalThis !== 'undefined' ? globalThis : undefined);
	const endpoint = `${origin}/api/agents/${encodeURIComponent(agentId)}/manifest`;

	let res;
	try {
		// Public document: no cookies, so the wildcard CORS answer is usable
		// from any origin and shared caches can serve it.
		res = await boundFetch(endpoint, { credentials: 'omit', signal });
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		throw new AgentResolveError(
			'network',
			`network error fetching ${endpoint}: ${err.message || err}`,
		);
	}
	// 400 is the API's answer to an id that is not a uuid: no such agent.
	if (res.status === 404 || res.status === 400)
		throw new AgentResolveError('not_found', `agent ${agentId} not found`, {
			status: res.status,
		});
	if (!res.ok)
		throw new AgentResolveError('network', `request failed: ${endpoint} (${res.status})`, {
			status: res.status,
		});

	let doc;
	try {
		doc = await res.json();
	} catch (err) {
		throw new AgentResolveError('network', `invalid JSON from ${endpoint}: ${err.message || err}`);
	}

	const id = doc?.id || agentId;
	const bodyUri = doc?.body?.uri;
	if (!bodyUri) throw new AgentResolveError('no_avatar', `agent ${agentId} has no avatar bound`);

	const skills = Array.isArray(doc.skills)
		? doc.skills.map((s) => (typeof s === 'string' ? { name: s } : s)).filter(Boolean)
		: [];
	const registration = Array.isArray(doc.registrations) ? doc.registrations[0] : null;
	const chainId = registration?.agentRegistry
		? Number(String(registration.agentRegistry).split(':')[1]) || undefined
		: undefined;

	return {
		spec: 'agent-manifest/0.1',
		name: doc.name || 'Agent',
		description: doc.description || '',
		id: { agentId: id, ...(chainId ? { chainId } : {}) },
		body: { uri: bodyUri, format: 'gltf-binary' },
		brain: {},
		voice: {
			tts: ttsConfigFromManifestVoice(doc.voice, { origin, agentId: id }),
			stt: { provider: 'browser' },
		},
		skills,
		memory: { mode: 'local', namespace: id },
		tools: ['wave', 'lookAt', 'play_clip', 'setExpression', 'speak', 'remember'],
		...(doc.animationSlots ? { animationSlots: doc.animationSlots } : {}),
		...(Array.isArray(doc.choreographies) ? { choreographies: doc.choreographies } : {}),
		version: '0.1.0',
		_baseURI: `${origin}/agent/${id}/`,
		_source: 'agent-id',
	};
}

/**
 * Resolve an avatar UUID to a bare-body manifest via GET /api/avatars/:id.
 * Used by the `<agent-3d avatar-id="...">` attribute so embedders can hand off
 * a stable avatar identifier instead of a raw GLB URL.
 *
 * Always uses credentials: 'omit' — the public-visibility branch of the API
 * returns 200 without a session; private avatars 404 to anonymous callers, which
 * is the correct boundary for cross-origin embeds.
 *
 * @param {string} avatarId
 * @param {{ origin?: string, fetchFn?: typeof fetch, signal?: AbortSignal }} [opts]
 */
export async function resolveByAvatarId(
	avatarId,
	{
		origin = typeof location !== 'undefined' ? location.origin : '',
		fetchFn = fetch,
		signal,
	} = {},
) {
	if (!avatarId) throw new AgentResolveError('not_found', 'avatarId required');

	const boundFetch = fetchFn.bind(typeof globalThis !== 'undefined' ? globalThis : undefined);
	const endpoint = `${origin}/api/avatars/${encodeURIComponent(avatarId)}`;

	let res;
	try {
		res = await boundFetch(endpoint, { credentials: 'omit', signal });
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		throw new AgentResolveError(
			'network',
			`network error fetching ${endpoint}: ${err.message || err}`,
		);
	}

	if (res.status === 404)
		throw new AgentResolveError('not_found', `avatar ${avatarId} not found`, { status: 404 });
	if (!res.ok)
		throw new AgentResolveError('network', `request failed (${res.status})`, {
			status: res.status,
		});

	let data;
	try {
		data = await res.json();
	} catch (err) {
		throw new AgentResolveError('network', `invalid JSON from ${endpoint}`);
	}

	const avatar = data?.avatar;
	const modelUrl = avatar?.model_url || avatar?.url;
	if (!modelUrl)
		throw new AgentResolveError('no_url', `avatar ${avatarId} has no model url`);

	return {
		spec: 'agent-manifest/0.1',
		_baseURI: '',
		_source: 'avatar-id',
		name: avatar.name || 'Avatar',
		body: { uri: modelUrl, format: 'gltf-binary' },
		brain: { provider: 'none' },
		voice: { tts: { provider: 'browser' }, stt: { provider: 'browser' } },
		skills: [],
	};
}
