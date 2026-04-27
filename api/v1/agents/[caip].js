/**
 * GET /api/v1/agents/:caip
 *
 * Public, gateway-cached resolver for an ERC-8004 / 3D Agent Card v1 agent.
 * Consumers (badge web component, indexers, third-party sites) call this so
 * they don't have to do RPC + IPFS + sha256 verification themselves.
 *
 * The :caip parameter is a CAIP-style ref:
 *   eip155:<chainId>:<registryAddress>/<tokenId>
 *
 * URL-encode it: `eip155%3A8453%3A0x8004A169...%2F1`.
 *
 * Response (200):
 *   {
 *     ref:         "eip155:8453:0x...",
 *     chainId, agentId, registry, owner, tokenURI,
 *     card:        {...},        // the resolved agent card JSON
 *     verified: {
 *       modelSha256: true|false|null,   // null when card has no model.sha256
 *       cardSchema:  "registration-v1" | "3d-agent-card-v1" | "unknown"
 *     },
 *     fetchedAt:   "2026-04-27T12:00:00Z"
 *   }
 *
 * Errors: 400 invalid_caip, 404 not_found, 502 upstream, 429 rate_limited.
 */

import { wrap, cors, method, json, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { resolveOnChainAgent, resolveURI } from '../../_lib/onchain.js';

const CAIP_RE = /^eip155:(\d+):(0x[a-fA-F0-9]{40})\/(\d+)$/;
const CACHE_HEADERS = {
	// 5 min fresh, 1 h stale-while-revalidate at the edge.
	'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600',
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const raw = decodeURIComponent(req.query?.caip || '');
	const m = CAIP_RE.exec(raw);
	if (!m) {
		return error(res, 400, 'invalid_caip', 'expected eip155:<chainId>:<registry>/<tokenId>');
	}
	const chainId = Number(m[1]);
	const registry = m[2];
	const agentId = m[3];

	const result = await resolveOnChainAgent({ chainId, agentId, fetchManifest: true });

	if (result.error === 'unsupported_chain') {
		return error(res, 400, 'unsupported_chain', `chain ${chainId} not in registry table`);
	}
	if (result.error?.startsWith('chain_read')) {
		return error(res, 404, 'not_found', `agent ${agentId} not found on chain ${chainId}`);
	}
	if (result.registry?.toLowerCase() !== registry.toLowerCase()) {
		return error(
			res,
			400,
			'registry_mismatch',
			'CAIP registry differs from canonical deployment',
		);
	}

	const card = result.manifest || null;
	const verified = await verifyCard(card);

	return json(
		res,
		200,
		{
			ref: `eip155:${chainId}:${result.registry}/${agentId}`,
			chainId,
			agentId,
			registry: result.registry,
			owner: result.owner,
			tokenURI: result.tokenURI,
			card,
			verified,
			fetchedAt: new Date().toISOString(),
		},
		CACHE_HEADERS,
	);
});

async function verifyCard(card) {
	const out = { modelSha256: null, cardSchema: 'unknown' };
	if (!card || typeof card !== 'object') return out;

	const types = Array.isArray(card.type) ? card.type : card.type ? [card.type] : [];
	if (types.includes('https://3dagent.vercel.app/specs/3d-agent-card-v1')) {
		out.cardSchema = '3d-agent-card-v1';
	} else if (types.includes('https://eips.ethereum.org/EIPS/eip-8004#registration-v1')) {
		out.cardSchema = 'registration-v1';
	}

	const expected = card?.model?.sha256;
	const uri = card?.model?.uri;
	if (expected && uri) {
		try {
			const httpUrl = resolveURI(uri);
			const r = await fetch(httpUrl, { signal: AbortSignal.timeout(5000) });
			if (r.ok) {
				const buf = new Uint8Array(await r.arrayBuffer());
				const hash = await sha256Hex(buf);
				out.modelSha256 = hash.toLowerCase() === String(expected).toLowerCase();
			} else {
				out.modelSha256 = false;
			}
		} catch {
			out.modelSha256 = false;
		}
	}
	return out;
}

async function sha256Hex(bytes) {
	const buf = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
