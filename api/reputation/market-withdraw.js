/**
 * POST /api/reputation/market-withdraw  { signature, network, proof: { issued_at, signature } }
 *
 * Settle a reputation-market position: return the staker's principal in full
 * plus whatever their conviction earned from the agent's attested action
 * history, and write the `threews.unstake.v1` memo that retires the conviction
 * on-chain.
 *
 * The payout always goes to the staker recorded in the stake transaction, never
 * to the caller. That alone is not enough: an open endpoint let anyone close
 * every position backing a rival agent. So the caller proves they ARE the
 * staker by signing `threews.unstake.v1:<network>:<stake sig>:<issued_at ms>`
 * with that wallet (`proof: { issued_at, signature }`, base58 signature), the
 * spec's rule 1. Mainnet stays owner-gated (specs/REPUTATION_STAKING_MARKET.md §1).
 */

import { cors, json, method, wrap, rateLimited, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isDbUnavailableError } from '../_lib/db.js';
import { withdrawPosition, MarketError } from '../_lib/reputation-market.js';

const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const body = await readJson(req).catch(() => null);
	const signature = String(body?.signature || '').trim();
	const network = body?.network === 'mainnet' ? 'mainnet' : 'devnet';

	if (!SIGNATURE_RE.test(signature)) {
		return error(res, 400, 'validation_error', 'signature must be a base58 Solana transaction signature');
	}

	try {
		const proof = body?.proof && typeof body.proof === 'object' ? body.proof : null;
		const result = await withdrawPosition({ signature, network, proof });
		return json(res, 200, {
			ok: true,
			status: result.status,
			settlement: result.settlement,
			position: {
				signature: result.position.signature,
				network: result.position.network,
				agent_asset: result.position.agentAsset,
				staker: result.position.staker,
				principal_lamports: result.position.principalLamports.toString(),
				status: result.position.status,
				closed_at: result.position.closedAt ? new Date(result.position.closedAt * 1000).toISOString() : null,
				settle_signature: result.position.settleSignature,
			},
		});
	} catch (err) {
		if (err instanceof MarketError) return error(res, err.status, err.code, err.message);
		if (isDbUnavailableError(err)) {
			return error(res, 503, 'db_unavailable', 'The market index is temporarily unavailable.');
		}
		throw err;
	}
});
