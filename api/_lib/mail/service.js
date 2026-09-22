// Agent mail service: provisioning, quotes, metered sends, and the inbox.
//
// Both callers, the v1 REST routes (api/_lib/mail/routes.js) and the MCP tools
// (api/_mcpagent/mail-tools.js), go through this module, so the rules are
// identical however an agent reaches its mailbox:
//
//   • Ownership. Every call names an agent the caller owns; anything else is a
//     404 that does not reveal whether the agent exists.
//   • Quote first. Provisioning and every send are financial. A quote binds the
//     price, the payment source and, for a send, a hash of the exact content.
//     The execute call must cite an unexpired, unconsumed quote and carry the
//     explicit confirm flag; a send whose content differs from what was quoted
//     is refused.
//   • Charge once. The charge is idempotent on the quote id, on both rails:
//     credits (debitCredits) or the agent's own USDC (transferUsdcGuarded, which
//     runs the wallet's spend limits, freeze switch and audit trail). A send the
//     provider rejects is refunded to credits.
//   • Conduct. Outbound content passes checkOutboundContent, recipients are
//     validated, and a warm-up throttle bounds a new mailbox's volume.

import { createHash } from 'node:crypto';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { sql } from '../db.js';
import { env } from '../env.js';
import { r2 } from '../r2.js';
import { debitCredits, getCreditAccount, refundCredits } from '../credits.js';
import { transferUsdcGuarded } from '../agent-usdc-transfer.js';
import { getSolanaAddressBalances } from '../agent-wallet.js';
import { currentSignatureFor } from '../real-funds-agreement.js';
import { fetchSafePublicUrlPinned } from '../ssrf-guard.js';
import { logAudit } from '../audit.js';
import {
	mailDomain,
	mailPricing,
	warmupLimits,
	QUOTE_TTL_MS,
	RESERVED_LOCAL_PARTS,
	MAX_RECIPIENTS,
	MAX_ATTACHMENTS,
	MAX_ATTACHMENT_BYTES,
	MAX_TOTAL_ATTACHMENT_BYTES,
	MAX_TEXT_CHARS,
	MAX_HTML_CHARS,
} from './config.js';
import { checkOutboundContent } from './content-rules.js';
import { isValidAddress, isValidLocalPart, localPartFrom, replyHeaders, replySubject } from './threading.js';
import { mailProvider, ProviderError } from './provider.js';

export class MailError extends Error {
	constructor(status, code, message, details = null) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function usd(n) {
	return Math.round(Number(n) * 1e6) / 1e6;
}

function hashPayload(obj) {
	return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

// ── ownership ────────────────────────────────────────────────────────────────

export async function loadOwnedAgent(agentId, userId) {
	if (!UUID_RE.test(String(agentId || ''))) throw new MailError(404, 'agent_not_found', 'No agent with that id is on your account.');
	const [row] = await sql`
		select id, user_id, name, meta
		from agent_identities
		where id = ${agentId} and deleted_at is null
		limit 1
	`;
	if (!row || row.user_id !== userId) throw new MailError(404, 'agent_not_found', 'No agent with that id is on your account.');
	return row;
}

export async function activeMailbox(agentId) {
	const [row] = await sql`
		select * from agent_mailboxes where agent_id = ${agentId} and status = 'active' limit 1
	`;
	return row || null;
}

async function outboundCounts(mailboxId) {
	const [row] = await sql`
		select
			count(*) filter (where created_at > now() - interval '1 hour')::int as last_hour,
			count(*) filter (where created_at > now() - interval '1 day')::int  as last_day
		from agent_mail_sends
		where mailbox_id = ${mailboxId} and kind = 'send'
		  and status not in ('charge_failed', 'refunded')
	`;
	return { lastHour: row?.last_hour ?? 0, lastDay: row?.last_day ?? 0 };
}

export async function mailboxView(mb) {
	if (!mb) return null;
	const limits = warmupLimits(mb.created_at);
	const [counts, [unread]] = await Promise.all([
		outboundCounts(mb.id),
		sql`
			select count(*)::int as n from agent_mail_messages
			where mailbox_id = ${mb.id} and direction = 'in' and read_at is null and deleted_at is null
			  and coalesce(spam_score, 0) < 6
		`,
	]);
	return {
		id: mb.id,
		address: mb.address,
		display_name: mb.display_name,
		status: mb.status,
		created_at: mb.created_at,
		unread: unread?.n ?? 0,
		limits: {
			per_hour: limits.perHour,
			per_day: limits.perDay,
			warming_up: limits.warming,
			sent_last_hour: counts.lastHour,
			sent_last_day: counts.lastDay,
		},
	};
}

// ── payment source ───────────────────────────────────────────────────────────

async function fundingView(userId, agent) {
	const credits = await getCreditAccount(userId).catch(() => ({ balanceUsd: 0 }));
	const address = agent.meta?.solana_address || null;
	let walletUsdc = null;
	if (address) {
		const b = await getSolanaAddressBalances(address, 'mainnet').catch(() => null);
		walletUsdc = b?.usdc != null ? Number(b.usdc) : null;
	}
	return {
		credits_usd: usd(credits.balanceUsd),
		wallet_address: address,
		wallet_usdc: walletUsdc,
		wallet_payable: Boolean(address && agent.meta?.encrypted_solana_secret && env.X402_PAY_TO_SOLANA),
	};
}

function choosePaymentSource(requested, price, funding) {
	const creditsOk = funding.credits_usd >= price;
	const walletOk = funding.wallet_payable && (funding.wallet_usdc ?? 0) >= price;
	if (requested === 'credits') {
		if (!creditsOk) throw new MailError(402, 'insufficient_credits', `This costs $${price} and your credit balance is $${funding.credits_usd}. Top up at /credits or pay from the agent wallet.`, { funding, price_usd: price });
		return 'credits';
	}
	if (requested === 'wallet') {
		if (!funding.wallet_payable) throw new MailError(409, 'wallet_unavailable', 'This agent has no custodial Solana wallet that can pay. Provision one, or pay with credits.', { funding });
		if (!walletOk) throw new MailError(402, 'insufficient_wallet_usdc', `This costs $${price} USDC and the agent wallet holds ${funding.wallet_usdc ?? 0} USDC.`, { funding, price_usd: price });
		return 'wallet';
	}
	if (creditsOk) return 'credits';
	if (walletOk) return 'wallet';
	throw new MailError(402, 'insufficient_funds', `This costs $${price}. Add credits at /credits or fund the agent wallet with USDC.`, { funding, price_usd: price });
}

// ── quotes ───────────────────────────────────────────────────────────────────

async function insertQuote({ userId, agentId, kind, price, source, payload }) {
	const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
	const [row] = await sql`
		insert into agent_mail_quotes (user_id, agent_id, kind, price_usd, payment_source, payload_hash, payload, expires_at)
		values (${userId}, ${agentId}, ${kind}, ${String(price)}, ${source}, ${hashPayload(payload)},
		        ${JSON.stringify(payload)}::jsonb, ${expiresAt.toISOString()})
		returning id, expires_at
	`;
	return row;
}

/**
 * Atomically consume a quote. Refuses a missing, foreign, stale, used or
 * mismatched quote with an error that names the preview tool to call again.
 */
async function consumeQuote({ quoteId, userId, agentId, kind, payload }) {
	const redo = kind === 'create' ? 'agent_mail_quote with action "create"' : 'agent_mail_quote with action "send"';
	if (!UUID_RE.test(String(quoteId || ''))) {
		throw new MailError(400, 'quote_required', `Call ${redo} first and pass its quote_id.`);
	}
	const [q] = await sql`select * from agent_mail_quotes where id = ${quoteId} limit 1`;
	if (!q || q.user_id !== userId || q.agent_id !== agentId || q.kind !== kind) {
		throw new MailError(400, 'quote_invalid', `That quote does not belong to this ${kind}. Call ${redo} again.`);
	}
	if (q.consumed_at) throw new MailError(409, 'quote_used', `That quote was already used. Call ${redo} for a new one.`);
	if (new Date(q.expires_at).getTime() < Date.now()) {
		throw new MailError(410, 'quote_expired', `That quote expired (quotes last 10 minutes). Call ${redo} again.`);
	}
	if (payload && q.payload_hash !== hashPayload(payload)) {
		throw new MailError(409, 'quote_mismatch', `The ${kind === 'send' ? 'message' : 'request'} differs from what was quoted. Call ${redo} with the final content.`);
	}
	const [claimed] = await sql`
		update agent_mail_quotes set consumed_at = now()
		where id = ${quoteId} and consumed_at is null
		returning id
	`;
	if (!claimed) throw new MailError(409, 'quote_used', `That quote was already used. Call ${redo} for a new one.`);
	return { ...q, price_usd: Number(q.price_usd) };
}

async function requireAgreementForWallet(userId) {
	const sig = await currentSignatureFor(userId).catch(() => {
		throw new MailError(503, 'agreement_check_unavailable', 'Could not verify your signed real-funds agreements, so nothing was charged. Try again in a moment.');
	});
	if (!sig) {
		throw new MailError(403, 'risk_ack_required', 'Sign the real-funds agreements at /legal/sign before paying from the agent wallet, or pay with credits.');
	}
}

// ── charging ─────────────────────────────────────────────────────────────────

async function charge({ quote, agent, userId, kind }) {
	const idempotencyKey = `agent-mail:${quote.id}`;
	if (quote.payment_source === 'credits') {
		const debit = await debitCredits({
			userId,
			amountUsd: quote.price_usd,
			action: `agent_mail.${kind}`,
			refType: 'agent_mail_quote',
			refId: quote.id,
			idempotencyKey,
			meta: { agent_id: agent.id },
		});
		return { creditLedgerId: debit.ledgerId, signature: null };
	}
	await requireAgreementForWallet(userId);
	const paid = await transferUsdcGuarded({
		fromAgentId: agent.id,
		fromUserId: userId,
		fromMeta: agent.meta || {},
		toAddress: env.X402_PAY_TO_SOLANA,
		usdc: quote.price_usd,
		network: 'mainnet',
		category: 'x402',
		idempotencyKey,
		rowMeta: { purpose: 'agent_mail', kind, quote_id: quote.id },
	});
	if (paid.status === 'paid' || paid.status === 'replayed') return { creditLedgerId: null, signature: paid.signature };
	if (paid.status === 'blocked') {
		throw new MailError(403, paid.code || 'spend_blocked', paid.message || 'The agent wallet spend policy blocked this payment.');
	}
	throw new MailError(402, paid.code || 'wallet_payment_failed', `The USDC payment from the agent wallet did not settle (${paid.code || 'failed'}). Nothing was sent.`);
}

// A failed delivery is made whole in credits on either rail: credits come back
// as credits, and a settled USDC payment is refunded as the same USD in credits.
async function refund({ quote, userId, kind, reason }) {
	await refundCredits({
		userId,
		amountUsd: quote.price_usd,
		action: `agent_mail.${kind}.refund`,
		refType: 'agent_mail_quote',
		refId: quote.id,
		idempotencyKey: `agent-mail-refund:${quote.id}`,
		meta: { reason, paid_with: quote.payment_source },
	});
}

async function recordSend(fields) {
	const [row] = await sql`
		insert into agent_mail_sends
			(mailbox_id, agent_id, user_id, kind, quote_id, cost_usd, payment_source, status)
		values (${fields.mailboxId}, ${fields.agentId}, ${fields.userId}, ${fields.kind}, ${fields.quoteId},
		        ${String(fields.cost)}, ${fields.source}, 'charging')
		returning id
	`;
	return row.id;
}

async function updateSend(id, patch) {
	await sql`
		update agent_mail_sends set
			status = coalesce(${patch.status ?? null}, status),
			mailbox_id = coalesce(${patch.mailboxId ?? null}::uuid, mailbox_id),
			credit_ledger_id = coalesce(${patch.creditLedgerId ?? null}::uuid, credit_ledger_id),
			signature = coalesce(${patch.signature ?? null}, signature),
			provider = coalesce(${patch.provider ?? null}, provider),
			provider_id = coalesce(${patch.providerId ?? null}, provider_id),
			message_row_id = coalesce(${patch.messageRowId ?? null}::uuid, message_row_id),
			error_code = ${patch.errorCode ?? null},
			error_message = ${patch.errorMessage ?? null},
			updated_at = now()
		where id = ${id}
	`;
}

// ── provisioning ─────────────────────────────────────────────────────────────

async function pickLocalPart(agent, requested) {
	if (requested != null && requested !== '') {
		const lp = String(requested).trim().toLowerCase();
		if (!isValidLocalPart(lp)) {
			throw new MailError(400, 'invalid_local_part', 'Use 3 to 32 lowercase letters, digits, dots or hyphens, starting and ending with a letter or digit.');
		}
		if (RESERVED_LOCAL_PARTS.has(lp)) throw new MailError(409, 'local_part_reserved', `"${lp}" is a reserved role address. Pick another.`);
		const [taken] = await sql`select 1 from agent_mailboxes where local_part = ${lp} and domain = ${mailDomain()} limit 1`;
		if (taken) throw new MailError(409, 'address_taken', `${lp}@${mailDomain()} is taken. Pick another.`);
		return lp;
	}
	const base = localPartFrom(agent.name) || `agent-${String(agent.id).slice(0, 8)}`;
	const stem = RESERVED_LOCAL_PARTS.has(base) ? `${base}-agent` : base;
	for (let i = 0; i < 20; i++) {
		const candidate = i === 0 ? stem : `${stem.slice(0, 28)}-${i + 1}`;
		const [taken] = await sql`select 1 from agent_mailboxes where local_part = ${candidate} and domain = ${mailDomain()} limit 1`;
		if (!taken) return candidate;
	}
	return `${stem.slice(0, 22)}-${String(agent.id).slice(0, 8)}`;
}

function cleanDisplayName(name, agent) {
	const s = String(name ?? agent.name ?? '').replace(/[<>"\r\n]/g, '').trim().slice(0, 64);
	return s || null;
}

export async function quoteCreate({ userId, agentId, localPart, displayName, paymentSource }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const existing = await activeMailbox(agent.id);
	if (existing) {
		throw new MailError(409, 'mailbox_exists', `This agent already has ${existing.address}.`, { address: existing.address });
	}
	const lp = await pickLocalPart(agent, localPart);
	const pricing = await mailPricing();
	const price = pricing.create_usd;
	const funding = await fundingView(userId, agent);
	const source = choosePaymentSource(paymentSource, price, funding);
	const payload = { local_part: lp, display_name: cleanDisplayName(displayName, agent) };
	const q = await insertQuote({ userId, agentId: agent.id, kind: 'create', price, source, payload });
	return {
		quote_id: q.id,
		action: 'create',
		price_usd: price,
		payment_source: source,
		expires_at: q.expires_at,
		address: `${lp}@${mailDomain()}`,
		display_name: payload.display_name,
		funding,
		confirm_with: { tool: 'agent_mail_create', flag: 'confirm_spend', quote_id: q.id },
	};
}

export async function createMailbox({ userId, agentId, quoteId, confirm }) {
	if (confirm !== true) {
		throw new MailError(400, 'confirm_required', 'Provisioning charges the account. Show the quote to the user, then call again with confirm_spend: true.');
	}
	const agent = await loadOwnedAgent(agentId, userId);
	const quote = await consumeQuote({ quoteId, userId, agentId: agent.id, kind: 'create' });
	const { local_part: lp, display_name: displayName } = quote.payload || {};
	const domain = mailDomain();
	const sendId = await recordSend({ mailboxId: null, agentId: agent.id, userId, kind: 'create', quoteId: quote.id, cost: quote.price_usd, source: quote.payment_source });

	let paid;
	try {
		paid = await charge({ quote, agent, userId, kind: 'create' });
	} catch (err) {
		await updateSend(sendId, { status: 'charge_failed', errorCode: err.code || 'charge_failed', errorMessage: err.message });
		throw err;
	}

	let mb;
	try {
		[mb] = await sql`
			insert into agent_mailboxes (agent_id, user_id, address, local_part, domain, display_name)
			values (${agent.id}, ${userId}, ${`${lp}@${domain}`}, ${lp}, ${domain}, ${displayName})
			returning *
		`;
	} catch (err) {
		await refund({ quote, userId, kind: 'create', reason: 'address_conflict' });
		await updateSend(sendId, { status: 'refunded', errorCode: 'address_conflict', errorMessage: err.message, ...paid });
		throw new MailError(409, 'address_taken', `${lp}@${domain} was claimed a moment ago. You were refunded in credits; quote again.`);
	}
	await updateSend(sendId, { status: 'provisioned', mailboxId: mb.id, creditLedgerId: paid.creditLedgerId, signature: paid.signature });
	logAudit({ userId, action: 'agent_mail.create', resourceId: agent.id, meta: { address: mb.address, paid_with: quote.payment_source, cost_usd: quote.price_usd } });
	return { mailbox: await mailboxView(mb), charge: { cost_usd: quote.price_usd, payment_source: quote.payment_source, signature: paid.signature, credit_ledger_id: paid.creditLedgerId } };
}

// ── drafting and sending ─────────────────────────────────────────────────────

function asList(v) {
	if (v == null || v === '') return [];
	return (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
}

/**
 * Validate and canonicalize a draft. The canonical form is what gets hashed
 * into the quote, so the confirmed send is byte-for-byte what was previewed.
 */
async function canonicalDraft(mb, draft) {
	const to = [...new Set(asList(draft.to))];
	const cc = [...new Set(asList(draft.cc))].filter((a) => !to.includes(a));
	if (!to.length) throw new MailError(400, 'recipient_required', 'Name at least one recipient in "to".');
	if (to.length + cc.length > MAX_RECIPIENTS) throw new MailError(400, 'too_many_recipients', `At most ${MAX_RECIPIENTS} recipients per message.`);
	const bad = [...to, ...cc].filter((a) => !isValidAddress(a));
	if (bad.length) throw new MailError(400, 'invalid_recipient', `Not a valid email address: ${bad.join(', ')}.`, { invalid: bad });
	if ([...to, ...cc].includes(mb.address)) throw new MailError(400, 'self_send', 'An agent cannot email its own address.');

	let parent = null;
	if (draft.in_reply_to) {
		if (!UUID_RE.test(String(draft.in_reply_to))) throw new MailError(400, 'invalid_reply', 'in_reply_to must be the id of a message in this mailbox.');
		[parent] = await sql`
			select id, thread_id, message_id, references_ids, subject from agent_mail_messages
			where id = ${draft.in_reply_to} and mailbox_id = ${mb.id} and deleted_at is null limit 1
		`;
		if (!parent) throw new MailError(404, 'reply_target_not_found', 'The message you are replying to is not in this mailbox.');
	}

	const subject = String(draft.subject ?? (parent ? replySubject(parent.subject) : '')).trim();
	const text = String(draft.text ?? '').trim();
	const html = draft.html ? String(draft.html) : null;
	if (text.length > MAX_TEXT_CHARS) throw new MailError(400, 'text_too_long', `The text body is over ${MAX_TEXT_CHARS} characters.`);
	if (html && html.length > MAX_HTML_CHARS) throw new MailError(400, 'html_too_long', `The HTML body is over ${MAX_HTML_CHARS} characters.`);
	if (!text) throw new MailError(400, 'text_required', 'Every message needs a plain-text body (html is optional and additional).');

	const verdict = checkOutboundContent({ subject, text, html, isReply: Boolean(parent) });
	if (!verdict.ok) {
		throw new MailError(422, 'content_rejected', verdict.violations.map((v) => v.message).join(' '), { violations: verdict.violations });
	}

	const attachments = Array.isArray(draft.attachments) ? draft.attachments : [];
	if (attachments.length > MAX_ATTACHMENTS) throw new MailError(400, 'too_many_attachments', `At most ${MAX_ATTACHMENTS} attachments per message.`);
	const atts = attachments.map((a, i) => {
		const url = String(a?.url || '').trim();
		let parsed;
		try { parsed = new URL(url); } catch { throw new MailError(400, 'invalid_attachment', `Attachment ${i + 1} needs a public https url.`); }
		if (parsed.protocol !== 'https:') throw new MailError(400, 'invalid_attachment', `Attachment ${i + 1} must be served over https.`);
		const filename = String(a?.filename || decodeURIComponent(parsed.pathname.split('/').pop() || '') || `attachment-${i + 1}`)
			.replace(/[\\/\r\n"]/g, '_')
			.slice(0, 120);
		return { url, filename };
	});

	return {
		canonical: { to, cc, subject, text, html, attachments: atts, in_reply_to: parent?.id || null },
		parent,
	};
}

async function assertThrottle(mb) {
	const limits = warmupLimits(mb.created_at);
	const counts = await outboundCounts(mb.id);
	if (counts.lastHour >= limits.perHour) {
		throw new MailError(429, 'mailbox_hourly_limit', `This mailbox sent ${counts.lastHour} messages in the last hour, its limit${limits.warming ? ' while warming up' : ''}. Try again later.`, { limits, counts });
	}
	if (counts.lastDay >= limits.perDay) {
		throw new MailError(429, 'mailbox_daily_limit', `This mailbox reached its ${limits.perDay} messages per day limit${limits.warming ? ' while warming up' : ''}.`, { limits, counts });
	}
	return { limits, counts };
}

async function requireMailbox(agent) {
	const mb = await activeMailbox(agent.id);
	if (!mb) throw new MailError(404, 'no_mailbox', 'This agent has no mailbox yet. Quote one with agent_mail_quote (action "create").');
	return mb;
}

export async function quoteSend({ userId, agentId, draft, paymentSource }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const mb = await requireMailbox(agent);
	const { canonical } = await canonicalDraft(mb, draft || {});
	const throttle = await assertThrottle(mb);
	const pricing = await mailPricing();
	const price = pricing.send_usd;
	const funding = await fundingView(userId, agent);
	const source = choosePaymentSource(paymentSource, price, funding);
	const q = await insertQuote({ userId, agentId: agent.id, kind: 'send', price, source, payload: canonical });
	return {
		quote_id: q.id,
		action: 'send',
		price_usd: price,
		payment_source: source,
		expires_at: q.expires_at,
		preview: {
			from: fromHeader(mb),
			to: canonical.to,
			cc: canonical.cc,
			subject: canonical.subject,
			text: canonical.text,
			has_html: Boolean(canonical.html),
			attachments: canonical.attachments,
			in_reply_to: canonical.in_reply_to,
		},
		limits: { per_hour: throttle.limits.perHour, per_day: throttle.limits.perDay, sent_last_hour: throttle.counts.lastHour, sent_last_day: throttle.counts.lastDay },
		funding,
		confirm_with: { tool: 'agent_mail_send', flag: 'confirm_send', quote_id: q.id },
	};
}

function fromHeader(mb) {
	return mb.display_name ? `"${mb.display_name}" <${mb.address}>` : mb.address;
}

async function fetchAttachments(list) {
	const out = [];
	let total = 0;
	for (const [i, a] of list.entries()) {
		let res;
		try {
			res = await fetchSafePublicUrlPinned(a.url, { signal: AbortSignal.timeout(20_000) }, { maxBytes: MAX_ATTACHMENT_BYTES });
		} catch (err) {
			throw new MailError(422, 'attachment_fetch_failed', `Attachment ${i + 1} (${a.filename}) could not be fetched: ${err?.message || 'blocked'}.`);
		}
		if (!res.ok) throw new MailError(422, 'attachment_fetch_failed', `Attachment ${i + 1} (${a.filename}) answered HTTP ${res.status}.`);
		const buf = Buffer.from(await res.arrayBuffer());
		total += buf.length;
		if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new MailError(413, 'attachments_too_large', `Attachments total over ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
		out.push({ filename: a.filename, content: buf, contentType: res.headers.get('content-type') || 'application/octet-stream', size: buf.length });
	}
	return out;
}

export async function sendMail({ userId, agentId, quoteId, draft, confirm }) {
	if (confirm !== true) {
		throw new MailError(400, 'confirm_required', 'Sending is outward-facing and metered. Show the quote preview to the user, then call again with confirm_send: true.');
	}
	const agent = await loadOwnedAgent(agentId, userId);
	const mb = await requireMailbox(agent);
	const { canonical, parent } = await canonicalDraft(mb, draft || {});
	await assertThrottle(mb);
	const quote = await consumeQuote({ quoteId, userId, agentId: agent.id, kind: 'send', payload: canonical });

	// Fetch attachments before charging, so an unreachable file costs nothing.
	const files = await fetchAttachments(canonical.attachments);

	const sendId = await recordSend({ mailboxId: mb.id, agentId: agent.id, userId, kind: 'send', quoteId: quote.id, cost: quote.price_usd, source: quote.payment_source });
	let paid;
	try {
		paid = await charge({ quote, agent, userId, kind: 'send' });
	} catch (err) {
		await updateSend(sendId, { status: 'charge_failed', errorCode: err.code || 'charge_failed', errorMessage: err.message });
		throw err;
	}
	await updateSend(sendId, { status: 'sending', creditLedgerId: paid.creditLedgerId, signature: paid.signature });

	const provider = mailProvider();
	const domain = mailDomain();
	const messageId = `${quote.id}@${domain}`;
	const headers = { 'Message-ID': `<${messageId}>`, ...(parent ? replyHeaders(parent) : {}) };
	let sent;
	try {
		sent = await provider.send({
			from: fromHeader(mb),
			to: canonical.to,
			cc: canonical.cc,
			subject: canonical.subject,
			text: canonical.text,
			html: canonical.html,
			headers,
			attachments: files,
			idempotencyKey: `agent-mail-send:${quote.id}`,
		});
	} catch (err) {
		const code = err instanceof ProviderError ? err.code : 'provider_error';
		await refund({ quote, userId, kind: 'send', reason: code });
		await updateSend(sendId, { status: 'refunded', provider: provider.name, errorCode: code, errorMessage: err.message });
		throw new MailError(502, 'send_failed', `The mail provider did not accept the message (${err.message}). You were refunded $${quote.price_usd} in credits; fix the issue and retry.`, { provider_code: code, retryable: Boolean(err.retryable) });
	}

	const references = parent ? [...(parent.references_ids || []), parent.message_id].filter(Boolean).slice(-20) : [];
	const [msg] = await sql`
		insert into agent_mail_messages
			(mailbox_id, direction, thread_id, from_address, from_name, to_addresses, cc_addresses, subject,
			 text_body, html_body, attachments, message_id, in_reply_to, references_ids, provider,
			 provider_message_id, read_at, delivery_status)
		values
			(${mb.id}, 'out', ${parent?.thread_id || quote.id}, ${mb.address}, ${mb.display_name}, ${canonical.to}, ${canonical.cc},
			 ${canonical.subject}, ${canonical.text}, ${canonical.html},
			 ${JSON.stringify(files.map((f) => ({ filename: f.filename, size: f.size, content_type: f.contentType })))}::jsonb,
			 ${messageId}, ${parent?.message_id || null}, ${references}, ${provider.name}, ${sent.id}, now(), 'sent')
		returning id, thread_id, created_at
	`;
	await updateSend(sendId, { status: 'sent', provider: provider.name, providerId: sent.id, messageRowId: msg.id });
	logAudit({ userId, action: 'agent_mail.send', resourceId: agent.id, meta: { to: canonical.to, cc: canonical.cc, message_id: msg.id, paid_with: quote.payment_source, cost_usd: quote.price_usd } });
	return {
		message: { id: msg.id, thread_id: msg.thread_id, created_at: msg.created_at, status: 'sent', provider_id: sent.id },
		charge: { cost_usd: quote.price_usd, payment_source: quote.payment_source, signature: paid.signature, credit_ledger_id: paid.creditLedgerId },
	};
}

// ── inbox reads ──────────────────────────────────────────────────────────────

function summaryRow(r) {
	return {
		id: r.id,
		direction: r.direction,
		thread_id: r.thread_id,
		from: r.from_address,
		from_name: r.from_name,
		to: r.to_addresses,
		cc: r.cc_addresses,
		subject: r.subject,
		snippet: String(r.text_body || '').replace(/\s+/g, ' ').trim().slice(0, 180),
		attachment_count: Array.isArray(r.attachments) ? r.attachments.length : 0,
		read: Boolean(r.read_at),
		spam: r.spam_score != null && Number(r.spam_score) >= 6,
		spam_score: r.spam_score != null ? Number(r.spam_score) : null,
		delivery_status: r.delivery_status,
		created_at: r.created_at,
	};
}

export async function getMailboxForAgent({ userId, agentId }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const mb = await activeMailbox(agent.id);
	const pricing = await mailPricing();
	return { agent: { id: agent.id, name: agent.name }, mailbox: await mailboxView(mb), pricing, domain: mailDomain() };
}

/**
 * List messages newest first. Cursor is the id of the last row of the previous
 * page. folder: inbox (received, not spam) | sent | spam | all.
 */
export async function listMessages({ userId, agentId, folder = 'inbox', unread = false, q = '', limit = 25, cursor = null }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const mb = await requireMailbox(agent);
	const cap = Math.min(Math.max(Number(limit) || 25, 1), 100);
	const f = ['inbox', 'sent', 'spam', 'all'].includes(folder) ? folder : 'inbox';
	const search = String(q || '').trim().slice(0, 120);
	const pattern = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

	let beforeTs = null;
	let beforeId = null;
	if (cursor && UUID_RE.test(String(cursor))) {
		const [anchor] = await sql`select created_at from agent_mail_messages where id = ${cursor} and mailbox_id = ${mb.id}`;
		if (anchor) {
			beforeTs = anchor.created_at;
			beforeId = cursor;
		}
	}
	const rows = await sql`
		select id, direction, thread_id, from_address, from_name, to_addresses, cc_addresses, subject,
		       left(text_body, 400) as text_body, attachments, read_at, spam_score, delivery_status, created_at
		from agent_mail_messages
		where mailbox_id = ${mb.id} and deleted_at is null
		  and (${f} = 'all'
		       or (${f} = 'inbox' and direction = 'in' and coalesce(spam_score, 0) < 6)
		       or (${f} = 'spam' and direction = 'in' and coalesce(spam_score, 0) >= 6)
		       or (${f} = 'sent' and direction = 'out'))
		  and (${unread === true} = false or (direction = 'in' and read_at is null))
		  and (${pattern}::text is null
		       or subject ilike ${pattern} or from_address ilike ${pattern} or text_body ilike ${pattern}
		       or array_to_string(to_addresses, ' ') ilike ${pattern})
		  and (${beforeTs}::timestamptz is null
		       or created_at < ${beforeTs}::timestamptz
		       or (created_at = ${beforeTs}::timestamptz and id < ${beforeId}::uuid))
		order by created_at desc, id desc
		limit ${cap + 1}
	`;
	const hasMore = rows.length > cap;
	const items = (hasMore ? rows.slice(0, cap) : rows).map(summaryRow);
	return { items, hasMore, nextCursor: hasMore ? items[items.length - 1].id : null, mailbox: { address: mb.address } };
}

async function loadMessage(mb, messageId) {
	if (!UUID_RE.test(String(messageId || ''))) throw new MailError(404, 'message_not_found', 'No message with that id in this mailbox.');
	const [row] = await sql`
		select * from agent_mail_messages where id = ${messageId} and mailbox_id = ${mb.id} and deleted_at is null limit 1
	`;
	if (!row) throw new MailError(404, 'message_not_found', 'No message with that id in this mailbox.');
	return row;
}

export async function readMessage({ userId, agentId, messageId, markRead = true }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const mb = await requireMailbox(agent);
	const row = await loadMessage(mb, messageId);
	if (markRead && row.direction === 'in' && !row.read_at) {
		await sql`update agent_mail_messages set read_at = now() where id = ${row.id} and read_at is null`;
		row.read_at = new Date().toISOString();
	}
	const thread = await sql`
		select id, direction, from_address, subject, created_at
		from agent_mail_messages
		where mailbox_id = ${mb.id} and thread_id = ${row.thread_id} and deleted_at is null
		order by created_at asc limit 50
	`;
	let send = null;
	if (row.direction === 'out') {
		[send] = await sql`
			select status, cost_usd, payment_source, signature, error_code, error_message
			from agent_mail_sends where message_row_id = ${row.id} limit 1
		`;
	}
	return {
		...summaryRow(row),
		reply_to: row.reply_to,
		text: row.text_body,
		html: row.html_body,
		message_id: row.message_id,
		in_reply_to: row.in_reply_to,
		attachments: (row.attachments || []).map((a, i) => ({
			index: i,
			filename: a.filename,
			size: a.size,
			content_type: a.content_type,
			stored: Boolean(a.key),
			quarantined: Boolean(a.quarantined),
		})),
		spam_verdict: row.spam_verdict,
		virus_verdict: row.virus_verdict,
		auth_results: row.auth_results,
		send: send ? { ...send, cost_usd: Number(send.cost_usd) } : null,
		thread: thread.map((t) => ({ id: t.id, direction: t.direction, from: t.from_address, subject: t.subject, created_at: t.created_at })),
		untrusted: row.direction === 'in',
	};
}

export async function setRead({ userId, agentId, messageId, read }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const mb = await requireMailbox(agent);
	const row = await loadMessage(mb, messageId);
	await sql`update agent_mail_messages set read_at = ${read ? new Date().toISOString() : null} where id = ${row.id}`;
	return { id: row.id, read: Boolean(read) };
}

export async function deleteMessage({ userId, agentId, messageId }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const mb = await requireMailbox(agent);
	const row = await loadMessage(mb, messageId);
	await sql`update agent_mail_messages set deleted_at = now() where id = ${row.id}`;
	return { id: row.id, deleted: true };
}

/**
 * A short-lived download URL for one stored attachment, always served with
 * Content-Disposition: attachment and a neutral content type, so a hostile
 * file is saved, never rendered in the browser.
 */
export async function attachmentDownloadUrl({ userId, agentId, messageId, index }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const mb = await requireMailbox(agent);
	const row = await loadMessage(mb, messageId);
	const att = (row.attachments || [])[Number(index)];
	if (!att) throw new MailError(404, 'attachment_not_found', 'No attachment at that index.');
	if (att.quarantined) throw new MailError(451, 'attachment_quarantined', 'This attachment was flagged by the malware scan and was not stored.');
	if (!att.key) throw new MailError(404, 'attachment_not_stored', att.skipped_reason || 'This attachment was not stored.');
	const safeName = String(att.filename || 'attachment').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
	const cmd = new GetObjectCommand({
		Bucket: env.S3_BUCKET,
		Key: att.key,
		ResponseContentDisposition: `attachment; filename="${safeName}"`,
		ResponseContentType: 'application/octet-stream',
	});
	const url = await getSignedUrl(r2, cmd, { expiresIn: 300 });
	return { url, filename: att.filename, size: att.size, expires_in: 300 };
}
