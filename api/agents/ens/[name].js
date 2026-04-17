// GET /api/agents/ens/:name
// Resolves an ENS name → address, then looks up agents registered to that address.
// Public, rate-limited 60/min per IP. ENS → address cached 5 min in-memory.

import { ethers } from 'ethers';
import { sql } from '../../_lib/db.js';
import { cors, error, json, method, wrap } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';

// Validates "foo.eth", "sub.foo.eth", etc. — each label [a-z0-9-]+, must end with .eth
const ENS_RE = /^(?:[a-z0-9-]+\.)+eth$/;

// In-memory ENS → address cache. Entry: { address, expiresAt }
const ensCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(name) {
	const entry = ensCache.get(name);
	if (!entry) return null;
	if (Date.now() > entry.expiresAt) {
		ensCache.delete(name);
		return null;
	}
	return entry.address;
}

function setCached(name, address) {
	ensCache.set(name, { address, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function resolveEns(name) {
	const rpcUrl = env.MAINNET_RPC_URL;
	const provider = rpcUrl
		? new ethers.JsonRpcProvider(rpcUrl)
		: ethers.getDefaultProvider('mainnet');

	const timeout = new Promise((_, reject) =>
		setTimeout(() => reject(new Error('ens-timeout')), 3000),
	);
	return Promise.race([provider.resolveName(name), timeout]);
}

async function agentsByAddress(address) {
	// TODO: dedupe with /api/agents/by-address once that endpoint exists (prompt 19)
	const rows = await sql`
		SELECT id, name, description, avatar_id, home_url,
		       erc8004_agent_id, erc8004_registry, chain_id,
		       wallet_address, created_at
		FROM agent_identities
		WHERE lower(wallet_address) = ${address.toLowerCase()}
		  AND deleted_at IS NULL
		ORDER BY created_at ASC`;

	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		description: r.description,
		avatar_id: r.avatar_id,
		home_url: r.home_url || `/agent/${r.id}`,
		erc8004_agent_id: r.erc8004_agent_id != null ? String(r.erc8004_agent_id) : null,
		erc8004_registry: r.erc8004_registry,
		chain_id: r.chain_id,
		wallet_address: r.wallet_address,
		created_at: r.created_at,
	}));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.ensResolve(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const name = (req.query?.name || '').trim().toLowerCase();

	if (!name || !ENS_RE.test(name)) {
		return error(res, 400, 'validation_error', 'name must be a valid ENS label ending in .eth');
	}

	// Cache hit
	let address = getCached(name);

	if (!address) {
		let resolved;
		try {
			resolved = await resolveEns(name);
		} catch (err) {
			if (err.message === 'ens-timeout') {
				return error(res, 503, 'ens_timeout', 'ENS resolution timed out');
			}
			return error(res, 503, 'ens_error', 'ENS resolution failed');
		}

		if (!resolved) return error(res, 404, 'not_found', `${name} does not resolve to an address`);

		address = resolved.toLowerCase();
		setCached(name, address);
	}

	const agents = await agentsByAddress(address);

	return json(res, 200, { name, address, agents });
});
