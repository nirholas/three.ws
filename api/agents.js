/**
 * Agent Identity API
 * ------------------
 * GET  /api/agents           — list caller's agents
 * GET  /api/agents/me        — get or auto-create the caller's default agent
 * POST /api/agents           — create a new agent identity
 * GET  /api/agents/:id       — get one agent (public fields if not owner)
 * PUT  /api/agents/:id       — update agent (owner only)
 * DELETE /api/agents/:id     — soft-delete agent (owner only)
 * POST /api/agents/:id/wallet — link / update wallet
 * DELETE /api/agents/:id/wallet — unlink wallet
 */

import { getSessionUser, authenticateBearer, extractBearer } from './_lib/auth.js';
import { sql }           from './_lib/db.js';
import { cors, json, method, readJson, wrap, error } from './_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'GET') return handleList(req, res);
	return handleCreate(req, res);
});

// ── List ───────────────────────────────────────────────────────────────────

async function handleList(req, res) {
	const url    = new URL(req.url, 'http://x');
	const isMe   = url.pathname.endsWith('/me');
	const auth   = await resolveAuth(req);

	// /api/agents/me is the identity bootstrap endpoint — the client calls it
	// on every page load, including for anonymous visitors. Return null instead
	// of 401 so the client can cleanly fall back to a local-only identity
	// without a noisy console error on every unauthenticated page view.
	if (!auth) {
		if (isMe) return json(res, 200, { agent: null });
		return error(res, 401, 'unauthorized', 'sign in or provide a bearer token');
	}

	if (isMe) return handleGetOrCreateMe(req, res, auth);

	const rows = await sql`
		SELECT * FROM agent_identities
		WHERE user_id = ${auth.userId}
		  AND deleted_at IS NULL
		ORDER BY created_at ASC
	`;
	return json(res, 200, { agents: rows.map(decorate) });
}

// ── Get-or-create default agent ───────────────────────────────────────────

async function handleGetOrCreateMe(req, res, auth) {
	try {
		let [agent] = await sql`
			SELECT * FROM agent_identities
			WHERE user_id  = ${auth.userId}
			  AND deleted_at IS NULL
			ORDER BY created_at ASC
			LIMIT 1
		`;

		if (!agent) {
			[agent] = await sql`
				INSERT INTO agent_identities (user_id, name, skills)
				VALUES (${auth.userId}, ${'Agent'}, ${['greet', 'present-model', 'validate-model', 'remember', 'think']})
				RETURNING *
			`;
		}

		return json(res, 200, { agent: decorate(agent) });
	} catch (err) {
		// Missing table / bad migration shouldn't brick the client — surface a
		// null agent and let the UI fall back to local-only identity.
		const code = err?.code || '';
		const msg  = String(err?.message || '');
		const missing = code === '42P01' || /relation.*does not exist/i.test(msg);
		if (missing) {
			console.error('[agents/me] agent_identities table missing — run schema.sql', err);
			return json(res, 200, { agent: null, warning: 'agents_table_missing' });
		}
		throw err;
	}
}

// ── Create ────────────────────────────────────────────────────────────────

async function handleCreate(req, res) {
	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in or provide a bearer token');

	const body = await readJson(req);
	const name = String(body.name || 'Agent').trim().slice(0, 100);

	if (!name) return error(res, 400, 'validation_error', 'name is required');

	const [agent] = await sql`
		INSERT INTO agent_identities (user_id, name, description, skills, meta)
		VALUES (
			${auth.userId},
			${name},
			${body.description ? String(body.description).slice(0, 500) : null},
			${body.skills || ['greet', 'present-model', 'validate-model', 'remember', 'think']},
			${body.meta   || {}}
		)
		RETURNING *
	`;

	return json(res, 201, { agent: decorate(agent) });
}

// ── Get One ───────────────────────────────────────────────────────────────

export async function handleGetOne(req, res, id) {
	if (cors(req, res, { methods: 'GET,PUT,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT', 'DELETE'])) return;

	if (req.method === 'GET') {
		const auth  = await resolveAuth(req);
		const [row] = await sql`
			SELECT * FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL
		`;
		if (!row) return error(res, 404, 'not_found', 'agent not found');

		// Public fields if not owner; full record if owner
		const isOwner = auth?.userId === row.user_id;
		return json(res, 200, { agent: decorate(row, isOwner) });
	}

	if (req.method === 'PUT') {
		const auth = await resolveAuth(req);
		if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
		return handleUpdate(req, res, id, auth);
	}

	if (req.method === 'DELETE') {
		const auth = await resolveAuth(req);
		if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
		return handleDelete(req, res, id, auth);
	}
}

// ── Update ────────────────────────────────────────────────────────────────

async function handleUpdate(req, res, id, auth) {
	const [existing] = await sql`
		SELECT id, user_id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!existing)                  return error(res, 404, 'not_found',    'agent not found');
	if (existing.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const body = await readJson(req);
	const [updated] = await sql`
		UPDATE agent_identities SET
			name         = COALESCE(${body.name        || null}, name),
			description  = COALESCE(${body.description || null}, description),
			avatar_id    = COALESCE(${body.avatar_id   || null}, avatar_id),
			skills       = COALESCE(${body.skills      || null}, skills),
			meta         = COALESCE(${body.meta        ? sql.json(body.meta) : null}, meta),
			home_url     = COALESCE(${body.home_url    || null}, home_url)
		WHERE id = ${id}
		RETURNING *
	`;
	return json(res, 200, { agent: decorate(updated) });
}

// ── Delete ────────────────────────────────────────────────────────────────

async function handleDelete(req, res, id, auth) {
	const [existing] = await sql`
		SELECT id, user_id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!existing)                        return error(res, 404, 'not_found',    'agent not found');
	if (existing.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	await sql`UPDATE agent_identities SET deleted_at = now() WHERE id = ${id}`;
	return json(res, 200, { ok: true });
}

// ── Wallet ────────────────────────────────────────────────────────────────

export async function handleWallet(req, res, id) {
	if (cors(req, res, { methods: 'POST,DELETE,OPTIONS', credentials: true })) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const [existing] = await sql`
		SELECT id, user_id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!existing)                        return error(res, 404, 'not_found', 'agent not found');
	if (existing.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	if (req.method === 'DELETE') {
		await sql`UPDATE agent_identities SET wallet_address = null, chain_id = null WHERE id = ${id}`;
		return json(res, 200, { ok: true });
	}

	if (!method(req, res, ['POST'])) return;
	const body    = await readJson(req);
	const address = String(body.wallet_address || '').trim();
	const chainId = Number(body.chain_id)      || null;
	if (!address) return error(res, 400, 'validation_error', 'wallet_address required');

	const [updated] = await sql`
		UPDATE agent_identities
		SET wallet_address = ${address}, chain_id = ${chainId}
		WHERE id = ${id}
		RETURNING *
	`;
	return json(res, 200, { agent: decorate(updated) });
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, source: 'session' };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer)  return { userId: bearer.userId, source: 'bearer' };
	return null;
}

function decorate(row, isOwner = true) {
	const base = {
		id:           row.id,
		name:         row.name,
		description:  row.description,
		avatar_id:    row.avatar_id,
		home_url:     row.home_url || `/agent/${row.id}`,
		skills:       row.skills  || [],
		meta:         row.meta    || {},
		is_registered: Boolean(row.erc8004_agent_id),
		created_at:   row.created_at,
	};
	if (isOwner) {
		base.wallet_address = row.wallet_address;
		base.chain_id       = row.chain_id;
		base.user_id        = row.user_id;
		base.erc8004_agent_id  = row.erc8004_agent_id;
		base.erc8004_registry  = row.erc8004_registry;
		base.registration_cid  = row.registration_cid;
	}
	return base;
}
