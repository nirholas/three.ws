// Shared by GET /api/ledger/verify/:agentId and GET /api/agents/:id/decision-trail/verify.
// Recomputes the per-agent hash chain from each entry's committed contents
// (trusting NO stored hash), then checks the recomputed head against the latest
// on-chain anchor.
//
// status:
//   empty                - no decisions recorded yet
//   verified             - chain intact AND head matches the on-chain anchor
//   verified_unanchored  - chain intact, no on-chain anchor yet (commitment pending)
//   verification_failed  - a tamper / inconsistency was detected (see `chain` / `anchor`)

import { getChainEntries, verifyChain } from './reasoning-ledger.js';
import { latestAnchoredAnchor } from './ledger-anchor.js';

function solscanUrl(sig, network) {
	if (!sig) return null;
	return network === 'devnet' ? `https://solscan.io/tx/${sig}?cluster=devnet` : `https://solscan.io/tx/${sig}`;
}

export async function buildVerifyReport(agentId) {
	const entries = await getChainEntries(agentId);
	const checkedAt = new Date().toISOString();

	if (!entries.length) {
		return {
			agent_id: agentId,
			status: 'empty',
			ok: true,
			first_broken_index: null,
			chain: { ok: true, count: 0, head_hash: null, computed_head: null, broken_at: null, reason: null },
			anchor: null,
			checked_at: checkedAt,
		};
	}

	const chain = await verifyChain(agentId, entries);
	const anchorRow = await latestAnchoredAnchor(agentId).catch(() => null);

	// The anchored head must equal the entry_hash at its seq. verifyChain only
	// reports ok after recomputing every entry_hash from its committed contents, so
	// on an intact chain the stored hash compared here IS the recomputed one; on a
	// broken chain no stored hash is trusted and the match can only be false.
	let matchesAnchor = false;
	if (anchorRow && chain.ok) {
		const atSeq = entries.find((e) => Number(e.seq) === Number(anchorRow.through_seq));
		matchesAnchor = !!atSeq && String(atSeq.entry_hash) === String(anchorRow.head_hash);
	}

	let status;
	if (!chain.ok) status = 'verification_failed';
	else if (anchorRow) status = matchesAnchor ? 'verified' : 'verification_failed';
	else status = 'verified_unanchored';

	// Report the anchor whenever one exists, including on a failed verification:
	// the on-chain commitment the altered history no longer matches is the most
	// useful thing an auditor can be handed.
	const anchor = anchorRow
		? {
				status: anchorRow.status,
				signature: anchorRow.signature,
				head_hash: anchorRow.head_hash,
				through_seq: Number(anchorRow.through_seq),
				entry_count: Number(anchorRow.entry_count),
				anchored_at: anchorRow.anchored_at,
				network: anchorRow.network,
				explorer_url: solscanUrl(anchorRow.signature, anchorRow.network),
				matches_chain: matchesAnchor,
			}
		: null;

	return {
		agent_id: agentId,
		status,
		ok: chain.ok && status !== 'verification_failed',
		// 0-based position in the seq-ordered chain; seq is 1-based, so index = seq - 1.
		first_broken_index: chain.ok ? null : Number(chain.broken_at) - 1,
		chain,
		anchor,
		checked_at: checkedAt,
	};
}
