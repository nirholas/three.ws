// GET  /api/world/gems            the caller's gem balance and recent digs
// POST /api/world/gems            complete a dig: { node, anonId? }
// ---------------------------------------------------------------------------
// The ledger behind gem mining in the three.ws world (the 3D entry to the web
// desktop). The server owns the roll and the cadence: a dig completes only if
// the miner's previous dig is at least MIN_DIG_INTERVAL_MS old and the daily
// cap is not reached, and the gem is drawn with crypto randomness from the
// shared table in api/_lib/world-gems.js. Miners are the session user or, for
// visitors, a stable anonymous browser id (the walk_metrics convention). A
// signed-in dig that carries the browser's anonId adopts that browser's
// anonymous gems onto the account, so nothing mined before signing in is lost.

import { randomInt } from 'node:crypto';
import { cors, error, json, method, readJson, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { getSessionUser, extractBearer, authenticateBearer } from '../_lib/auth.js';
import {
	DAILY_DIG_CAP,
	DIG_SECONDS,
	GEMS,
	MIN_DIG_INTERVAL_MS,
	digAllowed,
	rollGem,
	summarize,
	validAnonId,
	validNode,
} from '../_lib/world-gems.js';

export const maxDuration = 10;

async function resolveUserId(req) {
	const bearer = extractBearer(req);
	if (bearer) {
		const u = await authenticateBearer(bearer, { ip: clientIp(req) }).catch(() => null);
		if (u?.id) return u.id;
	}
	const u = await getSessionUser(req).catch(() => null);
	return u?.id || null;
}

function minerClause(userId, anonId) {
	return userId ? sql`user_id = ${userId}` : sql`anon_id = ${anonId}`;
}

async function balance(userId, anonId) {
	const where = minerClause(userId, anonId);
	const [rows, recent] = await Promise.all([
		sql`select gem, sum(amount)::int as amount from world_gems where ${where} group by gem`,
		sql`select gem, node, amount, mined_at from world_gems where ${where} order by mined_at desc limit 12`,
	]);
	return { ...summarize(rows), recent };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const ip = clientIp(req);
	const rl = await limits.publicIp(ip);
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://local');
	const userId = await resolveUserId(req);

	if (req.method === 'GET') {
		const anonId = url.searchParams.get('anonId');
		if (!userId && !validAnonId(anonId)) {
			return json(res, 200, { ok: true, miner: null, ...summarize([]), recent: [], table: GEMS, dig_seconds: DIG_SECONDS });
		}
		const b = await balance(userId, userId ? null : anonId);
		return json(res, 200, { ok: true, miner: userId ? 'account' : 'browser', ...b, table: GEMS, dig_seconds: DIG_SECONDS }, { 'cache-control': 'no-store' });
	}

	const body = (await readJson(req)) || {};
	if (!validNode(body.node)) return error(res, 400, 'invalid_node', 'node must name a mining vein in the world');
	const anonId = validAnonId(body.anonId) ? body.anonId : null;
	if (!userId && !anonId) return error(res, 400, 'no_miner', 'sign in or send a browser id to keep your gems');

	// Adopt the browser's anonymous gems onto the account on a signed-in dig.
	if (userId && anonId) {
		await sql`update world_gems set user_id = ${userId}, anon_id = null where anon_id = ${anonId} and user_id is null`;
	}

	const where = minerClause(userId, userId ? null : anonId);
	const [last] = await sql`select max(mined_at) as last_at, count(*) filter (where mined_at >= date_trunc('day', now())) ::int as today from world_gems where ${where}`;
	const lastMs = last?.last_at ? new Date(last.last_at).getTime() : null;
	if (!digAllowed(lastMs, Date.now())) {
		const wait = Math.ceil((MIN_DIG_INTERVAL_MS - (Date.now() - lastMs)) / 1000);
		return error(res, 429, 'dig_too_soon', `the vein needs ${wait}s more`, { retry_in_sec: wait });
	}
	if ((last?.today || 0) >= DAILY_DIG_CAP) {
		return error(res, 429, 'daily_cap', `you have mined ${DAILY_DIG_CAP} gems today; the veins refill at midnight UTC`);
	}

	const gem = rollGem(randomInt(0, 1_000_000) / 1_000_000);
	await sql`insert into world_gems (user_id, anon_id, node, gem, amount) values (${userId}, ${userId ? null : anonId}, ${body.node}, ${gem.id}, 1)`;
	const b = await balance(userId, userId ? null : anonId);
	return json(res, 200, { ok: true, miner: userId ? 'account' : 'browser', mined: { id: gem.id, label: gem.label, points: gem.points, hex: gem.hex, node: body.node }, ...b }, { 'cache-control': 'no-store' });
});
