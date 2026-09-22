// Whole-agent marketplace: every business rule in one place. The REST routes
// (api/v1/marketplace/agents/) and the MCP tools (api/_mcpagent/marketplace-tools.js)
// are thin adapters over these functions, so a rule changed here changes both.
//
// Money-moving calls take `confirm: true` and refuse without it. The MCP layer
// additionally requires a preview id from previewAction for the same action and
// arguments, so a model always shows the user the confirmation table first.

import { createHash, randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

import { sql } from '../db.js';
import { cacheGet, cacheSet } from '../cache.js';
import { logAudit } from '../audit.js';
import { insertNotification } from '../notify.js';
import { currentSignatureFor, agreementRequirement } from '../real-funds-agreement.js';
import { getSolanaAddressBalances } from '../agent-wallet.js';
import { getSpendLimits } from '../agent-trade-guards.js';
import { resolveMarketplacePayer } from '../solana/gasless-tx.js';
import { getAgentReputation, scoreAgentsLite } from '../trust/wallet-reputation.js';
import {
	currencyInfo, escrowAddressFor, formatAtomics, marketNetwork, parseAmount,
} from './chain.js';
import {
	agentWalletFundingStatus, buildFundingTransaction, FUND_WINDOW_MS, fundFromAgentWallet, newReference,
	refundBid, verifyConnectedFunding,
} from './escrow.js';
import * as store from './store.js';
import { effectiveFeeBps, feeRecipient, runTransfer, saleFeeBps, transferView } from './settlement.js';

export const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 30 * 24;
const DEFAULT_DURATION_HOURS = 7 * 24;
// How long an HTTP request drives settlement before handing it to the cron.
const INLINE_SETTLE_MS = 45_000;

function fail(status, code, message, extra = {}) {
	throw Object.assign(new Error(message), { status, code, expose: true, ...extra });
}

function isUuid(v) {
	return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function solanaAddressOrFail(value, field) {
	try {
		const pk = new PublicKey(String(value || '').trim());
		return pk.toBase58();
	} catch {
		return fail(400, 'bad_address', `${field} is not a valid Solana address`);
	}
}

function requireUser(user) {
	if (!user?.id) fail(401, 'unauthorized', 'sign in to use the agent marketplace');
}

function requireConfirm(confirm, what) {
	if (confirm !== true) fail(400, 'confirmation_required', `${what} moves real funds; pass confirm: true after showing the preview`);
}

async function requireAgreement(userId) {
	let signed;
	try {
		signed = await currentSignatureFor(userId);
	} catch {
		fail(503, 'agreement_check_unavailable', 'could not verify your signed real-funds agreements; nothing moved');
	}
	if (!signed) {
		const req = agreementRequirement();
		fail(403, 'risk_ack_required', `sign the real-funds agreements first at ${req.sign_url}`, { requirement: req });
	}
}

async function requireFeePayer() {
	if (!(await resolveMarketplacePayer())) {
		fail(503, 'fee_payer_unavailable', 'the marketplace fee payer is not configured, so escrow cannot settle');
	}
}

function money(atomics, currency) {
	const info = currencyInfo(currency);
	return `${formatAtomics(atomics, info.decimals)} ${info.symbol}`;
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function liveBalances(address) {
	if (!address) return null;
	const key = `agent-market:bal:${address}`;
	const hit = await cacheGet(key).catch(() => null);
	if (hit) return hit;
	const bal = await getSolanaAddressBalances(address, marketNetwork());
	if (bal.sol != null) await cacheSet(key, bal, 60).catch(() => {});
	return bal;
}

async function tradeSummary(agentId) {
	const [row] = await sql`
		SELECT count(*) FILTER (WHERE event = 'sold')::int AS sales,
		       max(amount_atomics) FILTER (WHERE event = 'sold' AND currency = 'USDC') AS best_sale_atomics,
		       max(created_at) FILTER (WHERE event = 'sold') AS last_sale_at
		FROM agent_marketplace_history WHERE agent_id = ${agentId}
	`;
	return {
		sales: row?.sales || 0,
		best_sale: row?.best_sale_atomics != null ? money(row.best_sale_atomics, 'USDC') : null,
		last_sale_at: row?.last_sale_at ? new Date(row.last_sale_at).toISOString() : null,
	};
}

/** Browse live listings with reputation and (when included) live balances. */
export async function browseListings({ q = '', sort = 'ending', limit = 24, cursor = 0, viewerId = null } = {}) {
	const lim = Math.min(48, Math.max(1, Number(limit) || 24));
	const offset = Math.max(0, Number(cursor) || 0);
	const { rows, hasMore } = await store.listListings({ q: String(q || '').trim(), sort: store.normalizeSort(sort), limit: lim, offset });
	const reps = await scoreAgentsLite(rows.map((r) => r.agent_id)).catch(() => new Map());
	const items = await Promise.all(rows.map(async (r) => {
		const v = store.listingView(r, { viewerId });
		const rep = reps.get(r.agent_id);
		v.reputation = rep ? { score: rep.score, tier: rep.tier, label: rep.tierLabel } : null;
		v.wallet_balance = r.include_balance ? await liveBalances(r.agent_solana_address).catch(() => null) : null;
		return v;
	}));
	return { items, next_cursor: hasMore ? String(offset + lim) : null };
}

/** Public, published agents that could be bought or bid on, with sale state. */
export async function browsePublicAgents({ q = '', limit = 24, cursor = 0 } = {}) {
	const lim = Math.min(48, Math.max(1, Number(limit) || 24));
	const offset = Math.max(0, Number(cursor) || 0);
	const qLike = q ? `%${String(q).trim().slice(0, 80)}%` : null;
	const rows = await sql`
		SELECT ai.id, ai.name, ai.description, ai.skills, ai.category, ai.user_id,
		       l.id AS listing_id, l.ask_usdc_atomics, l.min_bid_usdc_atomics, l.expires_at
		FROM agent_identities ai
		LEFT JOIN agent_listings l ON l.agent_id = ai.id AND l.status = 'active' AND l.expires_at > now()
		WHERE ai.deleted_at IS NULL AND ai.is_published = true
		  AND (${qLike}::text IS NULL OR ai.name ILIKE ${qLike} OR ai.description ILIKE ${qLike})
		ORDER BY (l.id IS NOT NULL) DESC, ai.views_count DESC NULLS LAST, ai.id
		LIMIT ${lim + 1} OFFSET ${offset}
	`;
	return {
		items: rows.slice(0, lim).map((r) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			skills: r.skills || [],
			category: r.category,
			url: `/agents/${r.id}`,
			for_sale: r.listing_id
				? {
					listing_id: r.listing_id,
					ask: r.ask_usdc_atomics != null ? money(r.ask_usdc_atomics, 'USDC') : null,
					min_bid: money(r.min_bid_usdc_atomics, 'USDC'),
					expires_at: new Date(r.expires_at).toISOString(),
					url: `/marketplace/agents/listing/${r.listing_id}`,
				}
				: null,
		})),
		next_cursor: rows.length > lim ? String(offset + lim) : null,
	};
}

/** Full listing detail: listing, bids, reputation, balance, history, transfer. */
export async function getListingDetail(listingId, viewerId = null) {
	if (!isUuid(listingId)) fail(404, 'not_found', 'listing not found');
	const row = await store.getListing(listingId);
	if (!row) fail(404, 'not_found', 'listing not found');
	const [bids, history, rep, balances, trades, transfer] = await Promise.all([
		store.listBidsForListing(listingId),
		store.listHistory({ listingId, limit: 50 }),
		getAgentReputation(row.agent_id, { lite: true }).catch(() => null),
		liveBalances(row.agent_solana_address).catch(() => null),
		tradeSummary(row.agent_id),
		store.getTransferForListing(listingId),
	]);
	const listing = store.listingView(row, { viewerId });
	listing.reputation = rep ? { score: rep.score, tier: rep.tier, label: rep.tierLabel } : null;
	listing.wallet_balance = balances;
	listing.trade_history = trades;
	listing.fee_bps = saleFeeBps();
	listing.what_transfers = whatTransfers(row);
	return {
		listing,
		bids: bids.map((b) => store.bidView(b, { viewerId })),
		history: history.map(store.historyView),
		transfer: transfer ? transferView(transfer, { viewerId }) : null,
	};
}

export async function getLiveListingForAgent(agentId, viewerId = null) {
	if (!isUuid(agentId)) fail(404, 'not_found', 'agent not found');
	const row = await store.getLiveListingForAgent(agentId);
	return row ? store.listingView(row, { viewerId }) : null;
}

export async function marketplaceHistory({ agentId = null, limit = 50 } = {}) {
	if (agentId && !isUuid(agentId)) fail(400, 'bad_request', 'agent_id must be a uuid');
	const rows = await store.listHistory({ agentId, limit: Math.min(200, Math.max(1, Number(limit) || 50)) });
	return rows.map(store.historyView);
}

export async function sellerDashboard(user) {
	requireUser(user);
	const [{ rows }, received] = await Promise.all([
		store.listListings({ sellerId: user.id, sort: 'newest', limit: 100 }),
		store.listBidsReceived(user.id),
	]);
	const transfers = await sql`
		SELECT * FROM agent_transfers WHERE seller_user_id = ${user.id} OR buyer_user_id = ${user.id}
		ORDER BY created_at DESC LIMIT 50
	`;
	return {
		listings: rows.map((r) => store.listingView(r, { viewerId: user.id })),
		received_bids: received.map((b) => store.bidView(b, { viewerId: user.id })),
		transfers: transfers.map((t) => transferView(t, { viewerId: user.id })),
	};
}

/**
 * The caller's own agents, for the listing form and agent-wallet bid funding:
 * wallet, live balance, and whether each is already listed or funding bids.
 */
export async function myAgents(user) {
	requireUser(user);
	const rows = await sql`
		SELECT ai.id, ai.name, ai.meta->>'solana_address' AS wallet_address,
		       EXISTS (SELECT 1 FROM agent_listings l WHERE l.agent_id = ai.id AND l.status IN ('active', 'settling')) AS listed,
		       (SELECT l.id FROM agent_listings l WHERE l.agent_id = ai.id AND l.status IN ('active', 'settling') LIMIT 1) AS listing_id,
		       EXISTS (SELECT 1 FROM agent_listing_bids b WHERE b.funding_agent_id = ai.id AND b.status IN ('awaiting_funds', 'open')) AS funding_bids
		FROM agent_identities ai
		WHERE ai.user_id = ${user.id} AND ai.deleted_at IS NULL
		ORDER BY ai.updated_at DESC NULLS LAST
		LIMIT 100
	`;
	return Promise.all(rows.map(async (r) => ({
		id: r.id,
		name: r.name,
		wallet_address: r.wallet_address,
		balance: r.wallet_address ? await liveBalances(r.wallet_address).catch(() => null) : null,
		listed: r.listed,
		listing_id: r.listing_id,
		funding_bids: r.funding_bids,
	})));
}

export async function myBids(user) {
	requireUser(user);
	const rows = await store.listBidsByBidder(user.id);
	return rows.map((b) => store.bidView(b, { viewerId: user.id }));
}

export async function receivedBids(user) {
	requireUser(user);
	const rows = await store.listBidsReceived(user.id);
	return rows.map((b) => store.bidView(b, { viewerId: user.id }));
}

export async function getTransferForViewer(transferId, user) {
	requireUser(user);
	if (!isUuid(transferId)) fail(404, 'not_found', 'transfer not found');
	const row = await store.getTransfer(transferId);
	if (!row || (row.buyer_user_id !== user.id && row.seller_user_id !== user.id)) fail(404, 'not_found', 'transfer not found');
	return transferView(row, { viewerId: user.id });
}

// ── What transfers ───────────────────────────────────────────────────────────

export function whatTransfers(listing) {
	return [
		{ item: 'Identity, name and public profile', transfers: true },
		{ item: 'Persona, system prompt and greeting', transfers: true },
		{ item: 'Installed skills and skill prices', transfers: true },
		{ item: '3D body (avatar)', transfers: true },
		{
			item: 'Wallet balance (SOL and every token)',
			transfers: Boolean(listing.include_balance),
			note: listing.include_balance
				? 'moves to the agent\'s new wallet'
				: 'swept to the seller before the handover',
		},
		{
			item: 'Memories, activity and mood history',
			transfers: Boolean(listing.include_history),
			note: listing.include_history ? undefined : 'deleted before the handover',
		},
		{ item: 'Custodial wallet key', transfers: false, note: 'replaced by a new key only the buyer controls; the old key is destroyed' },
		{ item: "Seller's allowlists, payout wallets, delegations, automations and social links", transfers: false, note: 'revoked; spend limits reset to conservative defaults and the wallet starts frozen' },
		{ item: 'Earnings the agent made before the sale', transfers: false, note: 'stay with the seller' },
	];
}

// ── Previews ─────────────────────────────────────────────────────────────────

function paramsHash(action, params) {
	const canon = JSON.stringify(Object.keys(params).sort().reduce((o, k) => {
		if (params[k] !== undefined && params[k] !== null && k !== 'preview_id' && !k.startsWith('confirm')) o[k] = params[k];
		return o;
	}, {}));
	return createHash('sha256').update(`${action}:${canon}`).digest('hex');
}

function tableText(rows) {
	return ['| Field | Value |', '|---|---|', ...rows.map((r) => `| ${r.label} | ${String(r.value).replace(/\|/g, '/')} |`)].join('\n');
}

/**
 * Build the confirmation table for a money-moving action without doing it,
 * and record it so the commit call can cite it. Throws the same precondition
 * errors the commit would, so a preview that succeeds describes a commit that
 * can succeed.
 */
export async function previewAction(user, action, params = {}) {
	requireUser(user);
	let preview;
	switch (action) {
		case 'create_listing': preview = await previewCreateListing(user, params); break;
		case 'delist': preview = await previewDelist(user, params); break;
		case 'place_bid': preview = await previewBid(user, params, 'bid'); break;
		case 'buy_now': preview = await previewBid(user, params, 'buy_now'); break;
		case 'accept_bid': preview = await previewAccept(user, params); break;
		case 'withdraw_bid': preview = await previewWithdraw(user, params); break;
		default: fail(400, 'bad_action', `unknown marketplace action "${action}"`);
	}
	const id = `amp_${randomUUID().replace(/-/g, '')}`;
	await sql`
		INSERT INTO agent_market_previews (id, user_id, action, params_hash, payload)
		VALUES (${id}, ${user.id}, ${action}, ${paramsHash(action, params)}, ${JSON.stringify(preview)}::jsonb)
	`;
	return { preview_id: id, action, expires_at: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(), ...preview, text: tableText(preview.table) };
}

/** Validate and consume a preview for a commit. Throws a designed error. */
export async function consumePreview(user, action, params, previewId, previewTool) {
	if (!previewId) fail(400, 'preview_required', `call ${previewTool} with action "${action}" first, show the user its table, then pass its preview_id`);
	const [row] = await sql`
		UPDATE agent_market_previews SET consumed_at = now()
		WHERE id = ${previewId} AND user_id = ${user.id} AND action = ${action}
		  AND consumed_at IS NULL AND created_at > now() - make_interval(secs => ${PREVIEW_TTL_MS / 1000})
		  AND params_hash = ${paramsHash(action, params)}
		RETURNING id
	`;
	if (!row) {
		fail(409, 'preview_stale', `that preview is missing, used, older than ten minutes, or was for different arguments; call ${previewTool} again`);
	}
}

// ── Listing ──────────────────────────────────────────────────────────────────

async function loadOwnedAgent(agentId, userId) {
	if (!isUuid(agentId)) fail(400, 'bad_request', 'agent_id must be a uuid');
	const [row] = await sql`
		SELECT id, user_id, name, description, persona_prompt, skills, meta, wallet_address, chain_id, deleted_at
		FROM agent_identities WHERE id = ${agentId} LIMIT 1
	`;
	if (!row || row.deleted_at) fail(404, 'agent_not_found', 'agent not found');
	if (row.user_id !== userId) fail(403, 'forbidden', "that agent isn't on your account");
	return row;
}

async function listingBlockers(agent) {
	const [row] = await sql`
		SELECT
		  (SELECT count(*)::int FROM agent_vaults WHERE agent_id = ${agent.id} AND status IN ('open', 'paused', 'closing')) AS vaults,
		  (SELECT count(*)::int FROM agent_recovery_requests WHERE agent_id = ${agent.id} AND status IN ('pending_approvals', 'time_locked', 'ready')) AS recoveries,
		  (SELECT count(*)::int FROM agent_listing_bids WHERE funding_agent_id = ${agent.id} AND status IN ('awaiting_funds', 'open')) AS funding_bids,
		  (SELECT count(*)::int FROM agent_listings WHERE agent_id = ${agent.id} AND status IN ('active', 'settling')) AS live
	`;
	if (row.live) fail(409, 'already_listed', 'this agent already has a live listing');
	if (row.vaults) fail(409, 'vault_open', 'this agent manages a vault holding backers\' funds; close the vault before selling the agent');
	if (row.recoveries) fail(409, 'recovery_pending', 'this agent has a pending recovery request; resolve it before listing');
	if (row.funding_bids) fail(409, 'agent_funding_bids', 'this agent is funding open marketplace bids; withdraw them before listing it');
}

async function listingWarnings(agent) {
	const warnings = [];
	const [coins] = await sql`
		SELECT (SELECT count(*)::int FROM pump_agent_mints WHERE agent_id = ${agent.id})
		     + (SELECT count(*)::int FROM agent_launched_coins WHERE agent_id = ${agent.id}) AS n
	`.catch(() => [{ n: 0 }]);
	if (coins?.n) {
		warnings.push(`This agent launched ${coins.n} coin(s). Creator fees accrue to its current wallet, whose key is destroyed at transfer: claim them before the sale settles.`);
	}
	if (agent.meta?.encrypted_wallet_key && agent.wallet_address) {
		warnings.push(`This agent also has a custodial EVM wallet (${agent.wallet_address}). Its balance follows the balance setting when you name an EVM payout address, and otherwise transfers with the agent.`);
	}
	const lim = getSpendLimits(agent.meta || {});
	if (lim.frozen) warnings.push('The agent wallet is frozen now; it stays frozen for the buyer until they unfreeze it.');
	return warnings;
}

async function defaultPayoutAddress(userId) {
	const [row] = await sql`
		SELECT address FROM user_wallets WHERE user_id = ${userId} AND chain_type = 'solana'
		ORDER BY is_primary DESC, last_used_at DESC NULLS LAST, created_at DESC LIMIT 1
	`;
	return row?.address || null;
}

async function normalizeListingParams(user, p) {
	const agent = await loadOwnedAgent(p.agent_id, user.id);
	const minBid = parseAmount(p.min_bid_usdc, 6);
	const askUsdc = p.ask_usdc != null && p.ask_usdc !== '' ? parseAmount(p.ask_usdc, 6) : null;
	const askThree = p.ask_three != null && p.ask_three !== '' ? parseAmount(p.ask_three, currencyInfo('THREE').decimals) : null;
	if (askUsdc != null && askUsdc < minBid) fail(400, 'bad_price', 'the buy-now price cannot be lower than the minimum bid');
	const hours = p.duration_hours == null ? DEFAULT_DURATION_HOURS : Number(p.duration_hours);
	if (!Number.isFinite(hours) || hours < MIN_DURATION_HOURS || hours > MAX_DURATION_HOURS) {
		fail(400, 'bad_duration', `duration_hours must be between ${MIN_DURATION_HOURS} and ${MAX_DURATION_HOURS}`);
	}
	const payoutRaw = p.payout_address || (await defaultPayoutAddress(user.id));
	if (!payoutRaw) fail(400, 'payout_address_required', 'name a Solana payout_address for the sale proceeds (no linked Solana wallet was found)');
	const payout = solanaAddressOrFail(payoutRaw, 'payout_address');
	if (payout === agent.meta?.solana_address) fail(400, 'bad_address', 'the payout address cannot be the agent\'s own wallet: that wallet is handed to the buyer');
	let payoutEvm = null;
	if (p.payout_evm_address) {
		if (!/^0x[0-9a-fA-F]{40}$/.test(String(p.payout_evm_address))) fail(400, 'bad_address', 'payout_evm_address is not a valid EVM address');
		payoutEvm = String(p.payout_evm_address);
	}
	const note = p.note ? String(p.note).trim().slice(0, 1000) : null;
	return {
		agent, minBid, askUsdc, askThree, hours, payout, payoutEvm, note,
		includeBalance: p.include_balance === true,
		includeHistory: p.include_history !== false,
	};
}

async function previewCreateListing(user, p) {
	const n = await normalizeListingParams(user, p);
	await listingBlockers(n.agent);
	const bal = await liveBalances(n.agent.meta?.solana_address).catch(() => null);
	const bps = await effectiveFeeBps('USDC');
	const refPrice = n.askUsdc ?? n.minBid;
	const fee = (refPrice * BigInt(bps)) / 10_000n;
	const table = [
		{ label: 'Agent', value: `${n.agent.name} (${n.agent.id})` },
		{ label: 'Buy-now price', value: n.askUsdc != null ? money(n.askUsdc, 'USDC') : 'none (auction only)' },
		...(n.askThree != null ? [{ label: 'Buy-now price in $THREE', value: money(n.askThree, 'THREE') }] : []),
		{ label: 'Minimum bid', value: money(n.minBid, 'USDC') },
		{ label: 'Ends', value: new Date(Date.now() + n.hours * 3_600_000).toISOString() },
		{ label: 'Wallet balance', value: n.includeBalance ? `transfers to the buyer (now ${bal?.sol ?? '?'} SOL, ${bal?.usdc ?? '?'} USDC)` : `swept to ${n.payout} before the handover` },
		{ label: 'History', value: n.includeHistory ? 'transfers' : 'deleted before the handover' },
		{ label: 'Proceeds to', value: n.payout },
		{ label: 'Platform fee', value: `${bps / 100}% (${money(fee, 'USDC')} at ${money(refPrice, 'USDC')})` },
		{ label: 'Chain', value: `Solana ${marketNetwork()}` },
	];
	return { table, warnings: await listingWarnings(n.agent), what_transfers: whatTransfers({ include_balance: n.includeBalance, include_history: n.includeHistory }) };
}

/** List an agent for sale. Committing: the agent can be sold once this runs. */
export async function createListing(user, p, { confirm = false } = {}) {
	requireUser(user);
	requireConfirm(confirm, 'Listing an agent');
	await requireAgreement(user.id);
	await requireFeePayer();
	const n = await normalizeListingParams(user, p);
	await listingBlockers(n.agent);
	const id = randomUUID();
	const escrowAddress = escrowAddressFor(id);
	const [rep, bal, warnings] = await Promise.all([
		getAgentReputation(n.agent.id, { lite: true }).catch(() => null),
		liveBalances(n.agent.meta?.solana_address).catch(() => null),
		listingWarnings(n.agent),
	]);
	const snapshot = {
		persona_summary: String(n.agent.description || n.agent.persona_prompt || '').slice(0, 280),
		skills: n.agent.skills || [],
		wallet_address: n.agent.meta?.solana_address || null,
		wallet_balance: bal,
		reputation: rep ? { score: rep.score, tier: rep.tier } : null,
		warnings,
		payout_evm_address: n.payoutEvm,
		fee_bps_at_listing: saleFeeBps(),
	};
	try {
		await store.insertListing({
			id, agentId: n.agent.id, sellerUserId: user.id, askUsdc: n.askUsdc != null ? String(n.askUsdc) : null,
			askThree: n.askThree != null ? String(n.askThree) : null, minBid: String(n.minBid),
			expiresAt: new Date(Date.now() + n.hours * 3_600_000), includeBalance: n.includeBalance,
			includeHistory: n.includeHistory, payoutAddress: n.payout, escrowAddress, note: n.note, snapshot,
		});
	} catch (err) {
		if (err?.code === '23505') fail(409, 'already_listed', 'this agent already has a live listing');
		throw err;
	}
	await store.addHistory({
		agentId: n.agent.id, listingId: id, actorUserId: user.id, event: 'listed',
		currency: 'USDC', amount: n.askUsdc ?? n.minBid, meta: { min_bid: String(n.minBid), ask: n.askUsdc != null ? String(n.askUsdc) : null },
	});
	logAudit({ userId: user.id, action: 'agent_market.listed', resourceId: n.agent.id, meta: { listing_id: id } });
	return getListingDetail(id, user.id);
}

async function loadSellerListing(user, listingId) {
	if (!isUuid(listingId)) fail(404, 'not_found', 'listing not found');
	const row = await store.getListing(listingId);
	if (!row) fail(404, 'not_found', 'listing not found');
	if (row.seller_user_id !== user.id) fail(403, 'forbidden', 'only the seller can do that');
	return row;
}

async function previewDelist(user, p) {
	const row = await loadSellerListing(user, p.listing_id);
	if (row.status !== 'active') fail(409, 'not_active', `this listing is ${row.status}`);
	const bids = (await store.listBidsForListing(row.id)).filter((b) => b.status === 'open');
	const table = [
		{ label: 'Listing', value: `${row.agent_name} (${row.id})` },
		{ label: 'Open bids refunded', value: String(bids.length) },
		...bids.map((b) => ({ label: `Refund ${b.id.slice(0, 8)}`, value: `${money(b.amount_atomics, b.currency)} to ${b.funding_address}` })),
		{ label: 'Chain', value: `Solana ${marketNetwork()}` },
	];
	return { table, warnings: [] };
}

/** Take a listing down and refund every open bid. */
export async function delistListing(user, listingId, { confirm = false } = {}) {
	requireUser(user);
	requireConfirm(confirm, 'Delisting refunds every open bid and');
	const row = await loadSellerListing(user, listingId);
	const closed = await store.closeListing({ listingId: row.id, sellerId: user.id, to: 'delisted', bidStatus: 'rejected' });
	if (!closed) fail(409, 'not_active', 'this listing is no longer active (it may already be settling a sale)');
	await store.addHistory({ agentId: row.agent_id, listingId: row.id, actorUserId: user.id, event: 'delisted', meta: { refunds: closed.refunds } });
	await refundPendingForListing(row.id);
	return getListingDetail(row.id, user.id);
}

// ── Bids ─────────────────────────────────────────────────────────────────────

async function loadActiveListingForBid(user, listingId) {
	if (!isUuid(listingId)) fail(404, 'not_found', 'listing not found');
	const row = await store.getListing(listingId);
	if (!row) fail(404, 'not_found', 'listing not found');
	if (row.status !== 'active' || new Date(row.expires_at).getTime() <= Date.now()) fail(409, 'not_active', 'this listing is no longer taking bids');
	if (row.seller_user_id === user.id || row.agent_owner_id === user.id) fail(403, 'own_listing', 'you cannot bid on your own agent');
	return row;
}

async function resolveFunding(user, p, currency) {
	const source = p.funding_source === 'agent_wallet' ? 'agent_wallet' : 'connected_wallet';
	if (source === 'agent_wallet') {
		if (currency !== 'USDC') fail(400, 'bad_funding', '$THREE buy-now payments come from a connected wallet');
		if (!isUuid(p.funding_agent_id)) fail(400, 'bad_funding', 'funding_agent_id is required to pay from an agent wallet');
		const [agent] = await sql`
			SELECT id, user_id, name, meta, deleted_at FROM agent_identities WHERE id = ${p.funding_agent_id} LIMIT 1
		`;
		if (!agent || agent.deleted_at || agent.user_id !== user.id) fail(403, 'forbidden', "that funding agent isn't on your account");
		if (!agent.meta?.solana_address || !agent.meta?.encrypted_solana_secret) fail(409, 'no_wallet', 'that agent has no Solana wallet yet');
		const [live] = await sql`SELECT 1 FROM agent_listings WHERE agent_id = ${agent.id} AND status IN ('active', 'settling') LIMIT 1`;
		if (live) fail(409, 'funding_agent_listed', 'that agent is listed for sale, so it cannot fund bids');
		return { source, agent, address: agent.meta.solana_address };
	}
	return { source, agent: null, address: solanaAddressOrFail(p.wallet_address, 'wallet_address') };
}

async function bidTerms(user, p, kind) {
	const listing = await loadActiveListingForBid(user, p.listing_id);
	const currency = kind === 'buy_now' && p.currency === 'THREE' ? 'THREE' : 'USDC';
	let amount;
	if (kind === 'buy_now') {
		const ask = currency === 'THREE' ? listing.ask_three_atomics : listing.ask_usdc_atomics;
		if (ask == null) fail(409, 'no_buy_now', currency === 'THREE' ? 'this listing has no $THREE price' : 'this listing has no buy-now price; place a bid instead');
		amount = BigInt(String(ask));
	} else {
		amount = parseAmount(p.amount_usdc, 6);
		if (amount < BigInt(String(listing.min_bid_usdc_atomics))) fail(400, 'below_minimum', `the minimum bid is ${money(listing.min_bid_usdc_atomics, 'USDC')}`);
		if (listing.top_bid_atomics != null && amount <= BigInt(String(listing.top_bid_atomics))) {
			fail(400, 'not_highest', `bids must beat the current top bid of ${money(listing.top_bid_atomics, 'USDC')}`);
		}
		if (listing.ask_usdc_atomics != null && amount >= BigInt(String(listing.ask_usdc_atomics))) {
			fail(400, 'use_buy_now', `that meets the buy-now price of ${money(listing.ask_usdc_atomics, 'USDC')}; use buy now instead`);
		}
	}
	const funding = await resolveFunding(user, p, currency);
	return { listing, currency, amount, funding };
}

async function previewBid(user, p, kind) {
	const t = await bidTerms(user, p, kind);
	const info = currencyInfo(t.currency);
	const table = [
		{ label: 'Action', value: kind === 'buy_now' ? 'Buy now (settles immediately)' : 'Place bid' },
		{ label: 'Agent', value: `${t.listing.agent_name} (${t.listing.agent_id})` },
		{ label: 'Amount', value: money(t.amount, t.currency) },
		{ label: 'Token', value: `${info.symbol} (${info.mint})` },
		{ label: 'Chain', value: `Solana ${marketNetwork()}` },
		{ label: 'Recipient (escrow)', value: t.listing.escrow_address },
		{ label: 'Paid from', value: t.funding.source === 'agent_wallet' ? `agent ${t.funding.agent.name} wallet ${t.funding.address}` : `connected wallet ${t.funding.address}` },
		{ label: 'Refunded to', value: t.funding.address + ' if the bid is rejected, withdrawn, outbid at close, or expires' },
	];
	const warnings = kind === 'buy_now'
		? ['Buy now accepts the seller\'s price: once the escrow transfer lands, the sale settles and custody rotates to you.']
		: [];
	return { table, warnings, what_transfers: whatTransfers(t.listing) };
}

/**
 * Place a bid (or buy now). From an agent wallet the escrow transfer happens
 * here and the bid comes back open; from a connected wallet the bid comes back
 * awaiting funds with the transaction to sign.
 */
export async function placeBid(user, p, { confirm = false, kind = 'bid' } = {}) {
	requireUser(user);
	requireConfirm(confirm, kind === 'buy_now' ? 'Buying an agent' : 'A bid');
	await requireAgreement(user.id);
	await requireFeePayer();
	const t = await bidTerms(user, p, kind);
	const bid = await store.insertBid({
		id: randomUUID(), listingId: t.listing.id, bidderUserId: user.id, kind, currency: t.currency, amount: t.amount,
		fundingSource: t.funding.source, fundingAgentId: t.funding.agent?.id || null, fundingAddress: t.funding.address,
		reference: t.funding.source === 'connected_wallet' ? newReference() : null,
		fundBy: new Date(Date.now() + FUND_WINDOW_MS),
	});
	await store.addHistory({
		agentId: t.listing.agent_id, listingId: t.listing.id, bidId: bid.id, actorUserId: user.id,
		event: kind === 'buy_now' ? 'buy_now_started' : 'bid_placed', currency: t.currency, amount: t.amount,
		meta: { funding_source: t.funding.source },
	});

	if (t.funding.source === 'connected_wallet') {
		const tx = await buildFundingTransaction({ bid, listing: t.listing });
		return { bid: store.bidView(bid, { viewerId: user.id }), funding: { status: 'awaiting_signature', ...tx } };
	}

	let signature;
	try {
		({ signature } = await fundFromAgentWallet({ bid, listing: t.listing, fundingAgent: t.funding.agent }));
	} catch (err) {
		if (err.code !== 'unconfirmed') await store.expireUnfundedBid(bid.id, err.code || 'funding_failed');
		throw err;
	}
	return onFunded(user, bid.id, signature);
}

/** Confirm a connected-wallet bid once its escrow transfer has landed. */
export async function confirmBidFunding(user, bidId, { signature = null } = {}) {
	requireUser(user);
	if (!isUuid(bidId)) fail(404, 'not_found', 'bid not found');
	const bid = await store.getBid(bidId);
	if (!bid || bid.bidder_user_id !== user.id) fail(404, 'not_found', 'bid not found');
	if (bid.status !== 'awaiting_funds') return { bid: store.bidView(bid, { viewerId: user.id }), funding: { status: 'already_recorded' } };
	if (bid.funding_source !== 'connected_wallet') fail(409, 'not_wallet_bid', 'this bid is funded from an agent wallet');
	const listing = await store.getListing(bid.listing_id);
	const sig = await verifyConnectedFunding({ bid, listing, signature });
	if (!sig) return { bid: store.bidView(bid, { viewerId: user.id }), funding: { status: 'not_landed' } };
	return onFunded(user, bid.id, sig);
}

/** Rebuild the transaction for an unfunded connected-wallet bid (blockhash expired). */
export async function rebuildFundingTransaction(user, bidId) {
	requireUser(user);
	const bid = isUuid(bidId) ? await store.getBid(bidId) : null;
	if (!bid || bid.bidder_user_id !== user.id) fail(404, 'not_found', 'bid not found');
	if (bid.status !== 'awaiting_funds' || bid.funding_source !== 'connected_wallet') fail(409, 'not_awaiting', 'this bid is not waiting for a wallet signature');
	if (new Date(bid.fund_by).getTime() - Date.now() < 3 * 60 * 1000) fail(409, 'fund_window_closing', 'this bid\'s funding window is closing; place a new bid');
	const listing = await store.getListing(bid.listing_id);
	return { bid: store.bidView(bid, { viewerId: user.id }), funding: { status: 'awaiting_signature', ...(await buildFundingTransaction({ bid, listing })) } };
}

async function onFunded(user, bidId, signature) {
	let funded;
	try {
		funded = await store.markBidFunded(bidId, signature);
	} catch (err) {
		if (err?.code === '23505') fail(409, 'signature_reused', 'that transaction already funded another bid');
		throw err;
	}
	const bid = funded || (await store.getBid(bidId));
	const listing = await store.getListing(bid.listing_id);
	await store.addHistory({
		agentId: listing.agent_id, listingId: listing.id, bidId: bid.id, actorUserId: bid.bidder_user_id,
		event: 'bid_funded', currency: bid.currency, amount: bid.amount_atomics, signature,
	});

	if (bid.status === 'expired') {
		await processRefund(bid.id);
		fail(409, 'listing_closed', 'the listing closed before your escrow transfer landed; it is being refunded', { bid_id: bid.id });
	}

	// A higher bid from the same bidder replaces their earlier open ones.
	const older = await sql`
		UPDATE agent_listing_bids SET status = 'withdrawn', refund_status = 'pending', decided_at = now(), updated_at = now()
		WHERE listing_id = ${bid.listing_id} AND bidder_user_id = ${bid.bidder_user_id} AND status = 'open' AND id <> ${bid.id}
		RETURNING id
	`;
	for (const o of older) await processRefund(o.id).catch(() => {});

	if (bid.kind === 'buy_now') {
		return { bid: store.bidView(bid, { viewerId: user.id }), ...(await settleAccepted({ listing, bid, actorId: bid.bidder_user_id, bySystem: true })) };
	}
	insertNotification(listing.seller_user_id, 'agent_bid_received', {
		agent_id: listing.agent_id, listing_id: listing.id, bid_id: bid.id, amount: money(bid.amount_atomics, bid.currency),
	});
	return { bid: store.bidView(bid, { viewerId: user.id }), funding: { status: 'escrowed', signature } };
}

async function loadBidAndListing(bidId) {
	if (!isUuid(bidId)) fail(404, 'not_found', 'bid not found');
	const bid = await store.getBid(bidId);
	if (!bid) fail(404, 'not_found', 'bid not found');
	const listing = await store.getListing(bid.listing_id);
	return { bid, listing };
}

async function previewAccept(user, p) {
	const { bid, listing } = await loadBidAndListing(p.bid_id);
	if (listing.seller_user_id !== user.id) fail(403, 'forbidden', 'only the seller can accept a bid');
	if (bid.status !== 'open') fail(409, 'bid_not_open', `this bid is ${bid.status}`);
	const bps = await effectiveFeeBps(bid.currency);
	const gross = BigInt(String(bid.amount_atomics));
	const fee = (gross * BigInt(bps)) / 10_000n;
	const table = [
		{ label: 'Agent', value: `${listing.agent_name} (${listing.agent_id})` },
		{ label: 'Winning bid', value: money(gross, bid.currency) },
		{ label: 'Platform fee', value: `${money(fee, bid.currency)} (${bps / 100}%) to ${(await feeRecipient(bid.currency)) || 'none'}` },
		{ label: 'You receive', value: `${money(gross - fee, bid.currency)} at ${listing.payout_address}` },
		{ label: 'Paid from (escrow)', value: listing.escrow_address },
		{ label: 'Chain', value: `Solana ${marketNetwork()}` },
		{ label: 'Other open bids', value: 'rejected and refunded' },
		{ label: 'New owner', value: bid.bidder_user_id },
	];
	return {
		table,
		warnings: ['Accepting is final: the agent, its identity and (per the listing) its balance move to the buyer, and its wallet key is replaced.'],
		what_transfers: whatTransfers(listing),
	};
}

async function settleAccepted({ listing, bid, actorId, bySystem }) {
	const feeBps = await effectiveFeeBps(bid.currency);
	const accepted = await store.acceptBidAtomically({ listingId: listing.id, bidId: bid.id, sellerId: bySystem ? null : actorId, feeBps });
	if (!accepted) {
		if (bySystem) {
			const refundable = await store.decideBid({ bidId: bid.id, to: 'expired' });
			if (refundable) await processRefund(bid.id).catch(() => {});
		}
		fail(409, 'accept_lost', 'the listing or bid changed before it could be accepted (another bid may have won)');
	}
	await store.addHistory({
		agentId: listing.agent_id, listingId: listing.id, bidId: bid.id, transferId: accepted.transfer_id, actorUserId: actorId,
		event: 'accepted', currency: bid.currency, amount: bid.amount_atomics, meta: { rejected_others: accepted.rejected },
	});
	logAudit({ userId: actorId, action: 'agent_market.accepted', resourceId: listing.agent_id, meta: { listing_id: listing.id, bid_id: bid.id } });
	await refundPendingForListing(listing.id);
	const run = await runTransfer(accepted.transfer_id, { deadlineMs: INLINE_SETTLE_MS });
	return { transfer: transferView(run.transfer, { viewerId: actorId }), settlement_error: run.error || null };
}

/** Seller accepts an open bid: settlement and custody rotation start at once. */
export async function acceptBid(user, bidId, { confirm = false } = {}) {
	requireUser(user);
	requireConfirm(confirm, 'Accepting a bid sells the agent and');
	await requireAgreement(user.id);
	const { bid, listing } = await loadBidAndListing(bidId);
	if (listing.seller_user_id !== user.id) fail(403, 'forbidden', 'only the seller can accept a bid');
	if (bid.status !== 'open') fail(409, 'bid_not_open', `this bid is ${bid.status}`);
	return settleAccepted({ listing, bid, actorId: user.id, bySystem: false });
}

export async function rejectBid(user, bidId) {
	requireUser(user);
	const { bid, listing } = await loadBidAndListing(bidId);
	if (listing.seller_user_id !== user.id) fail(403, 'forbidden', 'only the seller can reject a bid');
	const row = await store.decideBid({ bidId: bid.id, to: 'rejected', sellerId: user.id });
	if (!row) fail(409, 'bid_not_open', `this bid is ${bid.status}`);
	await store.addHistory({ agentId: listing.agent_id, listingId: listing.id, bidId: bid.id, actorUserId: user.id, event: 'bid_rejected', currency: bid.currency, amount: bid.amount_atomics });
	insertNotification(bid.bidder_user_id, 'agent_bid_rejected', { agent_id: listing.agent_id, listing_id: listing.id, bid_id: bid.id, amount: money(bid.amount_atomics, bid.currency) });
	const refund = await processRefund(bid.id);
	return { bid: store.bidView(await store.getBid(bid.id), { viewerId: user.id }), refund };
}

async function previewWithdraw(user, p) {
	const { bid, listing } = await loadBidAndListing(p.bid_id);
	if (bid.bidder_user_id !== user.id) fail(403, 'forbidden', 'only the bidder can withdraw a bid');
	if (bid.status !== 'open') fail(409, 'bid_not_open', `this bid is ${bid.status}`);
	const table = [
		{ label: 'Agent', value: listing.agent_name },
		{ label: 'Refund', value: money(bid.amount_atomics, bid.currency) },
		{ label: 'From (escrow)', value: listing.escrow_address },
		{ label: 'To', value: bid.funding_address },
		{ label: 'Chain', value: `Solana ${marketNetwork()}` },
	];
	return { table, warnings: [] };
}

export async function withdrawBid(user, bidId, { confirm = false } = {}) {
	requireUser(user);
	requireConfirm(confirm, 'Withdrawing a bid');
	const { bid, listing } = await loadBidAndListing(bidId);
	if (bid.bidder_user_id !== user.id) fail(403, 'forbidden', 'only the bidder can withdraw a bid');
	const row = await store.decideBid({ bidId: bid.id, to: 'withdrawn', bidderId: user.id });
	if (!row) fail(409, 'bid_not_open', `this bid is ${bid.status}`);
	await store.addHistory({ agentId: listing.agent_id, listingId: listing.id, bidId: bid.id, actorUserId: user.id, event: 'bid_withdrawn', currency: bid.currency, amount: bid.amount_atomics });
	const refund = await processRefund(bid.id);
	return { bid: store.bidView(await store.getBid(bid.id), { viewerId: user.id }), refund };
}

// ── Refunds ──────────────────────────────────────────────────────────────────

/**
 * Send one pending refund under a lease. Errors are recorded on the bid for
 * the sweep cron to retry; the return value says what happened.
 */
export async function processRefund(bidId) {
	const [bid] = await sql`
		UPDATE agent_listing_bids
		SET refund_locked_until = now() + interval '3 minutes', refund_attempts = refund_attempts + 1, updated_at = now()
		WHERE id = ${bidId} AND refund_status IN ('pending', 'failed')
		  AND (refund_locked_until IS NULL OR refund_locked_until < now())
		RETURNING *
	`;
	if (!bid) return { status: 'not_due' };
	const [listing] = await sql`SELECT * FROM agent_listings WHERE id = ${bid.listing_id}`;
	try {
		const { signature, destination } = await refundBid({ bid, listing });
		await sql`
			UPDATE agent_listing_bids
			SET refund_status = 'sent', refund_signature = ${signature}, refund_error = NULL, refund_locked_until = NULL, updated_at = now()
			WHERE id = ${bid.id}
		`;
		await store.addHistory({
			agentId: listing.agent_id, listingId: listing.id, bidId: bid.id, event: 'bid_refunded',
			currency: bid.currency, amount: bid.amount_atomics, signature, meta: { to: destination },
		});
		insertNotification(bid.bidder_user_id, 'agent_bid_refunded', {
			listing_id: listing.id, bid_id: bid.id, amount: money(bid.amount_atomics, bid.currency), signature,
		});
		return { status: 'sent', signature, destination };
	} catch (err) {
		await sql`
			UPDATE agent_listing_bids
			SET refund_status = 'failed', refund_error = ${String(err?.message || err).slice(0, 400)}, refund_locked_until = NULL, updated_at = now()
			WHERE id = ${bid.id}
		`;
		return { status: 'retrying', code: err?.code || 'refund_failed', message: err?.message };
	}
}

async function refundPendingForListing(listingId) {
	const due = await sql`SELECT id FROM agent_listing_bids WHERE listing_id = ${listingId} AND refund_status IN ('pending', 'failed')`;
	for (const b of due) await processRefund(b.id).catch(() => {});
}

// ── Resume ───────────────────────────────────────────────────────────────────

/** The failure state's resume action: either party may drive it forward. */
export async function resumeTransfer(user, transferId) {
	requireUser(user);
	if (!isUuid(transferId)) fail(404, 'not_found', 'transfer not found');
	const row = await store.getTransfer(transferId);
	if (!row || (row.buyer_user_id !== user.id && row.seller_user_id !== user.id)) fail(404, 'not_found', 'transfer not found');
	if (row.status === 'completed') return { transfer: transferView(row, { viewerId: user.id }) };
	const run = await runTransfer(transferId, { deadlineMs: INLINE_SETTLE_MS });
	if (run.busy) fail(409, 'transfer_busy', 'settlement is already running for this transfer; refresh in a moment');
	return { transfer: transferView(run.transfer, { viewerId: user.id }), settlement_error: run.error || null };
}

export { agentWalletFundingStatus, isUuid };
