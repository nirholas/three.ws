// Approve and Deny for the approval inbox (api/_lib/approvals.js), as buttons in
// a paired chat. The owner gets the request where they already talk to their
// agent, reads the full confirmation table, and decides with one tap.
//
// The callback data each button carries is signed, so a press can only ever
// decide the exact request that was rendered, in the chat it was sent to, by
// the person that chat is paired to, before the request expires:
//
//   ar1 <verb> <request id> <expiry> <mac>
//
//   verb     a (approve) or d (deny)
//   id       the request uuid, 16 bytes as base64url (22 chars)
//   expiry   the request's expires_at in unix seconds, base36, 7 chars
//   mac      HMAC-SHA256 under JWT_SECRET over the platform, verb, id, the
//            paired link, the platform user, the request's payload hash and the
//            expiry, truncated to 24 base64url chars (144 bits)
//
// 57 bytes in all, inside Telegram's 64-byte callback_data and Discord's
// 100-char custom_id. The payload hash is not carried, it is bound: the press
// handler recomputes the mac from the row on file, so a request whose payload
// changed after delivery, a button replayed into another chat, a forged id or a
// flipped bit all fail the same check and nothing runs. A verified press then
// goes through decideApproval with the hash that was signed, which re-checks it
// in the conditional UPDATE, and the executor re-hashes the stored payload once
// more before it signs anything. A repeat press is idempotent: the row is
// already decided, so the message is redrawn with its current state.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '../db.js';
import { env } from '../env.js';
import { limits } from '../rate-limit.js';
import {
	ApprovalError,
	DECISION_VIAS,
	VENUES,
	confirmationTable,
	decideApproval,
	effectiveStatus,
	isUuid,
	approvalPath,
} from '../approvals.js';
import { appOrigin } from './format.js';

export const APPROVAL_CALLBACK_PREFIX = 'ar1';
const VERBS = { a: 'approve', d: 'deny' };
const VERB_CODE = { approve: 'a', deny: 'd' };
const EXP_LEN = 7;
const MAC_LEN = 24;
const ID_LEN = 22;
const CALLBACK_RE = new RegExp(`^${APPROVAL_CALLBACK_PREFIX}([ad])([A-Za-z0-9_-]{${ID_LEN}})([0-9a-z]{${EXP_LEN}})([A-Za-z0-9_-]{${MAC_LEN}})$`);

function uuidToB64(id) {
	return Buffer.from(String(id).replace(/-/g, ''), 'hex').toString('base64url');
}

// Only the canonical encoding parses: the 22nd character carries four padding
// bits, and accepting every spelling of them would give one button many names.
function b64ToUuid(s) {
	const bytes = Buffer.from(s, 'base64url');
	if (bytes.length !== 16 || bytes.toString('base64url') !== s) return null;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function expirySeconds(expiresAt) {
	return Math.floor(new Date(expiresAt).getTime() / 1000);
}

function mac({ platform, verb, id, linkId, platformUserId, payloadHash, exp }) {
	const body = ['approval-chat:v1', platform, verb, id, linkId, platformUserId, payloadHash, exp].join('|');
	return createHmac('sha256', env.JWT_SECRET).update(body).digest('base64url').slice(0, MAC_LEN);
}

/**
 * The callback data for one button on one request, bound to the chat link and
 * the platform user it is delivered to.
 * @param {{ verb:'approve'|'deny', row:{id:string, payload_hash:string, expires_at:string|Date}, link:{id:string, platform:string, platform_user_id:string} }} opts
 */
export function signApprovalCallback({ verb, row, link }) {
	const code = VERB_CODE[verb];
	if (!code) throw new Error(`unknown approval verb: ${verb}`);
	if (!isUuid(row.id)) throw new Error('approval id must be a uuid');
	const exp = expirySeconds(row.expires_at);
	const expField = exp.toString(36).padStart(EXP_LEN, '0');
	if (expField.length !== EXP_LEN) throw new Error('approval expiry out of range');
	const m = mac({ platform: link.platform, verb, id: row.id, linkId: link.id, platformUserId: String(link.platform_user_id), payloadHash: row.payload_hash, exp });
	return `${APPROVAL_CALLBACK_PREFIX}${code}${uuidToB64(row.id)}${expField}${m}`;
}

/**
 * Parse callback data into its parts without trusting any of them yet.
 * @returns {{ verb:'approve'|'deny', approvalId:string, exp:number, mac:string } | null}
 */
export function parseApprovalCallback(data) {
	const m = CALLBACK_RE.exec(String(data || ''));
	if (!m) return null;
	const approvalId = b64ToUuid(m[2]);
	if (!approvalId) return null;
	return { verb: VERBS[m[1]], approvalId, exp: parseInt(m[3], 36), mac: m[4] };
}

/**
 * Check a parsed press against the request on file and the chat it came from.
 * @returns {{ ok:true } | { ok:false, reason:'bad_signature'|'expired' }}
 */
export function verifyApprovalCallback(parsed, { row, link, now = Date.now() }) {
	const expected = Buffer.from(mac({
		platform: link.platform,
		verb: parsed.verb,
		id: row.id,
		linkId: link.id,
		platformUserId: String(link.platform_user_id),
		payloadHash: row.payload_hash,
		exp: parsed.exp,
	}), 'utf8');
	const actual = Buffer.from(String(parsed.mac), 'utf8');
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: 'bad_signature' };
	// The signed expiry must be the request's own; a request whose deadline moved
	// after delivery was changed, and fails closed like any other change.
	if (parsed.exp !== expirySeconds(row.expires_at)) return { ok: false, reason: 'bad_signature' };
	if (parsed.exp * 1000 <= now) return { ok: false, reason: 'expired' };
	return { ok: true };
}

/** Both buttons for one request in one chat. */
export function approvalChoices(row, link) {
	return [
		{ id: signApprovalCallback({ verb: 'approve', row, link }), label: 'Approve', style: 'success' },
		{ id: signApprovalCallback({ verb: 'deny', row, link }), label: 'Deny', style: 'danger' },
	];
}

function minutesLeft(expiresAt, now = Date.now()) {
	const ms = new Date(expiresAt).getTime() - now;
	if (ms <= 0) return 'expired';
	const min = Math.ceil(ms / 60_000);
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/**
 * The request as chat text: who asks, what for, the full confirmation table
 * (recipient, amount, asset, chain) with the venue, the risk notes and why it
 * was held, then the deadline and a signed link to review it on the web.
 */
export function approvalChatText(row, { now = Date.now() } = {}) {
	const table = confirmationTable(row);
	const notes = Array.isArray(row.risk_notes) ? row.risk_notes.filter(Boolean) : [];
	const recipient = table.find((r) => r.key === 'recipient');
	const lines = [
		`Approval needed${row.agent_name ? ` from ${row.agent_name}` : ''}`,
		String(row.summary || '').slice(0, 400),
		'',
		...table.map((r) => `${r.label}: ${r.value}`),
		`Venue: ${VENUES[row.venue]?.label || row.venue || 'n/a'}`,
	];
	if (recipient?.full && recipient.full !== recipient.value) lines.push(`Full address: ${recipient.full}`);
	if (row.gate_reason) lines.push(`Held because: ${String(row.gate_reason).slice(0, 200)}`);
	if (notes.length) lines.push('', 'Risk notes:', ...notes.slice(0, 5).map((n) => `- ${String(n).slice(0, 200)}`));
	lines.push(
		'',
		`Payload hash: ${String(row.payload_hash).slice(0, 16)}...`,
		`Expires in ${minutesLeft(row.expires_at, now)}. Nothing runs unless you press Approve.`,
		`Review on the web: ${appOrigin()}${approvalPath(row)}`,
	);
	return lines.join('\n');
}

/** One line for the request's state after a decision, or when it is already settled. */
export function approvalOutcomeLine(request) {
	const status = request.status;
	const sig = request.explorer || request.signature;
	const note = request.result?.note ? ` ${request.result.note}` : '';
	switch (status) {
		case 'executed': return `Approved and executed.${sig ? `\nSignature: ${sig}` : ''}`;
		case 'failed': return `Approved, but it did not execute.${note}`;
		case 'approved':
		case 'executing': return 'Approved. Executing now; you will get the result here.';
		case 'denied': return 'Denied. Nothing was sent.';
		case 'expired': return 'Expired before a decision. Nothing was sent. The agent asks again if the action is still wanted.';
		default: return `Status: ${status}.`;
	}
}

/** One request with its agent's name, by id, whoever owns it. Callers check ownership. */
export async function loadApprovalRequest(id) {
	const [row] = await sql`
		SELECT r.*, a.name AS agent_name
		FROM approval_requests r
		LEFT JOIN agent_identities a ON a.id = r.agent_id
		WHERE r.id = ${id}`;
	return row || null;
}

/**
 * Send one queued request into the paired chat it was queued for, rendered
 * from the row as it stands now. Skipped, with a reason, when the request is no
 * longer pending or belongs to another account than the link.
 * @returns {Promise<{ sent:boolean, reason?:string, ref?:object }>}
 */
export async function sendApprovalToChat({ gw, link, approvalId, chatId = link.chat_id }) {
	if (!isUuid(approvalId)) return { sent: false, reason: 'invalid_id' };
	const row = await loadApprovalRequest(approvalId);
	if (!row) return { sent: false, reason: 'not_found' };
	if (row.user_id !== link.user_id) return { sent: false, reason: 'wrong_account' };
	const status = effectiveStatus(row);
	if (status !== 'pending') return { sent: false, reason: status };
	const text = approvalChatText(row);
	const ref = gw.buttons !== false
		? await gw.sendChoice(String(chatId), text, approvalChoices(row, link))
		: await gw.sendText(String(chatId), `${text}\n\nApprove or deny it at the link above.`);
	return { sent: true, ref };
}

/**
 * Handle one Approve or Deny press from a paired chat.
 *
 * Refused without touching the request: a chat that is not paired, a presser
 * who is not the person it is paired to, a link that belongs to another
 * account, a mac that does not match the request on file (tampered, replayed
 * into another chat, or the payload changed), and an expired button.
 *
 * @param {{ gw:object, event:object, link:object|null }} ctx
 * @returns {Promise<{ ok:boolean, code?:string, request?:object, idempotent?:boolean }>}
 */
export async function handleApprovalPress({ gw, event, link }) {
	const press = event.approvalAction;
	const refuse = async (code, text) => {
		await gw.ackAction(event, text);
		return { ok: false, code };
	};
	if (!link) return refuse('unlinked', 'This chat is not paired to a three.ws account, so these buttons do nothing here.');
	if (String(event.userId) !== String(link.platform_user_id)) {
		return refuse('not_owner', 'Only the account owner paired to this chat can approve or deny.');
	}
	const row = await loadApprovalRequest(press.approvalId);
	if (!row || row.user_id !== link.user_id) return refuse('not_found', 'This request is not on the account this chat is paired to.');

	const verified = verifyApprovalCallback(press, { row, link });
	const ref = event.messageRef || null;
	const settle = async (line) => {
		const text = `${approvalChatText(row)}\n\n${line}`;
		if (gw.canEdit !== false && ref) await gw.editMessage(ref, text, { choices: [] }).catch(() => {});
		else await gw.sendText(event.chatId, line).catch(() => {});
	};
	if (!verified.ok && verified.reason === 'bad_signature') {
		console.warn('[gateway] approval press failed its signature', { approvalId: row.id, linkId: link.id });
		return refuse('bad_signature', 'This button does not match the request on file, so nothing ran. Review it on the web.');
	}

	const status = effectiveStatus(row);
	if (status !== 'pending') {
		await gw.ackAction(event, `Already ${status}.`);
		await settle(approvalOutcomeLine({ ...row, status }));
		return { ok: true, code: 'already_decided', idempotent: true };
	}
	if (!verified.ok) {
		await gw.ackAction(event, 'This request expired.');
		await settle(approvalOutcomeLine({ status: 'expired' }));
		return { ok: false, code: 'expired' };
	}

	const rl = await limits.gatewayMessage(link.id);
	if (!rl.success) return refuse('rate_limited', 'Too many actions. Wait a minute and press again.');

	await gw.ackAction(event, press.verb === 'approve' ? 'Approved. Executing...' : 'Denied');
	try {
		const { request, idempotent } = await decideApproval({
			userId: link.user_id,
			id: row.id,
			decision: press.verb,
			payloadHash: row.payload_hash,
			via: DECISION_VIAS.includes(event.platform) ? event.platform : 'web',
		});
		await settle(approvalOutcomeLine(request));
		return { ok: true, request, idempotent };
	} catch (e) {
		if (e instanceof ApprovalError) {
			await settle(`Not executed: ${e.message}`);
			return { ok: false, code: e.code };
		}
		throw e;
	}
}
