// POST /api/users/referral-claim — attribute a pending referral to the
// signed-in user.
//
// The email signup path attributes referrals inline (api/auth/[action].js),
// but the Privy / SIWS / SIWE wallet flows don't carry a referral code through
// their verify handshakes. This endpoint closes that gap: the client captures
// `?ref=CODE` at the door (public/referral-capture.js) and replays it here once
// the user has a session, regardless of which auth method they used.
//
// Attribution is one-shot and guarded:
//   • only when the account has no referrer yet (`referred_by_id IS NULL`)
//   • only for genuinely new accounts (created within ATTRIBUTION_WINDOW)
//   • never a self-referral, never an unknown code
//
// body: { code: string }
// → { status: 'claimed' | 'already' | 'invalid' | 'expired', referrer?: { name } }

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { requireCsrf } from '../_lib/csrf.js';
import { cors, json, error, method, wrap, rateLimited, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { insertNotification } from '../_lib/notify.js';
import { recordEvent } from '../_lib/usage.js';

// Canonical referral-code shape (api/_lib/referrals.js REFERRAL_CODE_RE): A–Z
// and 0–9, 3–20 chars. Accepts vanity codes (the member's name), not just the
// restricted alphabet the auto-generator draws from.
const CODE_RE = /^[A-Z0-9]{3,20}$/;

// How long after signup a referral can still be attributed. The once-only
// `referred_by_id IS NULL` guard does the heavy lifting; this window simply
// stops a long-time member from being credited to whoever's link they happen
// to click months later.
const ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (!(await requireCsrf(req, res, session.id))) return;

	const claimRl = await limits.referralClaimIp(clientIp(req));
	if (!claimRl.success) return rateLimited(res, claimRl);

	const body = await readJson(req);
	const code = String(body?.code || '').trim().toUpperCase();
	if (!CODE_RE.test(code)) return error(res, 400, 'invalid_code', 'malformed referral code');

	const [me] = await sql`
		SELECT id, referred_by_id, created_at, referral_code, display_name
		FROM users WHERE id = ${session.id} AND deleted_at IS NULL
	`;
	if (!me) return error(res, 404, 'not_found', 'user not found');

	// Already attributed — idempotent success, nothing to do.
	if (me.referred_by_id != null) return json(res, 200, { status: 'already' });

	// You can't refer yourself.
	if (me.referral_code && me.referral_code.toUpperCase() === code) {
		return json(res, 200, { status: 'invalid' });
	}

	// Only fresh accounts can be attributed.
	const ageMs = Date.now() - new Date(me.created_at).getTime();
	if (!Number.isFinite(ageMs) || ageMs > ATTRIBUTION_WINDOW_MS) {
		return json(res, 200, { status: 'expired' });
	}

	const [referrer] = await sql`
		SELECT id, display_name, username
		FROM users
		WHERE UPPER(referral_code) = ${code} AND id <> ${me.id} AND deleted_at IS NULL
		LIMIT 1
	`;
	if (!referrer) return json(res, 200, { status: 'invalid' });

	// Atomic set-once: the WHERE guard means a concurrent claim can't double-set.
	const [updated] = await sql`
		UPDATE users SET referred_by_id = ${referrer.id}
		WHERE id = ${me.id} AND referred_by_id IS NULL
		RETURNING id
	`;
	if (!updated) return json(res, 200, { status: 'already' });

	insertNotification(referrer.id, 'referral_signup', {
		referred_user_id: me.id,
		referred_name: me.display_name || null,
	});

	// Funnel: a referred signup just landed. Mirrors the inline-attribution event
	// in api/auth/[action].js so visit→signup is measurable across every auth path.
	recordEvent({
		userId: referrer.id,
		kind: 'referral_signup',
		meta: { referred_user_id: String(me.id), source: 'claim' },
	});

	const referrerName = referrer.display_name || referrer.username || null;
	return json(res, 200, { status: 'claimed', referrer: { name: referrerName } });
});
