// GET  /api/user/provider-keys  — returns which keys are set (never returns values)
// PATCH /api/user/provider-keys  — set or clear individual provider keys
//   body: { anthropic?, openai?, grok?, meshy?, tripo?, rodin?, stability?, replicate?, elevenlabs? }
//         — each string | null
//   null = delete that key; string = store encrypted

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { cors, json, error, wrap, method, readJson, rateLimited } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { logAudit } from '../_lib/audit.js';
import { encryptProviderKey, BYOK_PROVIDERS } from '../_lib/provider-keys.js';
import { z } from 'zod';
import { parse } from '../_lib/validate.js';

const patchSchema = z.object({
	anthropic: z.string().trim().min(1).max(512).nullable().optional(),
	openai:    z.string().trim().min(1).max(512).nullable().optional(),
	grok:      z.string().trim().min(1).max(512).nullable().optional(),
	meshy:     z.string().trim().min(1).max(512).nullable().optional(),
	tripo:     z.string().trim().min(1).max(512).nullable().optional(),
	rodin:     z.string().trim().min(1).max(512).nullable().optional(),
	stability: z.string().trim().min(1).max(512).nullable().optional(),
	replicate: z.string().trim().min(1).max(512).nullable().optional(),
	elevenlabs: z.string().trim().min(1).max(512).nullable().optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PATCH,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PATCH'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') {
		const rlList = await limits.apiKeyList(session.id);
		if (!rlList.success) return rateLimited(res, rlList);
		const [row] = await sql`SELECT provider_keys FROM users WHERE id = ${session.id}`;
		const stored = row?.provider_keys || {};
		const status = {};
		for (const provider of Object.keys(BYOK_PROVIDERS)) {
			status[provider] = { set: !!stored[provider] };
		}
		return json(res, 200, { keys: status });
	}

	// PATCH — state-changing write of sensitive provider credentials; require a
	// CSRF token bound to the session, matching the other session-auth writers.
	if (!(await requireCsrf(req, res, session.id))) return;

	// Credential writes ride the same budget as API-key management.
	const rl = await limits.apiKeyManage(session.id);
	if (!rl.success) return rateLimited(res, rl);

	const body = parse(patchSchema, await readJson(req));

	const set = {};
	const cleared = [];
	for (const [provider, value] of Object.entries(body)) {
		if (!(provider in BYOK_PROVIDERS)) continue;
		if (value === null || value === undefined) cleared.push(provider);
		else set[provider] = await encryptProviderKey(value);
	}

	// One atomic merge: removals first, then sets. A read-modify-write here let
	// two concurrent PATCHes for different providers overwrite each other.
	const [row] = await sql`
		UPDATE users
		SET provider_keys = (COALESCE(provider_keys, '{}'::jsonb) - ${cleared}::text[]) || ${JSON.stringify(set)}::jsonb,
		    updated_at = NOW()
		WHERE id = ${session.id}
		RETURNING provider_keys
	`;
	if (!row) return error(res, 404, 'not_found', 'user not found');
	const current = row.provider_keys || {};

	// Provider names only, never a value or its ciphertext.
	logAudit({
		userId: session.id,
		action: 'update_provider_keys',
		meta: { set: Object.keys(set), cleared },
		req,
	});

	const status = {};
	for (const provider of Object.keys(BYOK_PROVIDERS)) {
		status[provider] = { set: !!current[provider] };
	}
	return json(res, 200, { keys: status });
});
