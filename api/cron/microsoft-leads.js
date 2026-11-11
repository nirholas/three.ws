// @ts-check
// GET /api/cron/microsoft-leads: finish and age out Microsoft Marketplace leads.
//
// The lead endpoint (api/microsoft-marketplace/leads.js) stores a lead first and
// then notifies the owner and drafts the reply inside the same request. Either
// step can be cut short (an instance stops, every LLM lane is busy), so every
// ten minutes this job:
//
//   1. notifies the owner about any lead older than two minutes that never
//      reached a channel;
//   2. drafts replies still pending, and retries failed ones, up to
//      MAX_DRAFT_ATTEMPTS per lead;
//   3. applies the retention rule (redactExpiredLeads).

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import { notifyOwner, draftReply, redactExpiredLeads, MAX_DRAFT_ATTEMPTS } from '../_lib/microsoft-leads.js';

const NOTIFY_PER_TICK = 20;
// Four drafts at the 20s draft timeout stay well inside the 120s cron budget.
const DRAFTS_PER_TICK = 4;

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const unnotified = await sql`
		select * from microsoft_marketplace_leads
		where notified_at is null and redacted_at is null and received_at < now() - interval '2 minutes'
		order by received_at
		limit ${NOTIFY_PER_TICK}
	`;
	let notified = 0;
	for (const row of unnotified) {
		const r = await notifyOwner(row).catch((err) => ({ delivered: false, error: err?.message }));
		if (r.delivered) notified += 1;
	}

	const undrafted = await sql`
		select * from microsoft_marketplace_leads
		where draft_status in ('pending', 'failed') and draft_attempts < ${MAX_DRAFT_ATTEMPTS}
			and redacted_at is null
			and coalesce(draft_updated_at, received_at) < now() - interval '2 minutes'
		order by received_at
		limit ${DRAFTS_PER_TICK}
	`;
	let drafted = 0;
	for (const row of undrafted) {
		const r = await draftReply(row);
		if (r?.draft_status === 'ready') drafted += 1;
	}

	const redacted = await redactExpiredLeads();
	return json(res, 200, { ok: true, notified, notify_candidates: unnotified.length, drafted, draft_candidates: undrafted.length, redacted });
});
