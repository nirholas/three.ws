// @ts-check
// The single authorization gate for the ops API surfaces (/api/ops/health,
// /api/ops/payment-outcomes). One helper so all of them use
// identical, auditable rules — no drift, no weaker second door.
//
// These surfaces expose internal state: endpoint/cron topology, wallet
// addresses, tx signatures, key-rotation hints, and stack traces. So the gate
// is strict and FAILS CLOSED in production. Two ways in:
//
//   1. A signed-in platform admin: session + admin wallet (the requireAdmin
//      model: wallet in ADMIN_ADDRESSES, the built-in owner address, or
//      is_admin in the DB) whose session passed a second factor
//      (admin-mfa.js). The strongest path and the only one that yields a real
//      per-user identity for audit trails. An admin session without one
//      falls through to the secret path below.
//
//   2. A dedicated OPS_SECRET presented as `x-ops-secret` (or `Authorization:
//      Bearer`). This is intentionally NOT CRON_SECRET: the ops dashboard must
//      never share a credential with the crons that move real funds, so a
//      leaked ops password can't be escalated into triggering a payment job.
//      Store OPS_SECRET in Secret Manager, high-entropy.
//
// With neither present the request is denied in production; it is allowed only
// off-production (local dev, where no secret is configured) so the dashboard is
// usable without secrets on a developer's machine.

import { constantTimeEquals } from './crypto.js';
import { getSessionUser } from './auth.js';
import { isAdminUser } from './admin.js';
import { mfaEnforced, sessionPassedMfa, adminSessionIdle } from './admin-mfa.js';
import { logAudit } from './audit.js';
import { sendOpsAlert } from './alerts.js';

// Read process.env directly, not the `env` façade: OPS_SECRET has no getter on
// `env`, so `env.OPS_SECRET` is always undefined (the pre-existing bug that made
// the old `env.OPS_SECRET || env.CRON_SECRET` silently fall through to
// CRON_SECRET). Evaluated per-call so a test or a runtime env change is honoured.
function isProd() {
	return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

/**
 * A wrong OPS_SECRET is a failed privileged-access attempt: audit it and alert
 * the operator (deduplicated per path). The presented value is never logged.
 * @param {{ method?: string, url?: string }} req
 */
function recordRejectedSecret(req) {
	const method = String(req.method || 'GET').toUpperCase();
	const path = String(req.url || '').split('?')[0];
	logAudit({ userId: null, action: 'ops_secret_rejected', meta: { method, path }, req });
	sendOpsAlert('Rejected OPS_SECRET attempt', `${method} ${path}`, {
		signature: `ops-secret-rejected:${path}`,
	});
}

/**
 * @param {import('http').IncomingMessage & { headers: Record<string,string|undefined> }} req
 * @returns {Promise<{ ok: boolean, actor: string, mfaRequired?: boolean }>} actor
 *   identifies who was authorized (admin wallet, `ops-secret`, or `dev`) for
 *   attribution. mfaRequired is true on a denial when the caller is a signed-in
 *   admin whose session has not passed a second factor; answer it with
 *   respondMfaRequired (admin-mfa.js) so the UI can send them to /login/verify.
 */
export async function authorizeOps(req) {
	let mfaRequired = false;
	// 1. Signed-in platform admin — preferred, carries a real identity.
	try {
		const user = await getSessionUser(req);
		if (user && (await isAdminUser(user)) && !adminSessionIdle(user)) {
			if (!mfaEnforced() || (await sessionPassedMfa(user.sid))) {
				return { ok: true, actor: user.wallet_address || `user:${user.id}` };
			}
			mfaRequired = true;
		}
	} catch {
		/* no / invalid session — fall through to the secret path */
	}

	// 2. Dedicated OPS_SECRET. Never CRON_SECRET.
	const secret = process.env.OPS_SECRET;
	if (secret) {
		const header =
			req.headers['x-ops-secret'] ||
			(typeof req.headers['authorization'] === 'string'
				? req.headers['authorization'].replace(/^Bearer\s+/i, '')
				: '');
		if (header && constantTimeEquals(header, secret)) return { ok: true, actor: 'ops-secret' };
		if (header) recordRejectedSecret(req);
		return { ok: false, actor: '' };
	}

	// 3. No secret configured: dev-only open, production denies.
	if (isProd()) return { ok: false, actor: 'dev', mfaRequired };
	return { ok: true, actor: 'dev' };
}
