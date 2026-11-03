// Settle a transaction the caller signed themselves.
//
//   POST /api/tx/submit   { tx_id, signed_transaction }   verify, broadcast, confirm, reconcile the ledger
//   GET  /api/tx/:id                                      status, refreshing an in-flight broadcast
//   GET  /api/tx/submit?tx_id=                            the same, for clients that prefer a query string
//
// `tx_id` comes from a build route called with `signer: "external"` (see
// api/_lib/custody/external-tx.js). The signed bytes must keep every prepared
// instruction and carry a valid signature from the prepared signer.

import { sql } from '../_lib/db.js';
import { cors, json, method, rateLimited, wrap } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { requirePrincipal } from '../_lib/custody/auth.js';
import { answerCustody, readCustodyBody } from '../_lib/custody/http.js';
import { clientError } from '../_lib/custody/builders.js';
import { getExternalTx, publicExternalTx, refreshSubmittedTx, submitExternalTx } from '../_lib/custody/external-tx.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SIGNED_B64 = 4096;

async function ledgerRow(eventId, userId) {
	if (!eventId) return null;
	const [row] = await sql`
		SELECT id, agent_id, event_type, category, network, asset, amount_raw, destination, signature, status, reason, created_at
		FROM agent_custody_events
		WHERE id = ${eventId} AND user_id = ${userId}
	`;
	return row || null;
}

async function withLedger(view, userId) {
	return { ...view, ledger: await ledgerRow(view.custody_event_id, userId) };
}

function txIdFrom(req, body = {}) {
	const url = new URL(req.url, 'http://x');
	const last = url.pathname.split('/').filter(Boolean).pop();
	const candidate = body.tx_id || url.searchParams.get('tx_id') || (UUID.test(last || '') ? last : '');
	if (!UUID.test(String(candidate))) throw clientError('invalid_parameter', 'tx_id must be the id returned when the transaction was prepared.');
	return String(candidate);
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	return answerCustody(res, async () => {
		const isSubmit = req.method === 'POST';
		const principal = await requirePrincipal(req, isSubmit ? 'wallet:write' : 'wallet:read');
		const rl = await (isSubmit ? limits.custodyWrite : limits.walletRead)(principal.userId);
		if (!rl.success) return rateLimited(res, rl);

		if (isSubmit) {
			const body = await readCustodyBody(req);
			const txId = txIdFrom(req, body);
			const signed = typeof body.signed_transaction === 'string' ? body.signed_transaction.trim() : '';
			if (!signed || signed.length > MAX_SIGNED_B64) {
				throw clientError('invalid_parameter', `signed_transaction must be a base64 transaction of at most ${MAX_SIGNED_B64} characters.`);
			}
			const out = await submitExternalTx({ userId: principal.userId, txId, signedTransaction: signed });
			return json(res, 200, { data: await withLedger(out, principal.userId) }, { 'cache-control': 'no-store' });
		}

		const txId = txIdFrom(req);
		const view = await refreshSubmittedTx(txId, principal.userId);
		if (!view) {
			const row = await getExternalTx(txId, principal.userId);
			if (!row) throw clientError('not_found', 'No prepared transaction with that tx_id for this account.', 404);
			return json(res, 200, { data: await withLedger(publicExternalTx(row), principal.userId) }, { 'cache-control': 'no-store' });
		}
		return json(res, 200, { data: await withLedger(view, principal.userId) }, { 'cache-control': 'no-store' });
	});
});
