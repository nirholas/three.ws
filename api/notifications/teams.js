// Microsoft Teams row of the notification settings.
//
//   GET    /api/notifications/teams
//     → { configured, linked: [...], events: [{ type, label, enabled }] }
//   POST   /api/notifications/teams  { action: 'link-code' }
//     → { code, display, expires_in }   the code to type to the bot: link <code>
//   POST   /api/notifications/teams  { action: 'test' }
//     → { results: [{ tenant_id, ok, code? , consent_url? }] }  a real notification
//   PUT    /api/notifications/teams  { events: { forgeJobCompleted: false, ... } }
//   DELETE /api/notifications/teams  unlink every Teams identity from this account
//
// Delivery itself is the `teams` leg of the fan-out (api/_lib/notify.js ->
// api/_lib/teams-activity.js).

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { getRequestUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../_lib/http.js';
import { requireCsrf } from '../_lib/csrf.js';
import { limits } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { readStoredPrefs } from '../_lib/notify-prefs.js';
import { ACTIVITY_TYPES, activityConfigured, adminConsentUrl, resolveEventPrefs, sendActivityNotification } from '../_lib/teams-activity.js';
import { createLinkCode, identitiesForUser, recordFailure, recordSent, unlinkUser } from '../_lib/teams-identity.js';

const putBody = z.object({
	events: z.record(z.boolean()).refine((e) => Object.keys(e).every((k) => ACTIVITY_TYPES.some((a) => a.type === k)), 'unknown event type'),
});
const postBody = z.object({ action: z.enum(['link-code', 'test']) });

const CONSENT_CODES = new Set(['consent_missing', 'token_failed']);

function present(row) {
	return {
		tenant_id: row.tenant_id,
		installed: row.installed,
		linked_at: row.linked_at,
		last_sent_at: row.last_sent_at,
		last_error_code: row.last_error_code,
		consent_url: CONSENT_CODES.has(row.last_error_code) ? adminConsentUrl(row.tenant_id) : null,
	};
}

async function state(userId) {
	const [rows, stored] = await Promise.all([identitiesForUser(userId), readStoredPrefs(userId)]);
	const enabled = resolveEventPrefs(stored);
	return {
		configured: activityConfigured(),
		linked: rows.map(present),
		events: ACTIVITY_TYPES.map((a) => ({ type: a.type, label: a.label, enabled: enabled[a.type] })),
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,PUT,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'PUT', 'DELETE'])) return;

	const user = await getRequestUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	if (req.method === 'GET') return json(res, 200, await state(user.id), { 'cache-control': 'no-store' });

	if (!(await requireCsrf(req, res, user.id))) return;
	const rl = await limits.notifPrefsWrite(user.id);
	if (!rl.success) return rateLimited(res, rl);

	if (req.method === 'DELETE') {
		await unlinkUser(user.id);
		return json(res, 200, { ok: true, ...(await state(user.id)) });
	}

	if (req.method === 'PUT') {
		const { events } = parse(putBody, await readJson(req));
		const stored = await readStoredPrefs(user.id);
		const next = { ...stored, teams: { events: { ...(stored.teams?.events || {}), ...events } } };
		await sql`
			insert into notification_preferences (user_id, prefs, updated_at)
			values (${user.id}, ${JSON.stringify(next)}::jsonb, now())
			on conflict (user_id) do update set prefs = ${JSON.stringify(next)}::jsonb, updated_at = now()
		`;
		return json(res, 200, { ok: true, ...(await state(user.id)) });
	}

	const { action } = parse(postBody, await readJson(req));
	if (action === 'link-code') {
		const c = await createLinkCode(user.id);
		return json(res, 200, { code: c.code, display: c.display, expires_in: c.expiresInSeconds }, { 'cache-control': 'no-store' });
	}

	if (!activityConfigured()) return error(res, 503, 'not_configured', 'Teams notifications are not configured on this server yet.');
	const targets = (await identitiesForUser(user.id)).filter((i) => i.installed);
	if (!targets.length) return error(res, 409, 'not_linked', 'Link a Teams account first: send the bot "link <code>" in Teams.');
	const results = [];
	for (const t of targets) {
		const identity = { tenantId: t.tenant_id, aadObjectId: t.aad_object_id };
		try {
			await sendActivityNotification({
				...identity,
				activityType: 'agentTaskCompleted',
				topic: 'three.ws test',
				params: { agent: 'three.ws', summary: 'This is a test notification' },
				preview: 'This is a test notification from three.ws',
			});
			await recordSent(identity);
			results.push({ tenant_id: t.tenant_id, ok: true });
		} catch (err) {
			const code = err?.code || 'rejected';
			if (!err?.retryable) await recordFailure(identity, code).catch(() => {});
			results.push({ tenant_id: t.tenant_id, ok: false, code, message: err?.message, consent_url: CONSENT_CODES.has(code) ? adminConsentUrl(t.tenant_id) : null });
		}
	}
	return json(res, results.every((r) => r.ok) ? 200 : 502, { results });
});
