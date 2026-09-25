// Inference provisioning: fund a new inference-only API key from an agent
// wallet in one confirmed move, and return the key exactly once.
//
// Two steps, shared by POST /api/me/inference/provision{,/preview}
// (api/inference/[action].js) and the provision_inference MCP tools
// (api/_mcpagent/inference-tools.js), so both surfaces are held to the same
// preview, confirm flag and one-key-per-top-up rule:
//
//   previewProvision()  the wallet top-up preview (source 'provision') plus the
//                       key it will mint. Nothing moves.
//   executeProvision()  settles that top-up through the self-facilitator, then
//                       mints an API key scoped to `inference` alone, binds it
//                       to the funding agent (inference_keys) and returns the
//                       secret once. A retry of a provision that already
//                       minted reports the key's prefix, never the secret.

import { sql } from './db.js';
import { mintApiKey } from './api-keys.js';
import { inferencePricing } from './inference-billing.js';
import { previewTopup, executeTopup, TopupError } from './inference-topup.js';
import { isUuid } from './validate.js';

export const INFERENCE_BASE_URL = 'https://three.ws/api/v1';
const MAX_KEY_NAME = 80;

/**
 * Preview funding a new inference key from an agent wallet.
 * @returns {Promise<object>} the top-up confirmation table plus `key`
 */
export async function previewProvision({ userId, agentId, amountUsdc }) {
	const id = String(agentId || '');
	if (!isUuid(id)) throw new TopupError(400, 'bad_request', 'agent_id is required: the agent whose wallet funds the key');
	const preview = await previewTopup({ userId, agentId: id, amountUsdc, source: 'provision' });
	return {
		...preview,
		key: { scope: 'inference', bound_agent_id: id, base_url: INFERENCE_BASE_URL, model: inferencePricing().model },
	};
}

function keyName(raw) {
	return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, MAX_KEY_NAME) : 'Inference key';
}

/**
 * Settle a provision preview and mint its key.
 * @returns {Promise<{ status: number, body: object }>} HTTP status and body:
 *   202 while Solana confirms, 200 on a replay (no secret), 201 with the key
 * @throws {TopupError} on a missing confirm flag, a stale preview, or a refused settlement
 */
export async function executeProvision({ userId, previewId, confirmDeposit, name = null, req = null }) {
	const topup = await executeTopup({ userId, previewId, confirmDeposit, sources: ['provision'] });
	if (topup.status === 'pending') return { status: 202, body: topup };
	if (topup.status !== 'settled') {
		throw new TopupError(502, 'topup_failed', 'The top-up did not settle, so no key was minted.', topup);
	}

	if (topup.api_key_id) {
		const [k] = await sql`SELECT id, prefix, scope FROM api_keys WHERE id = ${topup.api_key_id}`;
		return {
			status: 200,
			body: {
				...topup,
				key: { id: k?.id, prefix: k?.prefix, scope: k?.scope, token: null, base_url: INFERENCE_BASE_URL },
				note: 'This top-up already minted its key; the secret is only shown once. Revoke it at /dashboard/api and provision again if it was lost.',
			},
		};
	}

	const minted = await mintApiKey({ userId, name: keyName(name), scopes: ['inference'], req, via: 'inference_provision' });
	const [claimed] = await sql`
		UPDATE inference_topups SET api_key_id = ${minted.row.id}
		WHERE id = ${topup.topup_id} AND api_key_id IS NULL
		RETURNING id
	`;
	if (!claimed) {
		await sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${minted.row.id}`;
		throw new TopupError(409, 'already_provisioned', 'A concurrent request already minted the key for this top-up.');
	}
	await sql`
		INSERT INTO inference_keys (api_key_id, user_id, agent_id, topup_id)
		VALUES (${minted.row.id}, ${userId}, ${topup.agent_id}, ${topup.topup_id})
	`;
	return {
		status: 201,
		body: {
			...topup,
			api_key_id: minted.row.id,
			key: {
				id: minted.row.id,
				prefix: minted.row.prefix,
				scope: minted.row.scope,
				token: minted.secret,
				base_url: INFERENCE_BASE_URL,
				model: inferencePricing().model,
			},
		},
	};
}
