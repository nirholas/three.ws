// Owner send controls for an agent's mailbox: a recipient allowlist and a
// daily send cap (table agent_mail_policies, migration
// 20261010184500_agent_mail_controls.sql).
//
// Both are enforced by the mail service on the quote AND again on the confirmed
// send, so an allowlist tightened between the two still holds. The cap sits on
// top of the platform's warm-up limits: whichever is lower wins.
//
// Allowlist entries are either a full address (ava@example.com) or a whole
// domain written as @example.com. A bare domain (example.com) is accepted on
// input and stored as @example.com.

import { sql } from '../db.js';
import { isValidAddress } from './threading.js';

export const MAX_ALLOWLIST_ENTRIES = 200;
export const MAX_DAILY_SEND_CAP = 10000;

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export class PolicyInputError extends Error {
	constructor(message, details = null) {
		super(message);
		this.code = 'invalid_policy';
		this.details = details;
	}
}

/** Normalize one allowlist entry, or return null when it is not one. */
export function normalizeAllowEntry(raw) {
	const s = String(raw ?? '').trim().toLowerCase();
	if (!s) return null;
	if (s.includes('@') && !s.startsWith('@')) return isValidAddress(s) ? s : null;
	const domain = s.replace(/^@/, '');
	return DOMAIN_RE.test(domain) ? `@${domain}` : null;
}

/** Normalize a whole allowlist; throws PolicyInputError naming every bad entry. */
export function normalizeAllowlist(list) {
	const items = Array.isArray(list) ? list : String(list ?? '').split(/[\s,;]+/);
	const out = [];
	const bad = [];
	for (const raw of items) {
		if (String(raw ?? '').trim() === '') continue;
		const n = normalizeAllowEntry(raw);
		if (!n) bad.push(String(raw).trim());
		else if (!out.includes(n)) out.push(n);
	}
	if (bad.length) {
		throw new PolicyInputError(`Not an address or @domain: ${bad.slice(0, 5).join(', ')}.`, { invalid: bad });
	}
	if (out.length > MAX_ALLOWLIST_ENTRIES) {
		throw new PolicyInputError(`An allowlist holds at most ${MAX_ALLOWLIST_ENTRIES} entries.`);
	}
	return out;
}

/** True when `address` is covered by the allowlist (exact address or its domain). */
export function allowlistAllows(allowlist, address) {
	const a = String(address || '').trim().toLowerCase();
	const at = a.lastIndexOf('@');
	if (at < 1) return false;
	const domain = a.slice(at);
	return (allowlist || []).some((entry) => entry === a || entry === domain);
}

/** Recipients the policy refuses; empty when the send is allowed. */
export function blockedRecipients(policy, recipients) {
	if (!policy?.allowlist_enabled) return [];
	return recipients.filter((r) => !allowlistAllows(policy.allowlist, r));
}

export function policyView(row) {
	return {
		allowlist_enabled: Boolean(row?.allowlist_enabled),
		allowlist: row?.allowlist || [],
		daily_send_cap: row?.daily_send_cap ?? null,
		updated_at: row?.updated_at || null,
	};
}

export async function loadPolicy(agentId) {
	const [row] = await sql`select * from agent_mail_policies where agent_id = ${agentId} limit 1`;
	return policyView(row);
}

function parseCap(v) {
	if (v === null || v === '' || v === undefined) return null;
	const n = Number(v);
	if (!Number.isInteger(n) || n < 0 || n > MAX_DAILY_SEND_CAP) {
		throw new PolicyInputError(`daily_send_cap must be a whole number from 0 to ${MAX_DAILY_SEND_CAP}, or null for no cap.`);
	}
	return n;
}

/**
 * Upsert the policy. Fields left undefined keep their stored value, so a
 * caller can flip the allowlist on without resending it.
 */
export async function savePolicy({ agentId, userId, patch }) {
	const current = await loadPolicy(agentId);
	const next = {
		allowlist_enabled: patch.allowlist_enabled === undefined ? current.allowlist_enabled : Boolean(patch.allowlist_enabled),
		allowlist: patch.allowlist === undefined ? current.allowlist : normalizeAllowlist(patch.allowlist),
		daily_send_cap: patch.daily_send_cap === undefined ? current.daily_send_cap : parseCap(patch.daily_send_cap),
	};
	if (next.allowlist_enabled && !next.allowlist.length) {
		throw new PolicyInputError('Add at least one address or @domain before turning the allowlist on, or every send would be refused.');
	}
	const [row] = await sql`
		insert into agent_mail_policies (agent_id, user_id, allowlist_enabled, allowlist, daily_send_cap, updated_at)
		values (${agentId}, ${userId}, ${next.allowlist_enabled}, ${next.allowlist}, ${next.daily_send_cap}, now())
		on conflict (agent_id) do update set
			allowlist_enabled = excluded.allowlist_enabled,
			allowlist = excluded.allowlist,
			daily_send_cap = excluded.daily_send_cap,
			updated_at = now()
		returning *
	`;
	return policyView(row);
}
