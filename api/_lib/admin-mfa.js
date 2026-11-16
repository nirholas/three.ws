// Admin two-factor policy.
//
// Microsoft 365 Certification OS 16 makes MFA on administrative interfaces a
// hard requirement. three.ws has one authenticator per person: account
// two-step verification (api/_lib/account-mfa.js, an authenticator app plus
// recovery codes, enabled under Settings, Security). This module is only the
// admin rule on top of it: an admin request is honoured when the session it
// rides on passed a second factor, which happens at sign-in (/login/verify),
// by step-up on a signed-in session, or through Microsoft Entra MFA reported in
// the sign-in token. requireAdmin (admin.js), the ops gate (ops-auth.js) and
// isVerifiedAdmin all apply it; an admin without two-step on gets the same
// answer and /login/verify sends them to Settings to turn it on.
//
// Emergency switch: ADMIN_MFA_ENFORCE=0 disables the rule (for example if the
// owner loses both their authenticator and their recovery codes). Every admin
// write it waves through is still audited by requireAdmin, and the switch is
// itself an env change recorded in Cloud Audit Logs.

import { sql } from './db.js';
import { error } from './http.js';

export const MFA_VERIFY_URL = '/login/verify';

export function mfaEnforced() {
	return process.env.ADMIN_MFA_ENFORCE !== '0';
}

/** The one answer every admin gate gives a session that has not passed a second factor. */
export function respondMfaRequired(res) {
	return error(res, 403, 'mfa_required', 'admin access needs a session that passed two-step verification', {
		verify_url: MFA_VERIFY_URL,
	});
}

/** True when the session passed a second factor (sessions.mfa_verified_at). */
export async function sessionPassedMfa(sid) {
	if (!sid) return false;
	const rows = await sql`select mfa_verified_at from sessions where id = ${sid} limit 1`;
	return Boolean(rows[0]?.mfa_verified_at);
}
