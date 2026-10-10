// POST /api/credits/deposit: verify an on-chain SOL, USDC or $THREE transfer
// into the platform deposit wallet and credit the caller's prepaid balance.
//
// Body: { asset: 'SOL'|'USDC'|'THREE', tx_signature: string, network?: 'mainnet'|'devnet' }
// USDC credits at the published fixed rate; SOL and $THREE at the live mainnet
// quote; $THREE also earns the owner-configured bonus (bonus_usd in the reply).
//
// Server-authoritative: the signature alone proves nothing. credit-deposit.js
// confirms the tx, requires a signer linked to this account, checks the deposit
// wallet actually received funds, and credits idempotently on the signature.

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import {
	cors,
	error,
	json,
	method,
	wrap,
	readJson,
	rateLimited,
	respondError,
} from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { verifyAndCreditDeposit, DEPOSIT_ASSETS } from '../_lib/credit-deposit.js';

async function resolveUser(req, res) {
	const session = await getSessionUser(req, res);
	if (session) return session;
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) {
		const [u] = await sql`
			select id, wallet_address from users where id = ${bearer.userId} and deleted_at is null limit 1
		`;
		return u || null;
	}
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const user = await resolveUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to deposit credits');

	const body = await readJson(req).catch(() => null);
	const asset = String(body?.asset || '').toUpperCase();
	const txSignature = typeof body?.tx_signature === 'string' ? body.tx_signature.trim() : '';
	const network = body?.network === 'devnet' ? 'devnet' : 'mainnet';

	if (!txSignature) return error(res, 400, 'bad_request', 'tx_signature is required');
	if (!DEPOSIT_ASSETS.includes(asset))
		return error(res, 400, 'bad_request', `asset must be one of ${DEPOSIT_ASSETS.join(', ')}`);

	try {
		const result = await verifyAndCreditDeposit({ user, asset, txSignature, network });
		return json(res, 200, result);
	} catch (err) {
		return respondError(res, err.status || 500, err.code || 'deposit_failed', err, {
			...(Number.isFinite(err.available_usd) ? { available_usd: err.available_usd } : {}),
		});
	}
});
