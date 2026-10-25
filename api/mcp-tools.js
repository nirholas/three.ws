// Tool-group settings behind /settings/mcp-tools.
//
//   GET /api/mcp-tools
//     → { groups: [{ id, label, summary }], account: { <group id>: boolean }, key: null }
//        every group the policy knows, and the account's saved choices. A group
//        absent from `account` follows the tier default (read and write tools
//        on, financial tools off).
//   PUT /api/mcp-tools   { groups: { <group id>: boolean | null } }
//     → merge a sparse change onto the account-wide row in mcp_tool_settings.
//       true turns the whole group on (financial tools included), false turns
//       it off, null returns it to the default. Unknown group ids are a 400.
//
// api/_mcp/policy.js reads the row on every tools/list and tools/call, so a
// save drops that module's memo (invalidateToolSettings) to take effect now.

import { z } from 'zod';
import { GROUPS, GROUP_IDS } from '@three-ws/mcp-policy';
import { sql } from './_lib/db.js';
import { getRequestUser } from './_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from './_lib/http.js';
import { requireCsrf } from './_lib/csrf.js';
import { limits } from './_lib/rate-limit.js';
import { parse } from './_lib/validate.js';
import { loadToolSettings, invalidateToolSettings } from './_mcp/policy.js';

const putBody = z.object({
	// A record keyed by an enum demands every key, so check the ids by hand: a
	// sparse change must be accepted and an unknown id must be refused.
	groups: z.record(z.string(), z.boolean().nullable()).superRefine((groups, ctx) => {
		for (const id of Object.keys(groups)) {
			if (!GROUP_IDS.includes(id)) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, path: [id], message: `unknown tool group "${id}"` });
			}
		}
	}),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PUT,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT'])) return;

	const user = await getRequestUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to manage tool settings');

	if (req.method === 'GET') {
		const { account } = await loadToolSettings(user.id);
		return json(res, 200, { groups: GROUPS, account: account?.groups ?? {}, key: null }, { 'cache-control': 'no-store' });
	}

	if (!(await requireCsrf(req, res, user.id))) return;
	const rl = await limits.notifPrefsWrite(user.id);
	if (!rl.success) return rateLimited(res, rl);

	const { groups } = parse(putBody, await readJson(req));

	// Read the stored row directly: the policy memo can be up to 15 seconds old
	// and a merge onto a stale copy would drop a change saved moments ago.
	const [row] = await sql`
		SELECT settings FROM mcp_tool_settings
		WHERE user_id = ${user.id} AND api_key_id IS NULL
	`;
	const stored = row?.settings && typeof row.settings === 'object' ? row.settings : {};
	const merged = { ...(stored.groups || {}) };
	for (const [id, on] of Object.entries(groups)) {
		if (on === null) delete merged[id];
		else merged[id] = on;
	}
	const next = { ...stored, groups: merged };

	await sql`
		INSERT INTO mcp_tool_settings (user_id, api_key_id, settings, updated_at)
		VALUES (${user.id}, NULL, ${JSON.stringify(next)}::jsonb, now())
		ON CONFLICT (user_id) WHERE api_key_id IS NULL DO UPDATE SET
			settings = EXCLUDED.settings,
			updated_at = now()
	`;
	invalidateToolSettings(user.id);

	return json(res, 200, { ok: true, account: merged });
});
