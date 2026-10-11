// Link codes: one short-lived code links another device to the account.
//
// The shape is the same for every device kind, so a person learns it once:
//
//   1. mint     the signed-in session on the site mints a code and says what
//               kind of device it is for (phone, desktop app, CLI, Telegram).
//   2. claim    the device presents the code together with a description of
//               itself (its name and platform, or the Telegram chat it came
//               from) and receives a claim secret it polls with. A code is
//               claimed by one device, once; a second claim finds nothing.
//   3. confirm  the session that minted the code is shown exactly what will
//               be linked and confirms or rejects it. Nothing is issued until
//               that press, and only the minting account can press it.
//   4. consume  the device polls, reads its credential once, and the row is
//               done. The credential is what the device kind needs: a browser
//               session for a phone, an API key for a CLI or desktop app, a
//               gateway link for a Telegram chat.
//
// Every link produces an account_linked_devices row pointing at the
// credential, which is what the account page lists and revokes.

import { sql } from '../db.js';
import { randomToken, sha256 } from '../crypto.js';
import { createSession } from '../auth.js';
import { mintApiKey, normalizeKeyScopes } from '../api-keys.js';
import { createLink, revokeLink, GatewayError } from '../gateway/store.js';
import { generatePairCode, normalizePairCode, formatPairCode } from '../gateway/codes.js';
import { logAudit } from '../audit.js';

export const LINK_CODE_TTL_SEC = 10 * 60;
export const DEVICE_KINDS = Object.freeze(['phone', 'desktop', 'cli', 'telegram']);
export const DEVICE_LABELS = Object.freeze({ phone: 'Phone', desktop: 'Desktop app', cli: 'Command line', telegram: 'Telegram chat' });
// What a CLI or desktop link may ask for. `spend` and the wallet:write family
// stay off this path on purpose: a key that moves funds is minted on the keys
// page, with the real-funds agreement in front of it.
export const LINKABLE_SCOPES = Object.freeze(['read', 'generate', 'profile', 'agents:read', 'agents:write', 'avatars:read', 'avatars:write', 'memory:read', 'memory:write', 'wallet:read', 'inference']);
export const DEFAULT_SCOPES = Object.freeze({ cli: ['read', 'generate', 'agents:read', 'avatars:read', 'profile'], desktop: ['read', 'generate', 'agents:read', 'agents:write', 'avatars:read', 'profile'] });

export class LinkCodeError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

export function normalizeLinkCode(input) {
	return normalizePairCode(input);
}

async function hashCode(code) {
	return sha256(`alc:${code}`);
}

function cleanText(value, max) {
	const s = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return s ? s.slice(0, max) : null;
}

/** A device's self-description, bounded so a claim can never carry markup or a novel. */
export function describeClaim(raw = {}, { ip = null, userAgent = null } = {}) {
	return {
		name: cleanText(raw.name, 80),
		platform: cleanText(raw.platform, 60),
		client: cleanText(raw.client, 60),
		ip: ip ? String(ip).slice(0, 64) : null,
		user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
		...(raw.telegram ? { telegram: raw.telegram } : {}),
	};
}

export function publicCode(row, { forOwner = false } = {}) {
	const expired = row.status === 'issued' && new Date(row.expires_at).getTime() <= Date.now();
	return {
		id: row.id,
		device_kind: row.device_kind,
		device_label: DEVICE_LABELS[row.device_kind],
		label: row.label,
		status: expired ? 'expired' : row.status,
		requested_scope: row.requested_scope,
		claim: forOwner ? row.claim : (row.claim ? { name: row.claim.name, platform: row.claim.platform } : null),
		created_at: row.created_at,
		expires_at: row.expires_at,
		claimed_at: row.claimed_at,
		decided_at: row.decided_at,
		result_kind: row.result_kind,
		device_id: row.device_id,
	};
}

// ── 1. mint ───────────────────────────────────────────────────────────────────

export async function mintLinkCode({ userId, deviceKind, label = null, requestedScope = null, req = null }) {
	if (!DEVICE_KINDS.includes(deviceKind)) throw new LinkCodeError('invalid_kind', `device_kind must be one of ${DEVICE_KINDS.join(', ')}`);
	let scope = null;
	if (deviceKind === 'cli' || deviceKind === 'desktop') {
		const wanted = requestedScope ? normalizeKeyScopes(requestedScope) : { scopes: DEFAULT_SCOPES[deviceKind], invalid: [] };
		if (wanted.invalid.length) throw new LinkCodeError('invalid_scope', `unknown scope: ${wanted.invalid.join(', ')}`);
		const outside = wanted.scopes.filter((s) => !LINKABLE_SCOPES.includes(s));
		if (outside.length) throw new LinkCodeError('scope_not_linkable', `${outside.join(', ')} cannot be granted through a link code; create that key on the keys page`);
		scope = wanted.scopes.join(' ');
	}
	// One live code per kind per account keeps a confused person from holding
	// several, any of which would link whatever device claims it.
	await sql`
		update account_link_codes set status = 'expired'
		where user_id = ${userId} and device_kind = ${deviceKind} and status = 'issued'
	`;
	const code = generatePairCode();
	const [row] = await sql`
		insert into account_link_codes (code_hash, user_id, device_kind, label, requested_scope, expires_at)
		values (${await hashCode(code)}, ${userId}, ${deviceKind}, ${cleanText(label, 80)}, ${scope},
		        now() + ${`${LINK_CODE_TTL_SEC} seconds`}::interval)
		returning *
	`;
	logAudit({ userId, action: 'link_code_minted', resourceId: row.id, meta: { device_kind: deviceKind, scope }, req });
	return { ...publicCode(row, { forOwner: true }), code: formatPairCode(code) };
}

// ── 2. claim ──────────────────────────────────────────────────────────────────

/**
 * A device claims a code. Returns the claim secret it polls with. The UPDATE
 * is conditional on `issued` and unexpired, so a used or stale code is a
 * clean refusal rather than a second claimant.
 */
export async function claimLinkCode({ code: raw, claim, expectKind = null }) {
	const code = normalizeLinkCode(raw);
	if (!code) throw new LinkCodeError('invalid_code', 'that is not a link code; codes look like BCDF-GHJK');
	const [existing] = await sql`select id, status, device_kind, expires_at from account_link_codes where code_hash = ${await hashCode(code)} limit 1`;
	if (!existing) throw new LinkCodeError('unknown_code', 'that code does not exist or was mistyped', 404);
	if (expectKind && existing.device_kind !== expectKind) throw new LinkCodeError('wrong_kind', `that code was minted for a ${DEVICE_LABELS[existing.device_kind].toLowerCase()}, not for this`, 409);
	const claimSecret = randomToken(24);
	const [row] = await sql`
		update account_link_codes
		set status = 'claimed', claimed_at = now(), claim = ${JSON.stringify(claim)}::jsonb, claim_secret_hash = ${await sha256(claimSecret)}
		where id = ${existing.id} and status = 'issued' and expires_at > now()
		returning *
	`;
	if (!row) {
		if (existing.status === 'issued' || existing.status === 'expired') throw new LinkCodeError('expired', 'that code expired; generate a new one on the site', 410);
		throw new LinkCodeError('already_used', 'that code was already used', 409);
	}
	return { ...publicCode(row), claim_secret: claimSecret };
}

// ── 3. confirm / reject ───────────────────────────────────────────────────────

export async function readLinkCode({ id, userId }) {
	const [row] = await sql`select * from account_link_codes where id = ${id} and user_id = ${userId} limit 1`;
	return row ? publicCode(row, { forOwner: true }) : null;
}

export async function listPendingLinkCodes(userId) {
	const rows = await sql`
		select * from account_link_codes
		where user_id = ${userId} and status in ('issued', 'claimed') and expires_at > now()
		order by created_at desc
	`;
	return rows.map((r) => publicCode(r, { forOwner: true }));
}

/**
 * The minting account decides. `scopes` can only narrow what was requested.
 * Confirming issues the credential for the kind and records the device.
 */
export async function decideLinkCode({ id, userId, decision, scopes = null, req = null }) {
	const [row] = await sql`select * from account_link_codes where id = ${id} limit 1`;
	if (!row) throw new LinkCodeError('unknown_code', 'no such link request', 404);
	// The wrong account never learns whether the id exists in another account.
	if (row.user_id !== userId) throw new LinkCodeError('wrong_account', 'that link request belongs to a different account', 403);
	if (row.status !== 'claimed') {
		if (row.status === 'issued') throw new LinkCodeError('not_claimed', 'no device has entered this code yet', 409);
		throw new LinkCodeError('already_decided', `this link request is already ${row.status}`, 409);
	}
	if (new Date(row.expires_at).getTime() <= Date.now()) {
		await sql`update account_link_codes set status = 'expired' where id = ${row.id}`;
		throw new LinkCodeError('expired', 'this link request expired; generate a new code', 410);
	}
	if (decision === 'reject') {
		const [done] = await sql`
			update account_link_codes set status = 'rejected', decided_at = now(), claim_secret_hash = null
			where id = ${row.id} and status = 'claimed' returning *
		`;
		if (!done) throw new LinkCodeError('already_decided', 'this link request was already decided', 409);
		logAudit({ userId, action: 'link_code_rejected', resourceId: row.id, meta: { device_kind: row.device_kind, claim: row.claim }, req });
		return publicCode(done, { forOwner: true });
	}
	if (decision !== 'confirm') throw new LinkCodeError('invalid_decision', 'decision must be confirm or reject');

	const granted = narrowScopes(row.requested_scope, scopes);
	// Claim the row first so two confirms cannot both issue a credential.
	const [claimed] = await sql`
		update account_link_codes set status = 'confirmed', decided_at = now()
		where id = ${row.id} and status = 'claimed' returning *
	`;
	if (!claimed) throw new LinkCodeError('already_decided', 'this link request was already decided', 409);

	let issued;
	try {
		issued = await issueCredential({ row: claimed, userId, scopes: granted, req });
	} catch (err) {
		await sql`update account_link_codes set status = 'rejected', decided_at = now() where id = ${claimed.id}`.catch(() => {});
		throw err;
	}
	const label = deviceLabel(claimed);
	const [device] = await sql`
		insert into account_linked_devices (user_id, kind, label, meta, credential_kind, credential_id, link_code_id)
		values (${userId}, ${claimed.device_kind}, ${label}, ${JSON.stringify(deviceMeta(claimed, granted))}::jsonb,
		        ${issued.kind}, ${issued.id}, ${claimed.id})
		on conflict (credential_kind, credential_id) do update set revoked_at = null, label = excluded.label, meta = excluded.meta, linked_at = now()
		returning *
	`;
	await sql`
		update account_link_codes
		set result_kind = ${issued.kind}, result_id = ${issued.id}, result_secret = ${issued.secret || null}, device_id = ${device.id}
		where id = ${claimed.id}
	`;
	logAudit({
		userId, action: 'link_device', resourceId: device.id,
		meta: { device_kind: claimed.device_kind, label, credential_kind: issued.kind, credential_id: issued.id, scope: granted?.join(' ') || null, claim: claimed.claim },
		req,
	});
	return { ...publicCode({ ...claimed, result_kind: issued.kind, device_id: device.id }, { forOwner: true }), device: publicDevice(device), chat_notice: issued.chatNotice || null };
}

function narrowScopes(requested, wanted) {
	if (!requested) return null;
	const base = requested.split(' ').filter(Boolean);
	if (!wanted) return base;
	const list = Array.isArray(wanted) ? wanted : String(wanted).split(/[\s,]+/);
	const chosen = list.map((s) => String(s).trim()).filter(Boolean);
	const outside = chosen.filter((s) => !base.includes(s));
	if (outside.length) throw new LinkCodeError('scope_widened', `the device did not ask for ${outside.join(', ')}; a confirm can only narrow the request`);
	if (!chosen.length) throw new LinkCodeError('no_scope', 'keep at least one permission, or reject the request');
	return chosen;
}

function deviceLabel(row) {
	const c = row.claim || {};
	if (row.device_kind === 'telegram') {
		const t = c.telegram || {};
		return row.label || (t.username ? `@${t.username}` : t.chat_title || 'Telegram chat');
	}
	return row.label || c.name || c.client || DEVICE_LABELS[row.device_kind];
}

function deviceMeta(row, scopes) {
	const c = row.claim || {};
	return {
		platform: c.platform || null,
		client: c.client || null,
		ip: c.ip || null,
		user_agent: c.user_agent || null,
		scope: scopes ? scopes.join(' ') : null,
		...(c.telegram ? { telegram: c.telegram } : {}),
	};
}

async function issueCredential({ row, userId, scopes, req }) {
	const c = row.claim || {};
	switch (row.device_kind) {
		case 'phone': {
			const secret = await createSession({ userId, userAgent: c.user_agent || null, ip: c.ip || null });
			const [s] = await sql`select id from sessions where token_hash = ${await sha256(secret)} limit 1`;
			return { kind: 'session', id: s.id, secret };
		}
		case 'cli':
		case 'desktop': {
			const name = cleanText(row.label || c.name || `${DEVICE_LABELS[row.device_kind]} link`, 80);
			const { row: key, secret } = await mintApiKey({ userId, name, scopes, req, via: `link_code:${row.device_kind}` });
			return { kind: 'api_key', id: key.id, secret };
		}
		case 'telegram': {
			const t = c.telegram;
			if (!t?.chat_id || !t?.platform_user_id) throw new LinkCodeError('no_chat', 'this code was never sent from a Telegram chat', 409);
			let link;
			try {
				link = await createLink({
					platform: 'telegram', platformUserId: String(t.platform_user_id), platformUsername: t.username || null,
					chatId: String(t.chat_id), chatType: t.chat_type || null, chatTitle: t.chat_title || null, userId,
				});
			} catch (err) {
				if (err instanceof GatewayError) throw new LinkCodeError(err.code, err.message, err.status);
				throw err;
			}
			return { kind: 'gateway_link', id: link.id, secret: null, chatNotice: { chat_id: String(t.chat_id) } };
		}
		default:
			throw new LinkCodeError('invalid_kind', 'unknown device kind');
	}
}

// ── 4. consume (the device polls) ─────────────────────────────────────────────

/**
 * What the claiming device sees. On a confirmed row the credential secret is
 * handed over exactly once and wiped in the same statement that reads it.
 */
export async function pollLinkCode({ id, claimSecret }) {
	if (!id || !claimSecret) throw new LinkCodeError('unauthorized', 'claim secret required', 401);
	const hash = await sha256(claimSecret);
	const [row] = await sql`select * from account_link_codes where id = ${id} and claim_secret_hash = ${hash} limit 1`;
	if (!row) throw new LinkCodeError('unknown_claim', 'no such claim; the code may have been rejected', 404);
	if (row.status === 'claimed' && new Date(row.expires_at).getTime() <= Date.now()) {
		await sql`update account_link_codes set status = 'expired' where id = ${row.id} and status = 'claimed'`;
		return { status: 'expired', device_kind: row.device_kind };
	}
	if (row.status !== 'confirmed') return { status: row.status, device_kind: row.device_kind };
	const [done] = await sql`
		update account_link_codes
		set status = 'consumed', consumed_at = now(), result_secret = null, claim_secret_hash = null
		where id = ${row.id} and status = 'confirmed'
		returning result_kind, result_id, result_secret, device_id
	`;
	if (!done) return { status: 'consumed', device_kind: row.device_kind };
	return {
		status: 'confirmed',
		device_kind: row.device_kind,
		credential: { kind: done.result_kind, id: done.result_id, secret: done.result_secret },
		device_id: done.device_id,
	};
}

// ── devices ───────────────────────────────────────────────────────────────────

export function publicDevice(d) {
	return {
		id: d.id,
		kind: d.kind,
		kind_label: DEVICE_LABELS[d.kind],
		label: d.label,
		meta: d.meta || {},
		credential_kind: d.credential_kind,
		credential_id: d.credential_id,
		linked_at: d.linked_at,
		revoked_at: d.revoked_at,
		last_used_at: d.last_used_at || null,
		credential_live: d.credential_live ?? null,
	};
}

/** Every linked device with the live state of the credential behind it. */
export async function listLinkedDevices(userId) {
	const rows = await sql`
		select d.*,
		       coalesce(s.last_seen_at, k.last_used_at, g.last_seen_at) as last_used_at,
		       case d.credential_kind
		         when 'session' then (s.id is not null and s.revoked_at is null and s.expires_at > now())
		         when 'api_key' then (k.id is not null and k.revoked_at is null and (k.expires_at is null or k.expires_at > now()))
		         when 'gateway_link' then (g.id is not null and g.revoked_at is null)
		       end as credential_live
		from account_linked_devices d
		left join sessions s on d.credential_kind = 'session' and s.id = d.credential_id
		left join api_keys k on d.credential_kind = 'api_key' and k.id = d.credential_id
		left join gateway_links g on d.credential_kind = 'gateway_link' and g.id = d.credential_id
		where d.user_id = ${userId} and d.revoked_at is null
		order by d.linked_at desc
	`;
	return rows.map(publicDevice);
}

/** Revoke a device: its credential stops working on the next request. */
export async function revokeLinkedDevice({ id, userId, req = null }) {
	const [d] = await sql`select * from account_linked_devices where id = ${id} and user_id = ${userId} and revoked_at is null limit 1`;
	if (!d) throw new LinkCodeError('not_found', 'no such linked device', 404);
	switch (d.credential_kind) {
		case 'session':
			await sql`update sessions set revoked_at = now() where id = ${d.credential_id} and user_id = ${userId} and revoked_at is null`;
			break;
		case 'api_key':
			await sql`update api_keys set revoked_at = now() where id = ${d.credential_id} and user_id = ${userId} and revoked_at is null`;
			break;
		case 'gateway_link':
			await revokeLink(d.credential_id, userId);
			break;
	}
	const [done] = await sql`update account_linked_devices set revoked_at = now() where id = ${d.id} returning *`;
	logAudit({ userId, action: 'unlink_device', resourceId: d.id, meta: { kind: d.kind, label: d.label, credential_kind: d.credential_kind, credential_id: d.credential_id }, req });
	return publicDevice(done);
}
