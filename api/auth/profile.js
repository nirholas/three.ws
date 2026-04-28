import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { parse, username as usernameValidator, displayName } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { z } from 'zod';

const bodySchema = z
	.object({
		username: usernameValidator.optional(),
		display_name: displayName.optional(),
	})
	.refine((b) => b.username !== undefined || b.display_name !== undefined, {
		message: 'at least one field required',
	});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'PATCH,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['PATCH'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthenticated', 'not signed in');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	if (body.username) {
		const taken = await sql`
			select id from users
			where lower(username) = ${body.username.toLowerCase()} and id != ${user.id} and deleted_at is null
			limit 1
		`;
		if (taken[0]) return error(res, 409, 'conflict', 'username already taken');
	}

	const [updated] = await sql`
		update users set
			username     = coalesce(${body.username ?? null}, username),
			display_name = coalesce(${body.display_name ?? null}, display_name),
			updated_at   = now()
		where id = ${user.id} and deleted_at is null
		returning id, display_name, username
	`;

	return json(res, 200, { user: updated });
});
