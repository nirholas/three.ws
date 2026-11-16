// Adaptive Cards for approval requests in Microsoft Teams (Universal Actions).
//
// One card per request, rendered from the approval_requests row as it stands,
// so every state reads the same in Teams as in the /approvals inbox:
//
//   pending    the full confirmation table (the same rows the inbox, email and
//              chat text show), venue, gate reason, risk notes, the payload
//              fingerprint and the deadline, with Approve and Deny as
//              Action.Execute and a signed "Review on the web" link
//   approved / executing / executed / failed / denied / expired
//              the same facts with an outcome banner naming who decided, from
//              where and when, and for an executed request the result link
//   read-only  the facts with no buttons and a message saying why (a viewer
//              who is not the account owner, an unlinked Teams account)
//
// Every card carries `refresh` with an Action.Execute scoped to the owner's
// Teams MRI in `userIds`, so Teams asks the bot for the current state each time
// the owner opens the chat: a request approved from a phone push reads as
// approved in Teams too. Schema 1.5, the version Teams documents for Universal
// Actions; hosts below 1.4 get the signed web link as the fallback for both
// buttons, never an Action.Submit that would bypass the invoke checks.
// https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/universal-actions-for-adaptive-cards/overview

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';
import { VENUES, approvalPath, confirmationTable, effectiveStatus, isUuid } from './approvals.js';
import { CARD_CONTENT_TYPE, FORGE_CARD_VERSION, REFRESH_USER_LIMIT, escapeMarkdown } from './teams-forge-cards.js';

export const VERB_APPROVE = 'approval.approve';
export const VERB_DENY = 'approval.deny';
export const VERB_APPROVAL_REFRESH = 'approval.refresh';
export const APPROVAL_VERBS = Object.freeze([VERB_APPROVE, VERB_DENY, VERB_APPROVAL_REFRESH]);
export const TEST_ACTION_TYPE = 'approval_test';

const SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';
const MAC_LEN = 32;
const DECISION_OF = { [VERB_APPROVE]: 'approve', [VERB_DENY]: 'deny' };

const VIA_LABEL = {
	web: 'the web inbox',
	push: 'a push notification',
	telegram: 'Telegram',
	discord: 'Discord',
	mobile: 'the iOS app',
	email: 'email',
	teams: 'Teams',
};

/** 'approve' | 'deny' for a decision verb, null for refresh or anything else. */
export function decisionOf(verb) {
	return DECISION_OF[verb] || null;
}

function expirySeconds(expiresAt) {
	return Math.floor(new Date(expiresAt).getTime() / 1000);
}

function mac({ verb, id, tenantId, aadObjectId, payloadHash, exp }) {
	const body = ['approval-teams:v1', verb, id, tenantId, aadObjectId, payloadHash, exp].join('|');
	return createHmac('sha256', env.JWT_SECRET).update(body).digest('base64url').slice(0, MAC_LEN);
}

/**
 * The data an Approve or Deny button carries, bound to the request's payload
 * hash and deadline and to the one Teams person the card was sent to. The hash
 * is not carried, it is bound: the handler recomputes the mac from the row on
 * file, so a changed payload, a card forwarded to someone else, an edited id or
 * a flipped bit all fail the same check.
 */
export function signTeamsAction({ verb, row, identity }) {
	if (!decisionOf(verb)) throw new Error(`unknown approval verb: ${verb}`);
	if (!isUuid(row.id)) throw new Error('approval id must be a uuid');
	const exp = expirySeconds(row.expires_at);
	return {
		approval_id: row.id,
		exp,
		mac: mac({ verb, id: row.id, tenantId: identity.tenantId, aadObjectId: identity.aadObjectId, payloadHash: row.payload_hash, exp }),
	};
}

/**
 * Check a pressed button's data against the request on file and the person
 * who pressed it.
 * @returns {{ ok:true } | { ok:false, reason:'bad_signature'|'expired' }}
 */
export function verifyTeamsAction({ verb, data, row, identity, now = Date.now() }) {
	const exp = Number(data?.exp);
	if (!Number.isInteger(exp) || typeof data?.mac !== 'string') return { ok: false, reason: 'bad_signature' };
	const expected = Buffer.from(mac({ verb, id: row.id, tenantId: identity.tenantId, aadObjectId: identity.aadObjectId, payloadHash: row.payload_hash, exp }), 'utf8');
	const actual = Buffer.from(data.mac, 'utf8');
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: 'bad_signature' };
	// The signed deadline must be the request's own: one that moved after the
	// card was sent means the row changed, and that fails closed.
	if (exp !== expirySeconds(row.expires_at)) return { ok: false, reason: 'bad_signature' };
	if (exp * 1000 <= now) return { ok: false, reason: 'expired' };
	return { ok: true };
}

function text(value, extra = {}) {
	return { type: 'TextBlock', text: String(value), wrap: true, ...extra };
}

// RFC 3339 without milliseconds, the form the card TIME() and DATE() functions
// accept, so each viewer reads the time in their own zone.
function cardTime(value) {
	return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function when(value) {
	const t = cardTime(value);
	return `{{DATE(${t}, SHORT)}} {{TIME(${t})}}`;
}

function minutesLeft(expiresAt, now) {
	const ms = new Date(expiresAt).getTime() - now;
	if (ms <= 0) return null;
	const min = Math.ceil(ms / 60_000);
	if (min < 60) return `${min} min`;
	const h = Math.floor(min / 60);
	return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

function viaLabel(via) {
	return VIA_LABEL[via] || 'three.ws';
}

function decider(row) {
	return row.decider_name ? escapeMarkdown(row.decider_name) : 'the account owner';
}

/**
 * The outcome banner for a request that is no longer pending, or null.
 * `{ style, text }`, style being a Container style (good, attention, warning).
 */
export function outcomeBanner(row, { now = Date.now() } = {}) {
	const status = effectiveStatus(row, now);
	const by = decider(row);
	const at = row.decided_at ? ` at ${when(row.decided_at)}` : '';
	const from = row.decided_via ? ` from ${viaLabel(row.decided_via)}` : '';
	const note = row.result?.note ? ` ${escapeMarkdown(String(row.result.note).slice(0, 240))}` : '';
	const isTest = row.action_type === TEST_ACTION_TYPE;
	switch (status) {
		case 'approved':
		case 'executing':
			return { style: 'good', text: `Approved by ${by}${from}${at}. Executing now; this card updates when it finishes.` };
		case 'executed':
			return {
				style: 'good',
				text: isTest
					? `Approved by ${by}${from}${at}. This was a test, so nothing ran.`
					: `Approved by ${by}${from}${at}, and executed${row.executed_at ? ` at ${when(row.executed_at)}` : ''}.`,
			};
		case 'failed':
			return { style: 'attention', text: `Approved by ${by}${from}${at}, but it did not execute.${note}` };
		case 'denied':
			return { style: 'warning', text: `Denied by ${by}${from}${at}. Nothing ran.` };
		case 'expired':
			return { style: 'warning', text: 'Expired before a decision. Nothing ran. The agent asks again if the action is still wanted.' };
		default:
			return null;
	}
}

function explorerUrl(row) {
	if (!row.signature) return null;
	const cluster = row.network && row.network !== 'mainnet' ? `?cluster=${encodeURIComponent(row.network)}` : '';
	return `https://solscan.io/tx/${encodeURIComponent(row.signature)}${cluster}`;
}

function factsOf(row) {
	const table = confirmationTable(row);
	const facts = table.map((r) => ({ title: r.label, value: escapeMarkdown(r.full && r.full !== r.value ? `${r.value}\n${r.full}` : r.value) }));
	facts.push({ title: 'Venue', value: escapeMarkdown(VENUES[row.venue]?.label || row.venue || 'n/a') });
	if (row.gate_reason) facts.push({ title: 'Held because', value: escapeMarkdown(String(row.gate_reason).slice(0, 200)) });
	return facts;
}

function header(row) {
	const isTest = row.action_type === TEST_ACTION_TYPE;
	const agent = row.agent_name ? `from ${escapeMarkdown(row.agent_name)}` : '';
	return [
		text('three.ws', { size: 'small', weight: 'bolder', color: 'accent', spacing: 'none' }),
		text(isTest ? 'Test approval (nothing runs)' : `Approval needed${agent ? ` ${agent}` : ''}`, { size: 'large', weight: 'bolder', spacing: 'small' }),
		text(escapeMarkdown(String(row.summary || '').slice(0, 400)), { spacing: 'small' }),
	];
}

function riskBlock(row) {
	const notes = Array.isArray(row.risk_notes) ? row.risk_notes.filter(Boolean).slice(0, 5) : [];
	if (!notes.length) return [];
	return [{
		type: 'Container',
		style: 'warning',
		spacing: 'medium',
		items: [
			text('Risk notes', { weight: 'bolder', size: 'small' }),
			...notes.map((n) => text(`- ${escapeMarkdown(String(n).slice(0, 200))}`, { spacing: 'none', size: 'small' })),
		],
	}];
}

function footer(row, { now, status }) {
	const lines = [`Payload fingerprint: ${String(row.payload_hash).slice(0, 16)}`];
	if (status === 'pending') {
		const left = minutesLeft(row.expires_at, now);
		lines.push(`Expires ${when(row.expires_at)}${left ? ` (in ${left})` : ''}. Nothing runs unless you press Approve.`);
	}
	return lines.map((l, i) => text(l, { size: 'small', isSubtle: true, spacing: i ? 'none' : 'medium' }));
}

function refreshFor(row, teamsUserId) {
	const userIds = teamsUserId ? [String(teamsUserId)].slice(0, REFRESH_USER_LIMIT) : [];
	return {
		action: { type: 'Action.Execute', title: 'Refresh', verb: VERB_APPROVAL_REFRESH, data: { approval_id: row.id } },
		userIds,
	};
}

/**
 * The card for one request as one Teams person should see it.
 *
 * @param {object} row          approval_requests row (+ agent_name, decider_name)
 * @param {object} opts
 * @param {string} opts.origin  absolute site origin the links point at
 * @param {{tenantId:string, aadObjectId:string}|null} opts.identity
 *        the Teams person viewing; with `canDecide` the buttons are signed for them
 * @param {boolean} opts.canDecide  true only for the account owner
 * @param {string|null} opts.teamsUserId  owner's MRI for refresh.userIds
 * @param {string|null} opts.notice  a message shown above the actions (read-only reason, an error)
 */
export function approvalCard(row, { origin, identity = null, canDecide = false, teamsUserId = null, notice = null, now = Date.now() } = {}) {
	const status = effectiveStatus(row, now);
	const reviewUrl = `${origin}${status === 'pending' ? approvalPath(row) : `/approvals/${row.id}`}`;
	const body = [
		...header(row),
		{ type: 'FactSet', spacing: 'medium', facts: factsOf(row) },
		...riskBlock(row),
		...footer(row, { now, status }),
	];
	const banner = outcomeBanner(row, { now });
	if (banner) body.push({ type: 'Container', style: banner.style, spacing: 'medium', items: [text(banner.text, { weight: 'bolder' })] });
	if (notice) body.push({ type: 'Container', style: 'emphasis', spacing: 'medium', items: [text(escapeMarkdown(notice))] });

	const actions = [];
	if (status === 'pending' && canDecide && identity) {
		const fallback = { type: 'Action.OpenUrl', title: 'Review on the web', url: reviewUrl };
		actions.push(
			{ type: 'Action.Execute', title: 'Approve', verb: VERB_APPROVE, style: 'positive', data: signTeamsAction({ verb: VERB_APPROVE, row, identity }), fallback },
			{ type: 'Action.Execute', title: 'Deny', verb: VERB_DENY, style: 'destructive', data: signTeamsAction({ verb: VERB_DENY, row, identity }), fallback },
		);
	}
	const explorer = status === 'executed' ? explorerUrl(row) : null;
	if (explorer) actions.push({ type: 'Action.OpenUrl', title: 'View transaction', url: explorer });
	actions.push({ type: 'Action.OpenUrl', title: status === 'pending' ? 'Review on the web' : 'Open in inbox', url: reviewUrl });

	return {
		type: 'AdaptiveCard',
		$schema: SCHEMA,
		version: FORGE_CARD_VERSION,
		refresh: refreshFor(row, teamsUserId),
		body,
		actions,
	};
}

/** A card as a message attachment. */
export function approvalAttachment(card) {
	return { contentType: CARD_CONTENT_TYPE, content: card };
}
