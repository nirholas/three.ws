// Account-level inference billing routes.
//
//   GET  /api/me/usage                        credits, burn rate, days remaining at the
//                                             current rate, this month's model calls and
//                                             tokens, and the last top-ups with their
//                                             signatures. ?agent_id=<uuid> narrows it to one
//                                             agent and adds that agent's budget.
//   POST /api/me/inference/provision/preview  { agent_id, amount_usdc } → the confirmation
//                                             table for funding a new inference key from
//                                             that agent's wallet. Nothing moves.
//   POST /api/me/inference/provision          { preview_id, confirm_deposit: true, name? }
//                                             → settles the top-up, then mints an API key
//                                             scoped to `inference` alone, bound to the
//                                             agent, and returns it ONCE.
//
// vercel.json maps the /api/me/* paths here (?action=usage | provision-preview |
// provision). Reads accept a session or any Bearer key carrying `inference`,
// `wallet:read` or `profile`; provisioning moves funds, so a Bearer caller
// needs `wallet:write`.

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, error, json, method, readJson, wrap, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { mintApiKey } from '../_lib/api-keys.js';
import { inferenceUsage, inferencePricing } from '../_lib/inference-billing.js';
import { previewTopup, executeTopup, reconcilePendingTopups } from '../_lib/inference-topup.js';
import { isUuid } from '../_lib/validate.js';

const BASE_URL = 'https://three.ws/api/v1';

async function resolveCaller(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, scope: null };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId, scope: bearer.scope || '', apiKeyId: bearer.apiKeyId || null };
	return null;
}

function scopeOk(caller, ...scopes) {
	if (caller.scope === null) return true;
	return scopes.some((s) => hasScope(caller.scope, s));
}

function sendTyped(res, err) {
	if (err?.expose && err.status) return error(res, err.status, err.code, err.message, err.detail || {});
	throw err;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	const action = String(req.query?.action || '');

	const caller = await resolveCaller(req);
	if (!caller) return error(res, 401, 'unauthorized', 'sign in, or send a three.ws API key as a Bearer token (npx three-ws login)');

	if (action === 'usage') return handleUsage(req, res, caller);
	if (action === 'provision-preview' || action === 'provision') return handleProvision(req, res, caller, action);
	return error(res, 404, 'not_found', `unknown inference route: ${action || '(none)'}`);
});

async function handleUsage(req, res, caller) {
	if (!method(req, res, ['GET'])) return;
	if (!scopeOk(caller, 'inference', 'wallet:read', 'wallet:write', 'profile')) {
		return error(res, 403, 'insufficient_scope', 'reading usage needs the inference, wallet:read or profile scope');
	}
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const agentId = req.query?.agent_id ? String(req.query.agent_id) : null;
	let agent = null;
	if (agentId) {
		if (!isUuid(agentId)) return error(res, 400, 'bad_request', 'agent_id must be an agent id');
		const [row] = await sql`
			SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
		`;
		if (!row || String(row.user_id) !== String(caller.userId)) return error(res, 404, 'not_found', 'agent not found');
		agent = row;
	}
	await reconcilePendingTopups(caller.userId);
	const usage = await inferenceUsage({ userId: caller.userId, agent });
	return json(res, 200, { ...usage, base_url: BASE_URL });
}

async function handleProvision(req, res, caller, action) {
	if (!method(req, res, ['POST'])) return;
	if (!scopeOk(caller, 'wallet:write')) {
		return error(res, 403, 'insufficient_scope', 'funding an inference key from an agent wallet needs the wallet:write scope');
	}
	if (!(await requireCsrf(req, res, caller.userId))) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = (await readJson(req).catch(() => null)) || {};
	try {
		if (action === 'provision-preview') {
			const agentId = String(body.agent_id || '');
			if (!isUuid(agentId)) return error(res, 400, 'bad_request', 'agent_id is required: the agent whose wallet funds the key');
			const preview = await previewTopup({
				userId: caller.userId,
				agentId,
				amountUsdc: body.amount_usdc ?? body.amount,
				source: 'provision',
			});
			return json(res, 200, {
				...preview,
				key: { scope: 'inference', bound_agent_id: agentId, base_url: BASE_URL },
			});
		}

		const topup = await executeTopup({
			userId: caller.userId,
			previewId: body.preview_id,
			confirmDeposit: body.confirm_deposit,
			sources: ['provision'],
		});
		if (topup.status === 'pending') return json(res, 202, topup);
		if (topup.status !== 'settled') return error(res, 502, 'topup_failed', 'the top-up did not settle, so no key was minted', topup);

		// The key is minted once per settled top-up. A retry of a provision that
		// already minted reports the key's prefix; the secret was shown once.
		if (topup.api_key_id) {
			const [k] = await sql`SELECT id, prefix, scope FROM api_keys WHERE id = ${topup.api_key_id}`;
			return json(res, 200, {
				...topup,
				key: { id: k?.id, prefix: k?.prefix, scope: k?.scope, token: null, base_url: BASE_URL },
				note: 'This top-up already minted its key; the secret is only shown once. Revoke it at /dashboard/api and provision again if it was lost.',
			});
		}
		const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : 'Inference key';
		const minted = await mintApiKey({
			userId: caller.userId,
			name,
			scopes: ['inference'],
			req,
			via: 'inference_provision',
		});
		const [claimed] = await sql`
			UPDATE inference_topups SET api_key_id = ${minted.row.id}
			WHERE id = ${topup.topup_id} AND api_key_id IS NULL
			RETURNING id
		`;
		if (!claimed) {
			await sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${minted.row.id}`;
			return error(res, 409, 'already_provisioned', 'A concurrent request already minted the key for this top-up.');
		}
		await sql`
			INSERT INTO inference_keys (api_key_id, user_id, agent_id, topup_id)
			VALUES (${minted.row.id}, ${caller.userId}, ${topup.agent_id}, ${topup.topup_id})
		`;
		return json(res, 201, {
			...topup,
			api_key_id: minted.row.id,
			key: {
				id: minted.row.id,
				prefix: minted.row.prefix,
				scope: minted.row.scope,
				token: minted.secret,
				base_url: BASE_URL,
				model: inferencePricing().model,
			},
		});
	} catch (err) {
		return sendTyped(res, err);
	}
}
