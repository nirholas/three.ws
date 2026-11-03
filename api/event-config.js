// GET /api/event-config   the effective live-event document
// POST /api/event-config  operator override (admin session or OPS_SECRET)
//
// GET returns public/event.json with the live override (api/_lib/event-override.js)
// merged over it. The browser and the game server read this first and fall back to
// the static /event.json, so the event window can be extended, renamed or ended
// without a deploy.
//
// POST body, one of:
//   { startsAt?, endsAt?, name?, tagline?, link? }   patch the current event
//   { end: true }                                    end it now (cancel if not started)
//   { clear: true }                                  drop the override; the file governs again
// Validated with the same rules that gate the deploy (validateEventConfig). Auth is
// strict in every environment: an admin session, or `x-ops-secret: $OPS_SECRET`
// (scripts/event-override.mjs). Every write is audit-logged with before and after.

import { cors, json, method, wrap, error, readJson, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { authorizeOps } from './_lib/ops-auth.js';
import { logAuditNow } from './_lib/audit.js';
import { staticEventDoc, effectiveEventDoc, refreshEventOverride, invalidateEventOverride } from './_lib/event-config.js';
import {
	buildOverride, loadOverrideRow, saveOverrideRow, clearOverrideRow,
} from './_lib/event-override.js';

async function currentView() {
	await refreshEventOverride();
	const { doc, override, applied, ignoredReason } = effectiveEventDoc();
	return { doc, override, applied, ignoredReason };
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'GET') {
		const rl = await limits.publicIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		const { doc } = await currentView();
		if (!doc) return error(res, 503, 'event_config_unavailable', 'the event config could not be read');
		return json(res, 200, doc, { 'cache-control': 'public, max-age=15' });
	}

	const auth = await authorizeOps(req);
	if (!auth.ok || auth.actor === 'dev') {
		return error(res, 401, 'unauthorized', 'an admin session or the ops secret is required');
	}

	let input;
	try {
		input = await readJson(req, 16_000);
	} catch {
		return error(res, 400, 'invalid_json', 'request body must be valid JSON');
	}

	const staticDoc = staticEventDoc();
	let current;
	try {
		current = await loadOverrideRow();
	} catch (err) {
		return error(res, 503, 'override_store_unavailable', `could not read the stored override: ${err?.message || err}`);
	}

	const built = buildOverride({ staticDoc, current, input, now: Date.now() });
	if (!built.ok) return error(res, 422, 'invalid_override', built.failures.join('; '), { failures: built.failures });

	try {
		if (built.clear) await clearOverrideRow();
		else await saveOverrideRow(built.value, auth.actor);
	} catch (err) {
		return error(res, 503, 'override_store_unavailable', `could not store the override: ${err?.message || err}`);
	}

	await logAuditNow({
		userId: null,
		action: 'event_override',
		resourceId: staticDoc?.id || null,
		meta: { actor: auth.actor, before: current, after: built.clear ? null : built.value },
		req,
	});

	// Make this instance serve the new window immediately; the others converge
	// within the 15 s refresh.
	invalidateEventOverride();
	await refreshEventOverride();
	return json(res, 200, { ok: true, cleared: built.clear, effective: built.doc });
});
