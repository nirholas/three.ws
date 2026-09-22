// threews-agent MCP: the whole-agent marketplace tools.
//
// Buy, sell and bid on entire agents (identity, persona, skills, history and
// the custodial wallet) with USDC held in per-listing escrow on Solana. Every
// tool is a thin adapter over api/_lib/agent-market/service.js, the same layer
// the REST API and the /marketplace/agents pages use.
//
// Tool policy (docs/prompts/03): each definition carries `group`, `tier`, and
// for the financial ones `confirmFlag` and `previewTool`. A financial tool
// refuses unless its confirm flag is exactly true AND it cites a preview_id
// that preview_marketplace_action issued to the same user, for the same action
// and arguments, within the last ten minutes. The preview is the confirmation
// table the model must show the user before asking for a yes.

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import * as svc from '../_lib/agent-market/service.js';

const PREVIEW_TOOL = 'preview_marketplace_action';

// The argument keys each action's preview and commit agree on. Both sides hash
// exactly these, so a commit with different terms than the preview is refused.
const ACTION_KEYS = {
	create_listing: ['agent_id', 'ask_usdc', 'ask_three', 'min_bid_usdc', 'duration_hours', 'include_balance', 'include_history', 'payout_address', 'payout_evm_address', 'note'],
	delist: ['listing_id'],
	place_bid: ['listing_id', 'amount_usdc', 'funding_source', 'funding_agent_id', 'wallet_address'],
	buy_now: ['listing_id', 'currency', 'funding_source', 'funding_agent_id', 'wallet_address'],
	accept_bid: ['bid_id'],
	withdraw_bid: ['bid_id'],
};

function pick(args, action) {
	const out = {};
	for (const k of ACTION_KEYS[action]) {
		const v = args[k];
		if (v === undefined || v === null || v === '') continue;
		out[k] = typeof v === 'number' ? String(v) : v;
	}
	return out;
}

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

function ok(text, data) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: true, ...data } };
}

async function enforce(limiter, auth) {
	const rl = await limiter(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

/**
 * Run a service call with the shared sign-in, scope, rate and error handling.
 * Designed service errors become designed tool results; anything else is left
 * to the dispatcher's sanitizer.
 */
async function run(auth, { scope = null, signIn = true, pay = false }, fn) {
	await enforce(pay ? limits.mcpAgentPay : limits.mcpAgent, auth);
	if (signIn && !auth.userId) return refusal('Sign in to three.ws to use the agent marketplace.', 'auth_required', { signed_in: false });
	if (scope && !hasScope(auth.scope, scope)) {
		return refusal(`This action needs the ${scope} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scope });
	}
	try {
		return await fn(auth.userId ? { id: auth.userId } : null);
	} catch (err) {
		if (err?.expose && err.code && (err.status ?? 500) < 500) {
			return refusal(err.message, err.code, err.requirement ? { requirement: err.requirement } : {});
		}
		if (err?.expose && err.code) return refusal(err.message, err.code);
		throw err;
	}
}

/**
 * The financial gate: exact confirm flag, then a fresh matching preview.
 * Returns a refusal result, or null when the call may proceed.
 */
async function gate(user, args, action, confirmFlag) {
	if (args[confirmFlag] !== true) {
		return refusal(
			`This moves real funds or commits your agent. Call ${PREVIEW_TOOL} with action "${action}" first, show the user the table it returns, and only after a clear yes call again with ${confirmFlag}: true and its preview_id.`,
			'confirmation_required',
			{ confirm_flag: confirmFlag, preview_tool: PREVIEW_TOOL },
		);
	}
	await svc.consumePreview(user, action, pick(args, action), args.preview_id, PREVIEW_TOOL);
	return null;
}

function listingLine(l) {
	const price = l.ask ? `buy now ${l.ask.amount} USDC` : 'auction';
	const top = l.top_bid ? `top bid ${l.top_bid.amount} USDC` : `min bid ${l.min_bid.amount} USDC`;
	return `${l.agent.name}: ${price}, ${top}, ${l.bid_count} bid(s), ends ${l.expires_at}\n   listing ${l.id}  https://three.ws${l.url}`;
}

const ann = (readOnly, destructive, idempotent) => ({
	readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: true,
});

const uuid = { type: 'string', format: 'uuid' };
const amount = { type: ['string', 'number'], description: 'Decimal amount, e.g. "25" or "25.5".' };
const confirmArg = (desc) => ({ type: 'boolean', description: desc });
const previewArg = { type: 'string', description: `The preview_id ${PREVIEW_TOOL} returned for these exact arguments (valid ten minutes).` };
const funding = {
	funding_source: { type: 'string', enum: ['agent_wallet', 'connected_wallet'], description: 'Pay from one of your agents (settles here) or a browser wallet (returns a transaction to sign).' },
	funding_agent_id: { ...uuid, description: 'Your agent whose USDC funds the bid (funding_source agent_wallet).' },
	wallet_address: { type: 'string', description: 'Your Solana wallet address (funding_source connected_wallet).' },
};

export const marketplaceToolDefs = [
	{
		name: 'browse_marketplace',
		title: 'Browse agents for sale',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(true, false, false),
		description: 'List whole agents currently for sale on three.ws: each with its persona summary, skills, reputation, buy-now price, top bid, bid count, whether its wallet balance is included, and time left. Read-only.',
		inputSchema: {
			type: 'object',
			properties: {
				q: { type: 'string', maxLength: 80, description: 'Match name, description or skill.' },
				sort: { type: 'string', enum: ['ending', 'newest', 'price_asc', 'price_desc', 'most_bids'] },
				limit: { type: 'integer', minimum: 1, maximum: 48 },
				cursor: { type: 'string' },
			},
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { signIn: false }, async (user) => {
				const r = await svc.browseListings({ ...args, viewerId: user?.id || null });
				const text = r.items.length
					? r.items.map((l, i) => `${i + 1}. ${listingLine(l)}`).join('\n')
					: 'No agents are listed for sale right now. List one with create_marketplace_listing.';
				return ok(text, r);
			});
		},
	},
	{
		name: 'browse_public_agents',
		title: 'Browse public agents',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(true, false, false),
		description: 'Search published three.ws agents, listed-for-sale ones first, with each one\'s sale state (price, minimum bid, listing link) when it has a live listing. Read-only.',
		inputSchema: {
			type: 'object',
			properties: { q: { type: 'string', maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 48 }, cursor: { type: 'string' } },
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { signIn: false }, async () => {
				const r = await svc.browsePublicAgents(args);
				const text = r.items.length
					? r.items.map((a, i) => `${i + 1}. ${a.name} (${a.id})${a.for_sale ? ` FOR SALE: min bid ${a.for_sale.min_bid}${a.for_sale.ask ? `, buy now ${a.for_sale.ask}` : ''}` : ''}`).join('\n')
					: 'No published agents matched.';
				return ok(text, r);
			});
		},
	},
	{
		name: 'get_listing',
		title: 'Get an agent listing',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(true, false, false),
		description: 'Full detail for one agent listing: what transfers, live wallet balance, reputation, trade history, every bid, the event history, and settlement progress if it sold. Read-only.',
		inputSchema: { type: 'object', properties: { listing_id: uuid }, required: ['listing_id'], additionalProperties: false },
		async handler(args, auth) {
			return run(auth, { signIn: false }, async (user) => {
				const d = await svc.getListingDetail(args.listing_id, user?.id || null);
				const l = d.listing;
				const lines = [
					listingLine(l),
					`Status: ${l.status}. Escrow: ${l.escrow_address}. Platform fee ${l.fee_bps / 100}%.`,
					...l.what_transfers.map((w) => `  ${w.transfers ? 'transfers' : 'stays'}: ${w.item}${w.note ? ` (${w.note})` : ''}`),
					`Bids: ${d.bids.length ? d.bids.map((b) => `${b.amount.amount} ${b.amount.symbol} ${b.status}`).join(', ') : 'none'}`,
				];
				if (d.transfer) lines.push(`Settlement: ${d.transfer.status} at step ${d.transfer.step}`);
				return ok(lines.join('\n'), d);
			});
		},
	},
	{
		name: 'get_marketplace_history',
		title: 'Get marketplace history',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(true, false, false),
		description: 'The whole-agent marketplace event log (listed, bids, refunds, sales, settlement steps) for one agent or across the marketplace, newest first, with on-chain signatures. Read-only.',
		inputSchema: { type: 'object', properties: { agent_id: uuid, limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false },
		async handler(args, auth) {
			return run(auth, { signIn: false }, async () => {
				const events = await svc.marketplaceHistory({ agentId: args.agent_id || null, limit: args.limit });
				const text = events.length
					? events.map((e) => `${e.at} ${e.agent_name || e.agent_id}: ${e.event}${e.amount ? ` ${e.amount.amount} ${e.amount.symbol}` : ''}${e.signature ? ` (${e.signature})` : ''}`).join('\n')
					: 'No marketplace history yet.';
				return ok(text, { events });
			});
		},
	},
	{
		name: PREVIEW_TOOL,
		title: 'Preview a marketplace action',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(true, false, false),
		description: 'Build the confirmation table for a money-moving marketplace action WITHOUT doing it: recipient, amount, token, chain, fees, what transfers and any warnings. Show the table to the user, wait for a clear yes, then call the action tool with its confirm flag and this preview_id (valid ten minutes, one use). Actions: create_listing, delist, place_bid, buy_now, accept_bid, withdraw_bid; pass the same arguments the action tool will get.',
		inputSchema: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: Object.keys(ACTION_KEYS) },
				agent_id: uuid, listing_id: uuid, bid_id: uuid,
				ask_usdc: amount, ask_three: amount, min_bid_usdc: amount, amount_usdc: amount,
				duration_hours: { type: 'number', minimum: 1, maximum: 720 },
				include_balance: { type: 'boolean' }, include_history: { type: 'boolean' },
				payout_address: { type: 'string' }, payout_evm_address: { type: 'string' }, note: { type: 'string', maxLength: 1000 },
				currency: { type: 'string', enum: ['USDC', 'THREE'] },
				...funding,
			},
			required: ['action'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'agents:read' }, async (user) => {
				const p = await svc.previewAction(user, args.action, pick(args, args.action));
				const text = [
					`Preview (${p.action}), preview_id ${p.preview_id}, valid until ${p.expires_at}:`,
					p.text,
					...(p.warnings || []).map((w) => `Warning: ${w}`),
					'Show this to the user and get a clear yes before committing.',
				].join('\n');
				return ok(text, p);
			});
		},
	},
	{
		name: 'create_marketplace_listing',
		title: 'List an agent for sale',
		group: 'marketplace',
		tier: 'financial',
		confirmFlag: 'confirm_listing',
		previewTool: PREVIEW_TOOL,
		annotations: ann(false, true, false),
		description: 'List one of your agents for sale: a minimum bid in USDC, an optional buy-now price (USDC and optionally $THREE), a duration, and whether its wallet balance and history transfer. Commits the agent: a buy-now or an accepted bid sells it. Requires a preview_id from preview_marketplace_action (action create_listing) and confirm_listing: true.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: uuid,
				min_bid_usdc: amount,
				ask_usdc: { ...amount, description: 'Optional buy-now price in USDC.' },
				ask_three: { ...amount, description: 'Optional buy-now price in $THREE.' },
				duration_hours: { type: 'number', minimum: 1, maximum: 720, description: 'Default 168 (7 days).' },
				include_balance: { type: 'boolean', description: 'true: the wallet balance goes to the buyer. Default false: swept to you first.' },
				include_history: { type: 'boolean', description: 'Default true. false deletes memories and activity before the handover.' },
				payout_address: { type: 'string', description: 'Your Solana address for the proceeds. Defaults to your linked Solana wallet.' },
				payout_evm_address: { type: 'string', description: 'Optional: where a custodial EVM wallet balance goes when the balance is not included.' },
				note: { type: 'string', maxLength: 1000 },
				preview_id: previewArg,
				confirm_listing: confirmArg('Must be true, after the user approved the preview.'),
			},
			required: ['agent_id', 'min_bid_usdc'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'agents:write', pay: true }, async (user) => {
				const blocked = await gate(user, args, 'create_listing', 'confirm_listing');
				if (blocked) return blocked;
				const d = await svc.createListing(user, pick(args, 'create_listing'), { confirm: true });
				return ok(`Listed ${d.listing.agent.name}. ${listingLine(d.listing)}`, d);
			});
		},
	},
	{
		name: 'delist_marketplace_listing',
		title: 'Delist an agent',
		group: 'marketplace',
		tier: 'financial',
		confirmFlag: 'confirm_delist',
		previewTool: PREVIEW_TOOL,
		annotations: ann(false, true, false),
		description: 'Take your listing down and refund every open bid from escrow. Requires a preview_id from preview_marketplace_action (action delist) and confirm_delist: true.',
		inputSchema: {
			type: 'object',
			properties: { listing_id: uuid, preview_id: previewArg, confirm_delist: confirmArg('Must be true, after the user approved the preview.') },
			required: ['listing_id'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'agents:write', pay: true }, async (user) => {
				const blocked = await gate(user, args, 'delist', 'confirm_delist');
				if (blocked) return blocked;
				const d = await svc.delistListing(user, args.listing_id, { confirm: true });
				const refunds = d.bids.filter((b) => b.refund).map((b) => `${b.amount.amount} ${b.amount.symbol}: ${b.refund.status}${b.refund.signature ? ` (${b.refund.signature})` : ''}`);
				return ok(`Delisted. ${refunds.length ? `Refunds: ${refunds.join('; ')}` : 'There were no open bids.'}`, d);
			});
		},
	},
	{
		name: 'place_bid',
		title: 'Bid on an agent',
		group: 'marketplace',
		tier: 'financial',
		confirmFlag: 'confirm_bid',
		previewTool: PREVIEW_TOOL,
		annotations: ann(false, true, false),
		description: 'Bid USDC on a listed agent. The bid is locked in the listing\'s escrow on Solana and refunded if it is rejected, withdrawn, or the listing ends without accepting it. From an agent wallet the escrow transfer happens now; from a connected wallet you get a transaction to sign. Requires a preview_id from preview_marketplace_action (action place_bid) and confirm_bid: true.',
		inputSchema: {
			type: 'object',
			properties: {
				listing_id: uuid, amount_usdc: amount, ...funding,
				preview_id: previewArg, confirm_bid: confirmArg('Must be true, after the user approved the preview.'),
			},
			required: ['listing_id', 'amount_usdc', 'funding_source'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'wallet:write', pay: true }, async (user) => {
				const blocked = await gate(user, args, 'place_bid', 'confirm_bid');
				if (blocked) return blocked;
				const r = await svc.placeBid(user, pick(args, 'place_bid'), { confirm: true, kind: 'bid' });
				const text = r.funding?.status === 'awaiting_signature'
					? `Bid created. Sign the escrow transfer in your wallet within 10 minutes: open https://three.ws/marketplace/agents/listing/${r.bid.listing_id} (the transaction is also in structuredContent.funding.transaction).`
					: `Bid of ${r.bid.amount.amount} USDC is escrowed (${r.funding?.signature}).`;
				return ok(text, r);
			});
		},
	},
	{
		name: 'buy_now',
		title: 'Buy an agent now',
		group: 'marketplace',
		tier: 'financial',
		confirmFlag: 'confirm_payment',
		previewTool: PREVIEW_TOOL,
		annotations: ann(false, true, false),
		description: 'Pay a listing\'s buy-now price (USDC, or $THREE when the seller set one) into escrow; once it lands the sale settles and custody rotates to you: new wallet key, the seller\'s access revoked, ownership transferred. Requires a preview_id from preview_marketplace_action (action buy_now) and confirm_payment: true.',
		inputSchema: {
			type: 'object',
			properties: {
				listing_id: uuid, currency: { type: 'string', enum: ['USDC', 'THREE'] }, ...funding,
				preview_id: previewArg, confirm_payment: confirmArg('Must be true, after the user approved the preview.'),
			},
			required: ['listing_id', 'funding_source'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'wallet:write', pay: true }, async (user) => {
				const blocked = await gate(user, args, 'buy_now', 'confirm_payment');
				if (blocked) return blocked;
				const r = await svc.placeBid(user, pick(args, 'buy_now'), { confirm: true, kind: 'buy_now' });
				const text = r.funding?.status === 'awaiting_signature'
					? `Purchase started. Sign the escrow transfer in your wallet: https://three.ws/marketplace/agents/listing/${r.bid.listing_id}`
					: `Paid. Settlement is ${r.transfer?.status} at step ${r.transfer?.step}.${r.settlement_error ? ` It paused on ${r.settlement_error.step}: ${r.settlement_error.message}; it resumes automatically.` : ''}`;
				return ok(text, r);
			});
		},
	},
	{
		name: 'get_my_bids',
		title: 'My bids',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(true, false, false),
		description: 'Every bid you placed on agent listings, with status, escrow and refund signatures. Read-only.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(_args, auth) {
			return run(auth, { scope: 'agents:read' }, async (user) => {
				const bids = await svc.myBids(user);
				const text = bids.length
					? bids.map((b) => `${b.agent_name}: ${b.amount.amount} ${b.amount.symbol} ${b.status}${b.refund ? `, refund ${b.refund.status}` : ''} (bid ${b.id})`).join('\n')
					: 'You have not bid on any agent yet. browse_marketplace shows what is for sale.';
				return ok(text, { bids });
			});
		},
	},
	{
		name: 'get_received_bids',
		title: 'Bids on my listings',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(true, false, false),
		description: 'Every bid on your agent listings, open ones first. Read-only.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(_args, auth) {
			return run(auth, { scope: 'agents:read' }, async (user) => {
				const bids = await svc.receivedBids(user);
				const text = bids.length
					? bids.map((b) => `${b.agent_name}: ${b.amount.amount} ${b.amount.symbol} ${b.status} (bid ${b.id})`).join('\n')
					: 'No bids on your listings yet.';
				return ok(text, { bids });
			});
		},
	},
	{
		name: 'accept_marketplace_bid',
		title: 'Accept a bid',
		group: 'marketplace',
		tier: 'financial',
		confirmFlag: 'confirm_accept',
		previewTool: PREVIEW_TOOL,
		annotations: ann(false, true, false),
		description: 'Accept an open bid on your listing. Final: escrow pays you (minus the platform fee), every other bid is refunded, and custody rotates to the buyer. Requires a preview_id from preview_marketplace_action (action accept_bid) and confirm_accept: true.',
		inputSchema: {
			type: 'object',
			properties: { bid_id: uuid, preview_id: previewArg, confirm_accept: confirmArg('Must be true, after the user approved the preview.') },
			required: ['bid_id'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'agents:write', pay: true }, async (user) => {
				const blocked = await gate(user, args, 'accept_bid', 'confirm_accept');
				if (blocked) return blocked;
				const r = await svc.acceptBid(user, args.bid_id, { confirm: true });
				const t = r.transfer;
				const text = t.status === 'completed'
					? `Sold. You received ${t.seller_net.amount} ${t.seller_net.symbol} (${t.payout_signature}). The buyer now controls the agent through its new wallet ${t.new_wallet_address}.`
					: `Accepted. Settlement is at step ${t.step}${r.settlement_error ? ` and paused: ${r.settlement_error.message}. It resumes automatically, or call resume_agent_transfer.` : '.'}`;
				return ok(text, r);
			});
		},
	},
	{
		name: 'reject_marketplace_bid',
		title: 'Reject a bid',
		group: 'marketplace',
		tier: 'write',
		annotations: ann(false, false, true),
		description: 'Reject an open bid on your listing; its escrowed funds go back to the bidder. Your listing stays up.',
		inputSchema: { type: 'object', properties: { bid_id: uuid }, required: ['bid_id'], additionalProperties: false },
		async handler(args, auth) {
			return run(auth, { scope: 'agents:write' }, async (user) => {
				const r = await svc.rejectBid(user, args.bid_id);
				return ok(`Rejected. Refund ${r.refund.status}${r.refund.signature ? ` (${r.refund.signature})` : ''}.`, r);
			});
		},
	},
	{
		name: 'withdraw_marketplace_bid',
		title: 'Withdraw my bid',
		group: 'marketplace',
		tier: 'financial',
		confirmFlag: 'confirm_withdraw',
		previewTool: PREVIEW_TOOL,
		annotations: ann(false, true, false),
		description: 'Withdraw one of your open bids; escrow refunds it to where it came from. Requires a preview_id from preview_marketplace_action (action withdraw_bid) and confirm_withdraw: true.',
		inputSchema: {
			type: 'object',
			properties: { bid_id: uuid, preview_id: previewArg, confirm_withdraw: confirmArg('Must be true, after the user approved the preview.') },
			required: ['bid_id'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'wallet:write', pay: true }, async (user) => {
				const blocked = await gate(user, args, 'withdraw_bid', 'confirm_withdraw');
				if (blocked) return blocked;
				const r = await svc.withdrawBid(user, args.bid_id, { confirm: true });
				return ok(`Withdrawn. Refund ${r.refund.status}${r.refund.signature ? ` (${r.refund.signature})` : ''}.`, r);
			});
		},
	},
	{
		name: 'get_agent_transfer',
		title: 'Settlement progress',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(true, false, false),
		description: 'Step-by-step progress of an agent sale you are party to: seller payout, fee, key rotation, sweep, revocation, ownership, with signatures and any error. Read-only.',
		inputSchema: { type: 'object', properties: { transfer_id: uuid }, required: ['transfer_id'], additionalProperties: false },
		async handler(args, auth) {
			return run(auth, { scope: 'agents:read' }, async (user) => {
				const t = await svc.getTransferForViewer(args.transfer_id, user);
				return ok(t.steps.map((s) => `${s.state.padEnd(7)} ${s.label}`).join('\n') + (t.last_error ? `\nError: ${t.last_error}` : ''), t);
			});
		},
	},
	{
		name: 'resume_agent_transfer',
		title: 'Resume a stalled sale',
		group: 'marketplace',
		tier: 'write',
		annotations: ann(false, false, true),
		description: 'Resume an agent sale whose settlement stopped on an error. Safe to repeat: every step is idempotent and no leg can pay twice. The sweep cron also retries on its own.',
		inputSchema: { type: 'object', properties: { transfer_id: uuid }, required: ['transfer_id'], additionalProperties: false },
		async handler(args, auth) {
			return run(auth, { scope: 'agents:write' }, async (user) => {
				const r = await svc.resumeTransfer(user, args.transfer_id);
				return ok(`Settlement ${r.transfer.status} at step ${r.transfer.step}.${r.settlement_error ? ` Still blocked: ${r.settlement_error.message}` : ''}`, r);
			});
		},
	},
];
