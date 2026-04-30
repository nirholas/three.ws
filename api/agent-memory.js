/**
 * Agent Memory Sync
 * -----------------
 * Backend sync target for agent memories.
 * LocalStorage is the primary store — this is the durable backup.
 *
 * GET    /api/agent-memory?agentId=    — fetch agent's memories (owner only)
 * POST   /api/agent-memory             — store / upsert a memory entry
 * DELETE /api/agent-memory/:id         — forget a memory
 */

import { getSessionUser, authenticateBearer, extractBearer } from './_lib/auth.js';
import { sql } from './_lib/db.js';
import { cors, json, method, readJson, wrap, error } from './_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;

	const url = new URL(req.url, 'http://x');
	const pathId = url.pathname.split('/').pop(); // /api/agent-memory/:id

	// DELETE /api/agent-memory/:id
	if (req.method === 'DELETE' && pathId && pathId !== 'agent-memory') {
		return handleDelete(req, res, pathId);
	}

	if (!method(req, res, ['GET', 'POST'])) return;
	if (req.method === 'GET') return handleList(req, res);
	return handleUpsert(req, res);
});

// ── List ──────────────────────────────────────────────────────────────────

async function handleList(req, res) {
	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agentId') || url.searchParams.get('agent_id');
	const type = url.searchParams.get('type');
	const since = Number(url.searchParams.get('since')) || 0;
	const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500);

	if (!agentId) return error(res, 400, 'validation_error', 'agentId required');

	// Verify ownership
	const [agentRow] = await sql`
		SELECT user_id FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!agentRow) return error(res, 404, 'not_found', 'agent not found');
	if (agentRow.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const rows = type
		? await sql`
			SELECT * FROM agent_memories
			WHERE agent_id = ${agentId}
			  AND type = ${type}
			  AND (expires_at IS NULL OR expires_at > now())
			  AND created_at > ${new Date(since).toISOString()}
			ORDER BY salience DESC, created_at DESC
			LIMIT ${limit}
		`
		: await sql`
			SELECT * FROM agent_memories
			WHERE agent_id = ${agentId}
			  AND (expires_at IS NULL OR expires_at > now())
			  AND created_at > ${new Date(since).toISOString()}
			ORDER BY salience DESC, created_at DESC
			LIMIT ${limit}
		`;

	return json(res, 200, { entries: rows.map(decorateMemory) });
}

// ── Upsert ────────────────────────────────────────────────────────────────

async function handleUpsert(req, res) {
	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const body = await readJson(req);
	const agentId = body.agentId || body.agent_id;
	const entry = body.entry;

	if (!agentId) return error(res, 400, 'validation_error', 'agentId required');
	if (!entry) return error(res, 400, 'validation_error', 'entry required');

	// Verify ownership
	const [agentRow] = await sql`
		SELECT user_id FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!agentRow) return error(res, 404, 'not_found', 'agent not found');
	if (agentRow.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const validTypes = ['user', 'feedback', 'project', 'reference'];
	const memType = validTypes.includes(entry.type) ? entry.type : 'project';

	// Upsert by id (idempotent — local storage may resync the same entry).
	// The WHERE clause on ON CONFLICT is critical: IDs come from the client,
	// so without it, user B could write an entry with user A's memory id and
	// the conflict would overwrite A's content. Constrain updates to rows
	// belonging to the same agent (ownership already verified above).
	const entryUpdatedAt = entry.updatedAt
		? new Date(entry.updatedAt).toISOString()
		: new Date().toISOString();

	const [row] = entry.id
		? await sql`
			INSERT INTO agent_memories (id, agent_id, type, content, tags, context, salience, created_at, expires_at, updated_at)
			VALUES (
				${entry.id},
				${agentId},
				${memType},
				${String(entry.content || '').slice(0, 10000)},
				${entry.tags || []},
				${JSON.stringify(entry.context || {})}::jsonb,
				${entry.salience || 0.5},
				${entry.createdAt ? new Date(entry.createdAt).toISOString() : new Date().toISOString()},
				${entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null},
				${entryUpdatedAt}
			)
			ON CONFLICT (id) DO UPDATE SET
				content    = EXCLUDED.content,
				salience   = EXCLUDED.salience,
				expires_at = EXCLUDED.expires_at,
				updated_at = EXCLUDED.updated_at
			WHERE agent_memories.agent_id = EXCLUDED.agent_id
			RETURNING *
		`
		: await sql`
			INSERT INTO agent_memories (agent_id, type, content, tags, context, salience, expires_at, updated_at)
			VALUES (
				${agentId},
				${memType},
				${String(entry.content || '').slice(0, 10000)},
				${entry.tags || []},
				${JSON.stringify(entry.context || {})}::jsonb,
				${entry.salience || 0.5},
				${entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null},
				${entryUpdatedAt}
			)
			RETURNING *
		`;

	// Empty row means an ID collision with a row owned by another agent was
	// suppressed by the ON CONFLICT WHERE guard. Report a conflict so the
	// client generates a new ID instead of silently losing the write.
	if (!row) return error(res, 409, 'id_conflict', 'memory id already in use');

	return json(res, 201, { entry: decorateMemory(row) });
}

// ── Delete ────────────────────────────────────────────────────────────────

async function handleDelete(req, res, memoryId) {
	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const [row] = await sql`
		SELECT m.id, a.user_id
		FROM agent_memories m
		JOIN agent_identities a ON a.id = m.agent_id
		WHERE m.id = ${memoryId}
	`;

	if (!row) return error(res, 404, 'not_found', 'memory not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your memory');

	await sql`DELETE FROM agent_memories WHERE id = ${memoryId}`;
	return json(res, 200, { ok: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

function decorateMemory(row) {
	const createdMs = row.created_at ? new Date(row.created_at).getTime() : Date.now();
	return {
		id: row.id,
		agent_id: row.agent_id,
		type: row.type,
		content: row.content,
		tags: row.tags || [],
		context: row.context || {},
		salience: row.salience,
		createdAt: createdMs,
		updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : createdMs,
		expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
	};
}
