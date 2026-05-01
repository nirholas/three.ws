import { sql } from '../_lib/db.js';
import { json, method, wrap, error, readJson } from '../_lib/http.js';
import { env } from '../_lib/env.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const REQUIRED_AMOUNT = 8000;

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST'])) return;

	const secret = env.RIDER_HELIUS_WEBHOOK_SECRET;
	if (secret && req.headers.authorization !== `Bearer ${secret}`) {
		return error(res, 401, 'unauthorized', 'invalid webhook secret');
	}

	const vaultAddress = env.RIDER_VAULT_ADDRESS;
	if (!vaultAddress) return json(res, 200, { ok: true });

	const txns = await readJson(req);
	if (!Array.isArray(txns)) return json(res, 200, { ok: true });

	for (const txn of txns) {
		if (txn.transactionError) continue;
		for (const t of txn.tokenTransfers ?? []) {
			if (
				t.mint === THREE_MINT &&
				t.toUserAccount === vaultAddress &&
				Number(t.tokenAmount) >= REQUIRED_AMOUNT &&
				t.fromUserAccount
			) {
				await sql`
					insert into rider_passes (wallet_address, amount_paid, tx_signature)
					values (${t.fromUserAccount}, ${t.tokenAmount}, ${txn.signature})
					on conflict (wallet_address) do update
					  set amount_paid  = excluded.amount_paid,
					      tx_signature = excluded.tx_signature
				`;
			}
		}
	}

	return json(res, 200, { ok: true });
});
