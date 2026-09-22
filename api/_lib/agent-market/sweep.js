// The marketplace-escrow-sweep tick: everything in the whole-agent marketplace
// that must happen whether or not anyone is watching.
//
//   1. Unfunded bids past their funding window: a connected-wallet transfer
//      that landed late is recorded (and refunded if the listing moved on); an
//      agent-wallet transfer that crashed mid-flight is reconciled from its
//      custody receipt; anything that never landed expires.
//   2. Listings past their end time expire, and every open bid on them moves
//      to a refund.
//   3. Pending and failed refunds are sent (each under its own lease).
//   4. Transfers that stalled (a dead worker's lease expired, or a failed step)
//      are resumed through the state machine.
//   5. Finished listings with empty escrow close their token accounts so the
//      rent returns to the marketplace payer.
//
// Every stage is bounded per tick and idempotent; the next tick finishes the rest.

import { sql } from '../db.js';
import { agentWalletFundingStatus, closeEscrow, verifyConnectedFunding } from './escrow.js';
import { processRefund } from './service.js';
import { runTransfer } from './settlement.js';
import * as store from './store.js';

const BATCH = 25;
// A failed transfer is retried at most this often, so a persistent failure
// (e.g. an EVM wallet waiting on gas) does not hammer the chain every tick.
const FAILED_RETRY_MINUTES = 10;

async function reconcileUnfunded(summary) {
	const due = await sql`
		SELECT * FROM agent_listing_bids
		WHERE status = 'awaiting_funds' AND fund_by < now()
		ORDER BY fund_by ASC LIMIT ${BATCH}
	`;
	for (const bid of due) {
		try {
			let signature = null;
			if (bid.funding_source === 'connected_wallet') {
				const listing = await store.getListing(bid.listing_id);
				signature = await verifyConnectedFunding({ bid, listing });
			} else {
				const st = await agentWalletFundingStatus(bid);
				if (st.state === 'pending') continue;
				if (st.state === 'landed') signature = st.signature;
			}
			if (!signature) {
				await store.expireUnfundedBid(bid.id, 'funding_window_elapsed');
				summary.unfunded_expired++;
				continue;
			}
			const funded = await store.markBidFunded(bid.id, signature);
			if (funded?.status === 'expired') await processRefund(bid.id);
			summary.late_funded++;
		} catch (err) {
			summary.errors.push({ stage: 'unfunded', bid: bid.id, message: err?.message });
		}
	}
}

async function expireListings(summary) {
	const due = await sql`
		SELECT id FROM agent_listings WHERE status = 'active' AND expires_at < now()
		ORDER BY expires_at ASC LIMIT ${BATCH}
	`;
	for (const { id } of due) {
		const closed = await store.closeListing({ listingId: id, to: 'expired', bidStatus: 'expired' });
		if (!closed) continue;
		await store.addHistory({ agentId: closed.agent_id, listingId: id, event: 'listing_expired', meta: { refunds: closed.refunds } });
		summary.listings_expired++;
	}
}

async function sendRefunds(summary) {
	const due = await sql`
		SELECT id FROM agent_listing_bids
		WHERE refund_status IN ('pending', 'failed')
		  AND (refund_locked_until IS NULL OR refund_locked_until < now())
		ORDER BY updated_at ASC LIMIT ${BATCH}
	`;
	for (const { id } of due) {
		const r = await processRefund(id);
		if (r.status === 'sent') summary.refunds_sent++;
		else if (r.status === 'retrying') summary.errors.push({ stage: 'refund', bid: id, message: r.message });
	}
}

async function resumeTransfers(summary) {
	const due = await sql`
		SELECT id FROM agent_transfers
		WHERE status <> 'completed'
		  AND (locked_until IS NULL OR locked_until < now())
		  AND (status <> 'failed' OR updated_at < now() - make_interval(mins => ${FAILED_RETRY_MINUTES}))
		ORDER BY updated_at ASC LIMIT 5
	`;
	for (const { id } of due) {
		const run = await runTransfer(id, { deadlineMs: 50_000 });
		if (run.transfer?.status === 'completed') summary.transfers_completed++;
		else if (run.error) summary.errors.push({ stage: 'transfer', transfer: id, message: `${run.error.step}: ${run.error.message}` });
	}
}

async function closeEscrows(summary) {
	const due = await sql`
		SELECT l.* FROM agent_listings l
		WHERE l.status IN ('sold', 'delisted', 'expired') AND l.escrow_closed_at IS NULL
		  AND NOT EXISTS (
		    SELECT 1 FROM agent_listing_bids b
		    WHERE b.listing_id = l.id AND (b.status = 'awaiting_funds' OR b.refund_status IN ('pending', 'failed')))
		  AND NOT EXISTS (SELECT 1 FROM agent_transfers t WHERE t.listing_id = l.id AND t.status <> 'completed')
		ORDER BY l.closed_at ASC NULLS FIRST LIMIT ${BATCH}
	`;
	for (const listing of due) {
		try {
			const r = await closeEscrow(listing);
			if (r.closed) {
				await sql`UPDATE agent_listings SET escrow_closed_at = now(), updated_at = now() WHERE id = ${listing.id}`;
				summary.escrows_closed++;
			} else if (r.reason === 'escrow_not_empty') {
				summary.errors.push({ stage: 'close', listing: listing.id, message: `escrow still holds ${r.balance} ${r.currency}` });
			}
		} catch (err) {
			summary.errors.push({ stage: 'close', listing: listing.id, message: err?.message });
		}
	}
}

export async function runMarketplaceSweep() {
	const summary = {
		unfunded_expired: 0, late_funded: 0, listings_expired: 0, refunds_sent: 0,
		transfers_completed: 0, escrows_closed: 0, errors: [],
	};
	await reconcileUnfunded(summary);
	await expireListings(summary);
	await sendRefunds(summary);
	await resumeTransfers(summary);
	await closeEscrows(summary);
	return summary;
}
