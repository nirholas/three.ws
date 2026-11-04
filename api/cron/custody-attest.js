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
import { runAttestationEpoch, describeAnchorOutage, reconcileLandedAnchors } from '../_lib/custody-proof.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const startedAt = Date.now();
	const result = await runAttestationEpoch({ anchor: true });
	const reconciled = await reconcileSafely(startedAt + RECONCILE_DEADLINE_MS);
	const repaired = reconciled.promoted?.find((p) => String(p.epoch) === String(result.epoch));
	if (repaired) {
		result.anchor_status = 'anchored';
		result.anchor_signature = repaired.signature;
		delete result.anchor_error;
	}
	if (result.anchor_status === 'anchor_failed') await alertAnchorFailure(result);
	return json(res, 200, { ok: true, ...result, reconciled });
});

// The route's maxDuration is 120s and the snapshot may use up to 112s of it, so
// reconcile starts no lookup past 110s; anything left waits for the next run.
const RECONCILE_DEADLINE_MS = 110_000;

// Epochs whose memo landed after the confirm wait gave up are promoted from
// on-chain evidence (reconcileLandedAnchors verifies signer, epoch and root).
// Best-effort: a missing key or an RPC outage never fails the snapshot.
async function reconcileSafely(deadline) {
	try {
		return await reconcileLandedAnchors({ limit: 20, deadline });
	} catch (e) {
		return { error: e?.message || String(e) };
	}
}

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
