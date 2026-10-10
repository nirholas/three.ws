// agent_send: an agent moving money out of its own wallet to someone else.
//
// Two steps, never one:
//   1. previewSend pins recipient, amount, asset and chain in a quote and
//      reports how the send will be gated, so the agent can show its user the
//      confirmation table before anything is signed.
//   2. confirmSend consumes that quote. Where it goes next depends on the
//      destination, re-read at confirm time:
//        - on the owner's destination allowlist (active, past its cooldown):
//          the agent signs it now, inside every spend cap;
//        - not on it while the allowlist is off: it becomes an owner approval
//          request (the /approvals inbox, push, Telegram), never a send;
//        - refused by an enforced allowlist, a frozen wallet, or a cap: it
//          stops with the reason. Approval cannot lift any of those.
//   A policy rule that says "ask me" also turns a would-be direct send into an
//   approval request. Nothing on this path lets an agent approve itself.

import { sql } from '../db.js';
import {
	SpendLimitError, countPriorSpendsTo, enforceDestinationAllowlist, getDailySpendUsd, getSpendLimits,
	validateSolanaAddress,
} from '../agent-trade-guards.js';
import { createApprovalRequest, runApproved, TTL_MS } from '../approvals.js';
import { CommerceError, assetSpec, atomicsToUsd, formatAtomics, normalizeAsset, normalizeNetwork, parseAmount } from './assets.js';
import { consumeQuote, createQuote, recordQuoteResult } from './quotes.js';
import { agentTransfer } from './transfer.js';
import { explorerTxUrl } from './solana-pay.js';

export const SEND_MEMO_MAX = 120;
export const APPROVAL_SOURCE = 'agent_commerce';

async function loadAgent(agentId) {
	const [row] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!row) throw new CommerceError('agent_not_found', 'agent not found', 404);
	return row;
}

function shortAddr(a) {
	const s = String(a || '');
	return s.length > 12 ? `${s.slice(0, 4)}...${s.slice(-4)}` : s;
}

/**
 * How the allowlist sees a destination right now: 'listed' (approved and past
 * its cooldown), 'unlisted' (the allowlist is off, so the owner must approve),
 * or 'blocked' (an enforced allowlist refuses it).
 */
async function destinationGate({ agentId, meta, destination, usd, network }) {
	try {
		const decision = await enforceDestinationAllowlist({ agentId, meta, category: 'transfer', destination, usdValue: usd, network });
		if (decision?.state === 'active') return { route: 'listed', label: decision.entry?.label || null };
		return { route: 'unlisted', label: null };
	} catch (err) {
		if (err instanceof SpendLimitError) return { route: 'blocked', code: err.code, message: err.message };
		// The allowlist could not be read. Fail toward the owner: the send asks
		// for approval instead of going straight out.
		console.warn('[agent-commerce] allowlist read failed', err?.message);
		return { route: 'unlisted', label: null, note: 'The allowlist could not be read, so this send needs your approval.' };
	}
}

/** Pre-flight caps without reserving anything, for the preview. */
function capCheck({ limits, usd, spentToday }) {
	if (limits.frozen) return { code: 'wallet_frozen', message: 'This wallet is frozen, so the agent cannot send. Unfreeze it under Limits & Safety.' };
	if (usd == null) return null;
	if (limits.per_tx_usd != null && usd > limits.per_tx_usd + 1e-9) {
		return { code: 'per_tx_exceeded', message: `This send is $${usd.toFixed(2)}, over the per-transaction limit of $${limits.per_tx_usd.toFixed(2)}.` };
	}
	if (limits.daily_usd != null && spentToday + usd > limits.daily_usd + 1e-9) {
		return { code: 'daily_exceeded', message: `This would bring today's spend to $${(spentToday + usd).toFixed(2)}, over the daily limit of $${limits.daily_usd.toFixed(2)}.` };
	}
	return null;
}

function allowlistText(gate) {
	if (gate.route === 'listed') return `On the allowlist${gate.label ? `: ${gate.label}` : ''}`;
	if (gate.route === 'blocked') return `BLOCKED: ${gate.message}`;
	return gate.note || 'Not on the allowlist, and the allowlist is off, so you approve this send';
}

function confirmationTable(p, gate = null) {
	return {
		...(gate ? { allowlist: allowlistText(gate) } : {}),
		recipient: p.to,
		amount: `${p.amount} ${p.symbol}`,
		asset: p.symbol,
		chain: p.network === 'mainnet' ? 'Solana' : `Solana ${p.network}`,
		usd: p.usd,
	};
}

/**
 * Quote a send. Nothing is reserved or signed.
 * @returns the preview, including `preview_id`, the confirmation table and the route.
 */
export async function previewSend({ agentId, to, amount, asset, network, memo = null }) {
	const agent = await loadAgent(agentId);
	const v = validateSolanaAddress(String(to || '').trim());
	if (!v.valid) throw new CommerceError('invalid_recipient', `to is not a valid Solana address (${v.reason})`);
	const a = normalizeAsset(asset);
	const net = normalizeNetwork(network);
	const spec = assetSpec(a, net);
	const atomics = parseAmount(amount, spec.decimals);
	const memoText = memo == null || memo === '' ? null : String(memo).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, SEND_MEMO_MAX);
	if (agent.meta?.solana_address && v.base58 === agent.meta.solana_address) {
		throw new CommerceError('invalid_recipient', 'That is the agent\'s own wallet.');
	}

	const usd = await atomicsToUsd(a, atomics, spec.decimals);
	const limits = getSpendLimits(agent.meta || {});
	const spentToday = await getDailySpendUsd(agentId, net).catch(() => 0);
	const gate = await destinationGate({ agentId, meta: agent.meta, destination: v.base58, usd, network: net });
	const blocked = capCheck({ limits, usd, spentToday }) || (gate.route === 'blocked' ? { code: gate.code, message: gate.message } : null);

	const payload = {
		to: v.base58,
		asset: a,
		symbol: spec.symbol,
		network: net,
		atomics: atomics.toString(),
		amount: formatAtomics(atomics, spec.decimals),
		memo: memoText,
		usd,
	};
	const route = blocked ? 'blocked' : gate.route === 'listed' ? 'direct' : 'approval';
	const out = {
		confirmation: confirmationTable(payload, gate),
		memo: memoText,
		route,
		route_detail: blocked
			? blocked.message
			: route === 'direct'
				? `The recipient is on the owner's allowlist${gate.label ? ` (${gate.label})` : ''}. Confirming signs and sends it now.`
				: gate.note || 'The recipient is not on the owner\'s allowlist. Confirming sends the owner an approval request; nothing moves until they approve it.',
		limits: {
			per_tx_usd: limits.per_tx_usd,
			daily_usd: limits.daily_usd,
			spent_today_usd: Math.round(spentToday * 100) / 100,
		},
	};
	if (blocked) return { ...out, preview_id: null, blocked: { code: blocked.code, message: blocked.message } };
	const quote = await createQuote({ kind: 'send', agentId, userId: agent.user_id, payload });
	return { ...out, preview_id: quote.id, expires_at: quote.expires_at };
}

/**
 * Run a previewed send. Returns `{ status: 'sent', ... }` when the agent signed
 * it, or `{ status: 'awaiting_approval', approval }` when the owner must answer.
 */
export async function confirmSend({ agentId, previewId }) {
	const agent = await loadAgent(agentId);
	const quote = await consumeQuote({ id: previewId, kind: 'send', agentId });
	const p = quote.payload;
	const gate = await destinationGate({ agentId, meta: agent.meta, destination: p.to, usd: p.usd, network: p.network });
	if (gate.route === 'blocked') {
		await recordQuoteResult(quote.id, { status: 'blocked', code: gate.code });
		throw new CommerceError(gate.code, gate.message, 403);
	}

	if (gate.route === 'listed') {
		try {
			const sent = await sendNow({ agent, payload: p, quoteId: quote.id });
			await recordQuoteResult(quote.id, sent);
			return sent;
		} catch (err) {
			// The owner's policy wants to see this one: ask instead of failing.
			if (!(err instanceof SpendLimitError && err.code === 'policy_step_up')) throw asCommerceError(err);
			const asked = await askOwner({ agent, payload: p, quoteId: quote.id, gateReason: err.message });
			await recordQuoteResult(quote.id, asked);
			return asked;
		}
	}
	const asked = await askOwner({ agent, payload: p, quoteId: quote.id, gateReason: gate.note || 'Recipient is not on the allowlist.' });
	await recordQuoteResult(quote.id, asked);
	return asked;
}

function asCommerceError(err) {
	if (err instanceof CommerceError) return err;
	if (err instanceof SpendLimitError) return new CommerceError(err.code, err.message, 403, err.detail);
	return err;
}

async function sendNow({ agent, payload: p, quoteId, approvalId = null }) {
	const res = await agentTransfer({
		agentId: agent.id,
		userId: agent.user_id,
		network: p.network,
		asset: p.asset,
		recipient: p.to,
		atomics: BigInt(p.atomics),
		memo: p.memo,
		category: 'transfer',
		stepUpApproved: Boolean(approvalId),
		rowMeta: { action: 'agent_send', quote_id: quoteId, approval_id: approvalId || undefined },
	});
	return {
		status: 'sent',
		signature: res.signature,
		explorer_url: explorerTxUrl(res.signature, p.network),
		confirmation: confirmationTable(p),
		usd: res.usd,
	};
}

async function askOwner({ agent, payload: p, quoteId, gateReason }) {
	const priors = await countPriorSpendsTo(agent.id, p.to, p.network).catch(() => 0);
	const riskNotes = [];
	if (priors === 0) riskNotes.push('This wallet has never paid this address before. Payments on Solana cannot be reversed.');
	else riskNotes.push(`This wallet has paid this address ${priors} time${priors === 1 ? '' : 's'} before.`);
	if (p.memo) riskNotes.push(`Memo: ${p.memo}`);
	if (p.network !== 'mainnet') riskNotes.push(`Runs on Solana ${p.network}.`);
	const who = agent.name || 'Your agent';
	const created = await createApprovalRequest({
		userId: agent.user_id,
		agentId: agent.id,
		source: APPROVAL_SOURCE,
		sourceRef: quoteId,
		actionType: 'agent_send',
		venue: 'wallet_transfer',
		payload: {
			kind: 'agent_send',
			agent_id: agent.id,
			quote_id: quoteId,
			to: p.to,
			asset: p.asset,
			network: p.network,
			atomics: p.atomics,
			memo: p.memo,
		},
		summary: `${who} wants to send ${p.amount} ${p.symbol} to ${shortAddr(p.to)}`,
		amount: Number(p.amount),
		amountUsd: p.usd != null ? Math.round(p.usd * 100) / 100 : null,
		asset: p.symbol,
		chain: 'solana',
		network: p.network,
		recipient: p.to,
		riskNotes,
		gateReason,
		idempotencyKey: `agent_commerce:send:${quoteId}`,
		ttlMs: TTL_MS.transfer,
		// A first payment to an address always asks, whatever the owner's
		// auto-approve policy says.
		autoApprovable: priors > 0,
	});
	const req = created.request;
	if (created.autoApproved) {
		const { outcome } = await runApproved(req, (claim) => executeApprovedCommerceAction(claim));
		if (outcome?.status === 'ok') {
			return { status: 'sent', signature: outcome.signature, explorer_url: explorerTxUrl(outcome.signature, p.network), confirmation: confirmationTable(p), usd: outcome.usd ?? null, auto_approved: true };
		}
		throw new CommerceError('transfer_failed', outcome?.note || 'The auto-approved send did not go through.', 502);
	}
	return {
		status: 'awaiting_approval',
		approval: { id: req.id, link: `/approvals/${req.id}`, expires_at: new Date(req.expires_at).toISOString() },
		confirmation: confirmationTable(p),
		message: `Sent to the owner for approval: ${req.summary}. Nothing moves until they approve it at /approvals.`,
	};
}

/**
 * Executor for approved commerce requests (registered in api/_lib/approvals.js).
 * Runs ONLY the stored payload, for the agent the payload names, if the
 * approving account still owns it.
 * @returns {Promise<{ status: 'ok'|'error', signature?: string, note?: string, usd?: number }>}
 */
export async function executeApprovedCommerceAction(row) {
	const p = row.payload || {};
	if (p.kind !== 'agent_send') return { status: 'error', note: 'Unknown commerce action, so nothing was executed.' };
	const [agent] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${p.agent_id} AND deleted_at IS NULL`;
	if (!agent) return { status: 'error', note: 'The agent behind this request was deleted, so nothing was executed.' };
	if (String(agent.user_id) !== String(row.user_id)) return { status: 'error', note: 'This agent is no longer owned by the account that approved it, so nothing was executed.' };
	let spec;
	try {
		spec = assetSpec(p.asset, p.network);
	} catch (e) {
		return { status: 'error', note: e.message };
	}
	try {
		const sent = await sendNow({
			agent,
			payload: { ...p, symbol: spec.symbol, amount: formatAtomics(BigInt(p.atomics), spec.decimals) },
			quoteId: p.quote_id,
			approvalId: row.id,
		});
		await recordQuoteResult(p.quote_id, sent).catch(() => {});
		return { status: 'ok', signature: sent.signature, usd: sent.usd ?? undefined };
	} catch (e) {
		return { status: 'error', note: (e?.message || 'send failed').slice(0, 240) };
	}
}
