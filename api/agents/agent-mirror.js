// /api/agents/:id/mirror — the custodial copy-trade (mirror) social graph.
//
// Owner-only to configure (create/edit/pause/kill/sync); public to read a
// leader's follower count + honest track record. Every mirrored trade executes
// through the task-05 engine inside the follower's spend policy — this surface
// only manages the follow edges and triggers the fanout; it never bypasses a
// guard. See api/_lib/agent-mirror.js for the guarded executor.
//
//   GET    /api/agents/:id/mirror                following list + recent fills + counts (owner)
//   POST   /api/agents/:id/mirror                create / update a follow (owner)
//   POST   /api/agents/:id/mirror/unfollow       remove a follow edge (owner)
//   POST   /api/agents/:id/mirror/kill           toggle the agent-wide mirror kill switch (owner)
//   POST   /api/agents/:id/mirror/sync           process pending leader trades now (owner)
//   GET    /api/agents/:id/mirror/followers      who mirrors this agent (public)
//   GET    /api/agents/:id/mirror/track-record   this leader's real stats (public)
//   GET    /api/agents/:id/mirror/fills          recent mirror fills feed (owner)

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { assertBearerMaySpend } from '../_lib/spend-scope.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, error, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireCsrf } from '../_lib/csrf.js';
import { requireRealFundsAgreement } from '../_lib/real-funds-agreement.js';
import { isUuid } from '../_lib/validate.js';
import { logAudit } from '../_lib/audit.js';
import { normalizeFollowInput, SKIP_LABELS } from '../_lib/mirror-engine.js';
import { leaderTrackRecord } from '../_lib/mirror-stats.js';
import { syncFollow } from '../_lib/agent-mirror.js';

const NETWORKS = new Set(['mainnet', 'devnet']);
const netOf = (v) => (NETWORKS.has(v) ? v : 'mainnet');

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = assertBearerMaySpend(await authenticateBearer(extractBearer(req)), req);
	if (bearer) return { userId: bearer.userId };
	return null;
}

// Owner gate → returns { auth, row } or sends the response and returns null.
async function loadOwned(req, res, id) {
	const auth = await resolveAuth(req);
	if (!auth) { error(res, 401, 'unauthorized', 'sign in to manage mirroring'); return null; }
	const [row] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`;
	if (!row) { error(res, 404, 'not_found', 'agent not found'); return null; }
	if (row.user_id !== auth.userId) { error(res, 403, 'forbidden', 'only the owner can manage this agent’s mirroring'); return null; }
	return { auth, row };
}

// Hydrate follow rows with leader name/avatar for the management UI.
async function hydrateFollows(rows) {
	if (!rows.length) return [];
	const leaderIds = [...new Set(rows.map((r) => r.leader_agent_id))];
	const leaders = await sql`SELECT id, name, avatar_url, profile_image_url FROM agent_identities WHERE id = ANY(${leaderIds})`.catch(() => []);
	const byId = new Map(leaders.map((l) => [l.id, l]));
	return rows.map((r) => {
		const l = byId.get(r.leader_agent_id) || {};
		return {
			id: Number(r.id),
			leader_agent_id: r.leader_agent_id,
			leader_name: l.name || null,
			leader_avatar: l.avatar_url || l.profile_image_url || null,
			network: r.network,
			enabled: r.enabled,
			sizing_mode: r.sizing_mode,
			fixed_sol: r.fixed_sol,
			proportion_pct: r.proportion_pct,
			pct_balance: r.pct_balance,
			max_per_trade_sol: r.max_per_trade_sol,
			daily_budget_sol: r.daily_budget_sol,
			min_leader_sol: r.min_leader_sol,
			copy_sells: r.copy_sells,
			mint_allowlist: r.mint_allowlist || [],
			mint_denylist: r.mint_denylist || [],
			created_at: r.created_at,
			updated_at: r.updated_at,
		};
	});
}

// ── GET /mirror — owner management view ───────────────────────────────────────
async function handleList(req, res, id) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const owned = await loadOwned(req, res, id);
	if (!owned) return;

	const rl = await limits.walletRead(owned.auth.userId);
	if (!rl.success) return rateLimited(res, rl);

	const [follows, fills, followerCount] = await Promise.all([
		sql`SELECT * FROM agent_mirror_follows WHERE follower_agent_id = ${id} ORDER BY created_at DESC`.catch(() => []),
		sql`
			SELECT f.*, a.name AS leader_name, a.avatar_url AS leader_avatar
			FROM agent_mirror_fills f
			LEFT JOIN agent_identities a ON a.id = f.leader_agent_id
			WHERE f.follower_agent_id = ${id}
			ORDER BY f.created_at DESC LIMIT 30
		`.catch(() => []),
		sql`SELECT count(*)::int AS c, count(*) FILTER (WHERE enabled)::int AS active FROM agent_mirror_follows WHERE leader_agent_id = ${id}`.catch(() => [{ c: 0, active: 0 }]),
	]);

	return json(res, 200, {
		data: {
			is_owner: true,
			killed: owned.row.meta?.mirror_killed === true,
			following: await hydrateFollows(follows),
			following_count: follows.length,
			followers_count: Number(followerCount[0]?.c || 0),
			active_followers: Number(followerCount[0]?.active || 0),
			recent: fills.map(serializeFill),
		},
	});
}

function serializeFill(f) {
	return {
		id: Number(f.id),
		leader_agent_id: f.leader_agent_id,
		leader_name: f.leader_name || null,
		leader_avatar: f.leader_avatar || null,
		side: f.side,
		mint: f.mint,
		leader_sol: f.leader_sol,
		planned_sol: f.planned_sol,
		status: f.status,
		skip_reason: f.skip_reason,
		skip_label: f.skip_reason ? (SKIP_LABELS[f.skip_reason] || f.skip_reason) : null,
		signature: f.signature,
		usd: f.usd,
		price_impact_pct: f.price_impact_pct,
		at: f.created_at,
	};
}

// ── POST /mirror — create / update a follow edge ──────────────────────────────
async function handleUpsert(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const owned = await loadOwned(req, res, id);
	if (!owned) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try { body = await readJson(req); }
	catch (e) { return error(res, 400, 'bad_request', e?.message || 'invalid body'); }

	const leaderId = typeof body.leader_agent_id === 'string' ? body.leader_agent_id.trim() : '';
	if (!isUuid(leaderId)) return error(res, 400, 'validation_error', 'leader_agent_id must be a UUID');
	if (leaderId === id) return error(res, 400, 'cannot_follow_self', 'an agent cannot mirror itself');

	const network = netOf(body.network);
	const enabled = body.enabled === false ? false : true;

	// An enabled follow trades the follower's custodial wallet autonomously, so it
	// needs signed real-funds agreements. Saving a paused follow does not. Checked
	// before CSRF so a refusal does not burn the owner's single-use token.
	if (enabled && !(await requireRealFundsAgreement(req, res, { userId: owned.auth.userId, network, context: 'mirror' }))) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;

	// The leader must exist and be public (you can only copy a transparent agent).
	const [leader] = await sql`SELECT id, name, is_public FROM agent_identities WHERE id = ${leaderId} AND deleted_at IS NULL`;
	if (!leader) return error(res, 404, 'leader_not_found', 'that leader agent does not exist');
	if (leader.is_public === false) return error(res, 403, 'leader_private', 'that agent is private and cannot be mirrored');

	// Block a circular follow (A→B and B→A would feed each other forever).
	const [reverse] = await sql`SELECT 1 FROM agent_mirror_follows WHERE follower_agent_id = ${leaderId} AND leader_agent_id = ${id} LIMIT 1`;
	if (reverse) return error(res, 409, 'circular_follow', 'that agent already mirrors this one — circular mirroring is not allowed');

	const norm = normalizeFollowInput(body);
	if (!norm.ok) return error(res, 400, 'validation_error', norm.error);
	const v = norm.value;

	// Cursor starts at the leader's latest trade so a new follow mirrors only
	// trades made AFTER the follow began — never backfills history.
	const [latest] = await sql`
		SELECT COALESCE(MAX(id), 0) AS id FROM agent_custody_events
		WHERE agent_id = ${leaderId} AND network = ${network} AND category = 'trade'
	`.catch(() => [{ id: 0 }]);

	const [row] = await sql`
		INSERT INTO agent_mirror_follows (
			follower_agent_id, leader_agent_id, owner_user_id, network, enabled,
			sizing_mode, fixed_sol, proportion_pct, pct_balance,
			max_per_trade_sol, daily_budget_sol, min_leader_sol, copy_sells,
			mint_allowlist, mint_denylist, last_leader_event_id
		) VALUES (
			${id}, ${leaderId}, ${owned.auth.userId}, ${network}, ${enabled},
			${v.sizing_mode}, ${v.fixed_sol}, ${v.proportion_pct}, ${v.pct_balance},
			${v.max_per_trade_sol}, ${v.daily_budget_sol}, ${v.min_leader_sol}, ${v.copy_sells},
			${v.mint_allowlist}, ${v.mint_denylist}, ${Number(latest?.id || 0)}
		)
		ON CONFLICT (follower_agent_id, leader_agent_id) DO UPDATE SET
			enabled = ${enabled}, network = ${network},
			sizing_mode = ${v.sizing_mode}, fixed_sol = ${v.fixed_sol},
			proportion_pct = ${v.proportion_pct}, pct_balance = ${v.pct_balance},
			max_per_trade_sol = ${v.max_per_trade_sol}, daily_budget_sol = ${v.daily_budget_sol},
			min_leader_sol = ${v.min_leader_sol}, copy_sells = ${v.copy_sells},
			mint_allowlist = ${v.mint_allowlist}, mint_denylist = ${v.mint_denylist},
			updated_at = now()
		RETURNING *
	`;

	logAudit({ userId: owned.auth.userId, action: 'mirror.follow', resourceId: id, meta: { leader_agent_id: leaderId, sizing_mode: v.sizing_mode, enabled }, req });
	const [hydrated] = await hydrateFollows([row]);
	return json(res, 200, { data: { follow: hydrated } });
}

// ── POST /mirror/unfollow ─────────────────────────────────────────────────────
async function handleUnfollow(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const owned = await loadOwned(req, res, id);
	if (!owned) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;

	let body;
	try { body = await readJson(req); } catch { body = {}; }
	const leaderId = typeof body.leader_agent_id === 'string' ? body.leader_agent_id.trim() : '';
	if (!isUuid(leaderId)) return error(res, 400, 'validation_error', 'leader_agent_id must be a UUID');

	const del = await sql`DELETE FROM agent_mirror_follows WHERE follower_agent_id = ${id} AND leader_agent_id = ${leaderId} RETURNING id`;
	logAudit({ userId: owned.auth.userId, action: 'mirror.unfollow', resourceId: id, meta: { leader_agent_id: leaderId }, req });
	return json(res, 200, { data: { removed: del.length > 0 } });
}

// ── POST /mirror/kill — agent-wide kill switch ────────────────────────────────
async function handleKill(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const owned = await loadOwned(req, res, id);
	if (!owned) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;

	let body;
	try { body = await readJson(req); } catch { body = {}; }
	const killed = body.killed === true;

	const meta = { ...(owned.row.meta || {}), mirror_killed: killed };
	await sql`UPDATE agent_identities SET meta = ${JSON.stringify(meta)}::jsonb WHERE id = ${id}`;
	logAudit({ userId: owned.auth.userId, action: killed ? 'mirror.kill_on' : 'mirror.kill_off', resourceId: id, meta: {}, req });
	return json(res, 200, { data: { killed } });
}

// ── POST /mirror/sync — process pending leader trades now ─────────────────────
async function handleSync(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const owned = await loadOwned(req, res, id);
	if (!owned) return;

	const follows = await sql`SELECT * FROM agent_mirror_follows WHERE follower_agent_id = ${id} AND enabled = true`;
	// Syncing executes mirrored trades from the custodial wallet. Devnet-only
	// follows are exempt; checked before CSRF so a refusal keeps the token.
	const syncNetwork = follows.some((f) => f.network !== 'devnet') ? 'mainnet' : 'devnet';
	if (follows.length && !(await requireRealFundsAgreement(req, res, { userId: owned.auth.userId, network: syncNetwork, context: 'mirror' }))) return;
	if (!(await requireCsrf(req, res, owned.auth.userId))) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (owned.row.meta?.mirror_killed === true) {
		return error(res, 409, 'mirror_killed', 'mirroring is paused by the kill switch — turn it off to sync');
	}

	const out = [];
	for (const f of follows) {
		// Attach leader name for the custody label without an extra round trip later.
		const [leader] = await sql`SELECT name FROM agent_identities WHERE id = ${f.leader_agent_id}`.catch(() => []);
		f.leader_name = leader?.name || null;
		const r = await syncFollow(f, { maxEvents: 15 }).catch((e) => ({ processed: 0, results: [], error: (e?.message || 'error').slice(0, 120) }));
		out.push({ leader_agent_id: f.leader_agent_id, ...r });
	}
	return json(res, 200, { data: { synced: out } });
}

// ── GET /mirror/followers — public ────────────────────────────────────────────
async function handleFollowers(req, res, id) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const rows = await sql`
		SELECT f.follower_agent_id, f.enabled, f.created_at, a.name, a.avatar_url, a.profile_image_url
		FROM agent_mirror_follows f
		JOIN agent_identities a ON a.id = f.follower_agent_id AND a.deleted_at IS NULL
		WHERE f.leader_agent_id = ${id}
		ORDER BY f.created_at DESC LIMIT 60
	`.catch(() => []);
	return json(res, 200, {
		data: {
			count: rows.length,
			active: rows.filter((r) => r.enabled).length,
			followers: rows.map((r) => ({
				agent_id: r.follower_agent_id,
				name: r.name,
				avatar: r.avatar_url || r.profile_image_url || null,
				enabled: r.enabled,
				since: r.created_at,
			})),
		},
	});
}

// ── GET /mirror/track-record — public, real stats ─────────────────────────────
async function handleTrackRecord(req, res, id) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const network = netOf(new URL(req.url, 'http://x').searchParams.get('network'));
	const [agent] = await sql`SELECT name, avatar_url, profile_image_url FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL`.catch(() => []);
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	const record = await leaderTrackRecord(id, network);
	return json(res, 200, { data: { agent: { id, name: agent.name, avatar: agent.avatar_url || agent.profile_image_url || null }, record } });
}

// ── GET /mirror/fills — owner feed (paginated) ────────────────────────────────
async function handleFills(req, res, id) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const owned = await loadOwned(req, res, id);
	if (!owned) return;

	const url = new URL(req.url, 'http://x');
	const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '40', 10) || 40));
	const beforeId = parseInt(url.searchParams.get('before') || '0', 10) || null;

	const rows = await sql`
		SELECT f.*, a.name AS leader_name, a.avatar_url AS leader_avatar
		FROM agent_mirror_fills f
		LEFT JOIN agent_identities a ON a.id = f.leader_agent_id
		WHERE f.follower_agent_id = ${id}
		  ${beforeId ? sql`AND f.id < ${beforeId}` : sql``}
		ORDER BY f.id DESC LIMIT ${limit}
	`.catch(() => []);
	return json(res, 200, { data: { items: rows.map(serializeFill), next: rows.length === limit ? Number(rows[rows.length - 1].id) : null } });
}

export default async function handler(req, res, id, action) {
	if (!isUuid(id)) { if (cors(req, res)) return; return error(res, 404, 'not_found', 'agent not found'); }
	switch (action) {
		case undefined:
		case '':
			return req.method === 'POST' ? handleUpsert(req, res, id) : handleList(req, res, id);
		case 'unfollow': return handleUnfollow(req, res, id);
		case 'kill': return handleKill(req, res, id);
		case 'sync': return handleSync(req, res, id);
		case 'followers': return handleFollowers(req, res, id);
		case 'track-record': return handleTrackRecord(req, res, id);
		case 'fills': return handleFills(req, res, id);
		default:
			if (cors(req, res)) return;
			return error(res, 404, 'not_found', 'unknown mirror action');
	}
}
