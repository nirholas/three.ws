// GET/POST /api/cron/custody-attest — Verifiable Proof-of-Custody snapshot+anchor.
//
// Runs one attestation epoch: snapshots every custodial wallet's public state
// (address, live on-chain balance, custody-ledger head), builds a Merkle tree,
// persists the epoch + leaves, and commits the root on-chain as a signed SPL-Memo
// (api/_lib/custody-proof.js). Owners then verify their own inclusion proof in the
// browser against the on-chain root.
//
// Best-effort anchoring, like the other on-chain lanes: with no funded attester
// key (ATTEST_AGENT_SECRET_KEY) the epoch is still recorded with anchor_status
// 'pending'/'anchor_failed' and can be re-anchored later — the snapshot never
// 500s on a missing key.

import { json, method, wrapCron } from '../_lib/http.js';
import { runAttestationEpoch, describeAnchorOutage } from '../_lib/custody-proof.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const result = await runAttestationEpoch({ anchor: true });
	if (result.anchor_status === 'anchor_failed') await alertAnchorFailure(result);
	return json(res, 200, { ok: true, ...result });
});

// A failed anchor leaves the commitment untimestamped, so it must page ops. The
// signature is per network so a standing outage coalesces into one alert.
async function alertAnchorFailure(result) {
	const { network, attester, lamports } = await describeAnchorOutage();
	const balance = lamports == null ? 'unknown' : `${(lamports / 1e9).toFixed(6)} SOL`;
	await sendOpsAlert(
		'Custody proof: on-chain anchoring is down',
		`Epoch ${result.epoch} was recorded but its Merkle root could not be anchored on Solana ${network}. ` +
		`Reason: ${result.anchor_error}. Attester ${attester || 'key not configured'} holds ${balance} on ${network}. ` +
		`Fix: fund the attester on ${network} (or set CUSTODY_ANCHOR_NETWORK to the cluster it is funded on).`,
		{ signature: `custody-anchor-failed:${network}` },
	);
}
