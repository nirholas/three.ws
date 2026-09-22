// Agent cards service: the one place card purchases, status, reveals and
// withdrawals happen. The REST routes (api/v1/agent-cards.js) and the MCP tools
// (api/_mcp/tools/cards.js) are thin boundaries over these functions.
//
// Money path (live mode)
//   quote   creates the provider's price-locked USDC invoice and stores it as a
//           card row in status 'quoted' for QUOTE_TTL_MS.
//   create  requires confirm_spend === true and that fresh quote id. It claims
//           the quote atomically (so it settles at most once), re-reads the
//           provider invoice to prove the address and exact amount are
//           unchanged, then pays through transferUsdcGuarded: the custody
//           reserve under the agent's spend limits, natural-language policy,
//           capability scope and the anomaly freeze, all before any key is
//           touched, with the spend recorded in agent_custody_events.
//
// Secret path
//   On delivery the redemption data is fetched once, secret-box encrypted
//   (the custodial-wallet scheme) and stored; only a masked form and the list
//   of field names are kept in the clear. `data` issues a single-use reveal
//   grant; `reveal` requires confirm_reveal === true plus that grant, returns
//   the secret, clears the ciphertext in the same statement, and logs who
//   revealed what (field names, never values) in agent_card_events.

import { createHash, randomBytes } from 'node:crypto';
import { sql } from '../db.js';
import { encryptSecret, decryptSecret } from '../agent-wallet.js';
import { transferUsdcGuarded } from '../agent-usdc-transfer.js';
import { currentSignatureFor, agreementRequirement } from '../real-funds-agreement.js';
import { logAudit } from '../audit.js';
import { getCardProvider, CardProviderError, DEFAULT_PROVIDER } from './provider.js';
import { resolveDenomination } from './bitrefill.js';

export const QUOTE_TTL_MS = 10 * 60 * 1000;
export const REVEAL_GRANT_TTL_MS = 5 * 60 * 1000;
const MAX_QUOTES_PER_HOUR = 30;
const OPEN_STATUSES = ['paying', 'processing', 'needs_verification'];
const TERMINAL = new Set(['delivered', 'failed', 'refunded', 'cancelled', 'expired']);
const POLL_ATTEMPTS = 4;
const POLL_GAP_MS = 2500;

/** Live purchases are enabled per deploy; sandbox always works. */
export function liveCardsEnabled() {
	return process.env.AGENT_CARDS_LIVE === '1';
}

export class CardError extends Error {
	constructor(status, code, message, details = null) {
		super(message);
		this.name = 'CardError';
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

/** Map an adapter error onto the service error shape. */
function fromProvider(e) {
	if (e instanceof CardProviderError) return new CardError(e.status, e.code, e.message, e.detail || null);
	return e;
}

async function withProvider(fn) {
	try {
		return await fn();
	} catch (e) {
		throw fromProvider(e);
	}
}

function actorKind(principal) {
	if (!principal) return 'system';
	if (principal.source === 'session') return 'owner_session';
	if (principal.source === 'apikey') return 'api_key';
	if (principal.source === 'oauth') return 'oauth';
	if (principal.source === 'mcp') return 'mcp';
	return String(principal.source || 'owner');
}

/** Load an agent the principal owns, or throw a designed 401/403/404. */
export async function loadOwnedAgent(agentId, principal) {
	if (!principal?.userId) throw new CardError(401, 'unauthorized', 'Sign in to manage agent cards.');
	if (!/^[0-9a-f-]{36}$/i.test(String(agentId || ''))) {
		throw new CardError(400, 'invalid_agent_id', 'agent id must be a UUID');
	}
	const [agent] = await sql`
		SELECT id, user_id, name, meta
		FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!agent) throw new CardError(404, 'agent_not_found', 'Agent not found.');
	if (agent.user_id !== principal.userId) {
		throw new CardError(403, 'forbidden', 'Only the owner of this agent can manage its cards.');
	}
	return agent;
}

async function recordCardEvent(card, principal, event, { from = null, to = null, detail = {}, grantHash = null, grantExpiresAt = null } = {}) {
	const [row] = await sql`
		INSERT INTO agent_card_events
			(card_id, agent_id, actor_user_id, actor_kind, event, from_status, to_status,
			 grant_hash, grant_expires_at, ip, detail)
		VALUES (
			${card.id}, ${card.agent_id}, ${principal?.userId ?? null}, ${actorKind(principal)}, ${event},
			${from}, ${to}, ${grantHash}, ${grantExpiresAt}, ${principal?.ip ?? null},
			${JSON.stringify(detail)}::jsonb
		)
		RETURNING id, created_at
	`;
	return row;
}

/** The owner-facing shape of a card. Never includes the ciphertext. */
export function cardView(row) {
	if (!row) return null;
	return {
		id: row.id,
		agent_id: row.agent_id,
		provider: row.provider,
		mode: row.mode,
		kind: row.kind,
		product_id: row.product_id,
		product_name: row.product_name,
		merchant: row.merchant,
		country_code: row.country_code,
		image_url: row.image_url,
		face_value: Number(row.face_value),
		currency: row.currency,
		status: row.status,
		provider_status: row.provider_status,
		total_usdc: Number(row.quote_total_usdc),
		fee_usdc: Number(row.quote_fee_usdc),
		quote_expires_at: row.quote_expires_at,
		pay_address: row.pay_address,
		pay_network: row.pay_network,
		pay_signature: row.pay_signature,
		pay_explorer: row.pay_signature ? `https://solscan.io/tx/${row.pay_signature}` : null,
		masked_number: row.masked_number,
		secret_fields: row.secret_fields || [],
		redeem_instructions: row.redeem_instructions,
		expires_on: row.expires_on,
		revealed_at: row.revealed_at,
		reveal_count: Number(row.reveal_count || 0),
		error_code: row.error_code,
		error_message: row.error_message,
		created_at: row.created_at,
		updated_at: row.updated_at,
		delivered_at: row.delivered_at,
	};
}

function quoteView(row, product) {
	const card = cardView(row);
	const live = row.mode === 'live';
	return {
		quote_id: row.id,
		mode: row.mode,
		product: product ? {
			id: product.id, name: product.name, merchant: product.merchant, kind: product.kind,
			country_code: product.country_code, image_url: product.image_url,
		} : { id: row.product_id, name: row.product_name, merchant: row.merchant, kind: row.kind },
		face_value: card.face_value,
		currency: card.currency,
		total_usdc: card.total_usdc,
		fee_usdc: card.fee_usdc,
		expires_at: row.quote_expires_at,
		// The exact table an owner must see before saying yes (stop-and-ask gate 1).
		confirm: {
			recipient: live ? row.pay_address : `${row.provider} sandbox (test product, no funds move)`,
			amount: live ? card.total_usdc.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : '0',
			token: 'USDC',
			chain: 'Solana',
			buys: `${card.merchant} ${row.kind === 'prepaid_card' ? 'prepaid card' : 'gift card'}, ${card.face_value} ${card.currency}`,
			provider: row.provider,
		},
		next: {
			tool: 'agent_card_create',
			args: { agent_id: row.agent_id, quote_id: row.id, confirm_spend: true },
			note: 'Show the confirm table to the owner and wait for an explicit yes before calling agent_card_create.',
		},
	};
}

// ── catalog ──────────────────────────────────────────────────────────────────

function providerFor(name) {
	try {
		return getCardProvider(name || DEFAULT_PROVIDER);
	} catch (e) {
		throw fromProvider(e);
	}
}

export function providerInfo(name) {
	const p = providerFor(name);
	return {
		name: p.name,
		label: p.label,
		capabilities: p.capabilities,
		configured: p.configured(),
		live_enabled: liveCardsEnabled(),
	};
}

export async function searchMerchants({ q, country, kind, sandbox, limit, provider } = {}) {
	const p = providerFor(provider);
	return withProvider(() => p.searchMerchants({ q, country, kind, sandbox, limit }));
}

export async function searchProducts({ q, country, category, merchant, kind, sandbox, limit, start, provider } = {}) {
	const p = providerFor(provider);
	return withProvider(() => p.searchProducts({ q, country, category, merchant, kind, sandbox, limit, start }));
}

export async function getProduct({ productId, provider } = {}) {
	const p = providerFor(provider);
	return withProvider(() => p.getProduct(productId));
}

// ── quote ────────────────────────────────────────────────────────────────────

async function requireAgreement(userId) {
	let sig;
	try {
		sig = await currentSignatureFor(userId);
	} catch {
		throw new CardError(503, 'agreement_check_failed', 'Could not verify your real-funds agreement. No funds moved; try again.');
	}
	if (!sig) {
		throw new CardError(403, 'agreement_required',
			'Buying a live card spends real USDC. Sign the real-funds agreements first, then try again.',
			agreementRequirement());
	}
}

export async function quoteCard({ agentId, principal, productId, amount, provider }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const p = providerFor(provider);
	const product = await withProvider(() => p.getProduct(productId));
	if (!product.in_stock) throw new CardError(409, 'out_of_stock', `${product.name} is out of stock right now. Pick another merchant or try later.`);
	const denom = await withProvider(async () => resolveDenomination(product, amount));

	const mode = p.isSandboxProduct(product.id) ? 'sandbox' : 'live';
	const meta = agent.meta || {};
	if (mode === 'live') {
		if (!liveCardsEnabled()) {
			throw new CardError(409, 'live_cards_disabled',
				'Live card purchases are not switched on for this deployment yet. Sandbox test products work today; search with sandbox: true to try the full flow.');
		}
		if (!meta.solana_address || !meta.encrypted_solana_secret) {
			throw new CardError(409, 'wallet_preparing', 'This agent has no Solana wallet yet, so it cannot pay for a card. Open its wallet page to provision one.');
		}
	}

	const [{ n }] = await sql`
		SELECT count(*)::int AS n FROM agent_cards
		WHERE agent_id = ${agent.id} AND created_at > now() - interval '1 hour'
	`;
	if (n >= MAX_QUOTES_PER_HOUR) {
		throw new CardError(429, 'quote_rate_limited', `This agent has requested ${n} card quotes in the last hour. Wait a while before quoting again.`);
	}

	const q = await withProvider(() => p.quote({
		product, value: denom.value, packageId: denom.packageId, mode,
		refundAddress: mode === 'live' ? meta.solana_address : null,
	}));

	const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
	const [row] = await sql`
		INSERT INTO agent_cards
			(agent_id, user_id, provider, mode, kind, product_id, product_name, merchant, country_code,
			 image_url, face_value, currency, status, quote_total_usdc, quote_total_atomic, quote_fee_usdc,
			 quote_expires_at, pay_address, provider_invoice_id, provider_order_id, provider_status, meta)
		VALUES (
			${agent.id}, ${agent.user_id}, ${p.name}, ${mode}, ${product.kind}, ${product.id}, ${product.name},
			${product.merchant}, ${product.country_code}, ${product.image_url}, ${denom.value}, ${product.currency},
			'quoted', ${q.total_usdc}, ${q.total_atomic.toString()}, ${q.fee_usdc}, ${expiresAt.toISOString()},
			${q.pay_address}, ${q.provider_invoice_id}, ${q.provider_order_id}, ${q.provider_status},
			${JSON.stringify({ package_id: denom.packageId })}::jsonb
		)
		RETURNING *
	`;
	await recordCardEvent(row, principal, 'quoted', {
		to: 'quoted',
		detail: { total_usdc: q.total_usdc, face_value: denom.value, currency: product.currency, mode },
	});
	return quoteView(row, product);
}

// ── create ───────────────────────────────────────────────────────────────────

async function claimQuote(agentId, quoteId) {
	const [row] = await sql`
		UPDATE agent_cards SET status = 'paying', updated_at = now()
		WHERE id = ${quoteId} AND agent_id = ${agentId} AND status = 'quoted' AND quote_expires_at > now()
		RETURNING *
	`;
	if (row) return row;
	const [existing] = await sql`SELECT * FROM agent_cards WHERE id = ${quoteId} AND agent_id = ${agentId}`;
	if (!existing) throw new CardError(404, 'quote_not_found', 'No quote with that id for this agent. Call agent_card_quote first.');
	if (existing.status === 'quoted') {
		await sql`UPDATE agent_cards SET status = 'expired', updated_at = now() WHERE id = ${quoteId} AND status = 'quoted'`;
		throw new CardError(409, 'quote_expired', 'That quote is more than ten minutes old. Call agent_card_quote again for a fresh price.');
	}
	throw new CardError(409, 'quote_used', `That quote was already used (card status: ${existing.status}). Call agent_card_quote for a new card.`);
}

async function setStatus(card, principal, patch, event = 'status') {
	const [row] = await sql`
		UPDATE agent_cards SET
			status = COALESCE(${patch.status ?? null}, status),
			provider_status = COALESCE(${patch.provider_status ?? null}, provider_status),
			pay_signature = COALESCE(${patch.pay_signature ?? null}, pay_signature),
			custody_event_id = COALESCE(${patch.custody_event_id ?? null}, custody_event_id),
			error_code = ${patch.error_code !== undefined ? patch.error_code : card.error_code ?? null},
			error_message = ${patch.error_message !== undefined ? patch.error_message : card.error_message ?? null},
			delivered_at = COALESCE(${patch.delivered_at ?? null}, delivered_at),
			updated_at = now()
		WHERE id = ${card.id}
		RETURNING *
	`;
	if (patch.status && patch.status !== card.status) {
		await recordCardEvent(row, principal, event, {
			from: card.status, to: patch.status,
			detail: patch.error_code ? { error_code: patch.error_code } : {},
		});
	}
	return row;
}

/**
 * Store the redemption data encrypted, once, right after delivery. Only runs
 * while the card has never been revealed, so a revealed secret is never
 * written back.
 */
async function sealSecret(card, p) {
	if (card.secret_enc || card.revealed_at) return card;
	const secret = await withProvider(() => p.reveal({ card }));
	const data = await withProvider(() => p.cardData({ card }));
	const fields = Object.keys(secret || {});
	if (!fields.length) return card;
	const sealed = await encryptSecret(JSON.stringify(secret));
	const [row] = await sql`
		UPDATE agent_cards SET
			secret_enc = ${sealed}, secret_fields = ${fields}, masked_number = ${data.masked},
			redeem_instructions = ${data.instructions}, expires_on = ${data.expires_on}, updated_at = now()
		WHERE id = ${card.id} AND secret_enc IS NULL AND revealed_at IS NULL
		RETURNING *
	`;
	return row || card;
}

/** Pull the provider's status onto the row; seals the secret on delivery. */
async function syncCard(card, principal) {
	const p = providerFor(card.provider);
	if (card.status === 'quoted') {
		if (new Date(card.quote_expires_at).getTime() <= Date.now()) {
			return setStatus(card, principal, { status: 'expired' });
		}
		return card;
	}
	if (TERMINAL.has(card.status) && card.status !== 'delivered') return card;
	if (card.status === 'delivered' && (card.secret_enc || card.revealed_at)) return card;
	// A live card whose payment never broadcast has nothing to ask the provider.
	if (card.status === 'paying' && card.mode === 'live' && !card.pay_signature) return card;

	const s = await withProvider(() => p.status({ card }));
	let next = card.status;
	if (s.status === 'delivered') next = 'delivered';
	else if (s.status === 'failed') next = 'failed';
	else if (s.status === 'refunded') next = 'refunded';
	else if (s.status === 'needs_verification') next = 'needs_verification';
	else if (s.status === 'processing' || (s.status === 'awaiting_payment' && card.pay_signature)) next = 'processing';

	let row = await setStatus(card, principal, {
		status: next,
		provider_status: s.provider_status,
		delivered_at: next === 'delivered' ? (s.delivered_at || new Date().toISOString()) : null,
		error_code: next === 'failed' ? 'provider_failed' : undefined,
		error_message: next === 'failed' ? s.error : undefined,
	});
	if (row.status === 'delivered') row = await sealSecret(row, p);
	return row;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollUntilSettled(card, principal) {
	let row = card;
	for (let i = 0; i < POLL_ATTEMPTS; i++) {
		row = await syncCard(row, principal);
		if (TERMINAL.has(row.status) || row.status === 'needs_verification') return row;
		await pause(POLL_GAP_MS);
	}
	return row;
}

export async function createCard({ agentId, principal, quoteId, confirmSpend }) {
	const agent = await loadOwnedAgent(agentId, principal);
	if (confirmSpend !== true) {
		throw new CardError(400, 'confirm_required',
			'agent_card_create moves funds. Call agent_card_quote first, show the owner its confirm table, and pass confirm_spend: true only after they say yes.',
			{ preview_tool: 'agent_card_quote', confirm_flag: 'confirm_spend' });
	}
	if (typeof quoteId !== 'string' || !/^[0-9a-f-]{36}$/i.test(quoteId)) {
		throw new CardError(400, 'quote_required', 'quote_id from agent_card_quote is required.', { preview_tool: 'agent_card_quote' });
	}

	const [peek] = await sql`SELECT mode FROM agent_cards WHERE id = ${quoteId} AND agent_id = ${agent.id}`;
	if (peek?.mode === 'live') {
		if (!liveCardsEnabled()) throw new CardError(409, 'live_cards_disabled', 'Live card purchases are not switched on for this deployment.');
		await requireAgreement(principal.userId);
	}

	let card = await claimQuote(agent.id, quoteId);
	await recordCardEvent(card, principal, 'purchase_confirmed', { from: 'quoted', to: 'paying', detail: { total_usdc: Number(card.quote_total_usdc) } });
	const p = providerFor(card.provider);

	if (card.mode === 'sandbox') {
		try {
			await p.create({ card });
		} catch (e) {
			const err = fromProvider(e);
			await setStatus(card, principal, { status: 'failed', error_code: err.code || 'provider_error', error_message: err.message });
			throw err;
		}
		card = await setStatus(card, principal, { status: 'processing' }, 'paid');
		return cardView(await pollUntilSettled(card, principal));
	}

	// Live: prove the provider invoice still asks for exactly what the owner confirmed.
	let pr;
	try {
		pr = await p.paymentRequest(card.provider_invoice_id);
	} catch (e) {
		await setStatus(card, principal, { status: 'failed', error_code: 'invoice_unreadable', error_message: 'Could not re-read the provider invoice. No funds moved.' });
		throw fromProvider(e);
	}
	const expected = BigInt(card.quote_total_atomic);
	if (pr.status !== 'unpaid' || pr.currency !== 'USDC' || pr.address !== card.pay_address || pr.total_atomic !== expected) {
		await setStatus(card, principal, { status: 'failed', error_code: 'invoice_changed', error_message: 'The provider invoice no longer matches the quote. No funds moved; request a new quote.' });
		throw new CardError(409, 'invoice_changed', 'The provider invoice no longer matches the quote you confirmed. No funds moved; request a new quote.');
	}

	const pay = await transferUsdcGuarded({
		fromAgentId: agent.id,
		fromUserId: agent.user_id,
		fromMeta: agent.meta || {},
		toAddress: card.pay_address,
		usdc: Number(card.quote_total_usdc),
		amountAtomics: expected,
		network: 'mainnet',
		category: 'card',
		idempotencyKey: `card:${card.id}`,
		rowMeta: { card_id: card.id, provider: card.provider, product_id: card.product_id, invoice_id: card.provider_invoice_id },
	});

	if (pay.status === 'blocked') {
		await setStatus(card, principal, { status: 'failed', error_code: pay.code, error_message: pay.message });
		throw new CardError(403, pay.code, pay.message || 'The agent spend policy blocked this purchase. No funds moved.');
	}
	if (pay.status === 'failed' && pay.code === 'unconfirmed') {
		card = await setStatus(card, principal, { pay_signature: pay.signature, custody_event_id: pay.custodyEventId });
		logAudit({ userId: agent.user_id, action: 'cards.purchase_unconfirmed', resourceId: agent.id, meta: { card_id: card.id, signature: pay.signature } });
		return cardView(card);
	}
	if (pay.status !== 'paid' && pay.status !== 'replayed') {
		const message = pay.code === 'wallet_preparing'
			? 'This agent has no Solana wallet yet.'
			: `The USDC payment did not go through (${pay.code}). No card was bought.`;
		await setStatus(card, principal, { status: 'failed', error_code: pay.code, error_message: message });
		throw new CardError(502, pay.code || 'payment_failed', message);
	}

	card = await setStatus(card, principal, {
		status: 'processing', pay_signature: pay.signature, custody_event_id: pay.custodyEventId,
	}, 'paid');
	logAudit({
		userId: agent.user_id, action: 'cards.purchase', resourceId: agent.id,
		meta: { card_id: card.id, usdc: Number(card.quote_total_usdc), signature: pay.signature, provider: card.provider },
	});
	return cardView(await pollUntilSettled(card, principal));
}

// ── read ─────────────────────────────────────────────────────────────────────

async function loadCard(agentId, cardId) {
	if (typeof cardId !== 'string' || !/^[0-9a-f-]{36}$/i.test(cardId)) {
		throw new CardError(400, 'invalid_card_id', 'card id must be a UUID');
	}
	const [row] = await sql`SELECT * FROM agent_cards WHERE id = ${cardId} AND agent_id = ${agentId}`;
	if (!row) throw new CardError(404, 'card_not_found', 'No card with that id for this agent.');
	return row;
}

export async function listCards({ agentId, principal, status = null, limit = 25, cursor = null }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const lim = Math.min(100, Math.max(1, Number(limit) || 25));
	let before = null;
	if (cursor) {
		const d = new Date(String(cursor));
		if (!Number.isNaN(d.getTime())) before = d.toISOString();
	}
	const rows = await sql`
		SELECT * FROM agent_cards
		WHERE agent_id = ${agent.id}
		  AND (${status}::text IS NULL OR status = ${status})
		  AND (${before}::timestamptz IS NULL OR created_at < ${before}::timestamptz)
		  AND NOT (status IN ('expired', 'cancelled') AND created_at < now() - interval '1 day')
		ORDER BY created_at DESC
		LIMIT ${lim + 1}
	`;
	const pageRows = rows.slice(0, lim);
	// Bring in-flight cards up to date so a list read reflects delivery.
	const synced = [];
	let budget = 5;
	for (const r of pageRows) {
		const stale = OPEN_STATUSES.includes(r.status) || (r.status === 'quoted' && new Date(r.quote_expires_at) <= new Date());
		if (stale && budget > 0) {
			budget -= 1;
			try {
				synced.push(await syncCard(r, principal));
				continue;
			} catch {
				// Provider unreachable: show the stored state rather than failing the list.
			}
		}
		synced.push(r);
	}
	const [totals] = await sql`
		SELECT
			count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
			COALESCE(sum(quote_total_usdc) FILTER (WHERE status IN ('delivered', 'processing') AND mode = 'live'), 0)::float8 AS spent_usdc
		FROM agent_cards WHERE agent_id = ${agent.id}
	`;
	return {
		items: synced.map(cardView),
		has_more: rows.length > lim,
		next_cursor: rows.length > lim ? new Date(pageRows[pageRows.length - 1].created_at).toISOString() : null,
		totals: { delivered: totals.delivered, spent_usdc: Number(totals.spent_usdc) },
	};
}

export async function getCard({ agentId, principal, cardId }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const row = await loadCard(agent.id, cardId);
	const events = await sql`
		SELECT id, actor_kind, event, from_status, to_status, detail, created_at
		FROM agent_card_events
		WHERE card_id = ${row.id} AND event <> 'reveal_preview'
		ORDER BY id DESC LIMIT 30
	`;
	return { card: cardView(row), events };
}

export async function refreshCard({ agentId, principal, cardId }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const row = await loadCard(agent.id, cardId);
	return cardView(await syncCard(row, principal));
}

export async function cardBalance({ agentId, principal, cardId }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const row = await loadCard(agent.id, cardId);
	const p = providerFor(row.provider);
	if (p.capabilities.balance) {
		const b = await withProvider(() => p.balance({ card: row }));
		return { card_id: row.id, balance: b.balance, currency: b.currency, source: 'provider' };
	}
	const live = row.status === 'delivered';
	return {
		card_id: row.id,
		balance: live ? Number(row.face_value) : 0,
		currency: row.currency,
		source: 'face_value',
		note: live
			? `${p.label} does not report balances. A delivered gift card holds its face value until it is redeemed at ${row.merchant}.`
			: `This card is ${row.status}, so it holds no balance.`,
	};
}

// ── reveal ───────────────────────────────────────────────────────────────────

const hashGrant = (id) => createHash('sha256').update(String(id)).digest('hex');

/**
 * Card data without the secret, plus a single-use reveal grant (`preview_id`)
 * that agent_card_reveal must present with confirm_reveal: true.
 */
export async function cardData({ agentId, principal, cardId }) {
	const agent = await loadOwnedAgent(agentId, principal);
	let row = await loadCard(agent.id, cardId);
	if (row.status !== 'delivered') row = await syncCard(row, principal);
	if (row.status !== 'delivered') {
		throw new CardError(409, 'not_delivered', `This card is ${row.status}; its data is available once it is delivered.`);
	}
	const previewId = randomBytes(24).toString('base64url');
	const expiresAt = new Date(Date.now() + REVEAL_GRANT_TTL_MS);
	await recordCardEvent(row, principal, 'reveal_preview', {
		grantHash: hashGrant(previewId), grantExpiresAt: expiresAt.toISOString(),
		detail: { fields: row.secret_fields || [] },
	});
	return {
		card: cardView(row),
		fields: row.secret_fields || [],
		masked_number: row.masked_number,
		instructions: row.redeem_instructions,
		expires_on: row.expires_on,
		preview_id: previewId,
		preview_expires_at: expiresAt.toISOString(),
		next: {
			tool: 'agent_card_reveal',
			args: { agent_id: agent.id, card_id: row.id, preview_id: previewId, confirm_reveal: true },
			note: 'Revealing exposes the redemption secret. Confirm with the owner first. The preview id works once.',
		},
	};
}

export async function revealCard({ agentId, principal, cardId, previewId, confirmReveal }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const row = await loadCard(agent.id, cardId);
	const refuse = async (code, message, status = 400) => {
		await recordCardEvent(row, principal, 'reveal_refused', { detail: { reason: code } });
		throw new CardError(status, code, message, { preview_tool: 'agent_card_data', confirm_flag: 'confirm_reveal' });
	};
	if (confirmReveal !== true) {
		await refuse('confirm_required', 'agent_card_reveal exposes the card secret. Call agent_card_data, confirm with the owner, then pass its preview_id with confirm_reveal: true.');
	}
	if (typeof previewId !== 'string' || previewId.length < 16 || previewId.length > 128) {
		await refuse('preview_required', 'preview_id from agent_card_data is required.');
	}
	if (row.status !== 'delivered') {
		await refuse('not_delivered', `This card is ${row.status}; there is nothing to reveal.`, 409);
	}
	const [grant] = await sql`
		UPDATE agent_card_events SET grant_consumed_at = now()
		WHERE grant_hash = ${hashGrant(previewId)} AND card_id = ${row.id}
		  AND grant_consumed_at IS NULL AND grant_expires_at > now()
		RETURNING id
	`;
	if (!grant) {
		await refuse('preview_invalid', 'That preview id was already used or has expired. Call agent_card_data for a new one and confirm again.', 409);
	}

	// Take the ciphertext and clear it in one statement.
	const [taken] = await sql`
		UPDATE agent_cards c SET secret_enc = NULL, revealed_at = now(), reveal_count = c.reveal_count + 1, updated_at = now()
		FROM (SELECT id, secret_enc FROM agent_cards WHERE id = ${row.id} FOR UPDATE) o
		WHERE c.id = o.id
		RETURNING o.secret_enc AS sealed, c.reveal_count
	`;
	let secret;
	let source;
	if (taken?.sealed) {
		secret = JSON.parse(await decryptSecret(taken.sealed));
		source = 'sealed';
	} else {
		const p = providerFor(row.provider);
		secret = await withProvider(() => p.reveal({ card: row }));
		source = 'provider';
	}
	const fields = Object.keys(secret || {});
	await recordCardEvent(row, principal, 'revealed', { detail: { fields, source, reveal_count: taken?.reveal_count ?? null } });
	logAudit({ userId: agent.user_id, action: 'cards.reveal', resourceId: agent.id, meta: { card_id: row.id, fields } });
	return {
		card_id: row.id,
		merchant: row.merchant,
		face_value: Number(row.face_value),
		currency: row.currency,
		secret,
		fields,
		instructions: row.redeem_instructions,
		notice: 'Shown once. three.ws no longer stores this secret; save it somewhere safe now.',
	};
}

// ── cancel / withdraw / connect ─────────────────────────────────────────────

export async function cancelCard({ agentId, principal, cardId, confirmCancel }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const row = await loadCard(agent.id, cardId);
	if (confirmCancel !== true) {
		throw new CardError(400, 'confirm_required', 'Cancelling is irreversible. Show the card to the owner and pass confirm_cancel: true after they agree.',
			{ preview_tool: 'agent_card_get', confirm_flag: 'confirm_cancel' });
	}
	const p = providerFor(row.provider);
	await withProvider(() => p.cancel({ card: row }));
	const [updated] = await sql`
		UPDATE agent_cards SET status = 'cancelled', updated_at = now()
		WHERE id = ${row.id} AND status = 'quoted'
		RETURNING *
	`;
	if (!updated) throw new CardError(409, 'not_cancellable', 'This card can no longer be cancelled.');
	await recordCardEvent(updated, principal, 'cancelled', { from: row.status, to: 'cancelled' });
	return cardView(updated);
}

export async function withdrawCard({ agentId, principal, cardId, amount, confirmWithdraw }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const row = await loadCard(agent.id, cardId);
	const p = providerFor(row.provider);
	if (!p.capabilities.withdraw) {
		await withProvider(() => p.withdraw({ card: row }));
	}
	if (confirmWithdraw !== true) {
		throw new CardError(400, 'confirm_required', 'Withdrawing moves the card balance. Check agent_card_balance, confirm with the owner, then pass confirm_withdraw: true.',
			{ preview_tool: 'agent_card_balance', confirm_flag: 'confirm_withdraw' });
	}
	if (row.status !== 'delivered') throw new CardError(409, 'not_delivered', 'Only a delivered card has a balance to withdraw.');
	const amt = Number(amount);
	if (!(amt > 0)) throw new CardError(400, 'invalid_amount', 'amount must be a positive number');
	const destination = agent.meta?.solana_address;
	if (!destination) throw new CardError(409, 'wallet_preparing', 'This agent has no Solana wallet to receive the withdrawal.');
	const [w] = await sql`
		INSERT INTO agent_card_withdrawals (card_id, agent_id, user_id, provider, amount, currency, destination)
		VALUES (${row.id}, ${agent.id}, ${agent.user_id}, ${row.provider}, ${amt}, ${row.currency}, ${destination})
		RETURNING *
	`;
	try {
		const r = await p.withdraw({ card: row, amount: amt, destination });
		const [done] = await sql`
			UPDATE agent_card_withdrawals SET status = ${r.status || 'processing'}, provider_ref = ${r.provider_ref || null},
				usdc_amount = ${r.usdc_amount ?? null}, signature = ${r.signature || null}, updated_at = now()
			WHERE id = ${w.id} RETURNING *
		`;
		await recordCardEvent(row, principal, 'withdraw_requested', { detail: { withdrawal_id: w.id, amount: amt } });
		return done;
	} catch (e) {
		const err = fromProvider(e);
		await sql`UPDATE agent_card_withdrawals SET status = 'failed', error_message = ${err.message}, updated_at = now() WHERE id = ${w.id}`;
		throw err;
	}
}

export async function listWithdrawals({ agentId, principal, cardId }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const row = await loadCard(agent.id, cardId);
	const items = await sql`
		SELECT id, amount, currency, usdc_amount, destination, status, signature, error_message, created_at, updated_at
		FROM agent_card_withdrawals WHERE card_id = ${row.id} ORDER BY created_at DESC LIMIT 50
	`;
	return { items, supported: Boolean(providerFor(row.provider).capabilities.withdraw) };
}

export async function connectStatus({ agentId, principal, provider }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const p = providerFor(provider);
	const c = await withProvider(() => p.connectLink({ agent }));
	return { provider: p.name, required: Boolean(c.required), status: c.status, has_link: Boolean(c.url) };
}

export async function connectLink({ agentId, principal, provider }) {
	const agent = await loadOwnedAgent(agentId, principal);
	const p = providerFor(provider);
	const c = await withProvider(() => p.connectLink({ agent }));
	if (!c.required || !c.url) {
		throw new CardError(409, 'connect_not_required', `${p.label} needs no identity steps for this account. Cards can be bought right away.`);
	}
	return { provider: p.name, url: c.url, status: c.status };
}
