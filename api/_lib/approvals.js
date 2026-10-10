// Approval inbox: the queue every gated agent action waits in for its owner's yes.
//
// A gated action (a spend the owner's policy marked "needs my approval", and
// later anything a team member wants to do above its mandate) becomes one
// approval_requests row holding the EXACT action to run as canonical JSON plus
// its sha256. Every surface (the /approvals page, a push notification's Approve
// button, Telegram, the iOS app, the email fallback) renders the same
// confirmation table from that row: recipient, amount, asset, chain, and the
// risk notes. Approving:
//
//   1. requires the payload hash the owner was shown, so a screen that went
//      stale (or a link someone edited) can never approve a different action, and
//   2. flips pending -> approved in ONE conditional UPDATE that also checks the
//      expiry, so a double tap, a push tap racing a web click, or an approval
//      after the deadline cannot execute twice or late;
//   3. recomputes the hash from the stored payload before the executor runs,
//      so an edited row fails closed instead of executing;
//   4. runs the executor registered for the request's source, which signs
//      through the same spend-policy-gated custody path the action would have
//      used unattended. The executor never widens anything: only the step-up
//      the owner just answered is lifted, every numeric cap still applies.
//
// Deny and expiry are terminal and fail closed. Auto-approve policies are the
// owner's explicit, revocable "don't ask me for this", capped by size and venue;
// with none, every gated action asks. Transfers to an address the wallet has
// never paid are never auto-approved.
//
// Schema: api/_lib/migrations/20261010120000_approval_requests.sql
// Doc:    docs/approvals.md

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from './db.js';
import { env } from './env.js';
import { logAudit } from './audit.js';

export const APPROVAL_STATUSES = Object.freeze(['pending', 'approved', 'executing', 'executed', 'failed', 'denied', 'expired']);
export const DECISIONS = Object.freeze(['approve', 'deny']);
export const DECISION_VIAS = Object.freeze(['web', 'push', 'telegram', 'mobile', 'email']);

// Status groups the inbox filters by.
export const STATUS_GROUPS = Object.freeze({
	pending: ['pending'],
	done: ['approved', 'executing', 'executed', 'failed'],
	denied: ['denied'],
	expired: ['expired'],
});

// Venues an auto-approve policy can name. A venue is where the money goes, so a
// policy for swaps never silently covers transfers.
export const VENUES = Object.freeze({
	jupiter: { label: 'Token swaps (Jupiter)', auto: true },
	wallet_transfer: { label: 'Transfers to addresses this wallet has paid before', auto: true },
});

// Ceiling on a single auto-approve policy. Anything bigger is a decision the
// owner should make each time.
export const AUTO_POLICY_MAX_USD = 1000;

// How long a request stays answerable. Prices move fast, so a swap waits
// minutes; a transfer's amount is fixed in SOL, so it can wait hours.
export const TTL_MS = Object.freeze({ swap: 15 * 60 * 1000, transfer: 6 * 60 * 60 * 1000 });

const TERMINAL = new Set(['executed', 'failed', 'denied', 'expired']);
const APPROVED_FAMILY = new Set(['approved', 'executing', 'executed', 'failed']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApprovalError extends Error {
	constructor(status, code, message, extra = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.extra = extra;
	}
}

export function isUuid(v) {
	return typeof v === 'string' && UUID_RE.test(v);
}

// ── canonical payload + hash ────────────────────────────────────────────────────

/**
 * Deterministic JSON: object keys sorted at every depth, undefined dropped. The
 * payload round-trips through Postgres jsonb (which reorders keys), so the hash
 * has to be order-independent to be recomputable from the stored row.
 */
export function canonicalJson(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
	if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
	const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function payloadHash(payload) {
	return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

// ── signed deep links ───────────────────────────────────────────────────────────
// Every delivery carries /approvals/<id>?t=<token>. The token binds the request
// id, its owner, the payload hash and the request's expiry under JWT_SECRET, so
// the page can prove the action it renders is the one that was sent, and an
// approval arriving through a link is rejected if the row no longer matches it.

function linkSign(body) {
	return createHmac('sha256', env.JWT_SECRET).update(`approval-link:${body}`).digest('base64url');
}

export function signApprovalLink({ id, userId, hash, expiresAt }) {
	const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
	const body = Buffer.from(JSON.stringify({ i: id, u: String(userId), h: hash, e: exp }), 'utf8').toString('base64url');
	return `a1.${body}.${linkSign(body)}`;
}

/** @returns {{ ok: true } | { ok: false, reason: string }} */
export function verifyApprovalLink(token, { id, userId, hash, now = Date.now() }) {
	if (typeof token !== 'string' || !token.startsWith('a1.')) return { ok: false, reason: 'malformed' };
	const parts = token.split('.');
	if (parts.length !== 3 || !parts[1] || !parts[2]) return { ok: false, reason: 'malformed' };
	const expected = Buffer.from(linkSign(parts[1]), 'utf8');
	const actual = Buffer.from(parts[2], 'utf8');
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: 'bad_signature' };
	let claims;
	try {
		claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
	} catch {
		return { ok: false, reason: 'malformed' };
	}
	if (claims.i !== id || claims.u !== String(userId)) return { ok: false, reason: 'wrong_request' };
	if (claims.h !== hash) return { ok: false, reason: 'payload_changed' };
	if (!Number.isFinite(claims.e) || claims.e * 1000 <= now) return { ok: false, reason: 'expired' };
	return { ok: true };
}

export function approvalPath(row) {
	const token = signApprovalLink({ id: row.id, userId: row.user_id, hash: row.payload_hash, expiresAt: row.expires_at });
	return `/approvals/${row.id}?t=${encodeURIComponent(token)}`;
}

// ── rendering: the confirmation table every surface shows ───────────────────────

function shortAddr(a) {
	const s = String(a || '');
	return s.length > 12 ? `${s.slice(0, 4)}...${s.slice(-4)}` : s;
}

function fmtAmount(amount, asset) {
	const n = Number(amount);
	if (!Number.isFinite(n)) return '';
	const digits = n >= 1 ? 4 : 6;
	return `${n.toLocaleString('en-US', { maximumFractionDigits: digits })}${asset ? ` ${asset}` : ''}`;
}

export function chainLabel(chain, network) {
	const c = String(chain || 'solana');
	const name = c.charAt(0).toUpperCase() + c.slice(1);
	return network && network !== 'mainnet' ? `${name} ${network}` : name;
}

/**
 * The CLAUDE.md confirmation table for one request, as ordered rows. Rendered
 * identically by the page, the email and the chat text.
 */
export function confirmationTable(row) {
	const usd = row.amount_usd != null && Number.isFinite(Number(row.amount_usd)) ? ` (~$${Number(row.amount_usd).toFixed(2)})` : '';
	return [
		{ key: 'recipient', label: 'Recipient', value: row.recipient_label ? `${row.recipient_label} (${shortAddr(row.recipient)})` : (row.recipient || 'n/a'), full: row.recipient || null },
		{ key: 'amount', label: 'Amount', value: `${fmtAmount(row.amount, row.asset)}${usd}` },
		{ key: 'asset', label: 'Asset', value: row.asset || 'n/a' },
		{ key: 'chain', label: 'Chain', value: chainLabel(row.chain, row.network) },
	];
}

/** One plain-text block for chat surfaces and the email text part. */
export function confirmationText(row) {
	return confirmationTable(row).map((r) => `${r.label}: ${r.value}`).join('\n');
}

function explorerUrl(signature, network) {
	if (!signature) return null;
	const cluster = network && network !== 'mainnet' ? `?cluster=${encodeURIComponent(network)}` : '';
	return `https://solscan.io/tx/${encodeURIComponent(signature)}${cluster}`;
}

/** Effective status: a pending row past its deadline reads as expired even before the sweep writes it. */
export function effectiveStatus(row, now = Date.now()) {
	if (row.status === 'pending' && new Date(row.expires_at).getTime() <= now) return 'expired';
	return row.status;
}

/** The API shape of one request. */
export function publicApproval(row, { now = Date.now(), withLink = true } = {}) {
	const status = effectiveStatus(row, now);
	return {
		id: row.id,
		status,
		summary: row.summary,
		agent: row.agent_id ? { id: row.agent_id, name: row.agent_name || null } : null,
		team_id: row.team_id || null,
		requester_role: row.requester_role,
		source: row.source,
		action_type: row.action_type,
		venue: row.venue,
		venue_label: VENUES[row.venue]?.label || row.venue,
		confirmation: confirmationTable(row),
		risk_notes: Array.isArray(row.risk_notes) ? row.risk_notes : [],
		gate_reason: row.gate_reason || null,
		amount: row.amount != null ? Number(row.amount) : null,
		amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
		asset: row.asset,
		chain: row.chain,
		network: row.network,
		recipient: row.recipient,
		recipient_label: row.recipient_label || null,
		payload_hash: row.payload_hash,
		expires_at: row.expires_at,
		created_at: row.created_at,
		decided_at: row.decided_at || null,
		decided_via: row.decided_via || null,
		auto_policy_id: row.auto_policy_id || null,
		executed_at: row.executed_at || null,
		signature: row.signature || null,
		explorer: explorerUrl(row.signature, row.network),
		result: row.result || null,
		link: withLink && status === 'pending' ? approvalPath(row) : `/approvals/${row.id}`,
	};
}

// ── executors ───────────────────────────────────────────────────────────────────
// One per source. Lazy imports keep this module free of Solana/web3 weight and
// break the cycle with the engines that create requests.
//
// Contract: executor(row) -> { status: 'ok'|'error'|'paused'|'skipped', signature?, note?, usd? }.
// It receives the stored row and must execute ONLY row.payload.

const EXECUTORS = {
	wallet_intent: async () => (await import('./wallet-intents.js')).executeApprovedIntentAction,
	strategy: async () => (await import('./agent-strategy-runtime.js')).executeApprovedStrategyAction,
};

export function hasExecutor(source) {
	return Object.prototype.hasOwnProperty.call(EXECUTORS, source);
}

// ── auto-approve policies ───────────────────────────────────────────────────────

/**
 * The cheapest live policy that covers this request, or null. Never matches a
 * request that is not auto-approvable (a first transfer to a new address), an
 * unknown USD value, or a venue the policy does not name.
 */
export async function matchAutoPolicy({ userId, agentId = null, teamId = null, venue, amountUsd, autoApprovable = true }) {
	if (!autoApprovable || !VENUES[venue]?.auto) return null;
	// Number(null) is 0, which would slip under every cap: an unpriced action asks.
	if (amountUsd == null || amountUsd === '') return null;
	const usd = Number(amountUsd);
	if (!Number.isFinite(usd) || usd < 0) return null;
	const [row] = await sql`
		SELECT * FROM approval_auto_policies
		WHERE user_id = ${userId}
		  AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > now())
		  AND ${venue} = ANY(venues)
		  AND max_usd >= ${usd}
		  AND (agent_id IS NULL OR agent_id = ${agentId})
		  AND (team_id IS NULL OR team_id = ${teamId})
		ORDER BY max_usd ASC, created_at ASC
		LIMIT 1
	`;
	return row || null;
}

function publicPolicy(row, now = Date.now()) {
	const expired = row.expires_at && new Date(row.expires_at).getTime() <= now;
	return {
		id: row.id,
		label: row.label,
		agent: row.agent_id ? { id: row.agent_id, name: row.agent_name || null } : null,
		team_id: row.team_id || null,
		venues: row.venues,
		max_usd: Number(row.max_usd),
		expires_at: row.expires_at || null,
		revoked_at: row.revoked_at || null,
		created_at: row.created_at,
		active: !row.revoked_at && !expired,
	};
}

export async function listAutoPolicies(userId) {
	const rows = await sql`
		SELECT p.*, a.name AS agent_name
		FROM approval_auto_policies p
		LEFT JOIN agent_identities a ON a.id = p.agent_id
		WHERE p.user_id = ${userId}
		ORDER BY (p.revoked_at IS NULL) DESC, p.created_at DESC
		LIMIT 100
	`;
	return rows.map((r) => publicPolicy(r));
}

export async function createAutoPolicy(userId, input, { req = null } = {}) {
	const venues = [...new Set(Array.isArray(input.venues) ? input.venues : [])];
	if (!venues.length || venues.some((v) => !VENUES[v]?.auto)) {
		throw new ApprovalError(400, 'invalid_venue', `venues must be one or more of: ${Object.keys(VENUES).join(', ')}`);
	}
	const maxUsd = Number(input.max_usd);
	if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > AUTO_POLICY_MAX_USD) {
		throw new ApprovalError(400, 'invalid_max_usd', `max_usd must be above 0 and at most ${AUTO_POLICY_MAX_USD}`);
	}
	const agentId = input.agent_id || null;
	if (agentId) {
		if (!isUuid(agentId)) throw new ApprovalError(400, 'invalid_agent', 'agent_id must be a uuid');
		const [own] = await sql`SELECT id FROM agent_identities WHERE id = ${agentId} AND user_id = ${userId} AND deleted_at IS NULL`;
		if (!own) throw new ApprovalError(404, 'agent_not_found', 'You do not own that agent.');
	}
	const teamId = input.team_id ? String(input.team_id).slice(0, 80) : null;
	let expiresAt = null;
	if (input.expires_at) {
		const t = new Date(input.expires_at);
		if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) throw new ApprovalError(400, 'invalid_expiry', 'expires_at must be a future date');
		expiresAt = t.toISOString();
	}
	const label = String(input.label || '').trim().slice(0, 120)
		|| `Auto-approve ${venues.map((v) => VENUES[v].label.toLowerCase()).join(' and ')} up to $${maxUsd}`;
	const [row] = await sql`
		INSERT INTO approval_auto_policies (user_id, agent_id, team_id, label, venues, max_usd, expires_at)
		VALUES (${userId}, ${agentId}, ${teamId}, ${label}, ${venues}, ${maxUsd}, ${expiresAt})
		RETURNING *
	`;
	logAudit({ userId, action: 'approval_policy_created', resourceId: row.id, meta: { venues, max_usd: maxUsd, agent_id: agentId, team_id: teamId }, req });
	return publicPolicy(row);
}

export async function revokeAutoPolicy(userId, policyId, { req = null } = {}) {
	if (!isUuid(policyId)) throw new ApprovalError(400, 'invalid_id', 'policy id must be a uuid');
	const [row] = await sql`
		UPDATE approval_auto_policies SET revoked_at = now()
		WHERE id = ${policyId} AND user_id = ${userId} AND revoked_at IS NULL
		RETURNING *
	`;
	if (!row) {
		const [existing] = await sql`SELECT * FROM approval_auto_policies WHERE id = ${policyId} AND user_id = ${userId}`;
		if (!existing) throw new ApprovalError(404, 'not_found', 'No such auto-approve policy.');
		return publicPolicy(existing);
	}
	logAudit({ userId, action: 'approval_policy_revoked', resourceId: row.id, meta: { venues: row.venues, max_usd: Number(row.max_usd) }, req });
	return publicPolicy(row);
}

// ── create + deliver ────────────────────────────────────────────────────────────

/**
 * Queue a gated action for its owner. Idempotent on `idempotencyKey`, and at
 * most one pending request per (source, sourceRef): a rule that keeps firing
 * while the owner has not answered waits on the request already in the inbox.
 *
 * Returns { request, created, autoApproved, policy }. When autoApproved is true
 * the row is already `approved` by a policy and the CALLER executes it inline
 * through runApproved, which records the outcome.
 */
export async function createApprovalRequest({
	userId,
	agentId = null,
	teamId = null,
	requesterRole = 'agent',
	source,
	sourceRef = null,
	actionType,
	venue,
	payload,
	summary,
	amount = null,
	amountUsd = null,
	asset = null,
	chain = 'solana',
	network = 'mainnet',
	recipient = null,
	recipientLabel = null,
	riskNotes = [],
	gateReason = null,
	idempotencyKey,
	ttlMs = TTL_MS.transfer,
	autoApprovable = true,
	deliver = true,
}) {
	if (!userId) throw new ApprovalError(400, 'no_owner', 'An approval request needs an owner to ask.');
	if (!hasExecutor(source)) throw new ApprovalError(400, 'unknown_source', `No executor is registered for source "${source}".`);
	if (!VENUES[venue]) throw new ApprovalError(400, 'invalid_venue', `Unknown venue "${venue}".`);
	if (!idempotencyKey) throw new ApprovalError(400, 'no_idempotency_key', 'idempotencyKey is required');

	if (sourceRef) {
		const [open] = await sql`
			SELECT * FROM approval_requests
			WHERE source = ${source} AND source_ref = ${sourceRef} AND user_id = ${userId}
			  AND status = 'pending' AND expires_at > now()
			ORDER BY created_at DESC LIMIT 1
		`;
		if (open) return { request: open, created: false, autoApproved: false, policy: null };
	}

	const hash = payloadHash(payload);
	const policy = await matchAutoPolicy({ userId, agentId, teamId, venue, amountUsd, autoApprovable });
	const expiresAt = new Date(Date.now() + Math.max(60_000, Number(ttlMs) || TTL_MS.transfer)).toISOString();
	const notes = (Array.isArray(riskNotes) ? riskNotes : []).filter(Boolean).slice(0, 12).map((n) => String(n).slice(0, 280));

	const [row] = await sql`
		INSERT INTO approval_requests (
			user_id, agent_id, team_id, requester_role, source, source_ref, action_type, venue,
			payload, payload_hash, summary, amount, amount_usd, asset, chain, network,
			recipient, recipient_label, risk_notes, gate_reason, idempotency_key, status, expires_at,
			decided_at, decided_via, auto_policy_id
		) VALUES (
			${userId}, ${agentId}, ${teamId}, ${String(requesterRole).slice(0, 40)}, ${source}, ${sourceRef}, ${actionType}, ${venue},
			${JSON.stringify(payload)}::jsonb, ${hash}, ${String(summary).slice(0, 400)}, ${amount}, ${amountUsd}, ${asset}, ${chain}, ${network},
			${recipient}, ${recipientLabel ? String(recipientLabel).slice(0, 80) : null}, ${JSON.stringify(notes)}::jsonb,
			${gateReason ? String(gateReason).slice(0, 400) : null}, ${idempotencyKey}, ${policy ? 'approved' : 'pending'}, ${expiresAt},
			${policy ? new Date().toISOString() : null}, ${policy ? 'auto_policy' : null}, ${policy ? policy.id : null}
		)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING *
	`;
	if (!row) {
		const [existing] = await sql`SELECT * FROM approval_requests WHERE idempotency_key = ${idempotencyKey}`;
		return { request: existing, created: false, autoApproved: false, policy: null };
	}

	if (policy) {
		logAudit({ userId, action: 'approval_auto_approved', resourceId: row.id, meta: { policy_id: policy.id, venue, amount_usd: amountUsd, summary: row.summary } });
		return { request: row, created: true, autoApproved: true, policy };
	}

	logAudit({ userId, action: 'approval_requested', resourceId: row.id, meta: { source, action_type: actionType, venue, amount_usd: amountUsd, summary: row.summary } });
	if (deliver) await deliverApproval(row).catch((e) => console.warn('[approvals] delivery failed', e?.message));
	return { request: row, created: true, autoApproved: false, policy: null };
}

/**
 * Fan the request out: bell, web push (with Approve/Deny actions), the iOS app,
 * paired Telegram/Discord chats, all through insertNotification, then email
 * when none of the out-of-app channels reached the owner.
 */
export async function deliverApproval(row) {
	const { insertNotification, emailAllowedForType } = await import('./notify.js');
	const [agent] = row.agent_id ? await sql`SELECT name FROM agent_identities WHERE id = ${row.agent_id}` : [null];
	const link = approvalPath(row);
	const token = new URL(link, 'https://x').searchParams.get('t');
	const out = await insertNotification(row.user_id, 'approval_requested', {
		approval_id: row.id,
		agent_id: row.agent_id,
		agent_name: agent?.name || null,
		summary: row.summary,
		confirmation: confirmationText(row),
		payload_hash: row.payload_hash,
		link_token: token,
		link,
		amount_usd: row.amount_usd != null ? Number(row.amount_usd) : null,
		expires_at: row.expires_at,
	});
	const reached = out?.delivered || {};
	const outOfApp = (reached.push || 0) + (reached.telegram || 0) + (reached.discord || 0);
	if (outOfApp > 0) return { ...reached, email: 0 };
	if (!(await emailAllowedForType(row.user_id, 'approval_requested'))) return { ...reached, email: 0 };
	const [u] = await sql`SELECT email FROM users WHERE id = ${row.user_id}`;
	if (!u?.email) return { ...reached, email: 0 };
	const { sendApprovalRequestEmail } = await import('./email.js');
	const sent = await sendApprovalRequestEmail({
		to: u.email,
		agentName: agent?.name || null,
		summary: row.summary,
		table: confirmationTable(row),
		riskNotes: Array.isArray(row.risk_notes) ? row.risk_notes : [],
		link,
		expiresAt: row.expires_at,
	}).catch((e) => ({ error: e?.message }));
	return { ...reached, email: sent && !sent.skipped && !sent.error ? 1 : 0 };
}

// ── read ────────────────────────────────────────────────────────────────────────

/** Write `expired` onto every pending row past its deadline. Returns how many. */
export async function expireStale(userId = null) {
	const rows = userId
		? await sql`UPDATE approval_requests SET status = 'expired', updated_at = now()
			WHERE user_id = ${userId} AND status = 'pending' AND expires_at <= now() RETURNING id`
		: await sql`UPDATE approval_requests SET status = 'expired', updated_at = now()
			WHERE status = 'pending' AND expires_at <= now() RETURNING id`;
	return rows.length;
}

function encodeCursor(createdAt, id) {
	return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
	if (!cursor) return null;
	try {
		const [iso, id] = Buffer.from(String(cursor), 'base64url').toString('utf8').split('|');
		if (!iso || Number.isNaN(Date.parse(iso)) || !isUuid(id)) return null;
		return { iso, id };
	} catch {
		return null;
	}
}

export async function listApprovals(userId, { group = 'pending', agentId = null, limit = 30, cursor = null } = {}) {
	await expireStale(userId);
	const statuses = group === 'all' ? APPROVAL_STATUSES : STATUS_GROUPS[group];
	if (!statuses) throw new ApprovalError(400, 'invalid_status', `status must be one of: ${[...Object.keys(STATUS_GROUPS), 'all'].join(', ')}`);
	if (agentId && !isUuid(agentId)) throw new ApprovalError(400, 'invalid_agent', 'agent must be a uuid');
	const lim = Math.min(100, Math.max(1, Number(limit) || 30));
	const cur = decodeCursor(cursor);
	const rows = await sql`
		SELECT r.*, a.name AS agent_name
		FROM approval_requests r
		LEFT JOIN agent_identities a ON a.id = r.agent_id
		WHERE r.user_id = ${userId}
		  AND r.status = ANY(${statuses})
		  AND (${agentId}::uuid IS NULL OR r.agent_id = ${agentId}::uuid)
		  AND (${cur ? cur.iso : null}::timestamptz IS NULL OR (r.created_at, r.id) < (${cur ? cur.iso : null}::timestamptz, ${cur ? cur.id : null}::uuid))
		ORDER BY r.created_at DESC, r.id DESC
		LIMIT ${lim + 1}
	`;
	const page = rows.slice(0, lim);
	const last = page[page.length - 1];
	const counts = await sql`
		SELECT status, count(*)::int AS n FROM approval_requests
		WHERE user_id = ${userId} GROUP BY status
	`;
	const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
	const tally = Object.fromEntries(Object.entries(STATUS_GROUPS).map(([g, ss]) => [g, ss.reduce((s, x) => s + (byStatus[x] || 0), 0)]));
	tally.all = Object.values(byStatus).reduce((s, n) => s + n, 0);
	const agents = await sql`
		SELECT DISTINCT r.agent_id AS id, a.name
		FROM approval_requests r JOIN agent_identities a ON a.id = r.agent_id
		WHERE r.user_id = ${userId}
		ORDER BY a.name
		LIMIT 100
	`;
	return {
		items: page.map((r) => publicApproval(r)),
		next_cursor: rows.length > lim && last ? encodeCursor(last.created_at, last.id) : null,
		counts: tally,
		agents: agents.map((a) => ({ id: a.id, name: a.name })),
	};
}

async function loadRow(userId, id) {
	if (!isUuid(id)) throw new ApprovalError(400, 'invalid_id', 'approval id must be a uuid');
	const [row] = await sql`
		SELECT r.*, a.name AS agent_name
		FROM approval_requests r
		LEFT JOIN agent_identities a ON a.id = r.agent_id
		WHERE r.id = ${id} AND r.user_id = ${userId}
	`;
	if (!row) throw new ApprovalError(404, 'not_found', 'No such approval request on your account.');
	return row;
}

export async function getApproval(userId, id, { token = null } = {}) {
	const row = await loadRow(userId, id);
	const out = publicApproval(row);
	if (token) {
		const v = verifyApprovalLink(token, { id: row.id, userId: row.user_id, hash: row.payload_hash });
		out.link_verified = v.ok;
		if (!v.ok) out.link_problem = v.reason;
	}
	return out;
}

// ── decide ──────────────────────────────────────────────────────────────────────

/**
 * Approve or deny one request.
 *
 * Approve requires `payloadHash` (what the owner was shown). A repeat approve of
 * a request that is already approved, executing or done returns its current
 * state with `idempotent: true` and never runs the executor again.
 *
 * @returns {Promise<{ request: object, idempotent: boolean }>}
 */
export async function decideApproval({ userId, id, decision, payloadHash: shownHash = null, token = null, via = 'web', req = null }) {
	if (!DECISIONS.includes(decision)) throw new ApprovalError(400, 'invalid_decision', 'decision must be "approve" or "deny"');
	const channel = DECISION_VIAS.includes(via) ? via : 'web';
	const row = await loadRow(userId, id);

	if (token) {
		const v = verifyApprovalLink(token, { id: row.id, userId: row.user_id, hash: row.payload_hash });
		if (!v.ok && v.reason !== 'expired') {
			throw new ApprovalError(409, 'link_mismatch', 'This approval link does not match the request on file, so nothing was executed. Open /approvals to review it.', { reason: v.reason });
		}
	}

	if (decision === 'deny') return deny(row, { userId, via: channel, req });
	return approve(row, { userId, shownHash, via: channel, req });
}

async function deny(row, { userId, via, req }) {
	const [updated] = await sql`
		UPDATE approval_requests
		SET status = 'denied', decided_by = ${userId}, decided_at = now(), decided_via = ${via}, updated_at = now()
		WHERE id = ${row.id} AND user_id = ${userId} AND status = 'pending'
		RETURNING *
	`;
	if (updated) {
		logAudit({ userId, action: 'approval_denied', resourceId: row.id, meta: { via, summary: row.summary }, req });
		return { request: publicApproval({ ...updated, agent_name: row.agent_name }), idempotent: false };
	}
	const current = await loadRow(userId, row.id);
	if (current.status === 'denied' || current.status === 'expired') return { request: publicApproval(current), idempotent: true };
	throw new ApprovalError(409, 'already_decided', `This request was already ${current.status}; it can no longer be denied.`, { status: current.status });
}

async function approve(row, { userId, shownHash, via, req }) {
	if (typeof shownHash !== 'string' || !/^[0-9a-f]{64}$/.test(shownHash)) {
		throw new ApprovalError(400, 'payload_hash_required', 'Approving needs the payload_hash of the action you were shown.');
	}
	if (shownHash !== row.payload_hash) {
		throw new ApprovalError(409, 'payload_mismatch', 'The action on file differs from the one you approved, so nothing was executed. Reload and review it again.');
	}

	const [claimed] = await sql`
		UPDATE approval_requests
		SET status = 'approved', decided_by = ${userId}, decided_at = now(), decided_via = ${via}, updated_at = now()
		WHERE id = ${row.id} AND user_id = ${userId} AND status = 'pending'
		  AND expires_at > now() AND payload_hash = ${shownHash}
		RETURNING *
	`;
	if (!claimed) {
		const current = await loadRow(userId, row.id);
		if (APPROVED_FAMILY.has(current.status)) return { request: publicApproval(current), idempotent: true };
		if (current.status === 'denied') throw new ApprovalError(409, 'already_denied', 'This request was denied; it can no longer be approved.');
		if (current.status === 'pending' || current.status === 'expired') {
			await sql`UPDATE approval_requests SET status = 'expired', updated_at = now() WHERE id = ${row.id} AND status = 'pending'`;
			throw new ApprovalError(410, 'expired', 'This request expired before it was approved, so nothing was executed. The agent will ask again if the action is still wanted.');
		}
		throw new ApprovalError(409, 'not_pending', `This request is ${current.status}.`);
	}

	logAudit({ userId, action: 'approval_approved', resourceId: row.id, meta: { via, summary: row.summary, payload_hash: shownHash }, req });
	const done = await executeApproved({ ...claimed, agent_name: row.agent_name }, { userId, req });
	return { request: done, idempotent: false };
}

/**
 * Run an approved row exactly once through `run(claimedRow)`. The approved ->
 * executing step is a conditional UPDATE, so a second caller finds nothing to
 * claim and gets `outcome: null`. The payload is re-hashed first: a row whose
 * payload no longer matches its hash never runs.
 *
 * Engines that hold an auto-approved request call this with their own inline
 * runner; the inbox calls it (via executeApproved) with the source's executor.
 *
 * @returns {Promise<{ request: object, outcome: object|null }>}
 */
export async function runApproved(row, run, { userId = row.user_id, req = null } = {}) {
	const [claim] = await sql`
		UPDATE approval_requests SET status = 'executing', updated_at = now()
		WHERE id = ${row.id} AND status = 'approved'
		RETURNING *
	`;
	if (!claim) return { request: publicApproval(await loadRow(row.user_id, row.id)), outcome: null };

	let outcome;
	if (payloadHash(claim.payload) !== claim.payload_hash) {
		outcome = { status: 'error', note: 'The stored action no longer matches what was approved. Nothing was executed.', integrity: false };
	} else {
		try {
			outcome = await run(claim);
		} catch (e) {
			outcome = { status: 'error', note: (e?.message || 'execution failed').slice(0, 240) };
		}
	}
	const request = await recordApprovalOutcome(claim.id, outcome, { userId, req });
	return { request, outcome };
}

/** Run an approved row through its source's registered executor, once. */
export async function executeApproved(row, opts = {}) {
	const { request } = await runApproved(row, async (claim) => (await EXECUTORS[claim.source]())(claim), opts);
	return request;
}

/** Finalize a request with its executor's outcome. Returns the public shape. */
export async function recordApprovalOutcome(id, outcome, { userId = null, req = null } = {}) {
	const ok = outcome?.status === 'ok';
	const status = ok ? 'executed' : 'failed';
	const result = {
		status: outcome?.status || 'error',
		note: outcome?.note ? String(outcome.note).slice(0, 280) : null,
		usd: Number.isFinite(Number(outcome?.usd)) ? Number(outcome.usd) : null,
		...(outcome?.integrity === false ? { integrity: false } : {}),
	};
	const [row] = await sql`
		UPDATE approval_requests
		SET status = ${status}, executed_at = ${ok ? new Date().toISOString() : null},
		    signature = ${outcome?.signature || null}, result = ${JSON.stringify(result)}::jsonb, updated_at = now()
		WHERE id = ${id}
		RETURNING *
	`;
	if (!row) return null;
	logAudit({ userId: userId || row.user_id, action: ok ? 'approval_executed' : 'approval_failed', resourceId: id, meta: { signature: row.signature, note: result.note, via: row.decided_via }, req });
	const [named] = await sql`SELECT name FROM agent_identities WHERE id = ${row.agent_id}`;
	return publicApproval({ ...row, agent_name: named?.name || null });
}

/** Deny many pending requests at once. Returns the ids that were denied. */
export async function bulkDeny(userId, ids, { via = 'web', req = null } = {}) {
	const list = [...new Set((Array.isArray(ids) ? ids : []).filter(isUuid))].slice(0, 200);
	if (!list.length) throw new ApprovalError(400, 'no_ids', 'Pass one or more approval ids to deny.');
	const channel = DECISION_VIAS.includes(via) ? via : 'web';
	const rows = await sql`
		UPDATE approval_requests
		SET status = 'denied', decided_by = ${userId}, decided_at = now(), decided_via = ${channel}, updated_at = now()
		WHERE user_id = ${userId} AND id = ANY(${list}) AND status = 'pending'
		RETURNING id, summary
	`;
	for (const r of rows) logAudit({ userId, action: 'approval_denied', resourceId: r.id, meta: { via: channel, bulk: true, summary: r.summary }, req });
	return { denied: rows.map((r) => r.id), skipped: list.filter((id) => !rows.some((r) => r.id === id)) };
}

export { TERMINAL as TERMINAL_STATUSES };
