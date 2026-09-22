// Who is calling a custody route, and are they allowed to act on this agent?
//
// A browser session carries every scope. A bearer caller (API key or OAuth
// access token) must hold the scope the route names: `wallet:read` for reads,
// `wallet:write` for anything that builds, signs, or submits a transaction.
// `wallet:write` satisfies a `wallet:read` requirement.

import { sql } from '../db.js';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../auth.js';

export class CustodyHttpError extends Error {
	constructor(status, code, message, detail = null) {
		super(message);
		this.status = status;
		this.code = code;
		this.detail = detail;
		this.expose = true;
	}
}

/**
 * Resolve the caller. Returns null when nobody is signed in.
 * @returns {Promise<{ userId: string, via: 'session'|'bearer', scope: string|null } | null>}
 */
export async function resolvePrincipal(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id, via: 'session', scope: null };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId, via: 'bearer', scope: bearer.scope || '' };
	return null;
}

/** True when the principal may perform an action needing `scope`. */
export function principalHas(principal, scope) {
	if (!principal) return false;
	if (principal.via === 'session') return true;
	if (hasScope(principal.scope, scope)) return true;
	return scope === 'wallet:read' && hasScope(principal.scope, 'wallet:write');
}

/**
 * Require a signed-in principal holding `scope`.
 * @throws {CustodyHttpError}
 */
export async function requirePrincipal(req, scope) {
	const principal = await resolvePrincipal(req);
	if (!principal) throw new CustodyHttpError(401, 'unauthorized', 'Sign in to three.ws first.');
	if (!principalHas(principal, scope)) {
		throw new CustodyHttpError(403, 'insufficient_scope', `This token needs the ${scope} scope.`, { scope });
	}
	return principal;
}

/**
 * Load an agent the principal owns. 404 for a missing agent, 403 for someone
 * else's, so a caller never learns more than "not yours".
 * @throws {CustodyHttpError}
 */
export async function loadOwnedAgent(agentId, userId) {
	const [row] = await sql`
		SELECT id, user_id, name, meta
		FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) throw new CustodyHttpError(404, 'not_found', 'Agent not found.');
	if (row.user_id !== userId) throw new CustodyHttpError(403, 'forbidden', 'This agent belongs to another account.');
	return { ...row, meta: { ...(row.meta || {}) } };
}
