// Manifest loader — resolves agent://, ipfs://, https:// into a normalized manifest.
// See specs/AGENT_MANIFEST.md

import { JsonRpcProvider, Contract } from 'ethers';
import { IDENTITY_REGISTRY_ABI, REGISTRY_DEPLOYMENTS } from './erc8004/abi.js';
import { resolveURI, fetchWithFallback } from './ipfs.js';

const CHAIN_ALIASES = {
	base: 8453,
	'base-mainnet': 8453,
	'base-sepolia': 84532,
	ethereum: 1,
	mainnet: 1,
};

const DEFAULT_RPCS = {
	8453: 'https://mainnet.base.org',
	84532: 'https://sepolia.base.org',
	1: 'https://eth.llamarpc.com',
};

export async function loadManifest(source, { rpcURL, registry: registryOverride } = {}) {
	if (!source) throw new Error('loadManifest: source required');

	if (source.startsWith('agent://')) {
		return loadFromAgentURI(source, { rpcURL, registryOverride });
	}
	if (source.startsWith('ipfs://') || source.startsWith('ar://')) {
		const url = resolveURI(source);
		const json = await fetchManifestJSON(url);
		return normalize(json, { baseURI: trimToDir(url) });
	}
	if (source.startsWith('http')) {
		const json = await fetchManifestJSON(source);
		return normalize(json, { baseURI: trimToDir(source) });
	}
	throw new Error(`Unsupported manifest source: ${source}`);
}

async function loadFromAgentURI(uri, { rpcURL, registryOverride }) {
	// agent://{chain}/{agentId}
	const m = uri.match(/^agent:\/\/([^/]+)\/(\d+)$/);
	if (!m) throw new Error(`Malformed agent URI: ${uri}`);
	const [, chainName, agentIdStr] = m;
	const chainId = CHAIN_ALIASES[chainName.toLowerCase()] || Number(chainName);
	if (!chainId) throw new Error(`Unknown chain: ${chainName}`);

	const deployment = REGISTRY_DEPLOYMENTS[chainId];
	const registryAddr = registryOverride || deployment?.identityRegistry;
	if (!registryAddr) {
		throw new Error(`No registry deployed on chain ${chainId}. Pass registry= override.`);
	}

	const provider = new JsonRpcProvider(rpcURL || DEFAULT_RPCS[chainId]);
	const registry = new Contract(registryAddr, IDENTITY_REGISTRY_ABI, provider);
	const agentId = BigInt(agentIdStr);

	const tokenURI = await registry.tokenURI(agentId);
	if (!tokenURI) throw new Error(`Agent ${agentIdStr} on chain ${chainId} has no URI`);

	const resolved = resolveURI(tokenURI);
	const json = await fetchManifestJSON(resolved);
	const manifest = normalize(json, { baseURI: trimToDir(resolved) });

	// Ensure id is stamped on the manifest
	manifest.id = {
		...manifest.id,
		chain: chainName,
		chainId,
		registry: registryAddr,
		agentId: agentIdStr,
	};
	return manifest;
}

async function fetchManifestJSON(url) {
	// Prefer fetchWithFallback if this is an IPFS URI we can detect.
	let res;
	try {
		res = await fetch(url);
	} catch {
		res = await fetchWithFallback(url);
	}
	if (!res.ok) throw new Error(`Manifest fetch failed: ${url} (${res.status})`);
	return res.json();
}

// Convert either a full AGENT_MANIFEST or a bare ERC-8004 registration JSON
// into a uniform manifest object the runtime consumes.
export function normalize(json, { baseURI = '' } = {}) {
	// Full manifest — spec: "agent-manifest/0.1"
	if (json.spec && json.spec.startsWith('agent-manifest/')) {
		const m = { ...json, _baseURI: baseURI };
		m.body = m.body || {};
		if (!m.body.uri && m.image) m.body.uri = m.image;
		return m;
	}

	// ERC-8004 registration JSON — adapt to manifest shape
	if (json.type && json.type.includes('eip-8004')) {
		const registration = json.registrations?.[0] || {};
		return {
			spec: 'agent-manifest/0.1',
			_baseURI: baseURI,
			_source: 'erc8004-registration',
			id: { agentId: registration.agentId?.toString() },
			name: json.name,
			description: json.description,
			image: json.image,
			body: { uri: json.image, format: 'gltf-binary' },
			brain: { provider: 'none' },
			voice: { tts: { provider: 'browser' }, stt: { provider: 'browser' } },
			skills: [],
			memory: { mode: 'local' },
			tools: ['wave', 'lookAt', 'play_clip', 'setExpression'],
			version: '0.1.0',
		};
	}

	// Unknown / partial — best effort
	return {
		spec: 'agent-manifest/0.1',
		_baseURI: baseURI,
		name: json.name || 'Unnamed agent',
		description: json.description || '',
		body: {
			uri: json.body?.uri || json.image || json.model || '',
			format: json.body?.format || 'gltf-binary',
		},
		brain: json.brain || { provider: 'none' },
		voice: json.voice || { tts: { provider: 'browser' }, stt: { provider: 'browser' } },
		skills: json.skills || [],
		memory: json.memory || { mode: 'local' },
		tools: json.tools || ['wave', 'lookAt', 'play_clip', 'setExpression'],
		version: json.version || '0.1.0',
	};
}

function trimToDir(url) {
	const i = url.lastIndexOf('/');
	return i >= 0 ? url.slice(0, i + 1) : url;
}

// Load instructions.md, SKILL.md and other relative files referenced by the manifest
export async function fetchRelative(manifest, relPath) {
	if (!manifest._baseURI) return null;
	try {
		const url = new URL(relPath, manifest._baseURI).href;
		const res = await fetch(url);
		if (!res.ok) return null;
		return res.text();
	} catch {
		return null;
	}
}
