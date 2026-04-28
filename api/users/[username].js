import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { publicUrl } from '../_lib/r2.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const username = (req.query.username || '').toLowerCase().trim();
	if (!username || !/^[a-z0-9_-]{3,30}$/.test(username)) {
		return error(res, 400, 'validation_error', 'invalid username');
	}

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [user] = await sql`
		select id, display_name, username, created_at
		from users
		where lower(username) = ${username} and deleted_at is null
		limit 1
	`;
	if (!user) return error(res, 404, 'not_found', 'user not found');

	const avatarRows = await sql`
		select id, name, description, thumbnail_key, tags, created_at
		from avatars
		where owner_id = ${user.id} and visibility = 'public' and deleted_at is null
		order by created_at desc
		limit 48
	`;

	const avatars = avatarRows.map((a) => ({
		id: a.id,
		name: a.name,
		description: a.description,
		thumbnail_url: a.thumbnail_key ? publicUrl(a.thumbnail_key) : null,
		tags: a.tags || [],
		created_at: a.created_at,
	}));

	res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
	return json(res, 200, {
		user: {
			username: user.username,
			display_name: user.display_name || user.username,
		},
		avatars,
	});
});
