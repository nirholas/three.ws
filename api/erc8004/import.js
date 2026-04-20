/**
 * POST /api/erc8004/import
 * Import an on-chain agent for the authenticated user.
 * Creates a local agent_identities row pointing at the on-chain record.
 * Idempotent: 409 if already imported for this user.
 */

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { resolveOnChainAgent, SERVER_CHAIN_META } from '../_lib/onchain.js';
import { z } from 'zod';

// agentId is a uint256 on-chain but we cap the decimal string length to 78
// (max digits for uint256) and require digits only so BigInt() can't throw.
const agentIdSchema = z
	.union([z.string(), z.number()])
	.transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
	.refine((v) => /^\d{1,78}$/.test(v), { message: 'agentId must be a non-negative integer' });

const bodySchema = z.object({
	chainId: z.number().int().positive().max(2_147_483_647),
	agentId: agentIdSchema,
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const chainMeta = SERVER_CHAIN_META[body.chainId];
	if (!chainMeta) {
		return error(res, 400, 'bad_request', `unsupported chain ${body.chainId}`);
	}

	const agentId = body.agentId;

	// Check if already imported by this user.
	const [existing] = await sql`
		SELECT id FROM agent_identities
		WHERE user_id = ${session.id}
		  AND erc8004_agent_id = ${BigInt(agentId)}
		  AND chain_id = ${body.chainId}
		  AND deleted_at IS NULL
	`;

	if (existing) {
		return error(res, 409, 'conflict', 'agent already imported for this user');
	}

	// Look up the index row.
	const [indexRow] = await sql`
		SELECT owner, agent_uri FROM erc8004_agents_index
		WHERE chain_id = ${body.chainId} AND agent_id = ${agentId}
	`;

	if (!indexRow) {
		return error(res, 404, 'not_found', 'agent not found in index');
	}

	// Verify owner matches one of user's wallets.
	const wallets = await sql`
		SELECT address FROM user_wallets WHERE user_id = ${session.id}
	`;

	const userWallets = wallets.map((w) => w.address.toLowerCase());
	if (!userWallets.includes(indexRow.owner.toLowerCase())) {
		return error(res, 403, 'forbidden', 'you do not own this agent');
	}

	// Resolve on-chain agent metadata.
	let resolved;
	try {
		resolved = await resolveOnChainAgent({
			chainId: body.chainId,
			agentId,
			fetchManifest: true,
			timeoutMs: 5000,
		});
	} catch (err) {
		return error(res, 500, 'internal', `failed to resolve agent: ${err.message}`);
	}

	if (resolved.error) {
		return error(res, 400, 'bad_request', `failed to resolve agent: ${resolved.error}`);
	}

	const name = (resolved.name || `Agent #${agentId}`).slice(0, 255);
	const description = (resolved.description || '').slice(0, 1000);

	// Insert agent_identities row.
	const [inserted] = await sql`
		INSERT INTO agent_identities (
			user_id, name, description, avatar_id,
			chain_id, erc8004_agent_id, erc8004_registry, registration_cid
		)
		VALUES (
			${session.id},
			${name},
			${description},
			null,
			${body.chainId},
			${BigInt(agentId)},
			${chainMeta.registry},
			null
		)
		RETURNING id
	`;

	return json(res, 201, {
		agent: {
			id: inserted.id,
			erc8004_agent_id: agentId,
			erc8004_agent_id_chain_id: body.chainId,
			name,
			avatar_url: resolved.image,
		},
	});
});
