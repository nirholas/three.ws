// Data layer for the whole-agent marketplace: listing and bid queries, the
// atomic state transitions, the history log, and the public view shapes.
//
// Every transition that races (accept vs withdraw, two accepts, buy-now vs
// delist) is ONE conditional statement: the database driver has no interactive
// transactions, and a single statement is what makes "only one caller wins"
// true under concurrency. Callers read the RETURNING rows to learn if they won.

import { sql } from '../db.js';
import { thumbnailUrl, publicUrlOrNull } from '../r2.js';
import { currencyInfo, formatAtomics } from './chain.js';

export const LISTING_STATUSES = ['active', 'settling', 'sold', 'delisted', 'expired'];

// ── Listings ─────────────────────────────────────────────────────────────────

const LISTING_COLUMNS = sql`
	l.*,
	ai.name AS agent_name,
	ai.description AS agent_description,
	ai.persona_prompt AS agent_persona,
	ai.skills AS agent_skills,
	ai.category AS agent_category,
	ai.user_id AS agent_owner_id,
	ai.meta->>'solana_address' AS agent_solana_address,
	av.thumbnail_key AS avatar_thumbnail_key,
	av.storage_key AS avatar_storage_key,
	av.visibility AS avatar_visibility,
	su.display_name AS seller_name,
	(SELECT max(b.amount_atomics) FROM agent_listing_bids b
	   WHERE b.listing_id = l.id AND b.status = 'open' AND b.currency = 'USDC') AS top_bid_atomics,
	(SELECT count(*)::int FROM agent_listing_bids b
	   WHERE b.listing_id = l.id AND b.status IN ('open', 'accepted')) AS bid_count,
	(SELECT count(*)::int FROM agent_marketplace_history h
	   WHERE h.agent_id = l.agent_id AND h.event = 'sold') AS prior_sales
`;

const LISTING_FROM = sql`
	FROM agent_listings l
	JOIN agent_identities ai ON ai.id = l.agent_id
	LEFT JOIN avatars av ON av.id = ai.avatar_id AND av.deleted_at IS NULL
	LEFT JOIN users su ON su.id = l.seller_user_id
`;

export async function getListing(id) {
	const [row] = await sql`SELECT ${LISTING_COLUMNS} ${LISTING_FROM} WHERE l.id = ${id} LIMIT 1`;
	return row || null;
}

/** The live (active or settling) listing for an agent, if any. */
export async function getLiveListingForAgent(agentId) {
	const [row] = await sql`
		SELECT ${LISTING_COLUMNS} ${LISTING_FROM}
		WHERE l.agent_id = ${agentId} AND l.status IN ('active', 'settling')
		LIMIT 1
	`;
	return row || null;
}

const SORTS = {
	ending: sql`l.expires_at ASC`,
	newest: sql`l.created_at DESC`,
	price_asc: sql`coalesce(l.ask_usdc_atomics, l.min_bid_usdc_atomics) ASC`,
	price_desc: sql`coalesce(l.ask_usdc_atomics, l.min_bid_usdc_atomics) DESC`,
	most_bids: sql`bid_count DESC, l.expires_at ASC`,
};

export function normalizeSort(sort) {
	return Object.prototype.hasOwnProperty.call(SORTS, sort) ? sort : 'ending';
}

/**
 * Browse listings. `status` defaults to active (and unexpired). `sellerId`
 * narrows to one seller and lifts the status default so a dashboard sees all.
 */
export async function listListings({ q = '', sort = 'ending', limit = 24, offset = 0, sellerId = null, status = null } = {}) {
	const qLike = q ? `%${q.slice(0, 80)}%` : null;
	const orderBy = SORTS[normalizeSort(sort)];
	const statusFilter = status
		? sql`l.status = ${status}`
		: sellerId
			? sql`true`
			: sql`l.status = 'active' AND l.expires_at > now()`;
	const rows = await sql`
		SELECT ${LISTING_COLUMNS} ${LISTING_FROM}
		WHERE ${statusFilter}
		  AND ai.deleted_at IS NULL
		  AND (${sellerId}::uuid IS NULL OR l.seller_user_id = ${sellerId})
		  AND (${qLike}::text IS NULL OR ai.name ILIKE ${qLike} OR ai.description ILIKE ${qLike}
		       OR EXISTS (SELECT 1 FROM unnest(ai.skills) s WHERE s ILIKE ${qLike}))
		ORDER BY ${orderBy}, l.id
		LIMIT ${limit + 1} OFFSET ${offset}
	`;
	return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

export async function insertListing(l) {
	const [row] = await sql`
		INSERT INTO agent_listings (
			id, agent_id, seller_user_id, ask_usdc_atomics, ask_three_atomics, min_bid_usdc_atomics,
			expires_at, include_balance, include_history, payout_address, escrow_address, note, snapshot
		) VALUES (
			${l.id}, ${l.agentId}, ${l.sellerUserId}, ${l.askUsdc}, ${l.askThree}, ${l.minBid},
			${l.expiresAt}, ${l.includeBalance}, ${l.includeHistory}, ${l.payoutAddress},
			${l.escrowAddress}, ${l.note}, ${JSON.stringify(l.snapshot)}::jsonb
		)
		RETURNING id
	`;
	return row.id;
}

/**
 * Close an active listing (delist or expire) and move every open bid to a
 * refund. One statement, so a racing accept either wins first (and this
 * returns null) or finds the listing already closed.
 */
export async function closeListing({ listingId, sellerId = null, to, bidStatus }) {
	const [row] = await sql`
		WITH l AS (
			UPDATE agent_listings
			SET status = ${to}, closed_at = now(), updated_at = now()
			WHERE id = ${listingId} AND status = 'active'
			  AND (${sellerId}::uuid IS NULL OR seller_user_id = ${sellerId})
			RETURNING id, agent_id
		), b AS (
			UPDATE agent_listing_bids
			SET status = ${bidStatus}, refund_status = 'pending', decided_at = now(), updated_at = now()
			WHERE listing_id = ${listingId} AND status = 'open' AND EXISTS (SELECT 1 FROM l)
			RETURNING id
		)
		SELECT (SELECT id FROM l) AS listing_id, (SELECT agent_id FROM l) AS agent_id,
		       (SELECT count(*)::int FROM b) AS refunds
	`;
	return row?.listing_id ? row : null;
}

// ── Bids ─────────────────────────────────────────────────────────────────────

export async function getBid(id) {
	const [row] = await sql`SELECT * FROM agent_listing_bids WHERE id = ${id} LIMIT 1`;
	return row || null;
}

export async function listBidsForListing(listingId) {
	return sql`
		SELECT b.*, u.display_name AS bidder_name
		FROM agent_listing_bids b
		LEFT JOIN users u ON u.id = b.bidder_user_id
		WHERE b.listing_id = ${listingId} AND b.status <> 'awaiting_funds'
		ORDER BY b.amount_atomics DESC, b.created_at ASC
		LIMIT 200
	`;
}

export async function listBidsByBidder(userId, { limit = 50 } = {}) {
	return sql`
		SELECT b.*, ai.name AS agent_name, l.agent_id, l.status AS listing_status, l.expires_at AS listing_expires_at
		FROM agent_listing_bids b
		JOIN agent_listings l ON l.id = b.listing_id
		JOIN agent_identities ai ON ai.id = l.agent_id
		WHERE b.bidder_user_id = ${userId}
		ORDER BY b.created_at DESC
		LIMIT ${limit}
	`;
}

export async function listBidsReceived(sellerId, { limit = 100 } = {}) {
	return sql`
		SELECT b.*, ai.name AS agent_name, l.agent_id, l.status AS listing_status,
		       l.expires_at AS listing_expires_at, u.display_name AS bidder_name
		FROM agent_listing_bids b
		JOIN agent_listings l ON l.id = b.listing_id
		JOIN agent_identities ai ON ai.id = l.agent_id
		LEFT JOIN users u ON u.id = b.bidder_user_id
		WHERE l.seller_user_id = ${sellerId} AND b.status <> 'awaiting_funds'
		ORDER BY (b.status = 'open') DESC, b.created_at DESC
		LIMIT ${limit}
	`;
}

export async function insertBid(b) {
	const [row] = await sql`
		INSERT INTO agent_listing_bids (
			id, listing_id, bidder_user_id, kind, currency, amount_atomics, funding_source,
			funding_agent_id, funding_address, escrow_reference, fund_by
		) VALUES (
			${b.id}, ${b.listingId}, ${b.bidderUserId}, ${b.kind}, ${b.currency}, ${String(b.amount)},
			${b.fundingSource}, ${b.fundingAgentId}, ${b.fundingAddress}, ${b.reference}, ${b.fundBy}
		)
		RETURNING *
	`;
	return row;
}

/**
 * Record that a bid's escrow transfer landed. It opens only while its listing
 * is still active; otherwise the funds are already in escrow and must go back,
 * so it lands as expired with a pending refund.
 */
export async function markBidFunded(bidId, signature) {
	const [row] = await sql`
		UPDATE agent_listing_bids b
		SET escrow_signature = ${signature}, funded_at = now(), updated_at = now(),
		    status = CASE WHEN l.status = 'active' AND l.expires_at > now() THEN 'open' ELSE 'expired' END,
		    refund_status = CASE WHEN l.status = 'active' AND l.expires_at > now() THEN NULL ELSE 'pending' END,
		    decided_at = CASE WHEN l.status = 'active' AND l.expires_at > now() THEN NULL ELSE now() END
		FROM agent_listings l
		WHERE b.id = ${bidId} AND l.id = b.listing_id AND b.status = 'awaiting_funds'
		RETURNING b.*
	`;
	return row || null;
}

export async function expireUnfundedBid(bidId, reason) {
	const [row] = await sql`
		UPDATE agent_listing_bids
		SET status = 'expired', decided_at = now(), updated_at = now(), refund_error = ${reason}
		WHERE id = ${bidId} AND status = 'awaiting_funds'
		RETURNING *
	`;
	return row || null;
}

/** Move one open bid to rejected or withdrawn with a pending refund. */
export async function decideBid({ bidId, to, sellerId = null, bidderId = null }) {
	const [row] = await sql`
		UPDATE agent_listing_bids b
		SET status = ${to}, refund_status = 'pending', decided_at = now(), updated_at = now()
		FROM agent_listings l
		WHERE b.id = ${bidId} AND l.id = b.listing_id AND b.status = 'open'
		  AND (${sellerId}::uuid IS NULL OR l.seller_user_id = ${sellerId})
		  AND (${bidderId}::uuid IS NULL OR b.bidder_user_id = ${bidderId})
		RETURNING b.*
	`;
	return row || null;
}

/**
 * Accept a bid: listing -> settling, bid -> accepted, every other open bid ->
 * rejected with a pending refund, and the transfer row created. The listing is
 * locked FIRST so two concurrent accepts serialize on it, and the bid update is
 * conditional on the listing update having won.
 */
export async function acceptBidAtomically({ listingId, bidId, sellerId, feeBps }) {
	const [row] = await sql`
		WITH l AS (
			UPDATE agent_listings
			SET status = 'settling', sold_bid_id = ${bidId}, updated_at = now()
			WHERE id = ${listingId} AND status = 'active' AND expires_at > now()
			  AND (${sellerId}::uuid IS NULL OR seller_user_id = ${sellerId})
			  AND EXISTS (SELECT 1 FROM agent_listing_bids WHERE id = ${bidId} AND listing_id = ${listingId} AND status = 'open')
			RETURNING id, agent_id, seller_user_id
		), b AS (
			UPDATE agent_listing_bids
			SET status = 'accepted', decided_at = now(), updated_at = now()
			WHERE id = ${bidId} AND listing_id = ${listingId} AND status = 'open' AND EXISTS (SELECT 1 FROM l)
			RETURNING id, bidder_user_id, currency, amount_atomics
		), others AS (
			UPDATE agent_listing_bids
			SET status = 'rejected', refund_status = 'pending', decided_at = now(), updated_at = now()
			WHERE listing_id = ${listingId} AND status = 'open' AND id <> ${bidId} AND EXISTS (SELECT 1 FROM b)
			RETURNING id
		), t AS (
			INSERT INTO agent_transfers (
				listing_id, bid_id, agent_id, buyer_user_id, seller_user_id, currency,
				amount_atomics, fee_atomics, seller_net_atomics
			)
			SELECT l.id, b.id, l.agent_id, b.bidder_user_id, l.seller_user_id, b.currency,
			       b.amount_atomics,
			       floor(b.amount_atomics * ${feeBps} / 10000),
			       b.amount_atomics - floor(b.amount_atomics * ${feeBps} / 10000)
			FROM l, b
			RETURNING id
		)
		SELECT (SELECT id FROM l) AS listing_id, (SELECT id FROM b) AS bid_id,
		       (SELECT id FROM t) AS transfer_id, (SELECT count(*)::int FROM others) AS rejected
	`;
	if (row?.transfer_id) return row;
	// The listing moved but the bid did not (it was withdrawn in between):
	// put the listing back so it can take another bid.
	if (row?.listing_id) {
		await sql`
			UPDATE agent_listings SET status = 'active', sold_bid_id = NULL, updated_at = now()
			WHERE id = ${listingId} AND status = 'settling' AND sold_bid_id = ${bidId}
			  AND NOT EXISTS (SELECT 1 FROM agent_transfers WHERE listing_id = ${listingId})
		`;
	}
	return null;
}

// ── Transfers ────────────────────────────────────────────────────────────────

export async function getTransfer(id) {
	const [row] = await sql`SELECT * FROM agent_transfers WHERE id = ${id} LIMIT 1`;
	return row || null;
}

export async function getTransferForListing(listingId) {
	const [row] = await sql`SELECT * FROM agent_transfers WHERE listing_id = ${listingId} LIMIT 1`;
	return row || null;
}

// ── History ──────────────────────────────────────────────────────────────────

export async function addHistory(e) {
	await sql`
		INSERT INTO agent_marketplace_history
			(agent_id, listing_id, bid_id, transfer_id, actor_user_id, event, currency, amount_atomics, signature, meta)
		VALUES (
			${e.agentId}, ${e.listingId ?? null}, ${e.bidId ?? null}, ${e.transferId ?? null},
			${e.actorUserId ?? null}, ${e.event}, ${e.currency ?? null},
			${e.amount != null ? String(e.amount) : null}, ${e.signature ?? null},
			${JSON.stringify(e.meta || {})}::jsonb
		)
	`;
}

export async function listHistory({ agentId = null, listingId = null, limit = 50 } = {}) {
	return sql`
		SELECT h.*, ai.name AS agent_name
		FROM agent_marketplace_history h
		LEFT JOIN agent_identities ai ON ai.id = h.agent_id
		WHERE (${agentId}::uuid IS NULL OR h.agent_id = ${agentId})
		  AND (${listingId}::uuid IS NULL OR h.listing_id = ${listingId})
		ORDER BY h.created_at DESC, h.id DESC
		LIMIT ${limit}
	`;
}

// ── Views ────────────────────────────────────────────────────────────────────

function money(atomics, currency) {
	if (atomics == null) return null;
	const info = currencyInfo(currency);
	return { atomics: String(atomics), amount: formatAtomics(atomics, info.decimals), currency: info.currency, symbol: info.symbol };
}

function personaSummary(row) {
	const text = String(row.agent_description || row.agent_persona || '').replace(/\s+/g, ' ').trim();
	return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

export function listingView(row, { viewerId = null } = {}) {
	const avatarPublic = !row.avatar_visibility || row.avatar_visibility === 'public' || row.avatar_visibility === 'unlisted';
	const snapshot = row.snapshot || {};
	const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
	const live = row.status === 'active' && expiresAt.getTime() > Date.now();
	return {
		id: row.id,
		status: live || row.status !== 'active' ? row.status : 'expired',
		agent: {
			id: row.agent_id,
			name: row.agent_name,
			persona_summary: personaSummary(row),
			category: row.agent_category || null,
			skills: row.agent_skills || [],
			thumbnail_url: thumbnailUrl(row.avatar_thumbnail_key),
			avatar_glb_url: row.avatar_storage_key && avatarPublic ? publicUrlOrNull(row.avatar_storage_key) : null,
			wallet_address: row.agent_solana_address || null,
			url: `/agents/${row.agent_id}`,
		},
		seller: { id: row.seller_user_id, name: row.seller_name || null, is_viewer: Boolean(viewerId && viewerId === row.seller_user_id) },
		ask: money(row.ask_usdc_atomics, 'USDC'),
		ask_three: money(row.ask_three_atomics, 'THREE'),
		min_bid: money(row.min_bid_usdc_atomics, 'USDC'),
		top_bid: money(row.top_bid_atomics, 'USDC'),
		bid_count: row.bid_count || 0,
		prior_sales: row.prior_sales || 0,
		include_balance: row.include_balance,
		include_history: row.include_history,
		payout_address: viewerId && viewerId === row.seller_user_id ? row.payout_address : undefined,
		escrow_address: row.escrow_address,
		note: row.note || null,
		snapshot,
		expires_at: expiresAt.toISOString(),
		created_at: new Date(row.created_at).toISOString(),
		closed_at: row.closed_at ? new Date(row.closed_at).toISOString() : null,
		url: `/marketplace/agents/listing/${row.id}`,
	};
}

export function bidView(row, { viewerId = null } = {}) {
	const mine = Boolean(viewerId && viewerId === row.bidder_user_id);
	return {
		id: row.id,
		listing_id: row.listing_id,
		agent_id: row.agent_id ?? undefined,
		agent_name: row.agent_name ?? undefined,
		listing_status: row.listing_status ?? undefined,
		kind: row.kind,
		status: row.status,
		amount: money(row.amount_atomics, row.currency),
		bidder: { id: row.bidder_user_id, name: row.bidder_name || null, is_viewer: mine },
		funding_source: row.funding_source,
		funding_address: row.funding_address,
		escrow_signature: row.escrow_signature || null,
		refund: row.refund_status
			? { status: row.refund_status, signature: row.refund_signature || null, error: mine ? row.refund_error || null : undefined }
			: null,
		fund_by: row.status === 'awaiting_funds' && row.fund_by ? new Date(row.fund_by).toISOString() : null,
		created_at: new Date(row.created_at).toISOString(),
		decided_at: row.decided_at ? new Date(row.decided_at).toISOString() : null,
	};
}

export function historyView(row) {
	return {
		id: String(row.id),
		agent_id: row.agent_id,
		agent_name: row.agent_name || null,
		listing_id: row.listing_id,
		bid_id: row.bid_id,
		transfer_id: row.transfer_id,
		event: row.event,
		amount: row.amount_atomics != null && row.currency ? money(row.amount_atomics, row.currency) : null,
		signature: row.signature || null,
		meta: row.meta || {},
		at: new Date(row.created_at).toISOString(),
	};
}

export { money };
