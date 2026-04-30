/**
 * Agent Marketplace API
 * ---------------------
 * GET    /api/marketplace/categories
 * GET    /api/marketplace/agents              ?category=&q=&sort=&cursor=
 * GET    /api/marketplace/agents/:id
 * GET    /api/marketplace/agents/:id/versions
 * GET    /api/marketplace/agents/:id/similar
 * POST   /api/marketplace/agents/:id/fork
 * POST   /api/marketplace/agents/:id/bookmark
 * DELETE /api/marketplace/agents/:id/bookmark
 * POST   /api/marketplace/agents/:id/publish
 * POST   /api/marketplace/agents/:id/view
 *
 * Routed via vercel.json — see top of file path patterns.
 */

import { sql } from '../_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { publicUrl } from '../_lib/r2.js';
import { clientIp, limits } from '../_lib/rate-limit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CATEGORIES = [
	'academic',
	'career',
	'copywriting',
	'design',
	'education',
	'emotions',
	'entertainment',
	'games',
	'general',
	'life',
	'marketing',
	'office',
	'programming',
	'translation',
];

const SORTS = new Set(['recommended', 'recent', 'popular']);

export default wrap(async (req, res) => {
	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean); // ['api','marketplace',...]
	const head = parts[2]; // 'categories' | 'agents'
	const id = parts[3];
	const sub = parts[4];

	if (head === 'categories') return handleCategories(req, res);

	if (head === 'agents') {
		if (!id) return handleList(req, res, url);
		if (!UUID_RE.test(id)) return error(res, 404, 'not_found', 'agent not found');
		if (!sub) return handleDetail(req, res, id);
		if (sub === 'versions') return handleVersions(req, res, id);
		if (sub === 'similar') return handleSimilar(req, res, id);
		if (sub === 'fork') return handleFork(req, res, id);
		if (sub === 'bookmark') return handleBookmark(req, res, id);
		if (sub === 'publish') return handlePublish(req, res, id);
		if (sub === 'view') return handleView(req, res, id);
		return error(res, 404, 'not_found', 'unknown marketplace action');
	}

	return error(res, 404, 'not_found', 'unknown marketplace action');
});

// ── Auth ───────────────────────────────────────────────────────────────────

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

// ── Categories ─────────────────────────────────────────────────────────────

async function handleCategories(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const rows = await sql`
		SELECT category, count(*)::int AS count
		FROM agent_identities
		WHERE is_published = true AND deleted_at IS NULL
		GROUP BY category
	`;
	const counts = Object.fromEntries(
		rows.filter((r) => r.category).map((r) => [r.category, r.count]),
	);
	const total = rows.reduce((s, r) => s + r.count, 0);
	return json(
		res,
		200,
		{
			data: {
				total,
				categories: CATEGORIES.map((slug) => ({ slug, count: counts[slug] || 0 })),
			},
		},
		{ 'cache-control': 'public, max-age=60' },
	);
}

// ── List ───────────────────────────────────────────────────────────────────

async function handleList(req, res, url) {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const category = url.searchParams.get('category') || null;
	const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
	const sort = SORTS.has(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'recommended';
	const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit')) || 24));
	const cursor = url.searchParams.get('cursor');
	const offset = cursor ? Math.max(0, Number(cursor) || 0) : 0;

	const orderBy =
		sort === 'recent'
			? sql`published_at DESC NULLS LAST, created_at DESC`
			: sort === 'popular'
				? sql`(forks_count + views_count) DESC, published_at DESC NULLS LAST`
				: sql`(forks_count * 5 + views_count) DESC, published_at DESC NULLS LAST`;

	const cat = category && CATEGORIES.includes(category) ? category : null;
	const qLike = q ? `%${q}%` : null;

	const rows = await sql`
		SELECT ai.id, ai.name, ai.description, ai.category, ai.tags, ai.avatar_id, ai.user_id,
		       ai.forks_count, ai.views_count, ai.published_at, ai.created_at, ai.skills,
		       av.thumbnail_key
		FROM agent_identities ai
		LEFT JOIN avatars av ON av.id = ai.avatar_id AND av.deleted_at IS NULL
		WHERE ai.is_published = true
		  AND ai.deleted_at IS NULL
		  AND (${cat}::text IS NULL OR ai.category = ${cat})
		  AND (
		    ${qLike}::text IS NULL
		    OR ai.name ILIKE ${qLike}
		    OR ai.description ILIKE ${qLike}
		    OR EXISTS (SELECT 1 FROM unnest(ai.tags) t WHERE t ILIKE ${qLike})
		  )
		ORDER BY ${orderBy}
		LIMIT ${limit + 1} OFFSET ${offset}
	`;

	const hasMore = rows.length > limit;
	const items = rows.slice(0, limit).map(toCard);

	return json(
		res,
		200,
		{
			data: {
				items,
				next_cursor: hasMore ? String(offset + limit) : null,
			},
		},
		{ 'cache-control': 'public, max-age=15' },
	);
}

// ── Detail ─────────────────────────────────────────────────────────────────

async function handleDetail(req, res, id) {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [row] = await sql`
		SELECT a.*, u.display_name AS author_name, u.avatar_url AS author_avatar
		FROM agent_identities a
		LEFT JOIN users u ON u.id = a.user_id
		WHERE a.id = ${id} AND a.deleted_at IS NULL AND a.is_published = true
	`;
	if (!row) return error(res, 404, 'not_found', 'agent not found');

	const auth = await resolveAuth(req).catch(() => null);
	let bookmarked = false;
	if (auth) {
		const [b] =
			await sql`SELECT 1 AS x FROM agent_bookmarks WHERE user_id = ${auth.userId} AND agent_id = ${id}`;
		bookmarked = !!b;
	}

	return json(
		res,
		200,
		{ data: { agent: toDetail(row), bookmarked } },
		{ 'cache-control': 'public, max-age=15' },
	);
}

// ── Versions ───────────────────────────────────────────────────────────────

async function handleVersions(req, res, id) {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const rows = await sql`
		SELECT id, version, changelog, category, tags, created_at
		FROM agent_versions
		WHERE agent_id = ${id}
		ORDER BY version DESC
		LIMIT 50
	`;
	return json(res, 200, { data: { versions: rows } });
}

// ── Similar ────────────────────────────────────────────────────────────────

async function handleSimilar(req, res, id) {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [base] = await sql`
		SELECT id, name, description, category, tags FROM agent_identities
		WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!base) return error(res, 404, 'not_found', 'agent not found');

	const rows = await sql`
		SELECT ai.id, ai.name, ai.description, ai.category, ai.tags, ai.avatar_id, ai.user_id,
		       ai.forks_count, ai.views_count, ai.published_at, ai.created_at, ai.skills,
		       av.thumbnail_key,
		       (
		         (CASE WHEN ai.category = ${base.category} THEN 3 ELSE 0 END)
		         + cardinality(ARRAY(SELECT unnest(ai.tags) INTERSECT SELECT unnest(${base.tags}::text[])))
		         + similarity(ai.name, ${base.name})
		         + similarity(coalesce(ai.description,''), ${base.description || ''}) * 0.5
		       ) AS score
		FROM agent_identities ai
		LEFT JOIN avatars av ON av.id = ai.avatar_id AND av.deleted_at IS NULL
		WHERE ai.is_published = true
		  AND ai.deleted_at IS NULL
		  AND ai.id <> ${id}
		ORDER BY score DESC
		LIMIT 8
	`;
	return json(res, 200, { data: { items: rows.map(toCard) } });
}

// ── Fork ───────────────────────────────────────────────────────────────────

async function handleFork(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [src] = await sql`
		SELECT * FROM agent_identities
		WHERE id = ${id} AND deleted_at IS NULL AND is_published = true
	`;
	if (!src) return error(res, 404, 'not_found', 'agent not found');

	const [created] = await sql.transaction([
		sql`
			INSERT INTO agent_identities (
				user_id, name, description, avatar_id, skills, meta,
				category, tags, system_prompt, greeting, capabilities, fork_of
			)
			VALUES (
				${auth.userId},
				${src.name},
				${src.description},
				${src.avatar_id},
				${src.skills},
				'{}'::jsonb,
				${src.category},
				${src.tags},
				${src.system_prompt},
				${src.greeting},
				${src.capabilities}::jsonb,
				${src.id}
			)
			RETURNING id, name, description, category, tags, fork_of, created_at
		`,
		sql`UPDATE agent_identities SET forks_count = forks_count + 1 WHERE id = ${id}`,
	]);

	return json(res, 201, { data: { agent: created } });
}

// ── Bookmark ───────────────────────────────────────────────────────────────

async function handleBookmark(req, res, id) {
	if (cors(req, res, { methods: 'POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST', 'DELETE'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	if (req.method === 'DELETE') {
		await sql`DELETE FROM agent_bookmarks WHERE user_id = ${auth.userId} AND agent_id = ${id}`;
		return json(res, 200, { data: { bookmarked: false } });
	}

	await sql`
		INSERT INTO agent_bookmarks (user_id, agent_id)
		VALUES (${auth.userId}, ${id})
		ON CONFLICT DO NOTHING
	`;
	return json(res, 200, { data: { bookmarked: true } });
}

// ── Publish ────────────────────────────────────────────────────────────────

async function handlePublish(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req).catch(() => ({}));

	const [existing] = await sql`
		SELECT id, user_id, system_prompt, greeting, category, tags, capabilities
		FROM agent_identities WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!existing) return error(res, 404, 'not_found', 'agent not found');
	if (existing.user_id !== auth.userId) return error(res, 403, 'forbidden', 'not your agent');

	const category =
		body.category && CATEGORIES.includes(body.category) ? body.category : existing.category;
	if (!category) return error(res, 400, 'validation_error', 'category required');

	const tags = Array.isArray(body.tags)
		? body.tags
				.filter((t) => typeof t === 'string')
				.map((t) => t.trim().toLowerCase())
				.filter(Boolean)
				.slice(0, 12)
		: existing.tags;

	const systemPrompt =
		typeof body.system_prompt === 'string' ? body.system_prompt.slice(0, 16000) : existing.system_prompt;
	const greeting = typeof body.greeting === 'string' ? body.greeting.slice(0, 1000) : existing.greeting;
	const capabilities = body.capabilities && typeof body.capabilities === 'object' ? body.capabilities : existing.capabilities;
	const changelog = typeof body.changelog === 'string' ? body.changelog.slice(0, 1000) : null;

	const [{ next_version }] = await sql`
		SELECT COALESCE(MAX(version), 0) + 1 AS next_version
		FROM agent_versions WHERE agent_id = ${id}
	`;

	const [updated] = await sql.transaction([
		sql`
			UPDATE agent_identities
			SET is_published  = true,
			    published_at  = COALESCE(published_at, now()),
			    category      = ${category},
			    tags          = ${tags},
			    system_prompt = ${systemPrompt},
			    greeting      = ${greeting},
			    capabilities  = ${JSON.stringify(capabilities || {})}::jsonb
			WHERE id = ${id}
			RETURNING *
		`,
		sql`
			INSERT INTO agent_versions (
				agent_id, version, system_prompt, greeting, category, tags, capabilities, changelog, created_by
			)
			VALUES (
				${id}, ${next_version}, ${systemPrompt}, ${greeting},
				${category}, ${tags}, ${JSON.stringify(capabilities || {})}::jsonb,
				${changelog}, ${auth.userId}
			)
		`,
	]);

	return json(res, 200, { data: { agent: toDetail(updated), version: next_version } });
}

// ── View counter ───────────────────────────────────────────────────────────

async function handleView(req, res, id) {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return json(res, 200, { data: { ok: true } });

	queueMicrotask(() => {
		sql`UPDATE agent_identities SET views_count = views_count + 1 WHERE id = ${id} AND is_published = true`.catch(
			(err) => console.error('[marketplace/view]', err),
		);
	});
	return json(res, 200, { data: { ok: true } });
}

// ── Shaping ────────────────────────────────────────────────────────────────

function toCard(row) {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		category: row.category,
		tags: row.tags || [],
		avatar_id: row.avatar_id,
		thumbnail_url: row.thumbnail_key ? publicUrl(row.thumbnail_key) : null,
		author_id: row.user_id,
		skills: row.skills || [],
		forks_count: row.forks_count || 0,
		views_count: row.views_count || 0,
		published_at: row.published_at,
		created_at: row.created_at,
	};
}

function toDetail(row) {
	return {
		...toCard(row),
		system_prompt: row.system_prompt,
		greeting: row.greeting,
		capabilities: row.capabilities || {},
		fork_of: row.fork_of || null,
		author_name: row.author_name || null,
		author_avatar: row.author_avatar || null,
	};
}
