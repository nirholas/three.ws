// GET/POST /api/cron/domain-renewals - pay for upcoming domain renewals from credits.
//
// Google bills the GCP project when an AUTOMATIC_RENEWAL registration renews, so
// the owner's credits must cover that charge first. Daily, for every active
// registration with auto_renew whose paid year ends within RENEW_WINDOW_DAYS:
//   1. read the registrar's expireTime, so a registration that already renewed
//      advances its own expires_at and is not charged twice;
//   2. debit the yearly price from the owner's credits, idempotent per term
//      (key domain:renew:<id>:<expiry date>), and note it on the row;
//   3. if credits are short, switch the registration to MANUAL_RENEWAL at the
//      registrar, turn auto_renew off, and write renewal_note, so the platform
//      never absorbs a renewal nobody paid for. The owner re-enables it on /domains.
//
// Auth: the shared cron gate (api/_lib/cron-auth.js).

import { sql } from '../_lib/db.js';
import { debitCredits } from '../_lib/credits.js';
import { getRegistration, setRenewalMethod } from '../_lib/cloud-domains.js';
import { cors, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { logger } from '../_lib/usage.js';

export const maxDuration = 60;

const RENEW_WINDOW_DAYS = 14;
const BATCH_LIMIT = 50;
const log = logger('domain-renewals');

async function renewOne(row) {
	const reg = await getRegistration(row.domain_name);
	const registrarExpiry = reg?.expireTime ? new Date(reg.expireTime) : null;
	if (registrarExpiry && registrarExpiry.getTime() > new Date(row.expires_at).getTime() + 30 * 86400_000) {
		await sql`update web_domain_registrations set expires_at = ${registrarExpiry.toISOString()}, renewal_note = null, updated_at = now() where id = ${row.id}`;
		return 'already_renewed';
	}
	const term = new Date(row.expires_at).toISOString().slice(0, 10);
	try {
		await debitCredits({
			userId: row.user_id,
			amountUsd: Number(row.price_usd),
			action: 'domain_renewal',
			refType: 'web_domain_registration',
			refId: row.id,
			idempotencyKey: `domain:renew:${row.id}:${term}`,
			meta: { domain: row.domain_name, term },
		});
	} catch (err) {
		if (err.code !== 'insufficient_credits') throw err;
		await setRenewalMethod(row.domain_name, 'MANUAL_RENEWAL');
		await sql`
			update web_domain_registrations
			set auto_renew = false, updated_at = now(),
				renewal_note = ${`Credits were short for the ${term} renewal ($${Number(row.price_usd).toFixed(2)}), so auto-renew was switched off and the name will lapse unless renewed.`}
			where id = ${row.id}`;
		return 'switched_to_manual';
	}
	await sql`
		update web_domain_registrations
		set renewal_note = ${`Renewal for the term ending ${term} was paid from credits ($${Number(row.price_usd).toFixed(2)}).`}, updated_at = now()
		where id = ${row.id}`;
	return 'paid';
}

export default wrapCron(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const due = await sql`
		select * from web_domain_registrations
		where status = 'active' and auto_renew
			and expires_at is not null
			and expires_at < now() + make_interval(days => ${RENEW_WINDOW_DAYS})
		order by expires_at
		limit ${BATCH_LIMIT}`;

	const counts = { paid: 0, switched_to_manual: 0, already_renewed: 0, failed: 0 };
	for (const row of due) {
		try {
			counts[await renewOne(row)]++;
		} catch (err) {
			counts.failed++;
			log.error('renewal_failed', { domain: row.domain_name, error: err.message });
		}
	}
	return json(res, 200, { checked: due.length, ...counts });
});
