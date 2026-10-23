// POST /api/x402-prepaid/deposit  { tx_signature }
//
// Credit a prepaid x402 balance from ONE on-chain USDC transfer into the
// prepaid deposit wallet. The balance belongs to the wallet that sent and signed
// the transfer and is spent by signing in with that same wallet (SIGN-IN-WITH-X).
//
// The signature alone proves nothing, so the server reads the finalized
// transaction itself. Crediting is idempotent on the signature: retrying a
// deposit (or two clients submitting the same one) credits it once.

import { cors, error, json, method, rateLimited, readJson, respondError, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { creditDeposit, isLedgerUnavailable } from '../_lib/x402/prepaid-ledger.js';
import {
	PREPAID_ASSET,
	PREPAID_NETWORK,
	prepaidDepositWallet,
	verifyPrepaidDeposit,
} from '../_lib/x402/prepaid-chain.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (req.method === 'GET') {
		const wallet = await prepaidDepositWallet();
		if (!wallet) return error(res, 503, 'deposit_unavailable', 'prepaid deposits are not configured on this deployment yet');
		return json(res, 200, { deposit_wallet: wallet, network: PREPAID_NETWORK, asset: PREPAID_ASSET, decimals: 6 });
	}

	const body = await readJson(req).catch(() => null);
	const signature = typeof body?.tx_signature === 'string' ? body.tx_signature.trim() : '';
	if (!signature) return error(res, 400, 'bad_request', 'tx_signature is required');

	try {
		const verified = await verifyPrepaidDeposit(signature);
		if (verified.pending) {
			return json(res, 202, {
				ok: false,
				pending: true,
				status: 'awaiting_finalization',
				tx_signature: signature,
				message: 'Confirmed on-chain, still finalizing. Retry in a few seconds; the credit lands once.',
			});
		}
		const credit = await creditDeposit({
			payer: verified.payer,
			network: PREPAID_NETWORK,
			asset: PREPAID_ASSET,
			amountAtomics: verified.amountAtomics,
			ref: signature,
		});
		return json(res, 200, {
			ok: true,
			credited: credit.credited,
			payer: verified.payer,
			deposited_atomics: verified.amountAtomics.toString(),
			balance_atomics: credit.balanceAtomics.toString(),
			tx_signature: signature,
		});
	} catch (err) {
		if (isLedgerUnavailable(err)) {
			return error(res, 503, 'prepaid_unavailable', 'prepaid balances are not enabled on this deployment yet');
		}
		return respondError(res, err.status || 500, err.code || 'deposit_failed', err);
	}
});
