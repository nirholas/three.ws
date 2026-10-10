// GET /api/cron/webhook-deliveries: the per-minute driver for developer webhooks.
//
// Two jobs, in order:
//   1. Raise approval.needed for every pending approval request (api/_lib/approvals.js)
//      whose owner has an endpoint subscribed to it. The event id is derived
//      from the request id and webhook_deliveries is unique per (endpoint,
//      event), so a request seen on many sweeps is still delivered once per
//      endpoint. The payload links to the signed-in approval page, never to the
//      signed one-tap link: a receiver must not be able to approve.
//   2. sweepWebhookDeliveries posts every delivery whose retry is due and
//      reclaims rows a dead worker left leased (api/_lib/webhook-dispatch.js).
//
// Events raised inline (run.finished, automation.fired, message.received) get
// their first attempt immediately; this cron owns every retry after that.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import { env } from '../_lib/env.js';
import { dispatchWebhooks, sweepWebhookDeliveries } from '../_lib/webhook-dispatch.js';
import { publicApproval } from '../_lib/approvals.js';

const SWEEP_DEADLINE_MS = 45_000;
// Approvals older than this were either decided or announced on an earlier sweep.
const APPROVAL_LOOKBACK = '2 hours';

async function announceApprovals() {
	const rows = await sql`
		SELECT r.*, a.name AS agent_name
		FROM approval_requests r
		LEFT JOIN agent_identities a ON a.id = r.agent_id
		WHERE r.status = 'pending'
		  AND r.expires_at > now()
		  AND r.created_at > now() - ${APPROVAL_LOOKBACK}::interval
		  AND EXISTS (
		    SELECT 1 FROM developer_webhooks w
		    WHERE w.user_id = r.user_id AND w.active = true
		      AND (w.events @> ARRAY['approval.needed']::text[] OR cardinality(w.events) = 0)
		      AND (w.agent_id IS NULL OR w.agent_id = r.agent_id)
		  )
		ORDER BY r.created_at ASC
		LIMIT 200
	`;
	let queued = 0;
	for (const row of rows) {
		const approval = publicApproval(row, { withLink: false });
		const ids = await dispatchWebhooks({
			userId: row.user_id,
			agentId: row.agent_id,
			eventType: 'approval.needed',
			eventId: `evt_approval_${row.id}`,
			data: { ...approval, agent_id: row.agent_id, url: `${env.APP_ORIGIN}${approval.link}` },
		});
		queued += ids.length;
	}
	return { pending: rows.length, queued };
}

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const startedAt = Date.now();
	let approvals;
	try {
		approvals = await announceApprovals();
	} catch (err) {
		console.error('[webhook-deliveries] approval scan failed', err);
		approvals = { error: String(err?.message || err).slice(0, 200) };
	}
	const deliveries = await sweepWebhookDeliveries({ deadlineMs: SWEEP_DEADLINE_MS });
	const ms = Date.now() - startedAt;
	console.info(`[webhook-deliveries] done in ${ms}ms`, { approvals, deliveries });
	return json(res, 200, { data: { approvals, deliveries, took_ms: ms } });
});
