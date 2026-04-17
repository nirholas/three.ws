/**
 * GET /api/agents/:id/actions?limit=100&cursor=<timestamp>
 * -------
 * Paginated signed action log for an agent. Verifies EIP-191 signatures.
 * Auth: caller must own the agent OR agent visibility must be 'public'.
 */

import { verifyMessage } from 'ethers';
import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, error, wrap } from '../../_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (req.method !== 'GET') return error(res, 405, 'method_not_allowed', 'GET only');

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2];
	if (!id) return error(res, 400, 'invalid_request', 'agent id required');

	// Auth: session or bearer
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	const userId = session?.id ?? bearer?.userId;

	// Check agent exists and access
	const [agent] = await sql`
		SELECT id, user_id, name, wallet_address
		FROM agent_identities
		WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	// Auth check: must be owner (agents don't have visibility field yet)
	if (!userId || agent.user_id !== userId) {
		return error(res, 403, 'forbidden', 'not authorized to view this agent');
	}

	const url = new URL(req.url, 'http://x');
	const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
	const cursor = url.searchParams.get('cursor'); // ISO timestamp cursor

	// Query actions ordered by timestamp DESC
	const actions = cursor
		? await sql`
			SELECT id, type, payload, source_skill, signature, signer_address, created_at
			FROM agent_actions
			WHERE agent_id = ${id} AND created_at < ${cursor}
			ORDER BY created_at DESC
			LIMIT ${limit + 1}
		`
		: await sql`
			SELECT id, type, payload, source_skill, signature, signer_address, created_at
			FROM agent_actions
			WHERE agent_id = ${id}
			ORDER BY created_at DESC
			LIMIT ${limit + 1}
		`;

	const hasMore = actions.length > limit;
	const trimmed = hasMore ? actions.slice(0, limit) : actions;
	const nextCursor = hasMore ? trimmed[trimmed.length - 1].created_at.toISOString() : null;

	// Verify signatures for each action
	const decorated = trimmed.map((row) => {
		let verified = null;
		if (row.signature && row.signer_address && row.payload) {
			try {
				const message = JSON.stringify(row.payload) + row.created_at.toISOString();
				const recovered = verifyMessage(message, row.signature);
				verified = recovered.toLowerCase() === row.signer_address.toLowerCase();
			} catch {
				verified = false;
			}
		}
		return {
			id: String(row.id),
			type: row.type,
			payload: row.payload,
			sourceSkill: row.source_skill,
			timestamp: row.created_at.toISOString(),
			signature: row.signature || null,
			signer: row.signer_address || null,
			verified,
		};
	});

	// Cache: private, 10 seconds
	res.setHeader('Cache-Control', 'private, max-age=10');

	return json(res, 200, {
		actions: decorated,
		nextCursor,
	});
});
