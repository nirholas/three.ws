// GET /api/cron/agent-invoice-watch: the on-chain watcher for agent invoices.
//
// Every open or underpaid invoice (and, for a day after its due date, any that
// expired, so a late payment still settles it) is read against the chain by
// its Solana Pay reference. Payments are matched by reference, the memo is
// checked against the invoice number, the received amount is summed, and the
// invoice moves to paid, underpaid or expired. Each transition fires the
// invoice.* webhooks and owner notifications, and a paid purchase invoice
// releases the buyer's goods. Idempotent: payments are keyed by signature and
// every status move is guarded, so overlapping ticks are harmless.
// Library: api/_lib/agent-commerce/invoices.js. Guide: docs/agent-commerce.md.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sweepInvoices } from '../_lib/agent-commerce/invoices.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const summary = await sweepInvoices();
	return json(res, 200, { ok: true, ...summary }, { 'cache-control': 'no-store' });
});
