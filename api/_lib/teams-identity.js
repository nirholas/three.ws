// Who a Teams person is on three.ws, for Teams activity feed notifications
// (api/_lib/teams-activity.js).
//
// Two facts are needed before a notification can reach someone's Teams bell:
// the app is installed for them (Graph rejects the call otherwise), and we know
// which three.ws account they are. Both come from the Bot Framework activities
// the bot already receives after verifying the token:
//
//   installationUpdate add/remove, and any message   -> install state
//   `link <code>` typed to the bot                   -> three.ws account
//
// The code is minted for the signed-in account (POST /api/notifications/teams),
// lives ten minutes and works once, so the person proving they control the
// three.ws account and the person proving they control the Teams identity are
// the same human. Uninstalling clears the mapping.

import { randomInt } from 'node:crypto';
import { sql } from './db.js';
import { cacheDel, cacheGetFresh, cacheSet, cacheSetIfAbsent } from './cache.js';

export const LINK_CODE_TTL_S = 600;
// No 0/O/1/I/L: the code is read off a screen and typed into a chat.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const codeKey = (code) => `teams-link:${code}`;
const usedKey = (code) => `teams-link-used:${code}`;

/** The Teams person an activity came from, or null when it names no Entra identity. */
export function identityOf(activity) {
	const tenantId = activity?.channelData?.tenant?.id || activity?.conversation?.tenantId || '';
	const aadObjectId = activity?.from?.aadObjectId || '';
	if (!GUID.test(tenantId) || !GUID.test(aadObjectId)) return null;
	return { tenantId: tenantId.toLowerCase(), aadObjectId: aadObjectId.toLowerCase() };
}

/** Normalise what a person typed ("abcd-efgh", " ABCDEFGH ") to a code, or null. */
export function normalizeCode(text) {
	const code = String(text || '').toUpperCase().replace(/[\s-]/g, '');
	return code.length === CODE_LEN && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** "ABCD-EFGH" for display. */
export function formatCode(code) {
	return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** The code in a `link <code>` bot message, or null for any other text. */
export function linkCommandCode(text) {
	const m = /^\/?link(?:\s+([\s\S]*))?$/i.exec(String(text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim());
	return m ? normalizeCode(m[1] || '') ?? '' : null;
}

/** Record that the app is installed for this person (a message proves it too). */
export async function markInstalled(identity) {
	if (!identity) return;
	await sql`
		insert into teams_identities (tenant_id, aad_object_id, installed)
		values (${identity.tenantId}, ${identity.aadObjectId}, true)
		on conflict (tenant_id, aad_object_id) do update set
			installed = true, last_error_code = null, last_error_at = null, updated_at = now()
	`;
}

/** Uninstall: the person can no longer be notified, so the account link goes too. */
export async function markUninstalled(identity) {
	if (!identity) return;
	await sql`
		update teams_identities
		set installed = false, user_id = null, linked_at = null, updated_at = now()
		where tenant_id = ${identity.tenantId} and aad_object_id = ${identity.aadObjectId}
	`;
}

/** Mint a one-time link code for a signed-in account. */
export async function createLinkCode(userId) {
	let code = '';
	for (let i = 0; i < CODE_LEN; i++) code += ALPHABET[randomInt(ALPHABET.length)];
	await cacheSet(codeKey(code), { userId }, LINK_CODE_TTL_S);
	return { code, display: formatCode(code), expiresInSeconds: LINK_CODE_TTL_S };
}

/**
 * Redeem a code for the Teams person who typed it. Resolves to the linked
 * `userId`, or null when the code is unknown, expired or already used.
 */
export async function redeemLinkCode(code, identity) {
	if (!code || !identity) return null;
	const entry = await cacheGetFresh(codeKey(code));
	if (!entry?.userId) return null;
	if (!(await cacheSetIfAbsent(usedKey(code), 1, LINK_CODE_TTL_S))) return null;
	await cacheDel(codeKey(code)).catch(() => {});
	await sql`
		insert into teams_identities (tenant_id, aad_object_id, user_id, installed, linked_at)
		values (${identity.tenantId}, ${identity.aadObjectId}, ${entry.userId}, true, now())
		on conflict (tenant_id, aad_object_id) do update set
			user_id = ${entry.userId}, installed = true, linked_at = now(),
			last_error_code = null, last_error_at = null, updated_at = now()
	`;
	return entry.userId;
}

/** Remove the link from three.ws's side (the person keeps the app installed). */
export async function unlinkUser(userId) {
	await sql`
		update teams_identities set user_id = null, linked_at = null, updated_at = now()
		where user_id = ${userId}
	`;
}

/** Every Teams identity an account linked and that can still be notified. */
export async function identitiesForUser(userId) {
	return sql`
		select tenant_id, aad_object_id, installed, linked_at, last_sent_at, last_error_code, last_error_at
		from teams_identities where user_id = ${userId} order by linked_at desc nulls last
	`;
}

/** The linked account for a Teams person, or null. */
export async function userForIdentity(identity) {
	if (!identity) return null;
	const [row] = await sql`
		select user_id from teams_identities
		where tenant_id = ${identity.tenantId} and aad_object_id = ${identity.aadObjectId}
		  and installed = true and user_id is not null
	`;
	return row?.user_id ?? null;
}

export async function recordSent(identity) {
	await sql`
		update teams_identities set last_sent_at = now(), last_error_code = null, last_error_at = null
		where tenant_id = ${identity.tenantId} and aad_object_id = ${identity.aadObjectId}
	`;
}

/**
 * Remember a permanent failure once. A recipient the app is no longer
 * installed for is also marked uninstalled, so the next event skips the call.
 */
export async function recordFailure(identity, code) {
	await sql`
		update teams_identities set
			last_error_code = ${code}, last_error_at = now(),
			installed = case when ${code} = 'not_installed' then false else installed end,
			updated_at = now()
		where tenant_id = ${identity.tenantId} and aad_object_id = ${identity.aadObjectId}
	`;
}
