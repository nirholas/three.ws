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
import { sql } from './_lib/db.js';
import { cors, json, method, readJson, wrap, error } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { generateAgentWallet, generateSolanaAgentWallet } from './_lib/agent-wallet.js';
import { z } from 'zod';

const animationEntrySchema = z.object({
	name: z.string().trim().min(1).max(60),
	url: z
		.string()
		.trim()
		.min(1)
		.max(2048)
		.refine(
			(u) => /^(https?|ipfs|ar):\/\//.test(u) || u.startsWith('/'),
			'url must be http, https, ipfs, ar, or a root-relative path',
		),
	loop: z.boolean().default(true),
	clipName: z.string().trim().max(120).optional(),
	source: z.enum(['mixamo', 'preset', 'custom']),
	addedAt: z.string().optional(),
});

const animationsSchema = z.array(animationEntrySchema).max(30);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'GET') return handleList(req, res);
	return handleCreate(req, res);
});

// ── List ───────────────────────────────────────────────────────────────────

async function handleList(req, res) {
	const url = new URL(req.url, 'http://x');
	const isMe = url.pathname.endsWith('/me');
	const auth = await resolveAuth(req);

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
	return json(res, 200, { agents: rows.map((row) => decorate(row)) });
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
			const wallet = await generateAgentWallet();
			const sol = await generateSolanaAgentWallet();
			await sql`
				INSERT INTO agent_identities (user_id, name, skills, wallet_address, meta)
				VALUES (
					${auth.userId},
					${'Agent'},
					${['greet', 'present-model', 'validate-model', 'remember', 'think']},
					${wallet.address},
					${JSON.stringify({
						encrypted_wallet_key: wallet.encrypted_key,
						solana_address: sol.address,
						encrypted_solana_secret: sol.encrypted_secret,
					})}::jsonb
				)
				ON CONFLICT (user_id) WHERE deleted_at IS NULL DO NOTHING
			`;
			// Re-select covers both: we inserted, or a concurrent request beat us.
			[agent] = await sql`
				SELECT * FROM agent_identities
				WHERE user_id = ${auth.userId} AND deleted_at IS NULL
				ORDER BY created_at ASC LIMIT 1
			`;
		}

		return json(res, 200, { agent: decorate(agent) });
	} catch (err) {
		// Any failure here (missing table, wallet generation error, missing env var)
		// should not brick the client — surface null and let the UI fall back to
		// local-only identity.
		const code = err?.code || '';
		const msg = String(err?.message || '');
		const missing = code === '42P01' || /relation.*does not exist/i.test(msg);
		const warning = missing ? 'agents_table_missing' : 'agent_init_failed';
		console.error(`[agents/me] ${warning}`, err);
		return json(res, 200, { agent: null, warning });
	}
}

// ── Create ────────────────────────────────────────────────────────────────

async function handleCreate(req, res) {
	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in or provide a bearer token');

	const body = await readJson(req);
	const name = String(body.name || 'Agent')
		.trim()
		.slice(0, 100);

	if (!name) return error(res, 400, 'validation_error', 'name is required');

	const wallet = await generateAgentWallet();
	const sol = await generateSolanaAgentWallet();
	const meta = {
		...(body.meta || {}),
		encrypted_wallet_key: wallet.encrypted_key,
		solana_address: sol.address,
		encrypted_solana_secret: sol.encrypted_secret,
	};

	const [agent] = await sql`
		INSERT INTO agent_identities (user_id, name, description, skills, wallet_address, meta)
		VALUES (
			${auth.userId},
			${name},
			${body.description ? String(body.description).slice(0, 500) : null},
			${body.skills || ['greet', 'present-model', 'validate-model', 'remember', 'think']},
			${wallet.address},
			${JSON.stringify(meta)}::jsonb
		)
		RETURNING *
	`;

	return json(res, 201, { agent: decorate(agent) });
}

// ── Get One ───────────────────────────────────────────────────────────────

export async function handleGetOne(req, res, id) {
	if (cors(req, res, { methods: 'GET,PUT,PATCH,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT', 'PATCH', 'DELETE'])) return;

	if (req.method === 'GET') {
		const rl = await limits.publicIp(clientIp(req));
		if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

		const auth = await resolveAuth(req);
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

	if (req.method === 'PATCH') {
		const auth = await resolveAuth(req);
		if (!auth) return error(res, 401, 'unauthorized', 'sign in required');
		return handlePatchEdits(req, res, id, auth);
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
	if (!existing) return error(res, 404, 'not_found', 'agent not found');
	if (existing.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const body = await readJson(req);
	const [updated] = await sql`
		UPDATE agent_identities SET
			name         = COALESCE(${body.name || null}, name),
			description  = COALESCE(${body.description || null}, description),
			avatar_id    = COALESCE(${body.avatar_id || null}, avatar_id),
			skills       = COALESCE(${body.skills || null}, skills),
			meta         = COALESCE(${body.meta ? JSON.stringify(body.meta) : null}::jsonb, meta),
			home_url     = COALESCE(${body.home_url || null}, home_url)
		WHERE id = ${id}
		RETURNING *
	`;
	return json(res, 200, { agent: decorate(updated) });
}

// ── Patch (partial update) ────────────────────────────────────────────────

async function handlePatchEdits(req, res, id, auth) {
	return handleUpdate(req, res, id, auth);
}

// ── Delete ────────────────────────────────────────────────────────────────

async function handleDelete(req, res, id, auth) {
	const [existing] = await sql`
		SELECT id, user_id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!existing) return error(res, 404, 'not_found', 'agent not found');
	if (existing.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	// Soft-delete the agent and purge dependent records in a single transaction.
	// agent_actions / agent_memories have ON DELETE CASCADE FKs but the soft-delete
	// leaves the row in place, so we delete dependents explicitly.
	await sql.transaction([
		sql`UPDATE agent_identities SET deleted_at = now() WHERE id = ${id}`,
		sql`DELETE FROM agent_actions  WHERE agent_id = ${id}`,
		sql`DELETE FROM agent_memories WHERE agent_id = ${id}`,
	]);
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
	if (!existing) return error(res, 404, 'not_found', 'agent not found');
	if (existing.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	if (req.method === 'DELETE') {
		await sql`
			UPDATE agent_identities
			SET wallet_address = null, chain_id = null, erc8004_agent_id = null
			WHERE id = ${id}
		`;
		return json(res, 200, { ok: true });
	}

	if (!method(req, res, ['POST'])) return;
	const body = await readJson(req);
	const address = String(body.wallet_address || '').trim();
	const chainId = Number(body.chain_id) || null;
	// Optional: post-mint, the client can patch in the minted ERC-8004 agent id.
	const erc8004 = body.erc8004_agent_id != null ? BigInt(body.erc8004_agent_id).toString() : null;
	if (!address) return error(res, 400, 'validation_error', 'wallet_address required');

	const [updated] = await sql`
		UPDATE agent_identities
		SET wallet_address   = ${address},
		    chain_id         = ${chainId},
		    erc8004_agent_id = COALESCE(${erc8004}::bigint, erc8004_agent_id)
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
	if (bearer) return { userId: bearer.userId, source: 'bearer' };
	return null;
}

function decorate(row, isOwner = true) {
	// Strip encrypted secrets from meta — never expose to the client.
	const meta = { ...(row.meta || {}) };
	delete meta.encrypted_wallet_key;
	delete meta.encrypted_solana_secret;

	const base = {
		id: row.id,
		name: row.name,
		description: row.description,
		avatar_id: row.avatar_id,
		home_url: row.home_url || `/agent/${row.id}`,
		skills: row.skills || [],
		meta,
		is_registered: Boolean(row.erc8004_agent_id),
		created_at: row.created_at,
	};
	if (isOwner) {
		base.wallet_address = row.wallet_address;
		base.chain_id = row.chain_id;
		base.user_id = row.user_id;
		base.erc8004_agent_id = row.erc8004_agent_id;
		base.erc8004_registry = row.erc8004_registry;
		base.registration_cid = row.registration_cid;
	}
	return base;
}
