// /api/play/ufo-runs: the Flappin UFO leaderboard.
//
//   GET  ?limit=1..50 (default 20) &ghost=1
//        The best run per player, ranked by score (earliest run wins a tie).
//        With ghost=1 the response also carries the replay of the top run, which
//        the game flies as a translucent ghost alongside the player.
//   POST { name, levels: [{ edges: [tick, ...] }, ...] }
//        Submit a finished run. The client sends only its input flips; the server
//        replays them through the shared simulation (src/play/ufo/sim.js) and
//        stores the score IT computed. A run that cannot happen (a level that does
//        not clear, input after the crash, flips closer than the minimum gap,
//        a replay that does not end in a crash) is rejected with 422.
//
// Signed-in submissions are tied to the account so the score also feeds the
// unified leaderboard (metric=ufo_score). Anonymous submissions rank by name.

import { createHash } from 'node:crypto';
import { cors, json, method, wrap, error, rateLimited, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { sql } from '../_lib/db.js';
import { getSessionUser, extractBearer, authenticateBearer } from '../_lib/auth.js';
import { verifyRun, MAX_LEVELS, MAX_EDGES_PER_LEVEL } from '../../src/play/ufo/sim.js';

export const maxDuration = 10;

const NAME_MAX = 20;
const BODY_LIMIT = 256 * 1024;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// One row per player: a signed-in account by id, an anonymous name by its
// case-folded text, so "Ace" and "ace" are one competitor.
const playerKey = () => sql`coalesce(r.user_id::text, 'n:' || lower(r.name))`;

export function cleanName(raw) {
	const name = String(raw ?? '')
		.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, NAME_MAX)
		.trim();
	if (!name) return null;
	if (/https?:|www\.|\.(com|io|gg|ws|xyz)\b/i.test(name)) return null;
	return name;
}

async function resolveViewer(req) {
	try {
		const bearer = extractBearer(req);
		const user = bearer ? await authenticateBearer(bearer) : await getSessionUser(req);
		const id = user?.userId || user?.id || user?.sub || null;
		return id ? { id, displayName: user?.display_name || user?.displayName || null } : null;
	} catch {
		return null;
	}
}

function shapeRow(r, rank) {
	return {
		rank,
		id: r.id,
		name: r.name,
		score: r.score,
		level: r.level,
		signedIn: !!r.user_id,
		createdAt: new Date(r.created_at).toISOString(),
	};
}

async function handleGet(req, res) {
	const url = new URL(req.url, 'http://x');
	const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT);
	const wantGhost = url.searchParams.get('ghost') === '1';

	const rows = await sql`
		select id, user_id, name, score, level, created_at from (
			select distinct on (${playerKey()}) r.id, r.user_id, r.name, r.score, r.level, r.created_at
			from ufo_runs r
			order by ${playerKey()}, r.score desc, r.created_at asc
		) best
		order by score desc, created_at asc
		limit ${limit}
	`;
	const body = { rows: rows.map((r, i) => shapeRow(r, i + 1)), ghost: null };

	if (wantGhost && rows.length) {
		const [top] = await sql`select recording from ufo_runs where id = ${rows[0].id}`;
		if (top) {
			body.ghost = { id: rows[0].id, name: rows[0].name, score: rows[0].score, level: rows[0].level, levels: top.recording };
		}
	}
	return json(res, 200, body, {
		'cache-control': 'public, max-age=5, s-maxage=10, stale-while-revalidate=30',
	});
}

async function handlePost(req, res) {
	const rl = await limits.ufoRunIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try {
		body = await readJson(req, BODY_LIMIT);
	} catch (err) {
		return error(res, err.status || 400, 'bad_request', err.message);
	}
	if (!body || typeof body !== 'object' || !Array.isArray(body.levels)) {
		return error(res, 400, 'bad_request', 'levels must be an array of { edges }');
	}
	if (body.levels.length > MAX_LEVELS || body.levels.some((l) => !Array.isArray(l?.edges) || l.edges.length > MAX_EDGES_PER_LEVEL)) {
		return error(res, 400, 'bad_request', 'run is larger than any playable run');
	}
	const levels = body.levels.map((l) => ({ edges: l.edges }));

	const verdict = verifyRun(levels);
	if (!verdict.ok) {
		return error(res, 422, 'impossible_run', `run rejected: ${verdict.reason}`, {
			reason: verdict.reason,
			level: verdict.level ?? null,
		});
	}

	const viewer = await resolveViewer(req);
	const name = cleanName(body.name) || cleanName(viewer?.displayName);
	if (!name) {
		return error(res, 400, 'bad_name', `name is required (1 to ${NAME_MAX} characters, no links)`);
	}

	const hash = createHash('sha256').update(JSON.stringify(levels)).digest('hex');
	const inserted = await sql`
		insert into ufo_runs (user_id, name, score, level, ticks, recording, recording_hash)
		values (${viewer?.id || null}, ${name}, ${verdict.score}, ${verdict.level}, ${verdict.ticks},
		        ${JSON.stringify(levels)}::jsonb, ${hash})
		on conflict (recording_hash) do nothing
		returning id, created_at
	`;
	if (!inserted.length) {
		return error(res, 409, 'duplicate_run', 'this exact run was already submitted');
	}

	const key = viewer?.id ? viewer.id : `n:${name.toLowerCase()}`;
	const [{ ahead }] = await sql`
		select count(*)::int as ahead from (
			select ${playerKey()} as k, max(r.score) as best from ufo_runs r group by 1
		) b
		where b.best > ${verdict.score} and b.k <> ${key}
	`;
	const [{ best }] = await sql`
		select max(r.score)::int as best from ufo_runs r where ${playerKey()} = ${key}
	`;

	return json(res, 201, {
		id: inserted[0].id,
		name,
		score: verdict.score,
		level: verdict.level,
		rank: ahead + 1,
		personalBest: best,
		isPersonalBest: verdict.score >= best,
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (req.method === 'GET') {
		const rl = await limits.publicIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		return handleGet(req, res);
	}
	return handlePost(req, res);
});
