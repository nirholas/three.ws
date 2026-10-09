// The Crawl: three.ws agents reading the open web in real browsers, watched live.
// Doc: docs/crawl.md. Worker: workers/agent-crawler. Page: /crawl.
//
// Routes:
//   GET    /api/crawl/stats                  fleet + corpus totals, top domains (cached 15s)
//   GET    /api/crawl/crawlers               enrolled crawlers with avatar + live state
//   GET    /api/crawl/live                   SSE: snapshot, then step/sleep/page events
//   GET    /api/crawl/frame?agent=<uuid>     latest JPEG of that crawler's browser
//   GET    /api/crawl/pages?agent=&limit=&before=&format=json|jsonl
//                                            the corpus, newest first (jsonl = dataset export)
//   GET    /api/crawl/mission?agent=<uuid>   one agent's mission (public summary)
//   PUT    /api/crawl/mission                owner sends an agent out { agentId, topic, seeds[], enabled }
//   DELETE /api/crawl/mission?agent=<uuid>   owner calls it home
//   GET    /api/crawl/mine                   the signed-in owner's agents + their missions
//   GET    /api/crawl/roster                 worker: who should be walking (bearer CRAWL_WORKER_SECRET)
//   POST   /api/crawl/push                   worker: one step (+ optional finished page) for one crawler
//
// Storage: Redis carries the live layer (crawl:live:<id> step JSON, crawl:frame:<id>
// base64 JPEG, crawl:active sorted set, crawl:feed recent reads); Postgres carries
// the roster (crawl_missions) and the corpus (crawl_pages); object storage holds
// each page's full cleaned text under crawl/text/.

import { timingSafeEqual } from 'node:crypto';
import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getRedis } from '../_lib/redis.js';
import { sql } from '../_lib/db.js';
import { isUuid } from '../_lib/validate.js';
import { getSessionUser, extractBearer } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { objectStorageConfigured, putObject, publicUrlOrNull, thumbnailUrl } from '../_lib/r2.js';
import { resolveAvatarUrl } from '../_lib/avatars.js';
import {
	CRAWL_LIVE_TTL, CRAWL_ACTIVE_WINDOW_MS, isFrameB64, pageMemory, sanitizePage, sanitizeStep, validateMission,
} from '../_lib/crawl.js';

export const maxDuration = 300;

const WORKER_SECRET = process.env.CRAWL_WORKER_SECRET || '';
const LIVE_KEY = (id) => `crawl:live:${id}`;
const FRAME_KEY = (id) => `crawl:frame:${id}`;
const ACTIVE_KEY = 'crawl:active';
const FEED_KEY = 'crawl:feed';
const STATS_KEY = 'crawl:stats:v1';
const FEED_CAP = 60;
const MEMORY_TTL_MS = 30 * 24 * 3600 * 1000;
const MEMORY_MIN_RELEVANCE = 0.12;

function isWorker(req) {
	const bearer = extractBearer(req);
	if (!bearer || WORKER_SECRET.length < 16) return false;
	const a = Buffer.from(bearer);
	const b = Buffer.from(WORKER_SECRET);
	return a.length === b.length && timingSafeEqual(a, b);
}

// Upstash's REST client parses JSON values on read, so a record can come back as
// a string or an already-parsed object. Accept both.
function parseRecord(v) {
	if (v && typeof v === 'object') return v;
	if (typeof v !== 'string') return null;
	try { return JSON.parse(v); } catch { return null; }
}

function avatarFields(row) {
	const isPublic = row.avatar_visibility === 'public' || row.avatar_visibility === 'unlisted';
	let thumb = null;
	if (isPublic && row.thumbnail_key) {
		try { thumb = thumbnailUrl(row.thumbnail_key); } catch { thumb = null; }
	}
	return { glbRow: isPublic && row.storage_key ? row : null, thumb };
}

async function resolveGlb(row) {
	if (!row) return null;
	try {
		const { url } = await resolveAvatarUrl({
			id: row.avatar_id,
			storage_key: row.storage_key,
			baked_storage_key: row.baked_storage_key,
			appearance_hash: row.appearance_hash,
			appearance: row.appearance,
			visibility: row.avatar_visibility,
		});
		return url;
	} catch {
		return null;
	}
}

async function awakeSet(r) {
	if (!r) return new Map();
	const now = Date.now();
	try {
		const raw = await r.zrange(ACTIVE_KEY, now - CRAWL_ACTIVE_WINDOW_MS, now, { byScore: true, withScores: true });
		const out = new Map();
		for (let i = 0; i + 1 < (raw || []).length; i += 2) out.set(String(raw[i]), Number(raw[i + 1]));
		return out;
	} catch {
		return new Map();
	}
}

// ── worker: roster ──────────────────────────────────────────────────────────
async function handleRoster(req, res) {
	if (!isWorker(req)) return error(res, 401, 'unauthorized', 'crawl worker credential required');
	const url = new URL(req.url, 'http://x');
	const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 24));
	const rows = await sql`
		SELECT m.agent_id, m.topic, m.seeds, m.pages_read, i.name
		FROM crawl_missions m
		JOIN agent_identities i ON i.id = m.agent_id AND i.deleted_at IS NULL
		WHERE m.enabled = true
		ORDER BY m.last_at ASC NULLS FIRST
		LIMIT ${limit}
	`;
	return json(res, 200, {
		crawlers: rows.map((r) => ({
			agentId: r.agent_id, name: r.name, topic: r.topic, seeds: r.seeds || [], pagesRead: Number(r.pages_read) || 0,
		})),
	}, { 'cache-control': 'no-store' });
}

// ── worker: push ────────────────────────────────────────────────────────────
async function storeText(page) {
	if (!page.text || !objectStorageConfigured()) return null;
	const key = `crawl/text/${page.hash.slice(0, 2)}/${page.hash}.txt`;
	try {
		await putObject({ key, body: page.text, contentType: 'text/plain; charset=utf-8', metadata: { url: encodeURI(page.url).slice(0, 1024) } });
		return key;
	} catch (err) {
		console.warn('[crawl] text store failed:', err?.message);
		return null;
	}
}

async function recordPage(agentId, mission, page) {
	const [row] = await sql`
		INSERT INTO crawl_pages (agent_id, url, url_hash, domain, title, gist, tokens, links_out, relevance, from_url)
		VALUES (${agentId}, ${page.url}, ${page.hash}, ${page.domain}, ${page.title}, ${page.gist}, ${page.tokens},
		        ${page.linksOut}, ${page.relevance}, ${page.fromUrl})
		ON CONFLICT (agent_id, url_hash) DO NOTHING
		RETURNING id
	`;
	if (!row) return { inserted: false };

	const textKey = await storeText(page);
	const [counts] = await sql`
		UPDATE crawl_missions
		SET pages_read = pages_read + 1, tokens_read = tokens_read + ${page.tokens},
		    last_url = ${page.url}, last_at = now(), updated_at = now()
		WHERE agent_id = ${agentId}
		RETURNING pages_read, tokens_read
	`;
	if (textKey) await sql`UPDATE crawl_pages SET text_key = ${textKey} WHERE id = ${row.id}`;

	// The agent keeps what it read, but only when its own owner sent it out: an
	// agent's memory is the owner's to shape.
	const ownerSent = mission.set_by && mission.set_by === mission.user_id;
	if (ownerSent && page.gist && (page.relevance == null || page.relevance >= MEMORY_MIN_RELEVANCE)) {
		const salience = 0.25 + 0.4 * (page.relevance ?? 0.3);
		const expires = new Date(Date.now() + MEMORY_TTL_MS).toISOString();
		await sql`
			INSERT INTO agent_memories (agent_id, type, content, tags, context, salience, tier, expires_at)
			VALUES (${agentId}, 'reference', ${pageMemory(page, mission.topic)}, ${['crawl', page.domain]},
			        ${JSON.stringify({ source: 'crawl', url: page.url, page_id: row.id })}::jsonb, ${salience}, 'archival', ${expires})
		`.catch((err) => console.warn('[crawl] memory write failed:', err?.message));
	}
	return { inserted: true, id: row.id, pagesRead: Number(counts?.pages_read) || 0 };
}

async function handlePush(req, res) {
	if (!isWorker(req)) return error(res, 401, 'unauthorized', 'crawl worker credential required');
	let body;
	try {
		body = await readJson(req, 1_200_000);
	} catch {
		return error(res, 400, 'invalid_body', 'request body must be JSON under 1.2 MB');
	}
	const agentId = String(body?.agentId || '');
	if (!isUuid(agentId)) return error(res, 400, 'invalid_agent_id', 'agentId must be a uuid');

	const [mission] = await sql`
		SELECT m.topic, m.set_by, m.enabled, m.pages_read, i.name, i.user_id
		FROM crawl_missions m
		JOIN agent_identities i ON i.id = m.agent_id AND i.deleted_at IS NULL
		WHERE m.agent_id = ${agentId}
		LIMIT 1
	`;
	if (!mission || !mission.enabled) return error(res, 410, 'not_enrolled', 'this agent is not out crawling');

	const step = sanitizeStep(body.step);
	if (!step) return error(res, 400, 'invalid_step', 'step is required');
	const page = body.page ? sanitizePage(body.page) : null;
	const frame = isFrameB64(body.frame) ? body.frame : null;

	let pagesRead = Number(mission.pages_read) || 0;
	let recorded = null;
	if (page) {
		recorded = await recordPage(agentId, mission, page);
		if (recorded.inserted) pagesRead = recorded.pagesRead;
	}

	const r = getRedis();
	if (!r) return json(res, 200, { ok: true, live: false, pagesRead });

	const now = Date.now();
	const live = {
		agentId, name: mission.name, topic: mission.topic, ts: now, pagesRead,
		frameTs: frame ? now : undefined, ...step,
	};
	if (!frame) {
		// A step without new pixels keeps pointing at the frame already stored.
		const prev = parseRecord(await r.get(LIVE_KEY(agentId)).catch(() => null));
		if (prev?.frameTs) live.frameTs = prev.frameTs;
	}
	const writes = [
		r.set(LIVE_KEY(agentId), JSON.stringify(live), { ex: CRAWL_LIVE_TTL }),
		r.zadd(ACTIVE_KEY, { score: now, member: agentId }),
		r.zremrangebyscore(ACTIVE_KEY, 0, now - CRAWL_ACTIVE_WINDOW_MS * 2),
	];
	if (frame) writes.push(r.set(FRAME_KEY(agentId), frame, { ex: CRAWL_LIVE_TTL }));
	if (recorded?.inserted) {
		const entry = { agentId, name: mission.name, url: page.url, title: page.title, domain: page.domain, tokens: page.tokens, gist: page.gist, ts: now };
		writes.push(r.lpush(FEED_KEY, JSON.stringify(entry)).then(() => r.ltrim(FEED_KEY, 0, FEED_CAP - 1)));
	}
	await Promise.all(writes);
	return json(res, 200, { ok: true, live: true, pagesRead, recorded: Boolean(recorded?.inserted) });
}

// ── public: frame ───────────────────────────────────────────────────────────
async function handleFrame(req, res) {
	const agentId = new URL(req.url, 'http://x').searchParams.get('agent') || '';
	if (!isUuid(agentId)) return error(res, 400, 'invalid_agent_id', 'agent must be a uuid');
	const r = getRedis();
	if (!r) return error(res, 503, 'live_unavailable', 'the live layer is offline');
	const b64 = await r.get(FRAME_KEY(agentId));
	if (typeof b64 !== 'string' || !b64) {
		return error(res, 404, 'asleep', 'this crawler has no live frame right now');
	}
	const buf = Buffer.from(b64, 'base64');
	res.writeHead(200, {
		'content-type': 'image/jpeg',
		'content-length': buf.length,
		// The page asks with ?t=<frameTs>, so each frame has its own URL.
		'cache-control': 'public, max-age=30',
		'x-content-type-options': 'nosniff',
	});
	res.end(buf);
}

// ── public: live SSE ────────────────────────────────────────────────────────
// One poller per server instance, fanned out to every connected viewer, so Redis
// load is flat in the number of viewers.
const hub = { subs: new Set(), timer: null, crawlers: new Map(), feedTs: 0, feed: [] };
const HUB_POLL_MS = 800;

async function readFleet(r) {
	const awake = await awakeSet(r);
	const ids = [...awake.keys()].slice(0, 120);
	if (!ids.length) return [];
	const raw = await r.mget(...ids.map(LIVE_KEY));
	return (raw || []).map(parseRecord).filter(Boolean);
}

async function readFeed(r, n) {
	const raw = await r.lrange(FEED_KEY, 0, n - 1).catch(() => []);
	return (raw || []).map(parseRecord).filter(Boolean);
}

function broadcast(event, data) {
	const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	for (const s of hub.subs) s(line);
}

async function hubTick() {
	const r = getRedis();
	if (!r || !hub.subs.size) return;
	try {
		const fleet = await readFleet(r);
		const seen = new Set();
		for (const c of fleet) {
			seen.add(c.agentId);
			const prev = hub.crawlers.get(c.agentId);
			if (!prev || prev.ts !== c.ts) {
				hub.crawlers.set(c.agentId, c);
				broadcast('step', c);
			}
		}
		for (const id of [...hub.crawlers.keys()]) {
			if (!seen.has(id)) {
				hub.crawlers.delete(id);
				broadcast('sleep', { agentId: id });
			}
		}
		const recent = await readFeed(r, 10);
		const fresh = recent.filter((e) => e.ts > hub.feedTs).reverse();
		for (const e of fresh) broadcast('page', e);
		if (recent.length) hub.feedTs = Math.max(hub.feedTs, recent[0].ts);
	} catch (err) {
		console.warn('[crawl] hub tick failed:', err?.message);
	}
}

function hubStart() {
	if (hub.timer) return;
	hub.timer = setInterval(hubTick, HUB_POLL_MS);
	hub.timer.unref?.();
}

function hubStop() {
	if (hub.subs.size || !hub.timer) return;
	clearInterval(hub.timer);
	hub.timer = null;
	hub.crawlers.clear();
}

async function handleLive(req, res) {
	const r = getRedis();
	res.writeHead(200, {
		'content-type': 'text/event-stream; charset=utf-8',
		'cache-control': 'no-cache, no-transform',
		connection: 'keep-alive',
		'x-accel-buffering': 'no',
	});
	res.flushHeaders?.();
	let open = true;
	const write = (line) => {
		if (!open || res.writableEnded) return;
		try { res.write(line); } catch { open = false; }
	};

	if (!r) {
		write(`event: snapshot\ndata: ${JSON.stringify({ crawlers: [], feed: [], live: false })}\n\n`);
	} else {
		const [fleet, feed] = await Promise.all([readFleet(r).catch(() => []), readFeed(r, 30)]);
		for (const c of fleet) hub.crawlers.set(c.agentId, c);
		if (feed.length) hub.feedTs = Math.max(hub.feedTs, feed[0].ts);
		write(`event: snapshot\ndata: ${JSON.stringify({ crawlers: fleet, feed, live: true })}\n\n`);
	}

	hub.subs.add(write);
	hubStart();
	const ping = setInterval(() => write('event: ping\ndata: {}\n\n'), 15_000);
	const end = setTimeout(() => { try { res.end(); } catch { /* closed */ } }, 280_000);
	const close = () => {
		open = false;
		clearInterval(ping);
		clearTimeout(end);
		hub.subs.delete(write);
		hubStop();
	};
	req.on('close', close);
	res.on('close', close);
}

// ── public: stats ───────────────────────────────────────────────────────────
async function handleStats(req, res) {
	const r = getRedis();
	let cached = null;
	if (r) cached = parseRecord(await r.get(STATS_KEY).catch(() => null));
	if (!cached) {
		const [[totals], [enrolled], top] = await Promise.all([
			sql`
				SELECT count(*)::bigint AS pages,
				       coalesce(sum(tokens), 0)::bigint AS tokens,
				       count(DISTINCT domain)::int AS domains,
				       count(DISTINCT url_hash)::bigint AS unique_pages,
				       count(*) FILTER (WHERE created_at > now() - interval '24 hours')::bigint AS pages_24h
				FROM crawl_pages
			`,
			sql`SELECT count(*)::int AS n FROM crawl_missions WHERE enabled = true`,
			sql`
				SELECT domain, count(*)::int AS pages
				FROM crawl_pages
				WHERE created_at > now() - interval '7 days'
				GROUP BY domain ORDER BY pages DESC LIMIT 12
			`,
		]);
		cached = {
			pagesRead: Number(totals.pages) || 0,
			uniquePages: Number(totals.unique_pages) || 0,
			tokens: Number(totals.tokens) || 0,
			domains: totals.domains || 0,
			pages24h: Number(totals.pages_24h) || 0,
			crawlersEnrolled: enrolled.n || 0,
			topDomains: top.map((t) => ({ domain: t.domain, pages: t.pages })),
		};
		if (r) await r.set(STATS_KEY, JSON.stringify(cached), { ex: 15 }).catch(() => {});
	}
	const awake = await awakeSet(r);
	return json(res, 200, { ...cached, crawlersAwake: awake.size, ts: Date.now() }, { 'cache-control': 'public, max-age=10' });
}

// ── public: crawlers ────────────────────────────────────────────────────────
async function handleCrawlers(req, res) {
	const r = getRedis();
	const [rows, awake] = await Promise.all([
		sql`
			SELECT m.agent_id, m.topic, m.pages_read, m.tokens_read, m.last_url, m.last_at, m.enabled,
			       i.name, i.description,
			       a.id AS avatar_id, a.storage_key, a.baked_storage_key, a.appearance_hash, a.appearance,
			       a.thumbnail_key, a.visibility AS avatar_visibility
			FROM crawl_missions m
			JOIN agent_identities i ON i.id = m.agent_id AND i.deleted_at IS NULL
			LEFT JOIN avatars a ON a.id = i.avatar_id AND a.deleted_at IS NULL
			WHERE m.enabled = true
			ORDER BY m.last_at DESC NULLS LAST
			LIMIT 120
		`,
		awakeSet(r),
	]);
	const crawlers = await Promise.all(rows.map(async (row) => {
		const { glbRow, thumb } = avatarFields(row);
		return {
			agentId: row.agent_id,
			name: row.name,
			description: row.description ? String(row.description).slice(0, 200) : null,
			topic: row.topic,
			pagesRead: Number(row.pages_read) || 0,
			tokensRead: Number(row.tokens_read) || 0,
			lastUrl: row.last_url,
			lastAt: row.last_at,
			awake: awake.has(row.agent_id),
			avatarUrl: await resolveGlb(glbRow),
			thumbnail: thumb,
		};
	}));
	crawlers.sort((a, b) => Number(b.awake) - Number(a.awake) || b.pagesRead - a.pagesRead);
	return json(res, 200, { crawlers }, { 'cache-control': 'public, max-age=10' });
}

// ── public: pages (corpus) ──────────────────────────────────────────────────
async function handlePages(req, res) {
	const p = new URL(req.url, 'http://x').searchParams;
	const agent = p.get('agent');
	if (agent && !isUuid(agent)) return error(res, 400, 'invalid_agent_id', 'agent must be a uuid');
	const limit = Math.min(500, Math.max(1, Number(p.get('limit')) || 40));
	const before = Number(p.get('before'));
	const beforeId = Number.isSafeInteger(before) && before > 0 ? before : null;
	const rows = await sql`
		SELECT p.id, p.agent_id, i.name AS agent_name, p.url, p.domain, p.title, p.gist, p.tokens,
		       p.links_out, p.relevance, p.from_url, p.text_key, p.created_at
		FROM crawl_pages p
		JOIN agent_identities i ON i.id = p.agent_id
		WHERE (${agent}::uuid IS NULL OR p.agent_id = ${agent}::uuid)
		  AND (${beforeId}::bigint IS NULL OR p.id < ${beforeId}::bigint)
		ORDER BY p.id DESC
		LIMIT ${limit}
	`;
	const pages = rows.map((row) => ({
		id: Number(row.id),
		agentId: row.agent_id,
		agentName: row.agent_name,
		url: row.url,
		domain: row.domain,
		title: row.title,
		gist: row.gist,
		tokens: row.tokens,
		linksOut: row.links_out,
		relevance: row.relevance,
		fromUrl: row.from_url,
		textUrl: publicUrlOrNull(row.text_key),
		readAt: row.created_at,
	}));
	if (p.get('format') === 'jsonl') {
		res.writeHead(200, {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'public, max-age=30',
			'content-disposition': 'inline; filename="three-ws-crawl.jsonl"',
		});
		res.end(pages.map((x) => JSON.stringify(x)).join('\n') + (pages.length ? '\n' : ''));
		return;
	}
	const next = pages.length === limit ? pages[pages.length - 1].id : null;
	return json(res, 200, { pages, next }, { 'cache-control': 'public, max-age=10' });
}

// ── mission (public read, owner write) ──────────────────────────────────────
async function ownedAgent(agentId, userId) {
	const [row] = await sql`
		SELECT id, name FROM agent_identities
		WHERE id = ${agentId} AND user_id = ${userId} AND deleted_at IS NULL
		LIMIT 1
	`;
	return row || null;
}

function missionView(row) {
	return {
		agentId: row.agent_id,
		name: row.name,
		topic: row.topic,
		seeds: row.seeds || [],
		enabled: row.enabled,
		pagesRead: Number(row.pages_read) || 0,
		tokensRead: Number(row.tokens_read) || 0,
		lastUrl: row.last_url,
		lastAt: row.last_at,
	};
}

async function handleMission(req, res) {
	if (req.method === 'GET') {
		const agentId = new URL(req.url, 'http://x').searchParams.get('agent') || '';
		if (!isUuid(agentId)) return error(res, 400, 'invalid_agent_id', 'agent must be a uuid');
		const [row] = await sql`
			SELECT m.*, i.name FROM crawl_missions m
			JOIN agent_identities i ON i.id = m.agent_id AND i.deleted_at IS NULL
			WHERE m.agent_id = ${agentId} LIMIT 1
		`;
		if (!row) return json(res, 200, { mission: null }, { 'cache-control': 'no-store' });
		return json(res, 200, { mission: missionView(row) }, { 'cache-control': 'no-store' });
	}

	const auth = await getSessionUser(req, res);
	const userId = auth?.id;
	if (!userId) return error(res, 401, 'unauthorized', 'sign in to send your agent out');
	if (!(await requireCsrf(req, res, userId))) return;
	const rl = await limits.crawlMissionIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (req.method === 'DELETE') {
		const agentId = new URL(req.url, 'http://x').searchParams.get('agent') || '';
		if (!isUuid(agentId)) return error(res, 400, 'invalid_agent_id', 'agent must be a uuid');
		if (!(await ownedAgent(agentId, userId))) return error(res, 403, 'forbidden', 'you do not own this agent');
		await sql`UPDATE crawl_missions SET enabled = false, updated_at = now() WHERE agent_id = ${agentId}`;
		const r = getRedis();
		if (r) await Promise.all([r.del(LIVE_KEY(agentId)), r.zrem(ACTIVE_KEY, agentId)]).catch(() => {});
		return json(res, 200, { ok: true, enabled: false });
	}

	let body;
	try { body = await readJson(req, 16_000); } catch { return error(res, 400, 'invalid_body', 'body must be JSON'); }
	const agentId = String(body?.agentId || '');
	if (!isUuid(agentId)) return error(res, 400, 'invalid_agent_id', 'agentId must be a uuid');
	const agent = await ownedAgent(agentId, userId);
	if (!agent) return error(res, 403, 'forbidden', 'you do not own this agent');
	const m = validateMission(body);
	if (m.error) return error(res, 400, 'invalid_mission', m.error);

	const [row] = await sql`
		INSERT INTO crawl_missions (agent_id, topic, seeds, enabled, set_by)
		VALUES (${agentId}, ${m.topic}, ${m.seeds}, ${m.enabled}, ${userId})
		ON CONFLICT (agent_id) DO UPDATE
		SET topic = excluded.topic, seeds = excluded.seeds, enabled = excluded.enabled,
		    set_by = excluded.set_by, updated_at = now()
		RETURNING *
	`;
	return json(res, 200, { mission: missionView({ ...row, name: agent.name }) });
}

async function handleMine(req, res) {
	const auth = await getSessionUser(req, res);
	const userId = auth?.id;
	if (!userId) return error(res, 401, 'unauthorized', 'sign in to see your agents');
	const rows = await sql`
		SELECT i.id, i.name, a.thumbnail_key, a.visibility AS avatar_visibility,
		       m.topic, m.seeds, m.enabled, m.pages_read, m.tokens_read, m.last_url, m.last_at
		FROM agent_identities i
		LEFT JOIN avatars a ON a.id = i.avatar_id AND a.deleted_at IS NULL
		LEFT JOIN crawl_missions m ON m.agent_id = i.id
		WHERE i.user_id = ${userId} AND i.deleted_at IS NULL
		ORDER BY m.enabled DESC NULLS LAST, i.created_at DESC
		LIMIT 60
	`;
	return json(res, 200, {
		agents: rows.map((row) => ({
			agentId: row.id,
			name: row.name,
			thumbnail: avatarFields(row).thumb,
			mission: row.topic ? missionView({ ...row, agent_id: row.id }) : null,
		})),
	}, { 'cache-control': 'no-store' });
}

const ROUTES = {
	roster: { methods: ['GET'], fn: handleRoster },
	push: { methods: ['POST'], fn: handlePush },
	frame: { methods: ['GET'], fn: handleFrame },
	live: { methods: ['GET'], fn: handleLive },
	stats: { methods: ['GET'], fn: handleStats },
	crawlers: { methods: ['GET'], fn: handleCrawlers },
	pages: { methods: ['GET'], fn: handlePages },
	mission: { methods: ['GET', 'PUT', 'DELETE'], fn: handleMission },
	mine: { methods: ['GET'], fn: handleMine },
};

export default wrap(async function handleCrawl(req, res) {
	const action = new URL(req.url, 'http://x').searchParams.get('action') || '';
	const route = ROUTES[action];
	if (cors(req, res, { methods: `${route ? route.methods.join(',') : 'GET'},OPTIONS` })) return;
	if (!route) return error(res, 404, 'not_found', 'unknown crawl action');
	if (!method(req, res, route.methods)) return;

	// Worker traffic is authenticated by secret and paced by the worker itself.
	// Frames get a wider bucket (a wall of tiles fetches one per step each).
	if (action === 'frame') {
		const rl = await limits.crawlFrameIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
	} else if (action !== 'push' && action !== 'roster') {
		const rl = await limits.crawlReadIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
	}
	return route.fn(req, res);
});
