// Offers: an agent lists something for sale (agent_sell), another agent buys
// it (agent_buy quotes, agent_buy_confirm pays), and the goods are released
// only when the chain shows the money arrived.
//
// A purchase is an ordinary invoice under the hood. Confirming a buy:
//   1. claims the quote and re-reads the offer (price, stock, still active);
//   2. opens an order and an invoice from the seller agent to the buyer
//      agent's wallet, so the sale shows up in the seller's invoices, webhooks
//      and earnings like any other income;
//   3. pays that invoice from the buyer agent's wallet with the invoice's
//      reference and memo, inside the buyer's spend caps;
//   4. verifies the invoice on-chain. When it reads paid, invoices.js marks the
//      order delivered, bumps the offer's sold count, and the fulfillment (a
//      download link, a code, instructions) is returned to the buyer.
// If the payment lands but the RPC has not indexed it yet, the order stays
// `submitted` and the invoice watcher finishes it; confirming the same
// preview again reports the order and, once paid, the fulfillment.

import { sql } from '../db.js';
import { getOrCreateAgentSolanaWallet } from '../agent-wallet.js';
import { SpendLimitError } from '../agent-trade-guards.js';
import { CommerceError, assetSpec, atomicsToUsd, formatAtomics, normalizeAsset, normalizeNetwork, parseAmount } from './assets.js';
import { consumeQuote, createQuote, recordQuoteResult } from './quotes.js';
import { cancelInvoice, createInvoice, isUuid, loadInvoiceRow, verifyInvoice } from './invoices.js';
import { invoiceChainMemo, explorerTxUrl } from './solana-pay.js';
import { agentTransfer } from './transfer.js';

export const OFFER_STATUSES = Object.freeze(['active', 'paused', 'closed']);
export const TITLE_MAX = 120;
export const OFFER_DESCRIPTION_MAX = 2000;
export const FULFILLMENT_MAX = 4000;
// How long the seller's invoice for a purchase stays payable. The buyer pays
// it within seconds of confirming; the window only covers a slow confirmation.
const PURCHASE_INVOICE_HOURS = 1;
const VERIFY_ATTEMPTS = 4;
const VERIFY_BACKOFF_MS = 1500;

function clean(raw, max, field, { required = false, multiline = false } = {}) {
	let s = String(raw ?? '').replace(multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ');
	s = multiline ? s.replace(/[ \t]+/g, ' ').trim() : s.replace(/\s+/g, ' ').trim();
	if (required && !s) throw new CommerceError(`invalid_${field}`, `${field} is required`);
	if (s.length > max) throw new CommerceError(`invalid_${field}`, `${field} must be at most ${max} characters`);
	return s || null;
}

function iso(v) {
	return v ? new Date(v).toISOString() : null;
}

/** An offer as the public (and buyers) see it. The fulfillment is never in it. */
export function shapeOffer(row, { owner = false } = {}) {
	const decimals = assetSpecSafe(row.asset, row.network)?.decimals ?? 0;
	const out = {
		id: row.id,
		title: row.title,
		description: row.description || null,
		price: formatAtomics(BigInt(row.price_atomics), decimals),
		price_atomics: String(row.price_atomics),
		asset: row.asset,
		symbol: row.asset === 'THREE' ? '$THREE' : row.asset,
		network: row.network,
		chain: 'solana',
		stock: row.stock,
		sold: row.sold_count,
		available: row.stock == null ? null : Math.max(0, row.stock - row.sold_count),
		status: row.status,
		seller: { agent_id: row.agent_id, name: row.agent_name || null },
		created_at: iso(row.created_at),
	};
	if (owner) out.fulfillment = row.fulfillment;
	return out;
}

function assetSpecSafe(asset, network) {
	try {
		return assetSpec(asset, network);
	} catch {
		return null;
	}
}

async function loadAgent(agentId) {
	const [row] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!row) throw new CommerceError('agent_not_found', 'agent not found', 404);
	return row;
}

async function loadOffer(id) {
	if (!isUuid(id)) return null;
	const [row] = await sql`
		SELECT o.*, a.name AS agent_name FROM agent_commerce_offers o
		LEFT JOIN agent_identities a ON a.id = o.agent_id
		WHERE o.id = ${id}
	`;
	return row || null;
}

// ── selling ─────────────────────────────────────────────────────────────────

export async function createOffer({ agentId, userId, title, description, price, asset, network, fulfillment, stock = null }) {
	const agent = await loadAgent(agentId);
	if (agent.user_id !== userId) throw new CommerceError('forbidden', 'that agent is not yours', 403);
	const a = normalizeAsset(asset);
	const net = normalizeNetwork(network);
	const spec = assetSpec(a, net);
	const atomics = parseAmount(price, spec.decimals);
	const t = clean(title, TITLE_MAX, 'title', { required: true });
	const d = clean(description, OFFER_DESCRIPTION_MAX, 'description', { multiline: true });
	const f = clean(fulfillment, FULFILLMENT_MAX, 'fulfillment', { required: true, multiline: true });
	let st = null;
	if (stock != null && stock !== '') {
		st = Number(stock);
		if (!Number.isInteger(st) || st < 1 || st > 1_000_000) throw new CommerceError('invalid_stock', 'stock must be a whole number from 1 to 1000000, or omitted for unlimited');
	}
	// The seller's wallet is where buyers pay, so make sure it exists now.
	await getOrCreateAgentSolanaWallet(agent.id);
	const [row] = await sql`
		INSERT INTO agent_commerce_offers (agent_id, user_id, title, description, network, asset, price_atomics, fulfillment, stock)
		VALUES (${agent.id}, ${userId}, ${t}, ${d}, ${net}, ${a}, ${atomics.toString()}, ${f}, ${st})
		RETURNING *
	`;
	row.agent_name = agent.name;
	return shapeOffer(row, { owner: true });
}

/** Active offers anyone can buy, newest first. Narrow by seller or asset. */
export async function listPublicOffers({ agentId = null, asset = null, network = null, limit = 25 } = {}) {
	const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
	if (agentId && !isUuid(agentId)) throw new CommerceError('invalid_agent_id', 'agent_id must be a uuid');
	const a = asset ? normalizeAsset(asset) : null;
	const n = network ? normalizeNetwork(network) : null;
	const rows = await sql`
		SELECT o.*, a.name AS agent_name FROM agent_commerce_offers o
		JOIN agent_identities a ON a.id = o.agent_id AND a.deleted_at IS NULL
		WHERE o.status = 'active'
		  AND (o.stock IS NULL OR o.sold_count < o.stock)
		  AND (${agentId}::uuid IS NULL OR o.agent_id = ${agentId}::uuid)
		  AND (${a}::text IS NULL OR o.asset = ${a}::text)
		  AND (${n}::text IS NULL OR o.network = ${n}::text)
		ORDER BY o.created_at DESC
		LIMIT ${lim}
	`;
	return rows.map((r) => shapeOffer(r));
}

/** Every offer the owner's agents list, any status. */
export async function listOwnerOffers({ userId, agentId = null, limit = 50 }) {
	const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
	if (agentId && !isUuid(agentId)) throw new CommerceError('invalid_agent_id', 'agent_id must be a uuid');
	const rows = await sql`
		SELECT o.*, a.name AS agent_name FROM agent_commerce_offers o
		LEFT JOIN agent_identities a ON a.id = o.agent_id
		WHERE o.user_id = ${userId} AND (${agentId}::uuid IS NULL OR o.agent_id = ${agentId}::uuid)
		ORDER BY (o.status = 'active') DESC, o.created_at DESC
		LIMIT ${lim}
	`;
	return rows.map((r) => shapeOffer(r, { owner: true }));
}

/** Pause, reopen or close an offer. Closed is final. */
export async function setOfferStatus({ userId, offerId, status, agentId = null }) {
	if (!OFFER_STATUSES.includes(status)) throw new CommerceError('invalid_status', `status must be one of ${OFFER_STATUSES.join(', ')}`);
	const row = await loadOffer(offerId);
	if (!row || row.user_id !== userId || (agentId && row.agent_id !== agentId)) throw new CommerceError('not_found', 'offer not found', 404);
	if (row.status === 'closed' && status !== 'closed') throw new CommerceError('offer_closed', 'A closed offer cannot be reopened. List a new one.', 409);
	const [updated] = await sql`
		UPDATE agent_commerce_offers SET status = ${status}, updated_at = now()
		WHERE id = ${row.id} RETURNING *
	`;
	updated.agent_name = row.agent_name;
	return shapeOffer(updated, { owner: true });
}

// ── buying ──────────────────────────────────────────────────────────────────

async function openSlots(offer) {
	if (offer.stock == null) return Infinity;
	const [{ n }] = await sql`
		SELECT count(*)::int AS n FROM agent_commerce_orders
		WHERE offer_id = ${offer.id} AND status IN ('pending', 'submitted')
	`;
	return offer.stock - offer.sold_count - n;
}

function assertBuyable(offer, buyer) {
	if (!offer) throw new CommerceError('offer_not_found', 'offer not found', 404);
	if (offer.status !== 'active') throw new CommerceError('offer_unavailable', `This offer is ${offer.status}.`, 409);
	if (offer.agent_id === buyer.id) throw new CommerceError('own_offer', 'An agent cannot buy its own offer.', 409);
}

/** Quote a purchase. Nothing is reserved or signed. */
export async function quoteBuy({ buyerAgentId, offerId }) {
	const buyer = await loadAgent(buyerAgentId);
	const offer = await loadOffer(offerId);
	assertBuyable(offer, buyer);
	if ((await openSlots(offer)) <= 0) throw new CommerceError('sold_out', 'This offer is sold out.', 409);
	const spec = assetSpec(offer.asset, offer.network);
	const { address: recipient } = await getOrCreateAgentSolanaWallet(offer.agent_id);
	const usd = await atomicsToUsd(offer.asset, BigInt(offer.price_atomics), spec.decimals);
	const payload = {
		offer_id: offer.id,
		seller_agent_id: offer.agent_id,
		title: offer.title,
		price_atomics: String(offer.price_atomics),
		asset: offer.asset,
		network: offer.network,
		recipient,
		usd,
	};
	const quote = await createQuote({ kind: 'buy', agentId: buyer.id, userId: buyer.user_id, payload });
	const amount = formatAtomics(BigInt(offer.price_atomics), spec.decimals);
	return {
		preview_id: quote.id,
		expires_at: quote.expires_at,
		offer: shapeOffer(offer),
		confirmation: {
			recipient: `${offer.agent_name || 'Seller agent'} (${recipient})`,
			amount: `${amount} ${spec.symbol}`,
			asset: spec.symbol,
			chain: offer.network === 'mainnet' ? 'Solana' : `Solana ${offer.network}`,
			usd,
		},
		note: 'Confirming pays the seller from this agent\'s wallet, inside its spend limits, and returns what was bought once the payment is verified on-chain.',
	};
}

/** Pay a quoted purchase and collect the goods. */
export async function confirmBuy({ buyerAgentId, previewId }) {
	const buyer = await loadAgent(buyerAgentId);
	let quote;
	try {
		quote = await consumeQuote({ id: previewId, kind: 'buy', agentId: buyer.id });
	} catch (err) {
		// A repeat confirm is how a buyer collects an order that settled late.
		if (err instanceof CommerceError && err.code === 'preview_used') return orderStatusForQuote(previewId, buyer);
		throw err;
	}
	const q = quote.payload;
	const offer = await loadOffer(q.offer_id);
	assertBuyable(offer, buyer);
	if (String(offer.price_atomics) !== q.price_atomics || offer.asset !== q.asset || offer.network !== q.network) {
		throw new CommerceError('offer_changed', 'The offer changed since the quote. Request a new quote.', 409);
	}
	if ((await openSlots(offer)) <= 0) throw new CommerceError('sold_out', 'This offer sold out since the quote.', 409);

	const { address: buyerWallet } = await getOrCreateAgentSolanaWallet(buyer.id);
	const [order] = await sql`
		INSERT INTO agent_commerce_orders (offer_id, quote_id, buyer_agent_id, buyer_user_id, seller_agent_id, status)
		VALUES (${offer.id}, ${quote.id}, ${buyer.id}, ${buyer.user_id}, ${offer.agent_id}, 'pending')
		RETURNING *
	`;
	const spec = assetSpec(offer.asset, offer.network);
	const invoice = await createInvoice({
		userId: offer.user_id,
		agentId: offer.agent_id,
		createdBy: 'agent',
		amount: formatAtomics(BigInt(offer.price_atomics), spec.decimals),
		asset: offer.asset,
		network: offer.network,
		memo: `Order: ${offer.title}`.slice(0, 140),
		payer: buyerWallet,
		payerLabel: buyer.name || 'Buyer agent',
		dueInHours: PURCHASE_INVOICE_HOURS,
		orderId: order.id,
		metadata: { kind: 'offer_purchase', offer_id: offer.id, buyer_agent_id: buyer.id },
	});
	await sql`UPDATE agent_commerce_orders SET invoice_id = ${invoice.id}, updated_at = now() WHERE id = ${order.id}`;

	let paid;
	try {
		paid = await agentTransfer({
			agentId: buyer.id,
			userId: buyer.user_id,
			network: offer.network,
			asset: offer.asset,
			recipient: invoice.recipient,
			atomics: BigInt(offer.price_atomics),
			reference: invoice.reference,
			memo: invoiceChainMemo(invoice.number),
			category: 'purchase',
			// The destination is the seller agent's platform wallet, resolved here
			// from the offer, never from the caller. Every numeric cap still runs.
			destinationTrust: 'system',
			rowMeta: { action: 'agent_buy', order_id: order.id, offer_id: offer.id, invoice_id: invoice.id },
		});
	} catch (err) {
		await sql`UPDATE agent_commerce_orders SET status = 'failed', error = ${(err?.code || 'payment_failed').slice(0, 80)}, updated_at = now() WHERE id = ${order.id}`;
		await cancelInvoice({ userId: offer.user_id, id: invoice.id, reason: 'The buyer\'s payment did not go through.' }).catch(() => {});
		await recordQuoteResult(quote.id, { status: 'failed', order_id: order.id, code: err?.code || null });
		if (err instanceof SpendLimitError) throw new CommerceError(err.code, err.message, 403, err.detail);
		throw err;
	}
	await sql`
		UPDATE agent_commerce_orders SET status = 'submitted', signature = ${paid.signature}, updated_at = now()
		WHERE id = ${order.id} AND status = 'pending'
	`;
	await settleWithRetry(invoice.id);
	const result = await describeOrder(order.id, buyer);
	await recordQuoteResult(quote.id, { status: result.status, order_id: order.id, signature: paid.signature });
	return result;
}

/**
 * Read the invoice until the chain shows the payment. submitProtected already
 * waited for confirmation, so this normally settles on the first read; the
 * retries cover an RPC node that indexes the reference a moment later.
 */
async function settleWithRetry(invoiceId) {
	for (let i = 0; i < VERIFY_ATTEMPTS; i++) {
		const inv = await verifyInvoice(invoiceId).catch(() => null);
		if (inv?.status === 'paid') return inv;
		if (i < VERIFY_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, VERIFY_BACKOFF_MS * (i + 1)));
	}
	return null;
}

async function orderStatusForQuote(quoteId, buyer) {
	const [order] = await sql`SELECT id, status, invoice_id FROM agent_commerce_orders WHERE quote_id = ${quoteId} AND buyer_agent_id = ${buyer.id}`;
	if (!order) throw new CommerceError('preview_used', 'That preview was already used and produced no order.', 409);
	if (order.status === 'submitted' && order.invoice_id) await verifyInvoice(order.invoice_id).catch(() => null);
	return describeOrder(order.id, buyer);
}

/** The buyer's view of an order. The fulfillment appears only once it is paid. */
export async function describeOrder(orderId, buyer) {
	const [o] = await sql`
		SELECT o.*, f.title, f.fulfillment, f.asset, f.network, f.price_atomics, a.name AS seller_name
		FROM agent_commerce_orders o
		JOIN agent_commerce_offers f ON f.id = o.offer_id
		LEFT JOIN agent_identities a ON a.id = o.seller_agent_id
		WHERE o.id = ${orderId} AND o.buyer_agent_id = ${buyer.id}
	`;
	if (!o) throw new CommerceError('order_not_found', 'order not found', 404);
	const inv = o.invoice_id ? await loadInvoiceRow(o.invoice_id) : null;
	const spec = assetSpecSafe(o.asset, o.network);
	const delivered = o.status === 'paid';
	return {
		status: delivered ? 'delivered' : o.status,
		order_id: o.id,
		offer: { id: o.offer_id, title: o.title, seller: o.seller_name || null },
		amount: spec ? `${formatAtomics(BigInt(o.price_atomics), spec.decimals)} ${spec.symbol}` : null,
		network: o.network,
		signature: o.signature || null,
		explorer_url: explorerTxUrl(o.signature, o.network),
		invoice: inv ? { id: inv.id, number: inv.number, status: inv.status, receipt_url: `/invoices/${inv.id}` } : null,
		fulfillment: delivered ? o.fulfillment : null,
		delivered_at: iso(o.delivered_at),
		error: o.error || null,
		message: delivered
			? 'Paid and verified on-chain. The fulfillment is included.'
			: o.status === 'submitted'
				? 'Payment sent; waiting for the chain to show it. Confirm the same preview again in a minute to collect the goods.'
				: o.status === 'failed'
					? `The purchase did not complete (${o.error || 'payment failed'}). Nothing was delivered.`
					: 'The order is open.',
	};
}

/** Orders an owner's agents placed, newest first, for the dashboard. */
export async function listOwnerPurchases({ userId, limit = 50 }) {
	const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
	const rows = await sql`
		SELECT o.id, o.status, o.signature, o.created_at, o.delivered_at, o.invoice_id, o.buyer_agent_id,
		       f.title, f.asset, f.network, f.price_atomics, f.fulfillment,
		       b.name AS buyer_name, s.name AS seller_name
		FROM agent_commerce_orders o
		JOIN agent_commerce_offers f ON f.id = o.offer_id
		LEFT JOIN agent_identities b ON b.id = o.buyer_agent_id
		LEFT JOIN agent_identities s ON s.id = o.seller_agent_id
		WHERE o.buyer_user_id = ${userId}
		ORDER BY o.created_at DESC
		LIMIT ${lim}
	`;
	return rows.map((r) => {
		const spec = assetSpecSafe(r.asset, r.network);
		return {
			id: r.id,
			status: r.status === 'paid' ? 'delivered' : r.status,
			title: r.title,
			buyer: { agent_id: r.buyer_agent_id, name: r.buyer_name || null },
			seller: r.seller_name || null,
			amount: spec ? formatAtomics(BigInt(r.price_atomics), spec.decimals) : null,
			symbol: r.asset === 'THREE' ? '$THREE' : r.asset,
			network: r.network,
			explorer_url: explorerTxUrl(r.signature, r.network),
			receipt_url: r.invoice_id ? `/invoices/${r.invoice_id}` : null,
			fulfillment: r.status === 'paid' ? r.fulfillment : null,
			created_at: iso(r.created_at),
			delivered_at: iso(r.delivered_at),
		};
	});
}
