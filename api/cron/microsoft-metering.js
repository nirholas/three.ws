// @ts-check
// GET /api/cron/microsoft-metering: report metered usage for Microsoft
// Marketplace SaaS subscriptions to the Marketplace Metering API.
//
// Every hour, for each Subscribed subscription linked to a three.ws account:
//
//   1. Work out the completed hours not yet metered (hoursToMeter: the hour
//      after metered_through, or the activation hour, up to the last full hour,
//      never further back than Microsoft's 24 hour acceptance window).
//   2. Count the linked account's real usage_events in each of those hours for
//      every dimension in data/microsoft-marketplace.json (status 'ok' only;
//      a failed tool call or completion is never billed).
//   3. Store one microsoft_saas_usage_events row per subscription, dimension
//      and hour. The unique key matches Microsoft's own duplicate rule, so a
//      rerun never double counts.
//   4. Post every pending row in batches of 25 and settle each one from
//      Microsoft's per-event verdict (Accepted / Duplicate are final successes,
//      Expired is final, anything else is rejected with Microsoft's message).
//
// metered_through advances only after the hour's rows are stored, so a crash
// between steps resumes from the same hour. Pending rows that failed to post
// (a network error, a 5xx) stay pending and are retried on the next tick while
// they are inside the acceptance window; older ones are settled as expired.
//
// Microsoft subtracts each plan's included quantity itself, so the raw count
// is what gets reported.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import {
	DIMENSIONS, METERING_BATCH_MAX, METERING_LOOKBACK_HOURS,
	publisherConfig, hoursToMeter, settleUsageStatus, chunk, postUsageBatch,
} from '../_lib/microsoft-marketplace.js';

const HOUR_MS = 3_600_000;
const SUBSCRIPTIONS_PER_TICK = 200;

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	if (!publisherConfig()) {
		return json(res, 200, { ok: true, skipped: 'not_configured', detail: 'MS_MARKETPLACE_TENANT_ID, MS_MARKETPLACE_CLIENT_ID and MS_MARKETPLACE_CLIENT_SECRET are not set' });
	}

	const now = new Date();
	const recorded = await recordUsage(now);
	const posted = await postPending(now);
	if (posted.rejected > 0) {
		await sendOpsAlert(
			'Microsoft Marketplace metering: usage rejected',
			`${posted.rejected} usage event(s) were rejected by the Metering API this hour. First reason: ${posted.firstRejection}. ` +
			'Check that each dimension id in data/microsoft-marketplace.json is declared on the plan in Partner Center.',
			{ signature: 'microsoft-metering-rejected' },
		);
	}
	return json(res, 200, { ok: true, ...recorded, ...posted });
});

/** Step 1 to 3: turn usage_events into pending Metering API rows. */
async function recordUsage(now) {
	const subs = await sql`
		select id, user_id, plan_id, activated_at, metered_through
		from microsoft_saas_subscriptions
		where saas_status = 'Subscribed' and user_id is not null
		order by metered_through asc nulls first
		limit ${SUBSCRIPTIONS_PER_TICK}
	`;
	let rows = 0;
	let hoursCovered = 0;
	for (const sub of subs) {
		const hours = hoursToMeter({ meteredThrough: sub.metered_through, activatedAt: sub.activated_at, now });
		if (!hours.length) continue;
		const from = hours[0];
		const to = new Date(hours[hours.length - 1].getTime() + HOUR_MS);
		const kinds = DIMENSIONS.map((d) => d.usage_kind);
		const counts = await sql`
			select kind, date_trunc('hour', created_at) as hour, count(*)::int as n
			from usage_events
			where user_id = ${sub.user_id} and status = 'ok'
			  and kind = any(${kinds}::text[]) and created_at >= ${from} and created_at < ${to}
			group by kind, date_trunc('hour', created_at)
		`;
		for (const c of counts) {
			if (!c.n) continue;
			for (const dim of DIMENSIONS.filter((d) => d.usage_kind === c.kind)) {
				const inserted = await sql`
					insert into microsoft_saas_usage_events (subscription_id, plan_id, dimension, effective_start_time, quantity)
					values (${sub.id}, ${sub.plan_id}, ${dim.id}, ${new Date(c.hour)}, ${c.n})
					on conflict (subscription_id, dimension, effective_start_time) do nothing
					returning id
				`;
				rows += inserted.length;
			}
		}
		const last = hours[hours.length - 1];
		await sql`update microsoft_saas_subscriptions set metered_through = ${last}, updated_at = now() where id = ${sub.id}`;
		hoursCovered += hours.length;
	}
	return { subscriptions: subs.length, hours: hoursCovered, recorded: rows };
}

/** Step 4: post pending rows to Microsoft and settle them. */
async function postPending(now) {
	const cutoff = new Date(now.getTime() - (METERING_LOOKBACK_HOURS + 1) * HOUR_MS);
	const stale = await sql`
		update microsoft_saas_usage_events
		set status = 'expired', message = 'not accepted by Microsoft inside the 24 hour window', updated_at = now()
		where status = 'pending' and effective_start_time < ${cutoff}
		returning id
	`;
	const pending = await sql`
		select id, subscription_id, plan_id, dimension, effective_start_time, quantity
		from microsoft_saas_usage_events
		where status = 'pending'
		order by effective_start_time asc
		limit ${METERING_BATCH_MAX * 40}
	`;
	const tally = { posted: 0, accepted: 0, rejected: 0, expired: stale.length, failed_batches: 0, firstRejection: null };
	for (const batch of chunk(pending, METERING_BATCH_MAX)) {
		const events = batch.map((r) => ({
			resourceId: r.subscription_id,
			quantity: Number(r.quantity),
			dimension: r.dimension,
			effectiveStartTime: new Date(r.effective_start_time).toISOString(),
			planId: r.plan_id,
		}));
		let response;
		try {
			response = await postUsageBatch(events);
		} catch (err) {
			// Left pending: the next tick retries while the hour is still accepted.
			tally.failed_batches += 1;
			const ids = batch.map((r) => r.id);
			await sql`
				update microsoft_saas_usage_events
				set attempts = attempts + 1, message = ${String(err?.message || err).slice(0, 500)}, updated_at = now()
				where id = any(${ids}::uuid[])
			`;
			continue;
		}
		tally.posted += batch.length;
		const results = Array.isArray(response?.result) ? response.result : [];
		for (const row of batch) {
			const hit = results.find((r) =>
				r.resourceId === row.subscription_id && r.dimension === row.dimension &&
				new Date(r.effectiveStartTime).getTime() === new Date(row.effective_start_time).getTime());
			const settled = hit ? settleUsageStatus(hit.status) : 'rejected';
			const message = hit ? (hit.error?.message || hit.status) : 'Microsoft returned no result for this event';
			if (settled === 'accepted') tally.accepted += 1;
			else if (settled === 'expired') tally.expired += 1;
			else {
				tally.rejected += 1;
				tally.firstRejection ??= message;
			}
			await sql`
				update microsoft_saas_usage_events
				set status = ${settled}, usage_event_id = ${hit?.usageEventId ?? null}, message = ${message},
				    attempts = attempts + 1, updated_at = now()
				where id = ${row.id}
			`;
		}
	}
	return tally;
}
