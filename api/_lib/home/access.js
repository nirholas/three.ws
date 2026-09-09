// Who is allowed to touch a home, resolved once, for every /api/home/* route.
//
// Three things go wrong when each route answers this for itself, and all three
// have shipped in real products:
//
//   1. One route authenticates with a session and another forgets the bearer
//      path, so the agent lane silently 401s (or worse, the reverse).
//   2. One route checks ownership with a `WHERE user_id` and another fetches the
//      row and compares in JavaScript. The second one is a tenancy bug waiting
//      for a refactor to drop the comparison.
//   3. One route answers 403 for somebody else's home. A 403 confirms the id is
//      real, which turns a list of uuids into an oracle for "is this a house".
//      Across a tenancy boundary the answer is always 404.
//
// So: `resolveHomeAccess` is the only door. It authenticates, it reads the home
// through the store's ownership-filtered query, and it returns a discriminated
// result rather than throwing, because the caller is the only code that knows
// whether it is answering an SSE stream or a JSON POST.

import { authenticateBearer, extractBearer, getSessionUser, hasScope } from '../auth.js';

import { can, filterGraphForScope, normalizeScope, outOfScopeEntities } from './members.js';
import { getConnection } from './store.js';

/**
 * Who is calling. Session first, then bearer, because a browser sends both a
 * cookie and (on the agent lane) nothing else, and checking the cookie first
 * keeps the common path off the token verification.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} [res]
 * @returns {Promise<{ userId: string, via: 'session'|'bearer', scope: string|null }|null>}
 */
export async function resolveCaller(req, res) {
	const session = await getSessionUser(req, res).catch(() => null);
	if (session) return { userId: session.id, via: 'session', scope: null };

	const bearer = await authenticateBearer(extractBearer(req)).catch(() => null);
	if (bearer) return { userId: bearer.userId, via: 'bearer', scope: bearer.scope ?? null };

	return null;
}

/**
 * The OAuth scope a capability needs from a bearer principal.
 *
 * `home:read` and `home:act` are named on the consent screen the user approves,
 * so a token that was never granted one must not reach the surface behind it.
 * Reading is `home:read`; everything that changes a house, its roster, its
 * layout or its standing allowances is `home:act`, because each of them is a
 * write to somebody's building.
 *
 * A session principal is not scoped: the person is present, and the scopes exist
 * to narrow what a DELEGATE may do on their behalf.
 */
const CAPABILITY_SCOPE = Object.freeze({
	read: 'home:read',
	act: 'home:act',
	confirm: 'home:act',
	grant: 'home:act',
	layout: 'home:act',
	invite: 'home:act',
	manage: 'home:act',
	disconnect: 'home:act',
});

/**
 * Whether this caller may assert `confirmed: true`, the flag that stands for a
 * human saying yes to opening a building.
 *
 * Only a browser session can. This is the same rule `api/home/:id/confirm.js`
 * enforces for redeeming a minted confirmation, applied to the other half of the
 * protocol: the routes that accept a confirmation inline. Without it the whole
 * gate is optional, because `requireCsrf` exempts bearer callers by design (a
 * token is not auto-attached by a browser, so there is nothing to forge), and a
 * bearer caller could therefore write `confirmed: true` into a body and open a
 * front door with no person anywhere in the request. Measured, before this
 * existed: an API key holding only the `profile` scope unlocked a real deadbolt.
 *
 * `home:act` authorises ASKING to act. It has never authorised answering the
 * question, and the consent screen says so in those words.
 *
 * @param {{ via?: string }|null} caller
 */
export function canAssertConfirmation(caller) {
	return caller?.via === 'session';
}

/** The refusal a non-session principal gets when it claims a confirmation. */
export const CONFIRMATION_REQUIRES_SESSION = Object.freeze({
	status: 403,
	code: 'confirmation_requires_session',
	message:
		'A guarded action can only be confirmed by a signed-in person in a browser session. A bearer token, including one holding home:act, can ask to act and can never say yes on the account holder\'s behalf.',
});

/**
 * Authenticate, then resolve one home this caller is entitled to, for a named
 * capability.
 *
 * Two different refusals, and the difference is deliberate:
 *
 *   404  the caller is not in this household (or there is no such home, or it
 *        was disconnected). Indistinguishable on purpose: a 403 here would
 *        confirm the id is real and turn a list of uuids into an oracle for
 *        "is this a house".
 *   403  the caller IS in the household and their role does not hold this
 *        capability. Naming the role is safe, and it is the only answer that
 *        lets a guest refused an unlock understand it is their role rather than
 *        a broken door.
 *
 * `capability` defaults to `read` because every route on this surface needs at
 * least that, and a route that forgets to name one therefore fails closed at the
 * weakest useful level rather than open.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} homeId from `req.query.id`
 * @param {string} [capability] one of HOME_CAPABILITIES in ./members.js
 * @returns {Promise<
 *   | { ok: true, caller: object, home: object, role: string, scope: object, scoped: boolean }
 *   | { ok: false, status: 401, code: 'unauthorized', message: string }
 *   | { ok: false, status: 404, code: 'not_found', message: string }
 *   | { ok: false, status: 403, code: 'insufficient_scope', message: string }
 *   | { ok: false, status: 403, code: 'role_forbidden', message: string, role: string }
 * >}
 */
export async function resolveHomeAccess(req, res, homeId, capability = 'read') {
	const caller = await resolveCaller(req, res);
	if (!caller) {
		return { ok: false, status: 401, code: 'unauthorized', message: 'Sign in to reach your home.' };
	}

	// The scope gate, and it runs BEFORE the home is read on purpose. It depends
	// on nothing but the token, so it names a principal and never a house, and
	// answering it first keeps a token that was never granted home access off the
	// tenancy lookup entirely.
	const required = CAPABILITY_SCOPE[capability];
	if (caller.via === 'bearer' && required && !hasScope(caller.scope, required)) {
		return {
			ok: false,
			status: 403,
			code: 'insufficient_scope',
			message: `${required} required. This token was not granted it.`,
			caller,
		};
	}

	// A malformed id is answered exactly like a real id you are not in. A 400
	// here would tell an unauthenticated prober which of their guesses were even
	// shaped like a home id.
	const home = homeId ? await getConnection(homeId, caller.userId) : null;
	if (!home) {
		return { ok: false, status: 404, code: 'not_found', message: 'No such home.', caller };
	}

	const role = home.role;
	const scope = normalizeScope(home.entity_scope, role);

	if (capability && !can(role, capability)) {
		return {
			ok: false,
			status: 403,
			code: 'role_forbidden',
			message: `${article(role)} cannot ${capability} in this home.`,
			role,
			capability,
			caller,
			home,
		};
	}

	return { ok: true, caller, home, role, scope, scoped: scope.mode !== 'all' };
}

/** "an admin" / "a member": role names reach users as copy, not as identifiers. */
function article(role) {
	return /^[aeiou]/i.test(String(role)) ? `an ${role}` : `a ${role}`;
}

/**
 * The room graph as this member is allowed to see it.
 *
 * Re-exported from ./members.js through this module so every route reaches
 * scope filtering from the same import it already uses for access, and a route
 * that renders a graph without filtering it reads as an obvious omission rather
 * than as one missing import among many.
 */
export { filterGraphForScope, outOfScopeEntities };

/**
 * The credential-free projection every route returns for a home.
 *
 * Built here rather than in each route so a new column added to the table does
 * not leak by default: a field reaches a client because it is listed below, not
 * because it happened to be on the row. `access_token_enc` never reaches this
 * function at all (the store's SAFE_COLUMNS drops it in SQL), so this is the
 * second of two independent guards, not the only one.
 *
 * @param {object} row a row from api/_lib/home/store.js
 */
export function publicHome(row) {
	if (!row) return null;
	return {
		id: row.id,
		label: row.label,
		base_url: row.base_url,
		transport: row.transport,
		relay_id: row.relay_id ?? null,
		status: row.status,
		status_detail: row.status_detail ?? null,
		capabilities: row.capabilities ?? {},
		last_ok_at: row.last_ok_at ?? null,
		last_error_at: row.last_error_at ?? null,
		created_at: row.created_at,
		updated_at: row.updated_at,
		revoked_at: row.revoked_at ?? null,
	};
}
