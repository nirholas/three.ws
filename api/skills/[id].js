import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, error, method, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const updateSchema = z.object({
	name: z.string().trim().min(2).max(80).optional(),
	description: z.string().trim().max(500).optional(),
	tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
	is_public: z.boolean().optional(),
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
		.min(1)
		.optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PUT,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT', 'DELETE'])) return;

	const id = req.query?.id;
	if (!id || !UUID_RE.test(id)) return error(res, 404, 'not_found', 'skill not found');

	if (req.method === 'GET') return handleGet(req, res, id);
	if (req.method === 'PUT') return handleUpdate(req, res, id);
	return handleDelete(req, res, id);
});

async function resolveOptionalAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, plan: session.plan };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId, plan: null };
	return null;
}

function toSkill(row, { includeInstalled = false } = {}) {
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
		schema_json: row.schema_json,
		author: row.author_id
			? { id: row.author_id, display_name: row.author_display_name }
			: null,
		created_at: row.created_at,
	};
	if (includeInstalled) skill.installed = !!row.installed;
	return skill;
}

async function handleGet(req, res, id) {
	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const auth = await resolveOptionalAuth(req);
	const userId = auth?.userId ?? null;

	const [row] = await sql`
		SELECT
			ms.*,
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
		WHERE ms.id = ${id} AND ms.is_public = true
		GROUP BY ms.id, ms.author_id, u.display_name
	`;

	if (!row) return error(res, 404, 'not_found', 'skill not found');

	return json(res, 200, { skill: toSkill(row, { includeInstalled: userId != null }) });
}

async function handleUpdate(req, res, id) {
	const auth = await resolveOptionalAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.chatUser(auth.userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [skill] = await sql`
		SELECT id, author_id FROM marketplace_skills WHERE id = ${id}
	`;
	if (!skill) return error(res, 404, 'not_found', 'skill not found');

	if (skill.author_id !== auth.userId) {
		// Fallback: check admin status via DB (handles bearer auth where plan isn't cached)
		const [u] = await sql`SELECT plan FROM users WHERE id = ${auth.userId} AND deleted_at IS NULL`;
		if (u?.plan !== 'admin') return error(res, 403, 'forbidden', 'not your skill');
	}

	const body = parse(updateSchema, await readJson(req));
	if (Object.keys(body).length === 0) {
		return error(res, 400, 'validation_error', 'no fields to update');
	}

	const updates = [];
	if (body.name !== undefined) updates.push(sql`name = ${body.name}`);
	if (body.description !== undefined) updates.push(sql`description = ${body.description}`);
	if (body.tags !== undefined) updates.push(sql`tags = ${body.tags}`);
	if (body.is_public !== undefined) updates.push(sql`is_public = ${body.is_public}`);
	if (body.schema_json !== undefined)
		updates.push(sql`schema_json = ${JSON.stringify(body.schema_json)}::jsonb`);
	updates.push(sql`updated_at = now()`);

	const setClauses = updates.reduce((acc, frag) => sql`${acc}, ${frag}`);

	const [updated] = await sql`
		UPDATE marketplace_skills SET ${setClauses} WHERE id = ${id} RETURNING *
	`;

	const [author] = updated.author_id
		? await sql`SELECT id, display_name FROM users WHERE id = ${updated.author_id}`
		: [null];
	updated.author_display_name = author?.display_name ?? null;
	updated.avg_rating = 0;
	updated.rating_count = 0;

	return json(res, 200, { skill: toSkill(updated) });
}

async function handleDelete(req, res, id) {
	const auth = await resolveOptionalAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.chatUser(auth.userId);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [skill] = await sql`
		SELECT id, author_id FROM marketplace_skills WHERE id = ${id}
	`;
	if (!skill) return error(res, 404, 'not_found', 'skill not found');
	if (skill.author_id !== auth.userId) return error(res, 403, 'forbidden', 'not your skill');

	// skill_installs and skill_ratings cascade-delete on marketplace_skills delete
	await sql`DELETE FROM marketplace_skills WHERE id = ${id}`;

	res.statusCode = 204;
	res.end();
}
