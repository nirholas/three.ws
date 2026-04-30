// Private module: agent sub-resource handlers dispatched from [id].js.
// Not a Vercel function (underscore prefix). Handlers accept (req, res, id).

import { verifyMessage } from 'ethers';
import { Wallet } from 'ethers';
import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { parse } from '../../_lib/validate.js';
import { recoverAgentKey } from '../../_lib/agent-wallet.js';
import { readEmbedPolicy, validateEmbedPolicy } from '../../_lib/embed-policy.js';
import { resolveAvatarUrl } from '../../_lib/avatars.js';

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

// ── actions ───────────────────────────────────────────────────────────────────

export const handleActions = wrap(async (req, res, id) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (req.method !== 'GET') return error(res, 405, 'method_not_allowed', 'GET only');

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	const userId = session?.id ?? bearer?.userId;

	const [agent] = await sql`SELECT id, user_id, name, wallet_address FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (!userId || agent.user_id !== userId) return error(res, 403, 'forbidden', 'not authorized to view this agent');

	const url = new URL(req.url, 'http://x');
	const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
	const cursor = url.searchParams.get('cursor');

	const actions = cursor
		? await sql`SELECT id, type, payload, source_skill, signature, signer_address, created_at FROM agent_actions WHERE agent_id = ${id} AND created_at < ${cursor} ORDER BY created_at DESC LIMIT ${limit + 1}`
		: await sql`SELECT id, type, payload, source_skill, signature, signer_address, created_at FROM agent_actions WHERE agent_id = ${id} ORDER BY created_at DESC LIMIT ${limit + 1}`;

	const hasMore = actions.length > limit;
	const trimmed = hasMore ? actions.slice(0, limit) : actions;

	const decorated = trimmed.map((row) => {
		let verified = null;
		if (row.signature && row.signer_address && row.payload) {
			try {
				const recovered = verifyMessage(JSON.stringify(row.payload) + row.created_at.toISOString(), row.signature);
				verified = recovered.toLowerCase() === row.signer_address.toLowerCase();
			} catch { verified = false; }
		}
		return { id: String(row.id), type: row.type, payload: row.payload, sourceSkill: row.source_skill, timestamp: row.created_at.toISOString(), signature: row.signature || null, signer: row.signer_address || null, verified };
	});

	res.setHeader('Cache-Control', 'private, max-age=10');
	return json(res, 200, { actions: decorated, nextCursor: hasMore ? trimmed[trimmed.length - 1].created_at.toISOString() : null });
});

// ── animations ────────────────────────────────────────────────────────────────

const animationEntrySchema = z.object({
	name: z.string().trim().min(1).max(60),
	url: z.string().trim().min(1).max(2048).refine((u) => /^(https?|ipfs|ar):\/\//.test(u) || u.startsWith('/') || /^u\//.test(u), 'url must be http, https, ipfs, ar, root-relative, or storage key'),
	loop: z.boolean().default(true),
	clipName: z.string().trim().max(120).optional(),
	source: z.enum(['mixamo', 'preset', 'custom']),
	addedAt: z.string().optional(),
});

const animationsBodySchema = z.object({ animations: z.array(animationEntrySchema).max(30) });

export const handleAnimations = wrap(async (req, res, id) => {
	if (cors(req, res, { methods: 'PUT,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['PUT'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const [existing] = await sql`SELECT id, user_id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!existing) return error(res, 404, 'not_found', 'agent not found');
	if (existing.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	let parsed;
	try { parsed = animationsBodySchema.parse(await readJson(req)); }
	catch (err) { if (err.name === 'ZodError') return error(res, 400, 'validation_error', err.errors[0]?.message || 'invalid body', { fields: err.errors }); throw err; }

	await sql`UPDATE agent_identities SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{animations}', ${JSON.stringify(parsed.animations)}::jsonb, true) WHERE id = ${id}`;
	return json(res, 200, { animations: parsed.animations });
});

// ── embed-policy ──────────────────────────────────────────────────────────────

export const handleEmbedPolicy = wrap(async (req, res, id) => {
	if (cors(req, res, { methods: 'GET,PUT,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT', 'DELETE'])) return;

	if (req.method === 'GET') {
		const policy = await readEmbedPolicy(id);
		if (policy === null) {
			const [row] = await sql`SELECT id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
			if (!row) return error(res, 404, 'not_found', 'agent not found');
		}
		return json(res, 200, { policy: policy ?? null });
	}

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const [existing] = await sql`SELECT id, user_id FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!existing) return error(res, 404, 'not_found', 'agent not found');
	if (existing.user_id !== session.id) return error(res, 403, 'forbidden', 'not your agent');

	if (req.method === 'DELETE') {
		await sql`UPDATE agent_identities SET embed_policy = NULL WHERE id = ${id}`;
		return json(res, 200, { policy: null });
	}

	let normalized;
	try { normalized = validateEmbedPolicy(await readJson(req)); }
	catch (err) { if (err.name === 'ZodError') return error(res, 400, 'validation_error', err.errors[0]?.message || 'invalid policy', { fields: err.errors }); throw err; }

	const [updated] = await sql`UPDATE agent_identities SET embed_policy = ${JSON.stringify(normalized)}::jsonb WHERE id = ${id} RETURNING embed_policy`;
	return json(res, 200, { policy: updated.embed_policy });
});

// ── manifest ──────────────────────────────────────────────────────────────────

export const handleManifest = wrap(async (req, res, id) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	if (!/^[0-9a-f-]{36}$/i.test(id)) return error(res, 400, 'invalid_request', 'agent id required');

	const [row] = await sql`select a.id, a.name, a.description, a.avatar_id, a.skills, a.meta, a.chain_id, a.erc8004_agent_id, a.erc8004_registry, a.registration_cid, a.created_at, av.id as avatar_db_id, av.storage_key, av.content_type from agent_identities a left join avatars av on av.id = a.avatar_id and av.deleted_at is null where a.id = ${id} and a.deleted_at is null limit 1`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');

	let bodyUri = '';
	if (row.avatar_db_id) {
		try { const urlInfo = await resolveAvatarUrl({ storage_key: row.storage_key, visibility: 'public' }); bodyUri = urlInfo?.url || ''; } catch {}
	}

	const proto = req.headers['x-forwarded-proto'] || 'https';
	const host = req.headers['x-forwarded-host'] || req.headers.host || 'three.ws';
	const origin = process.env.PUBLIC_APP_ORIGIN?.replace(/\/$/, '') || `${proto}://${host}`;

	const manifest = {
		$schema: 'https://3d-agent.io/schemas/manifest/0.1.json',
		spec: 'agent-manifest/0.1',
		id: row.id,
		name: row.name || 'Agent',
		description: row.description || '',
		image: '',
		tags: Array.isArray(row.meta?.tags) ? row.meta.tags : [],
		body: bodyUri ? { uri: bodyUri, format: row.content_type || 'gltf-binary' } : undefined,
		skills: Array.isArray(row.skills) ? row.skills : [],
		homeUrl: `${origin}/agent/${row.id}`,
		registrations: row.chain_id && row.erc8004_agent_id ? [{ agentRegistry: `eip155:${row.chain_id}:${row.erc8004_registry}`, agentId: row.erc8004_agent_id }] : [],
		createdAt: row.created_at,
	};

	return json(res, 200, manifest, { 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400', 'access-control-allow-origin': '*' });
});

// ── sign ──────────────────────────────────────────────────────────────────────

const signBody = z.object({ message: z.string().min(1).max(8192), kind: z.enum(['personal']).default('personal') });

export const handleSign = wrap(async (req, res, id) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many sign requests');

	const [row] = await sql`SELECT id, user_id, wallet_address, meta FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');
	if (row.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const encryptedKey = row.meta?.encrypted_wallet_key;
	if (!encryptedKey) return error(res, 409, 'no_wallet', 'agent has no server wallet');

	const body = parse(signBody, await readJson(req));

	let signature;
	try {
		const pkHex = await recoverAgentKey(encryptedKey);
		signature = await new Wallet(pkHex).signMessage(body.message);
	} catch (e) {
		console.error('[agents/sign] signing failed', e);
		return error(res, 500, 'sign_failed', 'could not sign message');
	}

	return json(res, 200, { address: row.wallet_address, signature });
});

// ── usage ─────────────────────────────────────────────────────────────────────

export const handleUsage = wrap(async (req, res, id) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const [agent] = await sql`SELECT id FROM agent_identities WHERE id = ${id} AND user_id = ${session.id} AND deleted_at IS NULL`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');

	const policy = await readEmbedPolicy(id);
	const monthlyQuota = policy?.brain?.monthly_quota ?? null;

	const [monthRow] = await sql`SELECT COUNT(*)::int AS total FROM usage_events WHERE agent_id = ${id} AND kind = 'llm' AND created_at >= date_trunc('month', now())`;
	const dailyRows = await sql`SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS calls FROM usage_events WHERE agent_id = ${id} AND kind = 'llm' AND created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 1`;

	return json(res, 200, { agentId: id, monthlyQuota, currentMonthCalls: monthRow?.total ?? 0, dailyBreakdown: dailyRows.map((r) => ({ day: r.day, calls: r.calls })) });
});
