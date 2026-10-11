// GET /api/runs?id=rr_…        one run receipt, its signed envelope, and a fresh server-side verification
// GET /api/runs?stats=1&days=7 aggregate outcomes and stage verdicts across every receipt in the window
//
// Run receipts are the per-generation record of what each Studio stage was
// expected to do, what it actually did, and the verdict (api/_lib/run-receipt.js).
// A receipt is reachable only by its unguessable id, the same footing as the
// result it was attached to; the stats view is counts only, with no prompt, file
// or id in it. Public and read-only, so open CORS: anyone handed a receipt link
// can check it, and the offline verifier (scripts/run-receipt-verify.mjs) needs
// nothing but this JSON.

import { cors, method, wrap, json, error } from './_lib/http.js';
import { isReceiptId } from './_lib/run-receipt.js';
import { loadReceipt, receiptStats, verifyStoredReceipt, receiptSignerPublicKey, STATS_MAX_DAYS } from './_lib/run-receipt-store.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS', payments: false })) return;
	if (!method(req, res, ['GET'])) return;
	const q = new URL(req.url, 'http://localhost').searchParams;

	if (q.get('stats')) {
		const days = Number(q.get('days')) || 7;
		const stats = await receiptStats({ days });
		const signer = await receiptSignerPublicKey();
		return json(res, 200, { ...stats, max_days: STATS_MAX_DAYS, signer }, { 'cache-control': 'public, max-age=60, s-maxage=60' });
	}

	const id = q.get('id') || '';
	if (!isReceiptId(id)) return error(res, 400, 'invalid_id', 'Pass ?id= with a run receipt id (rr_…), or ?stats=1 for the aggregate view.');
	const envelope = await loadReceipt(id);
	if (!envelope) return error(res, 404, 'not_found', 'No run receipt with that id.');
	const verification = await verifyStoredReceipt(envelope);
	// A pending receipt changes when its job is collected; a finished one never does.
	const cache = envelope.receipt.outcome === 'pending' ? 'no-store' : 'public, max-age=300, s-maxage=3600';
	return json(res, 200, { ...envelope, verification }, { 'cache-control': cache });
});
