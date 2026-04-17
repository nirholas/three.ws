// POST /api/onboarding/link-avatar — link an avatar to the user's primary agent

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { z } from 'zod';

const bodySchema = z.object({
	avatarId: z.string().uuid(),
	force: z.boolean().default(false),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	// Auth: session OR bearer
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? bearer.userId;

	const body = parse(bodySchema, await readJson(req));

	// Verify the caller owns the avatar.
	const [avatar] = await sql`
		select id from avatars
		where id = ${body.avatarId} and owner_id = ${userId} and deleted_at is null
		limit 1
	`;
	if (!avatar) return error(res, 404, 'not_found', 'avatar not found or not owned by you');

	// Get the user's primary agent (first created).
	const [agent] = await sql`
		select id, avatar_id from agent_identities
		where user_id = ${userId} and deleted_at is null
		order by created_at asc
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'no agent identity found for user');

	// If the agent already has a different avatar, require force flag.
	if (agent.avatar_id && agent.avatar_id !== body.avatarId && !body.force) {
		return error(
			res,
			409,
			'already_linked',
			'agent already has an avatar; pass force: true to override',
			{
				current_avatar_id: agent.avatar_id,
			},
		);
	}

	// Update the agent's avatar.
	const [updated] = await sql`
		update agent_identities
		set avatar_id = ${body.avatarId}, updated_at = now()
		where id = ${agent.id}
		returning id, avatar_id, updated_at
	`;

	return json(res, 200, { agent: updated });
});
