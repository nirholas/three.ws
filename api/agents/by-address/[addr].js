// GET /api/agents/by-address/:addr?chainId=<n>
// Public, rate-limited 120/min per IP.
// DB-first, then chain fallback via ERC-721 enumerable reads.

import { JsonRpcProvider, Contract } from 'ethers';
import { sql } from '../../_lib/db.js';
import { cors, error, json, method, wrap } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { SERVER_CHAIN_META, resolveURI } from '../../_lib/onchain.js';

const ENUM_ABI = [
	'function balanceOf(address owner) external view returns (uint256)',
	'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
	'function tokenURI(uint256 tokenId) external view returns (string)',
];

// In-memory cache: cacheKey → { expires: ms, agents: [] }
const _cache = new Map();
const CACHE_TTL = 60_000;
const RPC_TIMEOUT = 3_000;

function cacheGet(key) {
	const entry = _cache.get(key);
	if (!entry) return null;
	if (Date.now() > entry.expires) {
		_cache.delete(key);
		return null;
	}
	return entry.agents;
}

function cacheSet(key, agents) {
	_cache.set(key, { expires: Date.now() + CACHE_TTL, agents });
}

function withTimeout(promise, ms) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
		Promise.resolve(promise).then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			},
		);
	});
}

async function queryChain(addr, chainId, meta) {
	let provider;
	try {
		provider = new JsonRpcProvider(meta.rpc, chainId, { staticNetwork: true });
	} catch {
		return [];
	}

	const registry = new Contract(meta.registry, ENUM_ABI, provider);
	let count;
	try {
		count = Number(await withTimeout(registry.balanceOf(addr), RPC_TIMEOUT));
	} catch {
		return [];
	}

	if (count === 0) return [];

	const agentIds = await Promise.all(
		Array.from({ length: count }, (_, i) =>
			withTimeout(registry.tokenOfOwnerByIndex(addr, BigInt(i)), RPC_TIMEOUT).catch(() => null),
		),
	);

	const results = [];
	for (const agentId of agentIds) {
		if (agentId == null) continue;
		let agentURI = null;
		try {
			agentURI = await withTimeout(registry.tokenURI(agentId), RPC_TIMEOUT);
		} catch {
			// best-effort — return the entry even without a URI
		}
		results.push({
			id: String(agentId),
			chainId,
			agentURI: agentURI || null,
			manifestUrl: agentURI ? resolveURI(agentURI) : null,
			onChain: true,
			source: 'chain',
		});
	}

	return results;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.agentByAddress(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const raw = ((req.query?.addr) || '').trim().toLowerCase();
	if (!/^0x[a-f0-9]{40}$/.test(raw)) {
		return error(res, 400, 'validation_error', 'invalid wallet address');
	}

	const url = new URL(req.url, 'http://x');
	const filterChainId = url.searchParams.get('chainId')
		? Number(url.searchParams.get('chainId'))
		: null;

	const cacheKey = `${raw}:${filterChainId ?? 'all'}`;
	const cached = cacheGet(cacheKey);
	if (cached) return json(res, 200, { agents: cached });

	// Step 2: DB-first — check agent_identities by wallet_address
	const rows = filterChainId
		? await sql`
			SELECT id, home_url, erc8004_agent_id, chain_id
			FROM agent_identities
			WHERE lower(wallet_address) = ${raw}
			  AND chain_id = ${filterChainId}
			  AND deleted_at IS NULL
			ORDER BY created_at ASC`
		: await sql`
			SELECT id, home_url, erc8004_agent_id, chain_id
			FROM agent_identities
			WHERE lower(wallet_address) = ${raw}
			  AND deleted_at IS NULL
			ORDER BY created_at ASC`;

	if (rows.length > 0) {
		const agents = rows.map((r) => ({
			id: r.id,
			chainId: r.chain_id,
			agentURI: null,
			manifestUrl: r.home_url || null,
			onChain: r.erc8004_agent_id != null,
			source: 'db',
		}));
		cacheSet(cacheKey, agents);
		return json(res, 200, { agents });
	}

	// Step 3: Chain fallback — enumerate ERC-721 tokens owned by addr
	const chains = filterChainId
		? SERVER_CHAIN_META[filterChainId]
			? [{ id: filterChainId, meta: SERVER_CHAIN_META[filterChainId] }]
			: []
		: Object.entries(SERVER_CHAIN_META).map(([id, meta]) => ({ id: Number(id), meta }));

	const settled = await Promise.allSettled(
		chains.map(({ id, meta }) => queryChain(raw, id, meta)),
	);

	const agents = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
	cacheSet(cacheKey, agents);
	return json(res, 200, { agents });
});
