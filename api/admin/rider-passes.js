import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!(await requireAdmin(req, res))) return;

	if (req.method === 'GET') {
		const passes = await sql`
			select wallet_address, amount_paid, tx_signature, created_at
			from rider_passes
			order by created_at desc
		`;
		return json(res, 200, { passes });
	}

	if (req.method === 'POST') {
		const body = await readJson(req);
		const address = body?.wallet_address?.trim();
		if (!address) return error(res, 400, 'validation_error', 'wallet_address required');

		await sql`
			insert into rider_passes (wallet_address, amount_paid, tx_signature)
			values (${address}, ${body.amount_paid ?? 8000}, ${body.tx_signature ?? 'manual'})
			on conflict (wallet_address) do update
			  set amount_paid  = excluded.amount_paid,
			      tx_signature = excluded.tx_signature
		`;
		return json(res, 200, { ok: true });
	}

	if (req.method === 'DELETE') {
		const body = await readJson(req);
		const address = body?.wallet_address?.trim();
		if (!address) return error(res, 400, 'validation_error', 'wallet_address required');

		await sql`delete from rider_passes where wallet_address = ${address}`;
		return json(res, 200, { ok: true });
	}

	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;
});
