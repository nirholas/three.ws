// /api/teams/:id and its sub-resources.
//
// GET    /api/teams/:id                         team, members (3D bodies, wallets, pages), policy
// PATCH  /api/teams/:id                         { name?, description?, is_public?, status?, policy? }
// DELETE /api/teams/:id                         archive (the agents stay with the owner)
// GET    /api/teams/:id/findings                the board: ?kind=&subject=&before=&limit=
// GET    /api/teams/:id/findings/stream         SSE: every new finding as it is written
// POST   /api/teams/:id/run                     { action, member_id?, role?, input }
// POST   /api/teams/:id/repair                  provision any missing role agent
// POST   /api/teams/:id/members                 { agent_id, permissions? } add a custom specialist
// PATCH  /api/teams/:id/members/:memberId       { permissions } narrow or restore a grant
// DELETE /api/teams/:id/members/:memberId       remove a custom specialist
//
// Routed here by the /api/teams/... rows in vercel.json; the server keeps the
// original pathname on req.url, so the handler splits sub-resources itself.
//
// Reads: the owner sees everything; a public team's view and board are open to
// anyone. Writes need the owner, a CSRF token for cookie sessions and the team
// budgets. The one action that can sign is a live Trader run: it also needs the
// real-funds agreement, the wallet:write scope for a bearer, and confirm: true.

import { cors, method, json, error, wrap, readJson, rateLimited } from '../_lib/http.js';
import { parseLimit } from '../_lib/http-params.js';
import { resolveAccount } from '../_lib/account-auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { requireRealFundsAgreement } from '../_lib/real-funds-agreement.js';
import { assertBearerMaySpend } from '../_lib/spend-scope.js';
import { limits } from '../_lib/rate-limit.js';
import { TeamError } from '../_lib/teams/roles.js';
import { KINDS, findingsSince } from '../_lib/teams/findings.js';
import {
	loadTeamFor, getTeamView, updateTeam, archiveTeam, provisionMissingRoles, runAction,
	addCustomMember, setMemberPermissions, removeCustomMember, listFindings,
} from '../_lib/teams/runtime.js';

const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const HEARTBEAT_MS = 15_000;
const POLL_MS = 2_000;
const MAX_DURATION_MS = 280_000; // end before the request timeout; EventSource reconnects

function teamError(res, e) {
	if (e instanceof TeamError) return error(res, e.status, e.code, e.message, e.detail ? { detail: e.detail } : {});
	throw e;
}

export default wrap(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean); // ['api','teams',':id', sub?, subId?]
	const id = parts[2];
	const sub = parts[3] || null;
	const subId = parts[4] || null;

	if (cors(req, res, { methods: 'GET,POST,PATCH,DELETE,OPTIONS', credentials: true })) return;
	const isHead = req.method === 'HEAD';
	if (!method(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
	if (!isUuid(id)) return error(res, 404, 'not_found', 'team not found');

	try {
		if (sub === null) return await teamRoot(req, res, id);
		if (sub === 'findings' && subId === null) return await findings(req, res, id, url);
		if (sub === 'findings' && subId === 'stream' && parts.length === 5) return await stream(req, res, id, url, { headOnly: isHead });
		if (sub === 'run' && subId === null) return await run(req, res, id);
		if (sub === 'repair' && subId === null) return await repair(req, res, id);
		if (sub === 'members') return await members(req, res, id, subId);
		return error(res, 404, 'not_found', 'not found');
	} catch (e) {
		return teamError(res, e);
	}
});

async function viewer(req, res) {
	return resolveAccount(req, res).catch(() => null);
}

/** Auth + ownership + CSRF + budget for every mutation. Returns null when answered. */
async function ownerWrite(req, res, id, { limiter = 'teamWrite', readBody = true } = {}) {
	const auth = await resolveAccount(req, res);
	if (!auth) { error(res, 401, 'unauthorized', 'sign in required'); return null; }
	const body = readBody ? await readJson(req) : {};
	const { team } = await loadTeamFor(id, auth.userId, { write: true });
	return { auth, body: body || {}, team, limiter };
}

async function gate(req, res, ctx) {
	if (!(await requireCsrf(req, res, ctx.auth.userId))) return false;
	const rl = await limits[ctx.limiter](ctx.auth.userId);
	if (!rl.success) { rateLimited(res, rl, 'too many team actions: slow down'); return false; }
	return true;
}

async function teamRoot(req, res, id) {
	if (req.method === 'GET') {
		const auth = await viewer(req, res);
		const { team, isOwner } = await loadTeamFor(id, auth?.userId || null);
		return json(res, 200, { data: await getTeamView(team, { isOwner }) }, { 'cache-control': 'no-store' });
	}
	if (req.method === 'POST') return error(res, 405, 'method_not_allowed', 'use PATCH to edit or DELETE to archive');

	const ctx = await ownerWrite(req, res, id, { readBody: req.method === 'PATCH' });
	if (!ctx || !(await gate(req, res, ctx))) return;
	if (req.method === 'DELETE') {
		await archiveTeam(ctx.team);
		return json(res, 200, { data: { id, status: 'archived' } });
	}
	await updateTeam(ctx.team, ctx.auth.userId, ctx.body, { req });
	const { team } = await loadTeamFor(id, ctx.auth.userId);
	return json(res, 200, { data: await getTeamView(team, { isOwner: true }) });
}

async function findings(req, res, id, url) {
	if (req.method !== 'GET') return error(res, 405, 'method_not_allowed', 'GET only');
	const auth = await viewer(req, res);
	const { team } = await loadTeamFor(id, auth?.userId || null);
	const kind = url.searchParams.get('kind');
	if (kind && !KINDS.includes(kind)) return error(res, 400, 'bad_kind', `kind must be one of ${KINDS.join(', ')}`);
	const before = url.searchParams.get('before');
	if (before && Number.isNaN(Date.parse(before))) return error(res, 400, 'bad_before', 'before must be an ISO timestamp');
	const limit = parseLimit(url.searchParams, { fallback: 50, max: 100 });
	const rows = await listFindings(team.id, {
		kind: kind || null,
		subject: url.searchParams.get('subject')?.slice(0, 120) || null,
		before: before || null,
		limit: limit + 1,
	});
	const hasMore = rows.length > limit;
	const data = hasMore ? rows.slice(0, limit) : rows;
	return json(res, 200, {
		data,
		next_before: hasMore ? new Date(data[data.length - 1].created_at).toISOString() : null,
	}, { 'cache-control': 'no-store' });
}

async function stream(req, res, id, url, { headOnly }) {
	if (req.method !== 'GET') return error(res, 405, 'method_not_allowed', 'GET only');
	const auth = await viewer(req, res);
	const { team } = await loadTeamFor(id, auth?.userId || null);

	res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache, no-transform');
	res.setHeader('X-Accel-Buffering', 'no');
	res.setHeader('Connection', 'keep-alive');
	// A HEAD probe gets the headers and nothing else, so it never pins a slot.
	if (headOnly) {
		res.statusCode = 200;
		return res.end();
	}

	const send = (event, data, eventId = null) => {
		try {
			res.write(`${eventId ? `id: ${eventId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		} catch { /* socket closed */ }
	};

	// Resume from the browser's Last-Event-ID on reconnect, else from ?since=,
	// else from now: the page loads history from /findings and streams the rest.
	const resumeFrom = req.headers['last-event-id'] || url.searchParams.get('since');
	let cursor = resumeFrom && !Number.isNaN(Date.parse(resumeFrom)) ? new Date(resumeFrom).toISOString() : new Date().toISOString();
	// created_at carries microseconds that a JS Date drops, so the cursor can
	// trail a row it already sent. Remember recent ids to never send one twice.
	const sent = new Set();
	let lastStatus = team.status;

	send('hello', { team_id: team.id, status: team.status, network: team.network, since: cursor });

	const poll = async () => {
		try {
			const rows = await findingsSince(team.id, cursor, 50);
			for (const f of rows) {
				const at = new Date(f.created_at).toISOString();
				if (at > cursor) cursor = at;
				if (sent.has(f.id)) continue;
				sent.add(f.id);
				send('finding', f, at);
			}
			if (sent.size > 500) for (const key of [...sent].slice(0, 250)) sent.delete(key);
			const { team: cur } = await loadTeamFor(id, auth?.userId || null);
			if (cur.status !== lastStatus) {
				lastStatus = cur.status;
				send('status', { status: cur.status });
			}
		} catch (e) {
			if (e instanceof TeamError) {
				// The team was archived or made private mid-stream: tell the client and stop.
				send('gone', { code: e.code });
				cleanup();
				try { res.end(); } catch { /* closed */ }
			}
		}
	};

	const pollTimer = setInterval(poll, POLL_MS);
	const heartbeat = setInterval(() => { try { res.write(':hb\n\n'); } catch { /* closed */ } }, HEARTBEAT_MS);
	const deadline = setTimeout(() => { cleanup(); try { res.end(); } catch { /* closed */ } }, MAX_DURATION_MS);
	function cleanup() { clearInterval(pollTimer); clearInterval(heartbeat); clearTimeout(deadline); }
	req.on('close', cleanup);
	res.on('close', cleanup);
	await poll();
}

async function run(req, res, id) {
	if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'POST only');
	const ctx = await ownerWrite(req, res, id, { limiter: 'teamRun' });
	if (!ctx) return;
	const { auth, body, team } = ctx;
	const input = body.input && typeof body.input === 'object' ? body.input : {};
	if (body.member_id != null && !isUuid(body.member_id)) return error(res, 400, 'bad_member', 'member_id must be a uuid');

	if (body.action === 'trade' && input.mode === 'live') {
		// The only signing path on a team. Same leash as /api/agents/:id/trade:
		// a bearer needs wallet:write, and mainnet needs the signed agreement.
		if (auth.source !== 'session') assertBearerMaySpend({ scope: auth.scope }, req);
		if (!(await requireRealFundsAgreement(req, res, { userId: auth.userId, network: team.network, context: 'team-trade' }))) return;
	}
	if (!(await gate(req, res, ctx))) return;

	const result = await runAction(team, {
		action: body.action,
		memberId: body.member_id || null,
		role: typeof body.role === 'string' ? body.role : null,
		input,
	}, { req, userId: auth.userId });
	return json(res, 200, { data: result });
}

async function repair(req, res, id) {
	if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'POST only');
	const ctx = await ownerWrite(req, res, id, { readBody: false });
	if (!ctx || !(await gate(req, res, ctx))) return;
	if (ctx.team.status === 'archived') return error(res, 409, 'archived', 'This team is archived.');
	const created = await provisionMissingRoles(ctx.team, ctx.auth.userId);
	const { team } = await loadTeamFor(id, ctx.auth.userId);
	return json(res, 200, { data: { created, team: await getTeamView(team, { isOwner: true }) } });
}

async function members(req, res, id, memberId) {
	if (memberId !== null && !isUuid(memberId)) return error(res, 404, 'not_found', 'member not found');
	if (memberId === null && req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'POST to add a member');
	if (memberId !== null && !['PATCH', 'DELETE'].includes(req.method)) return error(res, 405, 'method_not_allowed', 'PATCH or DELETE a member');

	const ctx = await ownerWrite(req, res, id, { readBody: req.method !== 'DELETE' });
	if (!ctx || !(await gate(req, res, ctx))) return;
	if (ctx.team.status === 'archived') return error(res, 409, 'archived', 'This team is archived.');

	if (memberId === null) {
		if (!isUuid(ctx.body.agent_id)) return error(res, 400, 'bad_agent', 'agent_id required');
		const added = await addCustomMember(ctx.team, ctx.auth.userId, { agentId: ctx.body.agent_id, permissions: ctx.body.permissions });
		return json(res, 201, { data: { member_id: added } });
	}
	if (req.method === 'PATCH') {
		const permissions = await setMemberPermissions(ctx.team, memberId, ctx.body.permissions);
		return json(res, 200, { data: { member_id: memberId, permissions } });
	}
	await removeCustomMember(ctx.team, memberId);
	return json(res, 200, { data: { member_id: memberId, status: 'removed' } });
}
