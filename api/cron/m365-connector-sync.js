// Microsoft 365 Copilot connector sync. Every 15 minutes (vercel.json crons):
//
//   1. Poll each connection whose Graph schema operation is still running and
//      flip it to ready when Microsoft finishes (5 to 15 minutes after connect).
//   2. Run an incremental sync for every ready connection that is not backing
//      off from a throttle: delete items that left three.ws, push items that
//      changed since the cursor. Each run stops at a time budget and the next
//      one resumes from the stored cursor.
//
// Skips cleanly when the deployment has no Entra app configured.
// Library: api/_lib/m365-connector.js. Docs: docs/microsoft-365-copilot-connector.md.

import { sql } from '../_lib/db.js';
import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { connectorAppConfig, missingConnectorConfig, pollSchema, runSync } from '../_lib/m365-connector.js';

const BUDGET_MS = 100_000;

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	if (!connectorAppConfig()) return json(res, 200, { ok: true, skipped: 'not_configured', detail: `missing ${missingConnectorConfig().join(', ')}` });

	const deadline = Date.now() + BUDGET_MS;
	const pending = await sql`select user_id from m365_connections where status = 'schema_pending' order by updated_at limit 50`;
	const schema = {};
	for (const { user_id } of pending) {
		if (Date.now() > deadline) break;
		const s = await pollSchema(user_id);
		schema[s] = (schema[s] || 0) + 1;
	}

	const due = await sql`
		select user_id from m365_connections
		where status = 'ready' and (next_attempt_at is null or next_attempt_at <= now())
		order by last_sync_at nulls first
		limit 200
	`;
	const totals = { accounts: 0, upserted: 0, deleted: 0, unchanged: 0, incomplete: 0, errors: 0 };
	for (const { user_id } of due) {
		if (Date.now() > deadline) break;
		const r = await runSync(user_id, { deadline });
		if (r.skipped) continue;
		totals.accounts++;
		totals.upserted += r.upserted;
		totals.deleted += r.deleted;
		totals.unchanged += r.unchanged;
		if (!r.complete) totals.incomplete++;
		if (r.error) totals.errors++;
	}
	return json(res, 200, { ok: true, schemaPolled: pending.length, schema, due: due.length, ...totals });
});
