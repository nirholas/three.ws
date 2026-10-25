// Agent inbox: one-time codes and magic links, behind the owner's sender list.
//
// An agent signing up to a service waits here for the verification email. Three
// gates stand between a received message and an extracted code:
//   1. The sender must be on the agent's `code_senders` list (agent_mail_policies,
//      changed only from an owner session). An empty list extracts nothing.
//   2. The message must be authentic: delivered locally by the platform, or
//      DMARC pass (which requires SPF or DKIM to align with the From domain; SPF
//      and DKIM passing for some other domain proves nothing). A forged From on an allowlisted
//      domain is reported as skipped, with no content.
//   3. It must not be filed as spam.
// What comes out is only the matched code or link (see ./extract.js). The body
// is never returned from here, never interpreted, and a link is never fetched.

import { sql } from '../db.js';
import { MailError, loadOwnedAgent, activeMailbox } from './service.js';
import { allowlistAllows, normalizeAllowEntry } from './controls.js';
import { extractCodes, parseSender } from './extract.js';

export const DEFAULT_LOOKBACK_SEC = 120;
export const DEFAULT_WAIT_SEC = 30;
export const MAX_WAIT_SEC = 90;
const POLL_MS = 2000;
const SPAM_THRESHOLD = 6;

/** 'ok' | 'sender_not_allowed' | 'sender_not_authenticated' | 'spam' for one stored message row. */
export function senderTrust(row, codeSenders) {
	if (Number(row.spam_score ?? 0) >= SPAM_THRESHOLD) return 'spam';
	const { address } = parseSender(row.from_address);
	if (!allowlistAllows(codeSenders, address)) return 'sender_not_allowed';
	if (row.provider === 'local') return 'ok';
	const a = row.auth_results || {};
	// DMARC pass is the only verdict tied to the From address the allowlist
	// matched. SPF and DKIM can both pass for an attacker's own domain while the
	// visible From is forged, so they never count on their own.
	if (a.dmarc === 'pass') return 'ok';
	return 'sender_not_authenticated';
}

/**
 * Extract from one stored message row. Returns { eligible: false, reason } when
 * a gate refuses it, otherwise the extraction plus message metadata.
 */
export function extractFromRow(row, codeSenders) {
	const trust = senderTrust(row, codeSenders);
	if (trust !== 'ok') return { eligible: false, reason: trust, message_id: row.id };
	const found = extractCodes({ from: row.from_address, subject: row.subject, text: row.text_body });
	return {
		eligible: true,
		message_id: row.id,
		received_at: row.created_at,
		sender: found.sender,
		codes: found.codes,
		links: found.links,
		best_code: found.best_code,
		best_link: found.best_link,
	};
}

/** Pick the newest eligible message that yields what `kind` asks for. */
export function pickResult(rows, codeSenders, { kind = 'any', from = null } = {}) {
	const want = from ? normalizeAllowEntry(from) : null;
	if (from && !want) throw new MailError(400, 'invalid_from', 'from must be an address like noreply@example.com or a domain like @example.com.');
	const skipped = {};
	for (const row of rows) {
		if (want && !allowlistAllows([want], parseSender(row.from_address).address)) continue;
		const r = extractFromRow(row, codeSenders);
		if (!r.eligible) {
			skipped[r.reason] = (skipped[r.reason] || 0) + 1;
			continue;
		}
		const code = kind === 'link' ? null : r.best_code;
		const link = kind === 'code' ? null : r.best_link;
		if (code || link) return { found: true, result: { ...r, best_code: code, best_link: link }, skipped };
	}
	return { found: false, skipped };
}

async function loadCodeSenders(agentId) {
	const [row] = await sql`select code_senders from agent_mail_policies where agent_id = ${agentId} limit 1`;
	return row?.code_senders || [];
}

async function resolveBox({ userId, agentId }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const mb = await activeMailbox(agent.id);
	if (!mb) throw new MailError(404, 'no_mailbox', 'This agent has no mailbox yet. Create one with agent_mail_quote and agent_mail_create.');
	return { agent, mb, codeSenders: await loadCodeSenders(agent.id) };
}

function requireSenders(codeSenders) {
	if (!codeSenders.length) {
		throw new MailError(
			403,
			'code_senders_empty',
			'This agent may not extract codes from any sender yet. The owner adds the services it signs up to (an address like noreply@example.com or a domain like @example.com) under Code senders in the inbox settings, or with PUT /api/v1/agents/:id/mail/policy { code_senders }.',
		);
	}
}

async function recentInbound(mailboxId, sinceIso, limit = 25) {
	return sql`
		select id, from_address, subject, text_body, provider, spam_score, auth_results, created_at
		from agent_mail_messages
		where mailbox_id = ${mailboxId} and direction = 'in' and deleted_at is null
		  and created_at >= ${sinceIso}::timestamptz
		order by created_at desc, id desc
		limit ${limit}
	`;
}

/**
 * Long-poll the inbox for a verification code or magic link.
 * @returns {Promise<{ found: boolean, result?: object, skipped: object, waited_s: number, code_senders: string[] }>}
 */
export async function waitForCode(
	{ userId, agentId, from = null, kind = 'any', sinceSec = DEFAULT_LOOKBACK_SEC, timeoutSec = DEFAULT_WAIT_SEC },
	deps = {},
) {
	const now = deps.now || (() => Date.now());
	const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
	const fetchRows = deps.fetchRows || recentInbound;
	const { mb, codeSenders } = await resolveBox({ userId, agentId });
	requireSenders(codeSenders);

	const lookback = Math.min(Math.max(Number(sinceSec) || DEFAULT_LOOKBACK_SEC, 0), 3600);
	const wait = Math.min(Math.max(Number(timeoutSec) || 0, 0), MAX_WAIT_SEC);
	const sinceIso = new Date(now() - lookback * 1000).toISOString();
	const started = now();
	for (;;) {
		const picked = pickResult(await fetchRows(mb.id, sinceIso), codeSenders, { kind, from });
		const waited_s = Math.round((now() - started) / 100) / 10;
		if (picked.found) return { ...picked, waited_s, code_senders: codeSenders };
		if (now() - started + POLL_MS > wait * 1000) return { ...picked, waited_s, code_senders: codeSenders };
		await sleep(POLL_MS);
	}
}

/** Extraction for one stored message, for inbox_read. */
export async function extractForMessage({ userId, agentId, messageId }) {
	const { mb, codeSenders } = await resolveBox({ userId, agentId });
	const [row] = await sql`
		select id, from_address, subject, text_body, provider, spam_score, auth_results, direction, created_at
		from agent_mail_messages
		where id = ${messageId} and mailbox_id = ${mb.id} and deleted_at is null limit 1
	`;
	if (!row || row.direction !== 'in') return null;
	return extractFromRow(row, codeSenders);
}

/** Whether each sender address may be extracted from, for inbox_list. */
export async function codeSenderFlags({ userId, agentId, addresses }) {
	const { codeSenders } = await resolveBox({ userId, agentId });
	return { codeSenders, flags: addresses.map((a) => allowlistAllows(codeSenders, parseSender(a).address)) };
}
