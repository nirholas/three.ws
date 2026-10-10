// threews-agent MCP: agent commerce. Invoices, transfers, offers, purchases
// and the agent's own spending rules.
//
// Thin adapters over api/_lib/agent-commerce/*, the same library the REST
// routes (/api/agent-commerce/*), the invoice-watch cron and the /commerce and
// /invoices/:id pages use. Guide: docs/agent-commerce.md.
//
// Tool policy (packages/mcp-policy/src/table.js, group `commerce`):
//
//   read       invoice_details, invoice_list, invoice_verify, offer_list,
//              agent_send_preview, agent_buy (a quote: nothing is reserved or
//              signed), spending_check
//   write      invoice_create, invoice_cancel, agent_sell, spending_setup
//              (a proposal only: the owner approves it on three.ws with a
//              fresh identity check; the agent can never approve it)
//   financial  agent_send (confirm_send + the agent_send_preview preview_id)
//              and agent_buy_confirm (confirm_payment + the agent_buy
//              preview_id). The library consumes the preview id itself, so a
//              preview runs once, never after it expires, and only for the
//              agent that asked for it.
//
// agent_send to an address the owner's allowlist does not cover never signs:
// it files an approval request in the owner's /approvals inbox and returns.

import { sql } from '../_lib/db.js';
import { hasScope } from '../_lib/auth.js';
import { limits as rateLimits } from '../_lib/rate-limit.js';
import { CommerceError } from '../_lib/agent-commerce/assets.js';
import {
	createInvoice, getInvoiceForOwner, listInvoices, cancelInvoice, verifyInvoice, loadInvoiceRow,
} from '../_lib/agent-commerce/invoices.js';
import { previewSend, confirmSend } from '../_lib/agent-commerce/send.js';
import { createOffer, listPublicOffers, quoteBuy, confirmBuy } from '../_lib/agent-commerce/offers.js';
import { spendingCheck, proposeLimits, PROPOSABLE_KEYS } from '../_lib/agent-commerce/limit-requests.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const QUOTE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const FINANCIAL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

const reply = (text, structuredContent) => ({ content: [{ type: 'text', text }], structuredContent });

async function enforce(auth) {
	const rl = await rateLimits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

/** The agent, if the signed-in account owns it. */
async function ownedAgent(agentId, userId) {
	const [row] = await sql`
		SELECT id, user_id, name FROM agent_identities
		WHERE id = ${agentId} AND user_id = ${userId} AND deleted_at IS NULL
	`;
	return row || null;
}

/**
 * Sign-in, scope, ownership and error handling shared by every tool. A
 * designed library error (a cap, a stale preview, an unpaid invoice) becomes a
 * designed tool result; anything else goes to the dispatcher's sanitizer.
 */
async function run(auth, args, { scope = null, signIn = true, agent = true }, fn) {
	await enforce(auth);
	if (signIn && !auth.userId) return refusal('Sign in to three.ws to act on your agents.', 'auth_required', { signed_in: false });
	if (scope && !hasScope(auth.scope, scope)) {
		return refusal(`This action needs the ${scope} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scope });
	}
	if (agent && !(await ownedAgent(args.agent_id, auth.userId))) {
		return refusal('No agent with that id belongs to this account. wallet_status lists yours.', 'agent_not_found');
	}
	try {
		return await fn();
	} catch (err) {
		if (err instanceof CommerceError) return refusal(err.message, err.code, err.extra ? { detail: err.extra } : {});
		if (err?.name === 'SpendLimitError' || (Number(err?.status) >= 400 && Number(err?.status) < 500 && err?.code)) {
			return refusal(String(err.message || err.code), String(err.code), err.detail ? { detail: err.detail } : {});
		}
		throw err;
	}
}

const usd = (n) => (n == null || !Number.isFinite(Number(n)) ? 'unpriced' : `$${Number(n).toFixed(2)}`);
const cap = (n) => (n == null ? 'no cap' : usd(n));

function tableText(c) {
	const lines = [
		`  Recipient: ${c.recipient}`,
		`  Amount:    ${c.amount} (${usd(c.usd)})`,
		`  Asset:     ${c.asset}`,
		`  Chain:     ${c.chain}`,
	];
	if (c.allowlist) lines.push(`  Allowlist: ${c.allowlist}`);
	return lines.join('\n');
}

function invoiceLine(inv) {
	const due = inv.status === 'open' || inv.status === 'underpaid' ? `, due ${inv.due_at}` : '';
	const paid = inv.status === 'underpaid' ? ` (${inv.paid} received, ${inv.remaining} still due)` : '';
	return `${inv.number} [${inv.status}] ${inv.amount} ${inv.symbol}${paid} on Solana ${inv.network}: ${inv.memo}${due}`;
}

function invoiceText(inv) {
	const lines = [invoiceLine(inv), `Receipt and pay page: ${inv.page_url}`];
	if (inv.pay_url) lines.push(`Solana Pay link: ${inv.pay_url}`, `QR code: ${inv.qr_url}`);
	lines.push(inv.open_to_anyone ? 'Payable by anyone.' : `Payer: ${inv.payer.label ? `${inv.payer.label} ` : ''}${inv.payer.address}`);
	if (inv.paid_at) lines.push(`Paid ${inv.paid_at}${inv.paid_late ? ' (after the due date)' : ''} by ${inv.paid_by || 'unknown'}.`);
	for (const p of inv.payments || []) {
		lines.push(`  ${p.counted ? '[counted]' : `[ignored: ${p.reject_reason}]`} ${p.signature} ${p.explorer_url}`);
	}
	return lines.join('\n');
}

const agentIdProp = { type: 'string', format: 'uuid', description: 'The agent acting. wallet_status or three://agents lists yours.' };
const invoiceIdProp = { type: 'string', format: 'uuid', description: 'Invoice id from invoice_create or invoice_list.' };
const assetProp = { type: 'string', enum: ['USDC', 'SOL', 'THREE'], description: 'USDC, SOL or THREE ($THREE, mainnet only).' };
const networkProp = { type: 'string', enum: ['mainnet', 'devnet'], default: 'mainnet', description: 'Solana cluster. devnet moves test funds only.' };
const amountProp = { type: 'string', pattern: '^[0-9]+(\\.[0-9]+)?$', maxLength: 32, description: 'Decimal amount in the asset, e.g. "12.5".' };
const previewIdProp = { type: 'string', pattern: '^(snd|buy)_[A-Za-z0-9_-]{16,64}$', description: 'preview_id from the preview step, before it expires (10 minutes).' };

export const commerceToolDefs = [
	// ── invoices ────────────────────────────────────────────────────────────
	{
		name: 'invoice_create',
		title: 'Create an invoice',
		group: 'commerce',
		tier: 'write',
		annotations: WRITE,
		description: "Bill someone in USDC, SOL or $THREE, paid into this agent's Solana wallet. Returns a Solana Pay link, a QR code and a public receipt page; the payment is matched on-chain by a unique reference and the invoice moves to paid, underpaid or expired on its own. Set payer to restrict it to one wallet, or leave it open to anyone. Use this when the agent needs to request a payment from someone.",
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				amount: amountProp,
				asset: assetProp,
				network: networkProp,
				memo: { type: 'string', minLength: 1, maxLength: 140, description: 'What the invoice is for. Shown to the payer and in their wallet.' },
				description: { type: 'string', maxLength: 1000, description: 'Optional longer detail for the receipt page.' },
				payer: { type: 'string', maxLength: 64, description: 'Optional Solana address that must pay it. Omit for an invoice anyone can pay.' },
				payer_label: { type: 'string', maxLength: 80, description: 'Optional name for the payer.' },
				due_in_hours: { type: 'number', minimum: 0.0834, maximum: 2160, description: 'Hours until it expires. Default 72. Minimum 5 minutes.' },
				due_at: { type: 'string', format: 'date-time', description: 'Exact expiry instead of due_in_hours.' },
			},
			required: ['agent_id', 'amount', 'asset', 'memo'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args, { scope: 'agents:write' }, async () => {
			const inv = await createInvoice({
				userId: auth.userId, agentId: args.agent_id, createdBy: 'agent',
				amount: args.amount, asset: args.asset, network: args.network, memo: args.memo, description: args.description,
				payer: args.payer, payerLabel: args.payer_label, dueAt: args.due_at, dueInHours: args.due_in_hours,
			});
			return reply(`Invoice created.\n${invoiceText(inv)}`, { invoice: inv });
		}),
	},
	{
		name: 'invoice_details',
		title: 'Read one invoice',
		group: 'commerce',
		tier: 'read',
		annotations: READ,
		description: 'One invoice with its status, amount received, every payment seen on-chain (counted or ignored, with the reason) and its timeline. Use this to check one invoice\'s payments and history.',
		inputSchema: { type: 'object', properties: { invoice_id: invoiceIdProp }, required: ['invoice_id'], additionalProperties: false },
		handler: (args, auth) => run(auth, args, { scope: 'wallet:read', agent: false }, async () => {
			const inv = await getInvoiceForOwner(auth.userId, args.invoice_id);
			return reply(invoiceText(inv), { invoice: inv });
		}),
	},
	{
		name: 'invoice_list',
		title: 'List invoices',
		group: 'commerce',
		tier: 'read',
		annotations: READ,
		description: 'Your invoices, newest first, with totals: how many are outstanding, paid and expired, and the USD received on mainnet. Narrow by agent and status; page with before. Use this to review what the agent has billed and what is still outstanding.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: { ...agentIdProp, description: 'Only this agent\'s invoices.' },
				status: { type: 'string', enum: ['open', 'underpaid', 'paid', 'expired', 'cancelled'] },
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
				before: { type: 'string', format: 'date-time', description: 'next_before from the previous page.' },
			},
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args, { scope: 'wallet:read', agent: Boolean(args.agent_id) }, async () => {
			const out = await listInvoices({ userId: auth.userId, agentId: args.agent_id || null, status: args.status || null, limit: args.limit, before: args.before || null });
			const t = out.totals;
			const lines = [
				`${t.outstanding} outstanding, ${t.paid} paid, ${t.expired} expired. Received on mainnet: ${usd(t.paid_usd)}.`,
				...(out.invoices.length ? out.invoices.map((i) => `  ${invoiceLine(i)} (${i.id})`) : ['  No invoices match.']),
			];
			if (out.next_before) lines.push(`More: call again with before ${out.next_before}.`);
			return reply(lines.join('\n'), out);
		}),
	},
	{
		name: 'invoice_verify',
		title: 'Check an invoice on-chain now',
		group: 'commerce',
		tier: 'read',
		annotations: READ,
		description: 'Read the chain for this invoice right now instead of waiting for the watcher (it runs every minute). Records any new payment, then reports paid, underpaid (with what is still due), expired or open. Use this when a payer says they paid and the invoice still shows open.',
		inputSchema: { type: 'object', properties: { invoice_id: invoiceIdProp }, required: ['invoice_id'], additionalProperties: false },
		handler: (args, auth) => run(auth, args, { scope: 'wallet:read', agent: false }, async () => {
			const row = await loadInvoiceRow(args.invoice_id);
			if (!row || String(row.user_id) !== String(auth.userId)) return refusal('No invoice with that id belongs to this account.', 'not_found');
			await verifyInvoice(args.invoice_id);
			const inv = await getInvoiceForOwner(auth.userId, args.invoice_id);
			return reply(invoiceText(inv), { invoice: inv });
		}),
	},
	{
		name: 'invoice_cancel',
		title: 'Cancel an open invoice',
		group: 'commerce',
		tier: 'write',
		annotations: WRITE,
		description: 'Cancel an invoice nobody has paid yet. The chain is read once more first, so a payment that just landed settles it instead. A partly paid invoice cannot be cancelled. Use this when an unpaid invoice is wrong or no longer needed.',
		inputSchema: {
			type: 'object',
			properties: { invoice_id: invoiceIdProp, reason: { type: 'string', maxLength: 200 } },
			required: ['invoice_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args, { scope: 'agents:write', agent: false }, async () => {
			const inv = await cancelInvoice({ userId: auth.userId, id: args.invoice_id, reason: args.reason });
			return reply(`Cancelled. ${invoiceLine(inv)}`, { invoice: inv });
		}),
	},

	// ── transfers ───────────────────────────────────────────────────────────
	{
		name: 'agent_send_preview',
		title: 'Preview a transfer',
		group: 'commerce',
		tier: 'read',
		annotations: QUOTE,
		description: "Price a transfer of USDC, SOL or $THREE from this agent's wallet and say how it would run: straight out (the recipient is on the owner's allowlist and inside the caps), as an approval request to the owner (any other recipient), or blocked (a cap, a freeze, or an enforced allowlist). Nothing is reserved or signed. Call this first for any transfer, and show the user the result before agent_send.",
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				to: { type: 'string', minLength: 32, maxLength: 64, description: 'Recipient Solana address.' },
				amount: amountProp,
				asset: assetProp,
				network: networkProp,
				memo: { type: 'string', maxLength: 120, description: 'Optional on-chain memo.' },
			},
			required: ['agent_id', 'to', 'amount', 'asset'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args, { scope: 'wallet:read' }, async () => {
			const p = await previewSend({ agentId: args.agent_id, to: args.to, amount: args.amount, asset: args.asset, network: args.network, memo: args.memo });
			const lines = [
				p.preview_id ? 'Show this table to the user and wait for a clear yes before calling agent_send:' : 'This transfer cannot run:',
				tableText(p.confirmation),
				p.memo ? `  Memo:      ${p.memo}` : null,
				`  Route:     ${p.route}: ${p.route_detail}`,
				`  Limits:    per transaction ${cap(p.limits.per_tx_usd)}, daily ${cap(p.limits.daily_usd)}, spent today ${usd(p.limits.spent_today_usd)}`,
				p.preview_id
					? `preview_id ${p.preview_id} (expires ${p.expires_at}). Call agent_send with it and confirm_send: true only after the user says yes.`
					: `Blocked: ${p.blocked.message}`,
			].filter(Boolean);
			return reply(lines.join('\n'), p);
		}),
	},
	{
		name: 'agent_send',
		title: 'Send funds from the agent wallet',
		group: 'commerce',
		tier: 'financial',
		confirmFlag: 'confirm_send',
		previewTool: 'agent_send_preview',
		annotations: FINANCIAL,
		description: "Run a transfer agent_send_preview priced. To an allowlisted recipient inside the caps it signs and sends now and returns the signature. To any other recipient it never signs: it sends the owner an approval request (inbox, push, Telegram) and returns its link; the owner's approval sends it. Needs confirm_send: true and the preview_id, after the user saw the preview table and said yes. Call this after the user approved an agent_send_preview.",
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				preview_id: previewIdProp,
				confirm_send: { type: 'boolean', description: 'Must be true. Set it only after the user approved the preview table.' },
			},
			required: ['agent_id', 'preview_id', 'confirm_send'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args, { scope: 'wallet:write' }, async () => {
			const r = await confirmSend({ agentId: args.agent_id, previewId: args.preview_id });
			if (r.status === 'sent') {
				return reply(`Sent${r.auto_approved ? ' (auto-approved by the owner\'s policy)' : ''}.\n${tableText(r.confirmation)}\nSignature ${r.signature}\n${r.explorer_url}`, r);
			}
			return reply(`${r.message}\nApproval: https://three.ws${r.approval.link} (expires ${r.approval.expires_at})\n${tableText(r.confirmation)}`, r);
		}),
	},

	// ── offers and purchases ────────────────────────────────────────────────
	{
		name: 'offer_list',
		title: 'Browse offers',
		group: 'commerce',
		tier: 'read',
		annotations: READ,
		description: 'Active offers agents sell for USDC, SOL or $THREE: title, price, seller and stock. Use an offer id with agent_buy to get a quote. Call this first when the agent wants to buy something from another agent.',
		inputSchema: {
			type: 'object',
			properties: {
				seller_agent_id: { type: 'string', format: 'uuid', description: 'Only this seller\'s offers.' },
				asset: assetProp,
				network: { type: 'string', enum: ['mainnet', 'devnet'] },
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
			},
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args, { signIn: false, agent: false }, async () => {
			const offers = await listPublicOffers({ agentId: args.seller_agent_id || null, asset: args.asset || null, network: args.network || null, limit: args.limit });
			const lines = offers.length
				? offers.map((o) => `  ${o.title}: ${o.price} ${o.symbol} on Solana ${o.network} from ${o.seller.name || o.seller.agent_id}${o.available != null ? `, ${o.available} left` : ''} (${o.id})`)
				: ['  No active offers match.'];
			return reply([`${offers.length} offer(s):`, ...lines].join('\n'), { offers });
		}),
	},
	{
		name: 'agent_sell',
		title: 'List an offer for sale',
		group: 'commerce',
		tier: 'write',
		annotations: WRITE,
		description: "List something this agent sells: a title, a price in USDC, SOL or $THREE, and the fulfillment (a download link, a license key, an access code, text) that buyers receive only after their payment is verified on-chain. Each sale is an invoice paid into this agent's wallet, so it shows up in earnings. Use this when the owner wants the agent to sell a file, key, code or text.",
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				title: { type: 'string', minLength: 1, maxLength: 120 },
				description: { type: 'string', maxLength: 2000 },
				price: amountProp,
				asset: assetProp,
				network: networkProp,
				fulfillment: { type: 'string', minLength: 1, maxLength: 4000, description: 'What a paying buyer receives. Never shown before payment.' },
				stock: { type: 'integer', minimum: 1, maximum: 1000000, description: 'How many can be sold. Omit for unlimited.' },
			},
			required: ['agent_id', 'title', 'price', 'asset', 'fulfillment'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args, { scope: 'agents:write' }, async () => {
			const offer = await createOffer({
				agentId: args.agent_id, userId: auth.userId, title: args.title, description: args.description,
				price: args.price, asset: args.asset, network: args.network, fulfillment: args.fulfillment, stock: args.stock ?? null,
			});
			return reply(`Listed "${offer.title}" at ${offer.price} ${offer.symbol} on Solana ${offer.network}${offer.stock ? `, ${offer.stock} available` : ''}. Offer id ${offer.id}.`, { offer });
		}),
	},
	{
		name: 'agent_buy',
		title: 'Quote a purchase',
		group: 'commerce',
		tier: 'read',
		annotations: QUOTE,
		description: "Quote buying an offer with this agent's wallet: who gets paid, how much, which asset and chain. Nothing is reserved or signed. Show the table to the user; on a clear yes call agent_buy_confirm with the preview_id. Call this first for any purchase from offer_list.",
		inputSchema: {
			type: 'object',
			properties: { agent_id: agentIdProp, offer_id: { type: 'string', format: 'uuid', description: 'Offer id from offer_list.' } },
			required: ['agent_id', 'offer_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args, { scope: 'wallet:read' }, async () => {
			const q = await quoteBuy({ buyerAgentId: args.agent_id, offerId: args.offer_id });
			const text = [
				`Show this table to the user and wait for a clear yes before calling agent_buy_confirm:`,
				`  Item:      ${q.offer.title}`,
				tableText(q.confirmation),
				q.note,
				`preview_id ${q.preview_id} (expires ${q.expires_at}). Call agent_buy_confirm with it and confirm_payment: true only after the user says yes.`,
			].join('\n');
			return reply(text, q);
		}),
	},
	{
		name: 'agent_buy_confirm',
		title: 'Pay for a quoted purchase',
		group: 'commerce',
		tier: 'financial',
		confirmFlag: 'confirm_payment',
		previewTool: 'agent_buy',
		annotations: FINANCIAL,
		description: "Pay for the offer agent_buy quoted, from this agent's wallet inside its spend limits, then verify the payment on-chain and return the goods (the seller's fulfillment). If the chain has not shown the payment yet the order is 'submitted'; call again with the same preview_id to collect it. Needs confirm_payment: true and the preview_id, after the user said yes. Call this after the user approved an agent_buy quote.",
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				preview_id: previewIdProp,
				confirm_payment: { type: 'boolean', description: 'Must be true. Set it only after the user approved the quote.' },
			},
			required: ['agent_id', 'preview_id', 'confirm_payment'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args, { scope: 'wallet:write' }, async () => {
			const o = await confirmBuy({ buyerAgentId: args.agent_id, previewId: args.preview_id });
			const lines = [
				`Order ${o.order_id}: ${o.status}. ${o.message}`,
				`  Item:    ${o.offer.title} from ${o.offer.seller || 'seller agent'}`,
				`  Paid:    ${o.amount} on Solana ${o.network}`,
			];
			if (o.signature) lines.push(`  Tx:      ${o.signature} ${o.explorer_url}`);
			if (o.invoice) lines.push(`  Receipt: https://three.ws${o.invoice.receipt_url}`);
			if (o.fulfillment) lines.push('Fulfillment:', o.fulfillment);
			return reply(lines.join('\n'), o);
		}),
	},

	// ── spending rules ──────────────────────────────────────────────────────
	{
		name: 'spending_check',
		title: 'Read this agent\'s spending limits',
		group: 'commerce',
		tier: 'read',
		annotations: READ,
		description: "This agent's spending rules: per-transaction, daily and per-recipient caps, whether the wallet is frozen, what it spent today and how much room is left, and any limit change it proposed that the owner has not answered. Use this before a send or purchase to see whether it fits the caps, or after one was blocked.",
		inputSchema: { type: 'object', properties: { agent_id: agentIdProp, network: networkProp }, required: ['agent_id'], additionalProperties: false },
		handler: (args, auth) => run(auth, args, { scope: 'wallet:read' }, async () => {
			const s = await spendingCheck({ agentId: args.agent_id, network: args.network || 'mainnet' });
			const l = s.limits;
			const lines = [
				`${s.agent.name || 'Agent'} on Solana ${s.network}${l.frozen ? ': WALLET FROZEN' : ''}`,
				`  Per transaction:   ${l.per_tx_usd == null ? 'no cap' : usd(l.per_tx_usd)}`,
				`  Daily:             ${l.daily_usd == null ? 'no cap' : usd(l.daily_usd)} (spent ${usd(s.spent_today_usd)}, left ${s.headroom_today_usd == null ? 'unlimited' : usd(s.headroom_today_usd)})`,
				`  Per recipient/day: ${l.per_counterparty_daily_usd == null ? 'no cap' : usd(l.per_counterparty_daily_usd)}`,
				`  Scoped capabilities required: ${l.require_capabilities ? 'yes' : 'no'}`,
				s.allowlist_note,
				s.pending_proposals.length
					? `Waiting for the owner:\n${s.pending_proposals.map((p) => `  ${p.summary} (${p.id}, expires ${p.expires_at})`).join('\n')}`
					: 'No proposals waiting.',
			];
			return reply(lines.join('\n'), s);
		}),
	},
	{
		name: 'spending_setup',
		title: 'Propose a change to this agent\'s limits',
		group: 'commerce',
		tier: 'write',
		annotations: WRITE,
		description: `Propose new spending limits for this agent. Nothing changes: the owner gets the proposal, and only they can approve it, on three.ws, with a fresh identity check (password, re-authentication or a wallet signature). Proposable: ${PROPOSABLE_KEYS.join(', ')}. USD caps take a number, or null for no cap. Give a reason the owner can judge. Use this when the caps keep blocking work the owner wants done.`,
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				changes: {
					type: 'object',
					properties: {
						daily_usd: { type: ['number', 'null'], minimum: 0 },
						per_tx_usd: { type: ['number', 'null'], minimum: 0 },
						per_counterparty_daily_usd: { type: ['number', 'null'], minimum: 0 },
						frozen: { type: 'boolean' },
						require_capabilities: { type: 'boolean' },
					},
					additionalProperties: false,
					minProperties: 1,
				},
				reason: { type: 'string', maxLength: 500, description: 'Why the agent needs the change.' },
			},
			required: ['agent_id', 'changes'],
			additionalProperties: false,
		},
		handler: (args, auth) => run(auth, args, { scope: 'agents:write' }, async () => {
			const r = await proposeLimits({ agentId: args.agent_id, changes: args.changes, reason: args.reason });
			const lines = [
				r.message,
				...r.changes.map((c) => `  ${c.label}: ${c.from} to ${c.to}${c.loosens ? ' (loosens)' : ''}`),
				`Request ${r.request_id}, expires ${r.expires_at}.`,
			];
			return reply(lines.join('\n'), r);
		}),
	},
];
