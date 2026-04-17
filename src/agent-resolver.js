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

async function fetchJSON(url, { fetchFn }) {
	let res;
	try {
		res = await fetchFn(url, { credentials: 'include' });
	} catch (err) {
		throw new AgentResolveError('network', `network error fetching ${url}: ${err.message || err}`);
	}
	if (res.status === 401 || res.status === 403) {
		throw new AgentResolveError('unauthorized', `unauthorized fetching ${url} (${res.status})`, { status: res.status });
	}
	if (res.status === 404) {
		throw new AgentResolveError('not_found', `resource not found: ${url}`, { status: 404 });
	}
	if (!res.ok) {
		throw new AgentResolveError('network', `request failed: ${url} (${res.status})`, { status: res.status });
	}
	try {
		return await res.json();
	} catch (err) {
		throw new AgentResolveError('network', `invalid JSON from ${url}: ${err.message || err}`);
	}
}

const _resolveCache = new Map();
const _CACHE_MAX = 100;

/**
 * Resolve an agent ID to its manifest URL via GET /api/agents/:id.
 * Returns null if the agent record has no manifestUrl (caller may fall back to resolveAgentById).
 * Throws AgentResolveError('not-found') on 404.
 *
 * @param {string} agentId
 * @param {AbortSignal} [signal]
 * @returns {Promise<string|null>}
 */
export async function resolveByAgentId(agentId, signal) {
	if (!agentId) throw new AgentResolveError('not-found', 'agentId required');

	if (_resolveCache.has(agentId)) return _resolveCache.get(agentId);

	const origin = typeof location !== 'undefined' ? location.origin : '';
	const endpoint = `${origin}/api/agents/${encodeURIComponent(agentId)}`;

	let res;
	try {
		res = await fetch(endpoint, { credentials: 'include', signal });
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		throw new AgentResolveError('network', `network error fetching ${endpoint}: ${err.message || err}`);
	}

	if (res.status === 404)
		throw new AgentResolveError('not-found', `agent ${agentId} not found`, { status: 404 });
	if (res.status === 401 || res.status === 403)
		throw new AgentResolveError('unauthorized', `unauthorized (${res.status})`, { status: res.status });
	if (!res.ok)
		throw new AgentResolveError('network', `request failed (${res.status})`, { status: res.status });

	let data;
	try {
		data = await res.json();
	} catch (err) {
		throw new AgentResolveError('network', `invalid JSON from ${endpoint}`);
	}

	const raw = data?.agent?.manifestUrl ?? null;
	let resolved = null;
	if (raw) {
		try {
			resolved = new URL(raw, origin).href;
		} catch {
			resolved = raw;
		}
	}

	if (_resolveCache.size >= _CACHE_MAX) _resolveCache.delete(_resolveCache.keys().next().value);
	_resolveCache.set(agentId, resolved);

	return resolved;
}

export async function resolveAgentById(agentId, { origin = typeof location !== 'undefined' ? location.origin : '', fetchFn = fetch } = {}) {
	if (!agentId) throw new AgentResolveError('not_found', 'agentId required');

	const boundFetch = fetchFn.bind(typeof globalThis !== 'undefined' ? globalThis : undefined);

	const agentRes = await fetchJSON(`${origin}/api/agents/${encodeURIComponent(agentId)}`, { fetchFn: boundFetch });
	const agent = agentRes?.agent;
	if (!agent) throw new AgentResolveError('not_found', `agent ${agentId} not found`);

	if (!agent.avatar_id) {
		throw new AgentResolveError('no_avatar', `agent ${agentId} has no avatar bound`);
	}

	const avatarRes = await fetchJSON(`${origin}/api/avatars/${encodeURIComponent(agent.avatar_id)}`, { fetchFn: boundFetch });
	const avatar = avatarRes?.avatar;
	if (!avatar || !avatar.url) {
		throw new AgentResolveError('no_avatar', `avatar ${agent.avatar_id} has no url`);
	}

	const skills = Array.isArray(agent.skills)
		? agent.skills.map((s) => (typeof s === 'string' ? { name: s } : s)).filter(Boolean)
		: [];

	return {
		spec: 'agent-manifest/0.1',
		name: agent.name || 'Agent',
		description: agent.description || '',
		id: {
			agentId: agent.id,
			owner: agent.wallet_address,
			chainId: agent.chain_id,
			walletAddress: agent.wallet_address,
		},
		body: { uri: avatar.url, format: 'gltf-binary' },
		brain: {},
		voice: { tts: { provider: 'browser' }, stt: { provider: 'browser' } },
		skills,
		memory: { mode: 'remote', namespace: agent.id },
		tools: ['wave', 'lookAt', 'play_clip', 'setExpression', 'speak', 'remember'],
		version: '0.1.0',
		_baseURI: `${origin}/agent/${agent.id}/`,
		_source: 'agent-id',
	};
}
