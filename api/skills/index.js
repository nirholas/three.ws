import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, error, method, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_SORTS = new Set(['popular', 'new', 'az']);

const skillSlug = z
	.string()
	.trim()
	.min(1)
	.max(60)
	.regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens');

const publishSchema = z.object({
	name: z.string().trim().min(2).max(80),
	slug: skillSlug,
	description: z.string().trim().max(500),
	category: z.string().trim().min(1).max(50).default('general'),
	tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
	schema_json: z
		.array(
			z
				.object({
					function: z
						.object({ name: z.string(), parameters: z.record(z.any()) })
						.passthrough(),
				})
				.passthrough(),
		)
		.min(1),
	is_public: z.boolean().default(true),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'GET') return handleList(req, res);
	return handlePublish(req, res);
});

async function resolveOptionalAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, plan: session.plan };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId, plan: null };
	return null;
}

function toSkill(row, { includeInstalled = false, includeSchema = false } = {}) {
	const skill = {
		id: row.id,
		name: row.name,
		slug: row.slug,
		description: row.description,
		category: row.category,
		tags: row.tags || [],
		install_count: row.install_count || 0,
		avg_rating: Number(row.avg_rating) || 0,
		rating_count: row.rating_count || 0,
		author: row.author_id
			? { id: row.author_id, display_name: row.author_display_name }
			: null,
		created_at: row.created_at,
	};
	if (includeInstalled) skill.installed = !!row.installed;
	if (includeSchema) skill.schema_json = row.schema_json;
	return skill;
}

async function handleList(req, res) {
	const url = new URL(req.url, 'http://x');
	const q = (url.searchParams.get('q') || '').trim().slice(0, 80) || null;
	const category = url.searchParams.get('category') || null;
	const sortParam = url.searchParams.get('sort') || '';
	const sort = VALID_SORTS.has(sortParam) ? sortParam : 'popular';
	const cursor = url.searchParams.get('cursor') || null;
	const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
	const installedOnly = url.searchParams.get('installed') === 'true';

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const auth = await resolveOptionalAuth(req);
	const userId = auth?.userId ?? null;

	if (installedOnly && !userId) {
		return error(res, 401, 'unauthorized', 'sign in required to filter by installed');
	}

	if (cursor && !UUID_RE.test(cursor)) {
		return error(res, 400, 'validation_error', 'invalid cursor');
	}

	const qLike = q ? `%${q}%` : null;

	// Fetch cursor pivot values for keyset pagination
	let cursorInstallCount = null;
	let cursorCreatedAt = null;
	let cursorName = null;
	if (cursor) {
		const [cr] = await sql`
			SELECT install_count, created_at, name
			FROM marketplace_skills
			WHERE id = ${cursor} AND is_public = true
		`;
		if (cr) {
			cursorInstallCount = cr.install_count;
			cursorCreatedAt = cr.created_at;
			cursorName = cr.name;
		}
	}

	// Build sort-specific ORDER BY and cursor condition as sql fragments
	let orderBy;
	let cursorCond;
	if (sort === 'new') {
		orderBy = sql`ms.created_at DESC, ms.id DESC`;
		cursorCond =
			cursor && cursorCreatedAt != null
				? sql`AND (ms.created_at < ${cursorCreatedAt} OR (ms.created_at = ${cursorCreatedAt} AND ms.id::text < ${cursor}))`
				: sql``;
	} else if (sort === 'az') {
		orderBy = sql`ms.name ASC, ms.id ASC`;
		cursorCond =
			cursor && cursorName != null
				? sql`AND (ms.name > ${cursorName} OR (ms.name = ${cursorName} AND ms.id::text > ${cursor}))`
				: sql``;
	} else {
		// popular (default)
		orderBy = sql`ms.install_count DESC, ms.id DESC`;
		cursorCond =
			cursor && cursorInstallCount != null
				? sql`AND (ms.install_count < ${cursorInstallCount} OR (ms.install_count = ${cursorInstallCount} AND ms.id::text < ${cursor}))`
				: sql``;
	}

	const rows = await sql`
		SELECT
			ms.id, ms.name, ms.slug, ms.description, ms.category, ms.tags,
			ms.install_count, ms.created_at, ms.author_id,
			u.display_name AS author_display_name,
			ROUND(COALESCE(AVG(sr.rating), 0)::numeric, 1)::float AS avg_rating,
			COUNT(sr.rating)::int AS rating_count,
			CASE WHEN ${userId}::uuid IS NOT NULL
				THEN EXISTS(
					SELECT 1 FROM skill_installs si
					WHERE si.skill_id = ms.id AND si.user_id = ${userId}::uuid
				)
				ELSE NULL END AS installed
		FROM marketplace_skills ms
		LEFT JOIN users u ON u.id = ms.author_id AND u.deleted_at IS NULL
		LEFT JOIN skill_ratings sr ON sr.skill_id = ms.id
		WHERE ms.is_public = true
			${cursorCond}
			AND (${category}::text IS NULL OR ms.category = ${category})
			AND (
				${qLike}::text IS NULL
				OR ms.name ILIKE ${qLike}
				OR ms.description ILIKE ${qLike}
				OR EXISTS (SELECT 1 FROM unnest(ms.tags) t WHERE t ILIKE ${qLike})
			)
			AND (
				NOT ${installedOnly}
				OR EXISTS(
					SELECT 1 FROM skill_installs
					WHERE skill_id = ms.id AND user_id = ${userId}::uuid
				)
			)
		GROUP BY ms.id, ms.author_id, u.display_name
		ORDER BY ${orderBy}
		LIMIT ${limit + 1}
	`;

	const hasMore = rows.length > limit;
	const skills = rows.slice(0, limit).map((r) => toSkill(r, { includeInstalled: userId != null }));

	return json(res, 200, {
		skills,
		next_cursor: hasMore ? rows[limit - 1].id : null,
	});
}

async function handlePublish(req, res) {
	const auth = await resolveOptionalAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.chatUser(auth.userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(publishSchema, await readJson(req));

	let row;
	try {
		[row] = await sql`
			INSERT INTO marketplace_skills (author_id, name, slug, description, category, tags, schema_json, is_public)
			VALUES (
				${auth.userId},
				${body.name},
				${body.slug},
				${body.description},
				${body.category},
				${body.tags},
				${JSON.stringify(body.schema_json)}::jsonb,
				${body.is_public}
			)
			RETURNING *
		`;
	} catch (err) {
		if (err.code === '23505') return error(res, 409, 'conflict', 'slug already taken');
		throw err;
	}

	const [author] = await sql`SELECT id, display_name FROM users WHERE id = ${auth.userId}`;
	row.author_id = author.id;
	row.author_display_name = author.display_name;
	row.avg_rating = 0;
	row.rating_count = 0;

	return json(res, 201, { skill: toSkill(row, { includeInstalled: true, includeSchema: true }) });
}
