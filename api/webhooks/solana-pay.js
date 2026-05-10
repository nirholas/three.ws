/**
 * /api/webhooks/solana-pay
 * --------------------------------------------------------------
 * GET  — Solana Pay merchant discovery probe: returns { label, icon }.
 * POST — Off-web confirmation path. Looks up the pending skill_purchases row
 *        by reference and runs the same on-chain verification + ledger writes
 *        as the buyer's polling /confirm endpoint via confirmSkillPurchase().
 *        Mainly useful for mobile QR flows where the merchant pings the
 *        server directly after the buyer signs in their wallet.
 *
 * Auth: Authorization: Bearer <WEBHOOK_SECRET>. The reference itself is also
 * a unique secret, so the surface is narrow; we still gate to avoid spammy
 * DoS-via-confirm probes.
 */
import { sql } from '../_lib/db.js';
import { error, json, method, readJson, wrap } from '../_lib/http.js';
import { confirmSkillPurchase } from '../_lib/purchase-confirm.js';

function authOk(req) {
	const secret = process.env.WEBHOOK_SECRET;
	if (!secret) return false;
	const header = req.headers?.authorization || '';
	return header === `Bearer ${secret}`;
}

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'GET') {
		return json(res, 200, {
			label: '3D-Agent Skill Marketplace',
			icon: 'https://three.ws/assets/logo.png',
		});
	}

	if (!authOk(req)) return error(res, 401, 'unauthorized', 'invalid or missing webhook secret');

	const body = await readJson(req).catch(() => null);
	const reference = typeof body?.reference === 'string' ? body.reference.trim() : null;
	if (!reference) return error(res, 400, 'validation_error', 'reference required');

	const [pur] = await sql`
		SELECT sp.*, COALESCE(asp.mint_decimals, 6) AS mint_decimals
		FROM skill_purchases sp
		LEFT JOIN agent_skill_prices asp
		       ON asp.agent_id = sp.agent_id AND asp.skill = sp.skill
		WHERE sp.reference = ${reference}
		LIMIT 1
	`;
	if (!pur) return error(res, 404, 'not_found', 'purchase not found');

	let result;
	try {
		result = await confirmSkillPurchase(pur);
	} catch (e) {
		return error(res, 500, 'confirm_failed', e.message);
	}

	if (result.status === 'pending') return json(res, 200, { data: { status: 'pending' } });
	if (result.status === 'expired') return error(res, 410, 'expired', 'purchase expired');
	if (result.status === 'mismatch') return error(res, 409, 'transfer_mismatch', result.message);
	if (result.status === 'tipped') {
		return error(res, 409, 'transfer_mismatch', result.message, {
			status: 'tipped',
			tipped_amount: result.tipped_amount,
			tx_signature: result.tx_signature,
		});
	}
	return json(res, 200, { data: { status: 'confirmed', tx_signature: result.tx_signature } });
});
