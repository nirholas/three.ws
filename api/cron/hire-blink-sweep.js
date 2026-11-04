// GET/POST /api/cron/hire-blink-sweep: settle or close open hire-Blink checkouts.
//
// A wallet that hires an agent through the Blink (api/actions/agent-hire.js)
// signs the payment in its own wallet, and the client then calls the confirm
// callback. That callback is best effort: the wallet can close, the client can
// skip links.next, or the payment can still be confirming when it arrives. This
// sweep is what guarantees a paid hire is always delivered and an unpaid one is
// always closed:
//
//   - pending, payment found by its Solana Pay reference  -> verify, run the
//     offer, record completed (or failed with the payment noted)
//   - pending, no payment, older than BLINK_HIRE_TTL_MS    -> expired (no money
//     moved, so it never counts against the provider)
//   - pending, a payment carrying the reference that does
//     not match the hire, past the TTL                     -> expired, with the
//     mismatched transaction kept on the row for the owner to review
//
// settleBlinkHire claims a row before running it, so this sweep and a late
// confirm callback can never run the same offer twice. Rows are handled one at
// a time, and the tick stops picking up new rows once its time budget is spent;
// the rest are picked up next tick.
//
// Auth: the shared, fail-closed cron gate (api/_lib/cron-auth.js).

import { cors, json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { listOpenBlinkHires, updateHire } from '../_lib/agent-economy.js';
import { BLINK_HIRE_TTL_MS, expireBlinkHire, locateHirePayment, settleBlinkHire } from '../_lib/hire-blink.js';

export const maxDuration = 120;

// Leave headroom under the 120s budget for the hire in flight to finish: an
// offer call can take up to two upstream attempts.
const TICK_BUDGET_MS = 80_000;
// Give the confirm callback the first minute before the sweep competes for a row.
const MIN_AGE_SECONDS = 60;
const BATCH_LIMIT = 50;

export async function sweepBlinkHires({ now = Date.now, budgetMs = TICK_BUDGET_MS } = {}) {
	const started = now();
	const rows = await listOpenBlinkHires({ olderThanSeconds: MIN_AGE_SECONDS, limit: BATCH_LIMIT });
	const counts = { scanned: rows.length, completed: 0, failed: 0, expired: 0, confirming: 0, busy: 0, mismatched: 0, errors: 0, deferred: 0 };

	for (const hire of rows) {
		if (now() - started > budgetMs) {
			counts.deferred++;
			continue;
		}
		const expiredWindow = now() - new Date(hire.created_at).getTime() > BLINK_HIRE_TTL_MS;
		try {
			const signature = await locateHirePayment(hire);
			if (!signature) {
				if (expiredWindow) {
					await expireBlinkHire(hire);
					counts.expired++;
				} else {
					counts.confirming++;
				}
				continue;
			}

			const outcome = await settleBlinkHire(hire, { signature });
			if (outcome.state === 'mismatch') {
				counts.mismatched++;
				if (expiredWindow) {
					await updateHire(hire.id, {
						status: 'expired',
						error: `a payment carrying this hire's reference does not match it (${outcome.reason})`.slice(0, 500),
						meta: { expired_at: new Date(now()).toISOString(), mismatch_signature: signature },
					});
					counts.expired++;
				}
				continue;
			}
			if (outcome.state in counts) counts[outcome.state]++;
		} catch (err) {
			counts.errors++;
			console.warn(`[hire-blink-sweep] hire ${hire.id}: ${err?.message || err}`);
		}
	}

	return { ...counts, ms: now() - started };
}

export default wrapCron(
	async (req, res) => {
		if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
		if (!method(req, res, ['GET', 'POST'])) return;
		if (!requireCron(req, res)) return;
		const result = await sweepBlinkHires();
		return json(res, 200, { ok: true, ...result });
	},
	{ maxDurationMs: maxDuration * 1000 },
);
