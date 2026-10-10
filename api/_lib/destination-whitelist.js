// The destination whitelist: which addresses an agent wallet may send funds to.
//
// Why it exists. A stolen session or a prompt-injected agent used to be able to
// add an attacker address and drain a wallet in one minute. This module closes
// that with four rules, enforced here and nowhere else:
//
//   1. A new address is never usable at once. It serves a cooldown (default 24
//      hours, owner-configurable, never below MIN_COOLDOWN_SECONDS) and the owner
//      is notified the moment it is added, on every channel they have connected,
//      with a one-click cancel link.
//   2. Adding, approving or editing needs step-up: the owner re-authenticates
//      (password, wallet signature or an emailed code) and receives a one-time
//      grant bound to their session and to the exact operation. Only a browser
//      session can obtain one. An API key, OAuth token or agent cannot.
//   3. An agent can PROPOSE an address, never activate one. A proposal is inert
//      until the owner approves it with step-up, and then it still serves the
//      cooldown.
//   4. Anything that makes the wallet safer is instant and needs no step-up:
//      removing an address, cancelling a pending one, lengthening the cooldown.
//      Anything that loosens protection (a shorter cooldown, enforcement off) is
//      itself parked for one full current cooldown before it takes effect.
//
// Addresses are compared by a canonical key (see normalizeDestination), never by
// the string a caller typed, so casing tricks, padding, zero-width characters
// and Unicode lookalikes can neither match a listed address nor smuggle in a
// second spelling of one.
//
// The guards (api/_lib/agent-trade-guards.js, api/_lib/evm-leg/guards.js) call
// evaluateDestination() for every outbound category. Doc: docs/destination-whitelist.md.

import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import bs58 from 'bs58';
import { getAddress, isAddress } from 'viem';

import { sql } from './db.js';
import { env } from './env.js';
import { logAudit } from './audit.js';

export const MIN_COOLDOWN_SECONDS = 3600;
export const DEFAULT_COOLDOWN_SECONDS = 24 * 3600;
export const MAX_COOLDOWN_SECONDS = 30 * 24 * 3600;
export const MAX_ENTRIES = 50;
export const MAX_LABEL_LENGTH = 60;
export const STEP_UP_TTL_MS = 5 * 60 * 1000;
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const STEP_UP_METHODS = Object.freeze(['password', 'wallet', 'email_code']);

/**
 * Categories that are not a send to a third party. A swap or snipe lands in the
 * agent's own wallet, and an x402 payment goes to whatever service the agent was
 * asked to call, which is not a destination an owner can list in advance (it is
 * bounded by the spend caps and the per-service policy instead). Everything else
 * that moves funds out (withdraw, transfer, tip, bridge, order and invoice
 * payouts, card withdrawals, signals, intents) is checked.
 */
export const EXEMPT_CATEGORIES = Object.freeze(new Set(['trade', 'snipe', 'x402']));

export class WhitelistError extends Error {
	constructor(status, code, message, extra = {}) {
		super(message);
		this.name = 'WhitelistError';
		this.status = status;
		this.code = code;
		this.extra = extra;
	}
}

// ── address normalisation ──────────────────────────────────────────────────────

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Parse an address into its canonical form.
 *
 * Only printable ASCII is accepted, after trimming surrounding whitespace, so a
 * zero-width space, a Cyrillic "а", a full-width digit or an embedded newline is
 * rejected outright instead of being quietly stripped into a different string.
 * Solana addresses are case-sensitive base58 that must decode to 32 bytes: a
 * differently cased string is a different address and never matches. EVM
 * addresses compare case-insensitively, and a mixed-case spelling must carry a
 * valid EIP-55 checksum, so a mistyped checksum is refused rather than guessed.
 *
 * @returns {{ chain: 'solana'|'evm', address: string, key: string } | null}
 */
export function normalizeDestination(input) {
	if (typeof input !== 'string') return null;
	const s = input.trim();
	if (!s || s.length > 64 || !PRINTABLE_ASCII.test(s)) return null;

	if (s.startsWith('0x')) {
		if (!EVM_ADDRESS.test(s)) return null;
		const hex = s.slice(2);
		const mixed = /[a-f]/.test(hex) && /[A-F]/.test(hex);
		if (mixed && !isAddress(s, { strict: true })) return null;
		const address = getAddress(s);
		return { chain: 'evm', address, key: address.toLowerCase() };
	}

	if (!BASE58_ADDRESS.test(s)) return null;
	try {
		if (bs58.decode(s).length !== 32) return null;
	} catch {
		return null;
	}
	return { chain: 'solana', address: s, key: s };
}

/** True when two spellings name the same destination. */
export function sameDestination(a, b) {
	const x = normalizeDestination(a);
	const y = normalizeDestination(b);
	return !!x && !!y && x.chain === y.chain && x.key === y.key;
}

/**
 * Address-poisoning check: an attacker plants an address that shares its first
 * and last characters with one the owner already uses, hoping a glance matches.
 * @returns {object|null} the existing entry the new address imitates
 */
export function findLookalike(entries, norm) {
	const head = norm.chain === 'evm' ? 6 : 4;
	const tail = 4;
	const k = norm.key;
	for (const e of entries) {
		if (e.chain !== norm.chain || e.address_key === k) continue;
		if (e.status === 'cancelled' || e.status === 'removed') continue;
		const o = e.address_key;
		if (o.slice(0, head) === k.slice(0, head) && o.slice(-tail) === k.slice(-tail)) return e;
	}
	return null;
}

export function shortAddress(address) {
	const s = String(address || '');
	return s.length > 14 ? `${s.slice(0, 6)}...${s.slice(-6)}` : s;
}

const INVISIBLE_OR_CONTROL = new RegExp(
	'[' + [
		'\\u0000-\\u001f', '\\u007f-\\u009f', '\\u200b-\\u200f',
		'\\u2028-\\u202e', '\\u2060-\\u206f', '\\ufeff',
	].join('') + ']',
	'g',
);

/** Plain text only: control characters, markup and links are removed, not escaped. */
export function sanitizeLabel(value) {
	if (value == null) return null;
	if (typeof value !== 'string') throw new WhitelistError(400, 'invalid_label', 'label must be a string');
	const clean = value
		.normalize('NFKC')
		.replace(INVISIBLE_OR_CONTROL, ' ')
		.replace(/[<>`]/g, '')
		.replace(/\bhttps?:\/\/\S+/gi, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_LABEL_LENGTH);
	return clean || null;
}

function sanitizeCap(value, field) {
	if (value == null || value === '') return null;
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0 || n > 1e9) {
		throw new WhitelistError(400, 'invalid_cap', `${field} must be a positive number of USD`);
	}
	return Math.round(n * 100) / 100;
}

// ── settings ───────────────────────────────────────────────────────────────────

function settingsView(row) {
	return {
		cooldown_seconds: row?.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS,
		enforced: row?.enforced === true,
		configured: !!row,
		pending_change: row?.pending_change || null,
		updated_at: row?.updated_at || null,
	};
}

/** Apply a parked loosening change once its time has come. */
async function applyDueSettingsChange(row) {
	const ch = row?.pending_change;
	if (!ch || !ch.effective_at || new Date(ch.effective_at).getTime() > Date.now()) return row;
	const [next] = await sql`
		UPDATE destination_whitelist_settings
		SET cooldown_seconds = ${ch.cooldown_seconds ?? row.cooldown_seconds},
		    enforced = ${ch.enforced ?? row.enforced},
		    pending_change = NULL, updated_at = now()
		WHERE agent_id = ${row.agent_id} AND pending_change = ${JSON.stringify(ch)}::jsonb
		RETURNING *`;
	return next || row;
}

export async function getSettings(agentId) {
	const [row] = await sql`SELECT * FROM destination_whitelist_settings WHERE agent_id = ${agentId}`;
	return settingsView(await applyDueSettingsChange(row));
}

// ── step-up ────────────────────────────────────────────────────────────────────

function stableStringify(v) {
	if (v === null || typeof v !== 'object') return JSON.stringify(v);
	if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
	return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export function hashOp(op) {
	return createHash('sha256').update(stableStringify(op)).digest('hex');
}

/**
 * The canonical form of a whitelist operation, built from the raw request body.
 * Both the step-up endpoint and the operation endpoint build it the same way, so
 * a grant minted for one operation cannot authorise any other.
 */
export function buildOp(kind, agentId, body = {}) {
	switch (kind) {
		case 'add': {
			const norm = normalizeDestination(body.address);
			if (!norm) throw new WhitelistError(400, 'invalid_address', 'That is not a valid Solana or EVM address.');
			return {
				t: 'add', a: agentId, c: norm.chain, k: norm.key,
				l: sanitizeLabel(body.label), p: sanitizeCap(body.per_tx_cap_usd, 'per_tx_cap_usd'), d: sanitizeCap(body.daily_cap_usd, 'daily_cap_usd'),
			};
		}
		case 'approve':
			return { t: 'approve', a: agentId, id: String(body.id || '') };
		case 'edit':
			return {
				t: 'edit', a: agentId, id: String(body.id || ''),
				l: 'label' in body ? sanitizeLabel(body.label) : undefined,
				p: 'per_tx_cap_usd' in body ? sanitizeCap(body.per_tx_cap_usd, 'per_tx_cap_usd') : undefined,
				d: 'daily_cap_usd' in body ? sanitizeCap(body.daily_cap_usd, 'daily_cap_usd') : undefined,
			};
		case 'settings':
			return {
				t: 'settings', a: agentId,
				cs: 'cooldown_seconds' in body ? Number(body.cooldown_seconds) : undefined,
				en: 'enforced' in body ? body.enforced === true : undefined,
			};
		case 'set_list': {
			const list = Array.isArray(body.withdraw_allowlist) ? body.withdraw_allowlist : [];
			const keys = list.map((x) => {
				const n = normalizeDestination(x);
				if (!n) throw new WhitelistError(400, 'invalid_address', 'withdraw_allowlist holds an invalid address.');
				return `${n.chain}:${n.key}`;
			});
			return { t: 'set_list', a: agentId, keys: [...new Set(keys)].sort() };
		}
		default:
			throw new WhitelistError(400, 'invalid_operation', 'Unknown whitelist operation.');
	}
}

export function stepUpMessage({ opHash, sessionId, expiresAt }) {
	return `three.ws step-up\nApprove allowlist change ${opHash}\nSession ${sessionId}\nValid until ${expiresAt}`;
}

const codeHash = (code, opHash, sessionId) =>
	createHmac('sha256', env.JWT_SECRET).update(`whitelist-code:${opHash}:${sessionId}:${code}`).digest('hex');

function requireBrowserSession(actor) {
	if (!actor?.sessionId || actor.kind !== 'owner') {
		throw new WhitelistError(403, 'session_required', 'This needs the owner signed in to the three.ws site. API keys, OAuth tokens and agents cannot do it.');
	}
}

async function mintGrant({ actor, agentId, opHash, method }) {
	const [row] = await sql`
		INSERT INTO destination_stepup_grants (user_id, session_id, agent_id, op_hash, method, expires_at)
		VALUES (${actor.userId}, ${actor.sessionId}, ${agentId}, ${opHash}, ${method}, now() + ${STEP_UP_TTL_MS / 1000} * interval '1 second')
		RETURNING id, expires_at`;
	return { grant: row.id, expires_at: row.expires_at, method };
}

/** Email a six-digit code that proves the owner holds the account's inbox. */
export async function sendStepUpCode({ actor, agentId, op }) {
	requireBrowserSession(actor);
	const opHash = hashOp(op);
	const [user] = await sql`SELECT email FROM users WHERE id = ${actor.userId}`;
	if (!user?.email) throw new WhitelistError(409, 'no_email', 'This account has no email address to send a code to. Use your password or wallet instead.');
	const [recent] = await sql`
		SELECT count(*)::int AS n FROM destination_stepup_codes
		WHERE user_id = ${actor.userId} AND created_at > now() - interval '10 minutes'`;
	if (recent.n >= 5) throw new WhitelistError(429, 'too_many_codes', 'Too many codes requested. Wait a few minutes and try again.');
	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	await sql`
		INSERT INTO destination_stepup_codes (user_id, session_id, op_hash, code_hash, expires_at)
		VALUES (${actor.userId}, ${actor.sessionId}, ${opHash}, ${codeHash(code, opHash, actor.sessionId)}, now() + ${EMAIL_CODE_TTL_MS / 1000} * interval '1 second')`;
	const { sendEmail, renderStepUpCode } = await import('./email.js');
	const sent = await sendEmail({ to: user.email, ...renderStepUpCode({ code, expiresInMinutes: EMAIL_CODE_TTL_MS / 60000, agentId }) });
	if (sent?.skipped) throw new WhitelistError(503, 'email_unavailable', 'Email is not configured on this server. Use your password or wallet instead.');
	return { sent: true, expires_in_seconds: EMAIL_CODE_TTL_MS / 1000 };
}

/**
 * Re-authenticate the owner and mint a one-time grant for exactly one operation.
 * @param {{ actor: object, agentId: string, op: object, method: string, proof: object }} o
 */
export async function mintStepUp({ actor, agentId, op, method, proof = {} }) {
	requireBrowserSession(actor);
	if (!STEP_UP_METHODS.includes(method)) throw new WhitelistError(400, 'invalid_method', `method must be one of ${STEP_UP_METHODS.join(', ')}`);
	const opHash = hashOp(op);

	if (method === 'password') {
		const { verifyPassword } = await import('./auth.js');
		const [u] = await sql`SELECT password_hash FROM users WHERE id = ${actor.userId}`;
		if (!u?.password_hash) throw new WhitelistError(409, 'no_password', 'This account has no password. Use your wallet or an emailed code instead.');
		if (typeof proof.password !== 'string' || !(await verifyPassword(proof.password, u.password_hash))) {
			throw new WhitelistError(401, 'step_up_failed', 'That password is not correct.');
		}
	} else if (method === 'wallet') {
		const [u] = await sql`SELECT wallet_address FROM users WHERE id = ${actor.userId}`;
		if (!u?.wallet_address) throw new WhitelistError(409, 'no_wallet', 'No wallet is linked to this account. Use your password or an emailed code instead.');
		const { verifySiwsSignature } = await import('./siws.js');
		const message = String(proof.message || '');
		const m = /^three\.ws step-up\nApprove allowlist change ([0-9a-f]{64})\nSession (\S+)\nValid until (\S+)$/.exec(message);
		const until = m ? Date.parse(m[3]) : NaN;
		if (!m || m[1] !== opHash || m[2] !== String(actor.sessionId) || !(until > Date.now()) || until > Date.now() + 15 * 60 * 1000) {
			throw new WhitelistError(401, 'step_up_failed', 'That signed message is not for this change, or it has expired.');
		}
		let valid = false;
		try {
			valid = verifySiwsSignature(message, String(proof.signature || ''), u.wallet_address);
		} catch {
			valid = false;
		}
		if (!valid) throw new WhitelistError(401, 'step_up_failed', 'That signature was not made by your linked wallet.');
	} else {
		const code = String(proof.code || '').trim();
		if (!/^\d{6}$/.test(code)) throw new WhitelistError(400, 'invalid_code', 'Enter the six-digit code from the email.');
		const [row] = await sql`
			SELECT id, code_hash, attempts FROM destination_stepup_codes
			WHERE user_id = ${actor.userId} AND session_id = ${actor.sessionId} AND op_hash = ${opHash}
			  AND used_at IS NULL AND expires_at > now() AND attempts < 5
			ORDER BY created_at DESC LIMIT 1`;
		if (!row) throw new WhitelistError(401, 'step_up_failed', 'No valid code for this change. Request a new one.');
		const expected = Buffer.from(row.code_hash, 'hex');
		const got = Buffer.from(codeHash(code, opHash, actor.sessionId), 'hex');
		if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
			await sql`UPDATE destination_stepup_codes SET attempts = attempts + 1 WHERE id = ${row.id}`;
			throw new WhitelistError(401, 'step_up_failed', 'That code is not correct.');
		}
		const [used] = await sql`UPDATE destination_stepup_codes SET used_at = now() WHERE id = ${row.id} AND used_at IS NULL RETURNING id`;
		if (!used) throw new WhitelistError(401, 'step_up_failed', 'That code was already used.');
	}

	return { ...(await mintGrant({ actor, agentId, opHash, method })), op_hash: opHash };
}

/** Spend a grant. One use, this session, this user, this agent, this exact operation. */
async function consumeGrant({ grantId, actor, agentId, op }) {
	const opHash = hashOp(op);
	if (typeof grantId === 'string' && /^[0-9a-f-]{36}$/i.test(grantId) && actor?.sessionId) {
		const [row] = await sql`
			UPDATE destination_stepup_grants SET used_at = now()
			WHERE id = ${grantId} AND user_id = ${actor.userId} AND session_id = ${actor.sessionId}
			  AND agent_id = ${agentId} AND op_hash = ${opHash}
			  AND used_at IS NULL AND expires_at > now()
			RETURNING method`;
		if (row) return row.method;
	}
	throw new WhitelistError(403, 'step_up_required', 'Confirm this change by re-entering your password, signing with your wallet, or entering an emailed code.', {
		op, op_hash: opHash, methods: STEP_UP_METHODS,
	});
}

// ── agents and entries ─────────────────────────────────────────────────────────

async function loadAgent(agentId, userId) {
	if (!/^[0-9a-f-]{36}$/i.test(String(agentId || ''))) throw new WhitelistError(400, 'invalid_agent_id', 'agent_id must be a UUID');
	const [agent] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!agent) throw new WhitelistError(404, 'agent_not_found', 'Agent not found.');
	if (agent.user_id !== userId) throw new WhitelistError(403, 'forbidden', 'Only the owner of this agent can manage its allowlist.');
	return agent;
}

function ownAddresses(meta) {
	return [meta?.solana_address, meta?.evm_address, meta?.evm?.address].filter(Boolean);
}

export function entryView(row, now = Date.now()) {
	if (!row) return null;
	const activatesMs = row.activates_at ? new Date(row.activates_at).getTime() : null;
	const usable = (row.status === 'active' || row.status === 'pending') && activatesMs != null && activatesMs <= now;
	return {
		id: row.id,
		agent_id: row.agent_id,
		chain: row.chain,
		address: row.address,
		label: row.label,
		per_tx_cap_usd: row.per_tx_cap_usd != null ? Number(row.per_tx_cap_usd) : null,
		daily_cap_usd: row.daily_cap_usd != null ? Number(row.daily_cap_usd) : null,
		status: usable && row.status === 'pending' ? 'active' : row.status,
		usable,
		proposed_by: row.proposed_by,
		created_at: row.created_at,
		activates_at: row.activates_at,
		seconds_until_active: !usable && row.status === 'pending' && activatesMs ? Math.max(0, Math.ceil((activatesMs - now) / 1000)) : 0,
	};
}

const LIVE = ['proposed', 'pending', 'active'];

async function liveEntries(agentId) {
	return sql`SELECT * FROM destination_whitelist_entries WHERE agent_id = ${agentId} AND status = ANY(${LIVE}) ORDER BY created_at`;
}

/** Everything the owner or an agent needs to see about an agent's allowlist. */
export async function getWhitelist(agentId, userId, { history = false } = {}) {
	await loadAgent(agentId, userId);
	await activateDue(agentId);
	const [settings, rows] = await Promise.all([
		getSettings(agentId),
		history
			? sql`SELECT * FROM destination_whitelist_entries WHERE agent_id = ${agentId} ORDER BY created_at DESC LIMIT 200`
			: liveEntries(agentId),
	]);
	const entries = rows.map((r) => entryView(r));
	return {
		agent_id: agentId,
		enforced: settings.enforced,
		settings,
		min_cooldown_seconds: MIN_COOLDOWN_SECONDS,
		max_entries: MAX_ENTRIES,
		entries,
		counts: {
			active: entries.filter((e) => e.status === 'active').length,
			pending: entries.filter((e) => e.status === 'pending').length,
			proposed: entries.filter((e) => e.status === 'proposed').length,
		},
	};
}

// ── notifications ──────────────────────────────────────────────────────────────

const APP_ORIGIN = () => process.env.APP_ORIGIN || 'https://three.ws';

function cancelSignature(body) {
	return createHmac('sha256', env.JWT_SECRET).update(`whitelist-cancel:${body}`).digest('base64url');
}

/** A link that cancels one pending or proposed entry, usable without signing in. */
export function signCancelToken({ entryId, userId, expiresAt }) {
	const exp = Math.floor(new Date(expiresAt).getTime() / 1000);
	const body = Buffer.from(JSON.stringify({ i: entryId, u: String(userId), e: exp }), 'utf8').toString('base64url');
	return `w1.${body}.${cancelSignature(body)}`;
}

export function verifyCancelToken(token, now = Date.now()) {
	if (typeof token !== 'string' || !token.startsWith('w1.')) return null;
	const parts = token.split('.');
	if (parts.length !== 3 || !parts[1] || !parts[2]) return null;
	const a = Buffer.from(cancelSignature(parts[1]), 'utf8');
	const b = Buffer.from(parts[2], 'utf8');
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	try {
		const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
		if (!c.i || !c.u || !Number.isFinite(c.e) || c.e * 1000 <= now) return null;
		return { entryId: c.i, userId: c.u };
	} catch {
		return null;
	}
}

export function cancelUrl(entry, userId) {
	const expiresAt = new Date(Math.max(Date.now(), new Date(entry.activates_at || Date.now()).getTime()) + 14 * 24 * 3600 * 1000);
	return `${APP_ORIGIN()}/api/wallet-whitelist?cancel=${signCancelToken({ entryId: entry.id, userId, expiresAt })}`;
}

const HEADLINES = {
	whitelist_proposed: 'An agent proposed a new destination',
	whitelist_pending: 'New destination added: cooling down',
	whitelist_active: 'A destination is now active',
	whitelist_cancelled: 'A pending destination was cancelled',
	whitelist_removed: 'A destination was removed',
	whitelist_edited: 'A destination was edited',
	whitelist_settings: 'Allowlist protection changed',
};
export const WHITELIST_NOTIFICATION_TYPES = Object.freeze(Object.keys(HEADLINES));

/**
 * Tell the owner on every channel they have connected (in-app, push, Telegram,
 * Discord; the notification preference matrix does not mute these, see
 * ALWAYS_NOTIFY_TYPES in notify-prefs.js) and by email. Never throws: the change
 * has already happened, and a delivery problem must not undo or hide it.
 */
export async function notifyOwner({ userId, agent, type, entry = null, detail = '', withCancel = false }) {
	try {
		const { insertNotification } = await import('./notify.js');
		const target = entry ? `${entry.label ? `"${entry.label}" ` : ''}${shortAddress(entry.address)}` : '';
		const message = [HEADLINES[type], target, detail].filter(Boolean).join(': ');
		const link = `/agent-wallet?agent=${encodeURIComponent(agent.id)}&tab=whitelist`;
		const cancel = withCancel && entry ? cancelUrl(entry, userId) : null;
		await insertNotification(userId, type, {
			agent_id: agent.id,
			agent_name: agent.name || null,
			entry_id: entry?.id || null,
			message,
			link,
			cancel_url: cancel,
			activates_at: entry?.activates_at || null,
		});
		const [u] = await sql`SELECT email FROM users WHERE id = ${userId}`;
		if (u?.email) {
			const { sendEmail, renderWhitelistNotice } = await import('./email.js');
			await sendEmail({
				to: u.email,
				...renderWhitelistNotice({
					headline: HEADLINES[type], agentName: agent.name, entry, detail, cancelUrl: cancel, link: `${APP_ORIGIN()}${link}`,
				}),
			}).catch((e) => console.warn('[whitelist] email failed', e?.message));
		}
	} catch (e) {
		console.warn('[whitelist] notify failed', e?.message);
	}
}

async function record(agent, userId, reason, entry, extra = {}, req = null) {
	const { recordCustodyEvent } = await import('./agent-trade-guards.js');
	await recordCustodyEvent({
		agentId: agent.id, userId, eventType: 'limit_change', reason,
		destination: entry?.address || null, meta: { entry_id: entry?.id || null, label: entry?.label || null, ...extra },
	}).catch((e) => console.warn('[whitelist] custody record failed', e?.message));
	logAudit({ userId, action: `custody.${reason}`, resourceId: agent.id, meta: { entry_id: entry?.id || null, address: entry?.address || null, ...extra }, req });
}

// ── lifecycle ──────────────────────────────────────────────────────────────────

async function ownerCooldownSeconds(agentId) {
	return (await getSettings(agentId)).cooldown_seconds;
}

/**
 * Add an address. `skipGrant` is for callers inside this module that already
 * consumed a grant covering the whole operation (replaceSolanaList).
 *
 * An owner browser session with a valid step-up grant creates a PENDING entry
 * that activates after the cooldown. Any other principal (an agent over MCP, an
 * API key, an OAuth token, a session without a grant) can only create a
 * PROPOSED entry, which is inert until the owner approves it with step-up. A
 * grant is only ever required of a session; a machine principal is never asked
 * for one because it could never satisfy it.
 */
export async function addEntry({ agentId, actor, body, grantId = null, skipGrant = false, req = null }) {
	const agent = await loadAgent(agentId, actor.userId);
	const op = buildOp('add', agentId, body);
	const norm = normalizeDestination(body.address);
	if (ownAddresses(agent.meta).some((a) => sameDestination(a, norm.address))) {
		throw new WhitelistError(400, 'own_wallet', 'That is this agent\'s own wallet. It is always allowed and does not need a place on the list.');
	}

	const live = await liveEntries(agentId);
	if (live.length >= MAX_ENTRIES) throw new WhitelistError(409, 'list_full', `An agent can have at most ${MAX_ENTRIES} allowlist entries.`);
	const dup = live.find((e) => e.chain === norm.chain && e.address_key === norm.key);
	if (dup) throw new WhitelistError(409, 'already_listed', 'That address is already on the list.', { entry: entryView(dup) });
	const lookalike = findLookalike(live, norm);

	const owner = actor.kind === 'owner';
	if (owner && !skipGrant) await consumeGrant({ grantId, actor, agentId, op });

	const cooldown = await ownerCooldownSeconds(agentId);
	const status = owner ? 'pending' : 'proposed';
	let row;
	try {
		[row] = await sql`
			INSERT INTO destination_whitelist_entries
				(agent_id, user_id, chain, address, address_key, label, per_tx_cap_usd, daily_cap_usd,
				 status, proposed_by, approved_at, activates_at)
			VALUES (${agentId}, ${agent.user_id}, ${norm.chain}, ${norm.address}, ${norm.key}, ${op.l}, ${op.p}, ${op.d},
				${status}, ${owner ? 'owner' : String(actor.kind || 'agent')},
				${owner ? sql`now()` : null},
				${owner ? sql`now() + ${cooldown} * interval '1 second'` : null})
			RETURNING *`;
	} catch (e) {
		if (e?.code === '23505') throw new WhitelistError(409, 'already_listed', 'That address is already on the list.');
		throw e;
	}

	await record(agent, actor.userId, owner ? 'whitelist_add' : 'whitelist_propose', row, { status, lookalike_of: lookalike?.id || null }, req);
	await notifyOwner({
		userId: agent.user_id, agent, entry: row,
		type: owner ? 'whitelist_pending' : 'whitelist_proposed',
		detail: owner
			? `usable in ${Math.round(cooldown / 3600)}h unless you cancel it`
			: 'it cannot receive funds until you approve it',
		withCancel: true,
	});
	return { entry: entryView(row), cooldown_seconds: owner ? cooldown : null, lookalike_of: lookalike ? entryView(lookalike) : null };
}

/** Owner approves a proposal. Starts the cooldown; the address is still not usable yet. */
export async function approveEntry({ agentId, entryId, actor, grantId, req = null }) {
	requireBrowserSession(actor);
	const agent = await loadAgent(agentId, actor.userId);
	const op = buildOp('approve', agentId, { id: entryId });
	const [cur] = await sql`SELECT * FROM destination_whitelist_entries WHERE id = ${entryId} AND agent_id = ${agentId}`;
	if (!cur) throw new WhitelistError(404, 'entry_not_found', 'No such allowlist entry.');
	if (cur.status !== 'proposed') throw new WhitelistError(409, 'not_proposed', 'Only a proposed address can be approved.', { status: cur.status });
	await consumeGrant({ grantId, actor, agentId, op });
	const cooldown = await ownerCooldownSeconds(agentId);
	const [row] = await sql`
		UPDATE destination_whitelist_entries
		SET status = 'pending', approved_at = now(), activates_at = now() + ${cooldown} * interval '1 second', updated_at = now()
		WHERE id = ${entryId} AND status = 'proposed' RETURNING *`;
	if (!row) throw new WhitelistError(409, 'not_proposed', 'That proposal changed. Reload and try again.');
	await record(agent, actor.userId, 'whitelist_approve', row, {}, req);
	await notifyOwner({ userId: agent.user_id, agent, entry: row, type: 'whitelist_pending', detail: `usable in ${Math.round(cooldown / 3600)}h unless you cancel it`, withCancel: true });
	return { entry: entryView(row), cooldown_seconds: cooldown };
}

/** Edit a label or the per-destination caps. The address and the status cannot be edited. */
export async function editEntry({ agentId, entryId, actor, body, grantId, req = null }) {
	requireBrowserSession(actor);
	const agent = await loadAgent(agentId, actor.userId);
	const op = buildOp('edit', agentId, { ...body, id: entryId });
	const [cur] = await sql`SELECT * FROM destination_whitelist_entries WHERE id = ${entryId} AND agent_id = ${agentId}`;
	if (!cur || !LIVE.includes(cur.status)) throw new WhitelistError(404, 'entry_not_found', 'No such allowlist entry.');
	await consumeGrant({ grantId, actor, agentId, op });
	const [row] = await sql`
		UPDATE destination_whitelist_entries
		SET label = ${op.l !== undefined ? op.l : cur.label},
		    per_tx_cap_usd = ${op.p !== undefined ? op.p : cur.per_tx_cap_usd},
		    daily_cap_usd = ${op.d !== undefined ? op.d : cur.daily_cap_usd},
		    updated_at = now()
		WHERE id = ${entryId} AND status = ANY(${LIVE}) RETURNING *`;
	if (!row) throw new WhitelistError(409, 'entry_changed', 'That entry changed. Reload and try again.');
	await record(agent, actor.userId, 'whitelist_edit', row, { before: { label: cur.label, per_tx_cap_usd: cur.per_tx_cap_usd, daily_cap_usd: cur.daily_cap_usd } }, req);
	await notifyOwner({ userId: agent.user_id, agent, entry: row, type: 'whitelist_edited' });
	return { entry: entryView(row) };
}

/** Cancel a pending or proposed entry. One click, no step-up: it only removes access. */
export async function cancelEntry({ entryId, userId, via = 'web', req = null }) {
	const [cur] = await sql`SELECT * FROM destination_whitelist_entries WHERE id = ${entryId} AND user_id = ${userId}`;
	if (!cur) throw new WhitelistError(404, 'entry_not_found', 'No such allowlist entry.');
	const agent = await loadAgent(cur.agent_id, userId);
	const [row] = await sql`
		UPDATE destination_whitelist_entries SET status = 'cancelled', cancelled_at = now(), updated_at = now()
		WHERE id = ${entryId} AND status IN ('pending', 'proposed') RETURNING *`;
	if (!row) {
		if (cur.status === 'cancelled') return { entry: entryView(cur), already: true };
		throw new WhitelistError(409, 'not_cancellable', cur.status === 'active' ? 'That address is already active. Remove it instead.' : 'That entry can no longer be cancelled.', { status: cur.status });
	}
	await record(agent, userId, 'whitelist_cancel', row, { via }, req);
	await notifyOwner({ userId, agent, entry: row, type: 'whitelist_cancelled' });
	return { entry: entryView(row) };
}

/** Remove an entry. Instant, for any principal that owns the agent. */
export async function removeEntry({ agentId, entryId, actor, req = null }) {
	const agent = await loadAgent(agentId, actor.userId);
	const [row] = await sql`
		UPDATE destination_whitelist_entries SET status = 'removed', removed_at = now(), updated_at = now()
		WHERE id = ${entryId} AND agent_id = ${agentId} AND status IN ('proposed', 'pending', 'active') RETURNING *`;
	if (!row) throw new WhitelistError(404, 'entry_not_found', 'No such allowlist entry, or it was already removed.');
	await record(agent, actor.userId, 'whitelist_remove', row, { via: actor.kind }, req);
	await notifyOwner({ userId: agent.user_id, agent, entry: row, type: 'whitelist_removed' });
	return { entry: entryView(row) };
}

/**
 * Change the cooldown or the enforcement switch.
 * Safer settings apply now. Looser ones (a shorter cooldown, enforcement off)
 * need step-up and are parked for one full current cooldown, so a stolen session
 * cannot shorten the cooldown and add an address in the same minute.
 */
export async function updateSettings({ agentId, actor, body, grantId = null, skipGrant = false, req = null }) {
	requireBrowserSession(actor);
	const agent = await loadAgent(agentId, actor.userId);
	const op = buildOp('settings', agentId, body);
	const cur = await getSettings(agentId);

	if (body.cancel_pending_change === true) {
		await sql`UPDATE destination_whitelist_settings SET pending_change = NULL, updated_at = now() WHERE agent_id = ${agentId}`;
		await record(agent, actor.userId, 'whitelist_settings_cancel', null, {}, req);
		return { settings: await getSettings(agentId) };
	}

	let cooldown = cur.cooldown_seconds;
	if (op.cs !== undefined) {
		if (!Number.isInteger(op.cs) || op.cs < MIN_COOLDOWN_SECONDS) {
			throw new WhitelistError(400, 'cooldown_too_short', `The cooldown cannot be shorter than ${MIN_COOLDOWN_SECONDS / 3600} hour.`);
		}
		if (op.cs > MAX_COOLDOWN_SECONDS) throw new WhitelistError(400, 'cooldown_too_long', `The cooldown cannot be longer than ${MAX_COOLDOWN_SECONDS / 86400} days.`);
		cooldown = op.cs;
	}
	let enforced = cur.enforced;
	if (op.en !== undefined) enforced = op.en;
	if (op.cs === undefined && op.en === undefined) throw new WhitelistError(400, 'nothing_to_change', 'Send cooldown_seconds, enforced or cancel_pending_change.');

	const loosensCooldown = cooldown < cur.cooldown_seconds;
	const loosensEnforce = cur.enforced && !enforced;
	if (enforced && !cur.enforced) {
		const [active] = await sql`SELECT count(*)::int AS n FROM destination_whitelist_entries WHERE agent_id = ${agentId} AND status IN ('pending', 'active') AND activates_at <= now()`;
		if (!active.n) throw new WhitelistError(409, 'nothing_to_enforce', 'Add an address and wait for its cooldown before turning enforcement on, or every send would be refused.');
	}
	if ((loosensCooldown || loosensEnforce) && !skipGrant) await consumeGrant({ grantId, actor, agentId, op });

	const park = {};
	if (loosensCooldown) { park.cooldown_seconds = cooldown; cooldown = cur.cooldown_seconds; }
	if (loosensEnforce) { park.enforced = false; enforced = cur.enforced; }
	const pending = Object.keys(park).length
		? { ...park, requested_at: new Date().toISOString(), effective_at: new Date(Date.now() + cur.cooldown_seconds * 1000).toISOString() }
		: cur.pending_change;

	await sql`
		INSERT INTO destination_whitelist_settings (agent_id, user_id, cooldown_seconds, enforced, pending_change)
		VALUES (${agentId}, ${agent.user_id}, ${cooldown}, ${enforced}, ${pending ? JSON.stringify(pending) : null}::jsonb)
		ON CONFLICT (agent_id) DO UPDATE
		SET cooldown_seconds = EXCLUDED.cooldown_seconds, enforced = EXCLUDED.enforced,
		    pending_change = EXCLUDED.pending_change, updated_at = now()`;

	await record(agent, actor.userId, 'whitelist_settings', null, { cooldown_seconds: cooldown, enforced, parked: park }, req);
	await notifyOwner({
		userId: agent.user_id, agent, type: 'whitelist_settings',
		detail: Object.keys(park).length
			? `a looser setting takes effect at ${pending.effective_at}; you can cancel it until then`
			: `cooldown ${Math.round(cooldown / 3600)}h, enforcement ${enforced ? 'on' : 'off'}`,
	});
	return { settings: await getSettings(agentId), parked: Object.keys(park).length > 0 };
}

/**
 * The legacy whole-list write (PUT /api/agents/:id/solana-wallet, field
 * withdraw_allowlist). It keeps working, under the same rules: addresses missing
 * from the new list are removed at once; addresses new to it become pending
 * entries that serve the cooldown and need step-up; and a list that would be
 * empty never switches enforcement off early (that is parked like any loosening).
 */
export async function replaceSolanaList(args) {
	return replaceList({ ...args, chain: 'solana' });
}

/** The whole-list write for one chain. Same rules for Solana and EVM. */
export async function replaceList({ agentId, actor, list, chain = 'solana', grantId = null, req = null }) {
	requireBrowserSession(actor);
	const agent = await loadAgent(agentId, actor.userId);
	const op = buildOp('set_list', agentId, { withdraw_allowlist: list });
	const wanted = new Map();
	for (const item of list) {
		const n = normalizeDestination(item);
		if (!n || n.chain !== chain) throw new WhitelistError(400, 'invalid_address', `The list holds an address that is not a valid ${chain === 'evm' ? 'EVM' : 'Solana'} address.`);
		wanted.set(n.key, n);
	}
	if (wanted.size > MAX_ENTRIES) throw new WhitelistError(400, 'list_full', `An allowlist holds at most ${MAX_ENTRIES} addresses.`);

	const live = (await liveEntries(agentId)).filter((e) => e.chain === chain);
	const byKey = new Map(live.map((e) => [e.address_key, e]));
	const toRemove = live.filter((e) => !wanted.has(e.address_key));
	const toAdd = [...wanted.values()].filter((n) => !byKey.has(n.key));
	const toApprove = live.filter((e) => e.status === 'proposed' && wanted.has(e.address_key));

	if (toAdd.length || toApprove.length) await consumeGrant({ grantId, actor, agentId, op });

	for (const e of toRemove) await removeEntry({ agentId, entryId: e.id, actor, req });
	const added = [];
	for (const n of toAdd) {
		const out = await addEntry({ agentId, actor, body: { address: n.address }, grantId: null, req, skipGrant: true });
		added.push(out.entry);
	}
	for (const e of toApprove) {
		const cooldown = await ownerCooldownSeconds(agentId);
		await sql`UPDATE destination_whitelist_entries SET status = 'pending', approved_at = now(), activates_at = now() + ${cooldown} * interval '1 second', updated_at = now() WHERE id = ${e.id} AND status = 'proposed'`;
	}

	if (chain === 'solana' && !wanted.size && (await getSettings(agentId)).enforced) {
		await updateSettings({ agentId, actor, body: { enforced: false }, grantId: null, skipGrant: true, req });
	}
	const view = await getWhitelist(agentId, actor.userId);
	return { ...view, added: added.length, removed: toRemove.length, pending: view.entries.filter((e) => e.status === 'pending') };
}

/** Active Solana addresses for an agent: what the legacy `withdraw_allowlist` field now reports. */
export async function activeAddresses(agentId, chain = 'solana') {
	await activateDue(agentId);
	const rows = await sql`SELECT address FROM destination_whitelist_entries WHERE agent_id = ${agentId} AND chain = ${chain} AND status = 'active' ORDER BY created_at`;
	return rows.map((r) => r.address);
}

// ── activation ─────────────────────────────────────────────────────────────────

/**
 * Flip entries whose cooldown has ended from pending to active, switch
 * enforcement on for an agent that never configured it (a first active entry
 * means the owner wants a list), and tell the owner. Safe to run from several
 * places at once: the UPDATE hands each entry to exactly one caller.
 */
export async function activateDue(agentId = null) {
	const rows = agentId
		? await sql`UPDATE destination_whitelist_entries SET status = 'active', activated_at = now(), updated_at = now()
			WHERE status = 'pending' AND activates_at <= now() AND agent_id = ${agentId} RETURNING *`
		: await sql`UPDATE destination_whitelist_entries SET status = 'active', activated_at = now(), updated_at = now()
			WHERE status = 'pending' AND activates_at <= now() RETURNING *`;
	for (const row of rows) {
		await sql`
			INSERT INTO destination_whitelist_settings (agent_id, user_id, enforced)
			VALUES (${row.agent_id}, ${row.user_id}, true) ON CONFLICT (agent_id) DO NOTHING`;
		const [agent] = await sql`SELECT id, name FROM agent_identities WHERE id = ${row.agent_id}`;
		if (agent) await notifyOwner({ userId: row.user_id, agent, entry: row, type: 'whitelist_active', detail: 'it can now receive funds' });
	}
	const due = await sql`SELECT agent_id FROM destination_whitelist_settings WHERE pending_change IS NOT NULL AND (pending_change->>'effective_at')::timestamptz <= now()`;
	for (const d of due) await getSettings(d.agent_id);
	return { activated: rows.length, settings_applied: due.length };
}

// ── enforcement ────────────────────────────────────────────────────────────────

/**
 * Decide whether `destination` may receive funds from this agent.
 *
 * Returns { allowed, state, ... }. `state` is one of exempt, own_wallet,
 * not_enforced, active, cooling_down, proposed, not_listed, invalid. The
 * entry's caps come back with an allowed decision so the caller can apply them
 * (the spend guard owns the per-destination spend ledger).
 */
export async function evaluateDestination({ agentId, destination, category, chain: hintChain = null, ownAddress = null, now = Date.now() }) {
	if (EXEMPT_CATEGORIES.has(category)) return { allowed: true, state: 'exempt', enforced: false };
	const norm = normalizeDestination(destination);
	const chain = norm?.chain || hintChain || 'solana';

	if (norm && ownAddress && sameDestination(ownAddress, norm.address)) {
		return { allowed: true, state: 'own_wallet', enforced: false, chain };
	}

	const [settings, entryRows] = await Promise.all([
		getSettings(agentId),
		norm
			? sql`SELECT * FROM destination_whitelist_entries
				WHERE agent_id = ${agentId} AND chain = ${norm.chain} AND address_key = ${norm.key} AND status IN ('proposed', 'pending', 'active')
				LIMIT 1`
			: Promise.resolve([]),
	]);
	// An agent that keeps an EVM list is restricted to it even when the switch
	// was never turned on; the EVM leg itself refuses unlisted destinations
	// unconditionally (evm-leg/guards.js). With no EVM list the switch decides.
	let enforced = settings.enforced;
	if (!enforced && chain === 'evm') {
		const [any] = await sql`SELECT 1 AS n FROM destination_whitelist_entries WHERE agent_id = ${agentId} AND chain = 'evm' AND status IN ('proposed', 'pending', 'active') LIMIT 1`;
		enforced = !!any;
	}
	const entry = entryRows[0] ? entryView(entryRows[0], now) : null;

	if (entry?.usable) return { allowed: true, state: 'active', enforced, chain, entry };
	if (!enforced) return { allowed: true, state: entry ? (entry.status === 'proposed' ? 'proposed' : 'cooling_down') : 'not_enforced', enforced, chain, entry };

	if (!norm) {
		return {
			allowed: false, state: 'invalid', enforced, chain, code: 'destination_invalid',
			message: 'That destination is not a valid address, so it cannot be checked against the allowlist.',
		};
	}
	if (entry?.status === 'pending') {
		return {
			allowed: false, state: 'cooling_down', enforced, chain, entry, code: 'destination_cooling_down',
			message: `That address was added recently and is still in its cooldown. It becomes usable at ${new Date(entry.activates_at).toISOString()}.`,
			detail: { activates_at: entry.activates_at, seconds_until_active: entry.seconds_until_active },
		};
	}
	if (entry?.status === 'proposed') {
		return {
			allowed: false, state: 'proposed', enforced, chain, entry, code: 'destination_awaiting_approval',
			message: 'That address was proposed but the owner has not approved it yet.',
		};
	}
	return {
		allowed: false, state: 'not_listed', enforced, chain, code: 'destination_not_whitelisted',
		message: 'That destination is not on this agent\'s allowlist. Add it under Limits & Safety; a new address becomes usable after its cooldown.',
	};
}

/** The one line a confirmation table shows for a destination's allowlist state. */
export function allowlistLine(decision) {
	switch (decision?.state) {
		case 'exempt': return 'Not applicable to this kind of payment';
		case 'own_wallet': return 'This agent\'s own wallet (always allowed)';
		case 'active': return `On the allowlist${decision.entry?.label ? `: ${decision.entry.label}` : ''}`;
		case 'not_enforced': return 'Allowlist is off for this agent (any address is allowed)';
		case 'cooling_down': return decision.allowed
			? 'Cooling down (allowlist is off, so it is allowed)'
			: `BLOCKED: cooling down until ${new Date(decision.entry.activates_at).toISOString()}`;
		case 'proposed': return decision.allowed ? 'Proposed, not yet approved (allowlist is off)' : 'BLOCKED: proposed by an agent, not yet approved';
		case 'not_listed': return 'BLOCKED: not on the allowlist';
		case 'invalid': return 'BLOCKED: not a valid address';
		default: return 'Unknown';
	}
}

/** A confirmation-table row for an outbound send. Never throws. */
export async function allowlistRow({ agentId, destination, category, ownAddress = null }) {
	try {
		const decision = await evaluateDestination({ agentId, destination, category, ownAddress });
		return { label: 'Allowlist', value: allowlistLine(decision), state: decision.state, allowed: decision.allowed };
	} catch (e) {
		return { label: 'Allowlist', value: 'Could not be checked right now', state: 'unknown', allowed: false };
	}
}
