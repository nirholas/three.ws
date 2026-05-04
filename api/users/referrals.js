import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, error, method, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	const userId = session?.id ?? bearer.userId;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const [user] = await sql`
		SELECT
			referral_code,
			referral_earnings_total
		FROM users
		WHERE id = ${userId}
	`;

	if (!user) {
		return error(res, 404, 'not_found', 'user not found');
	}

	const [referralCount] = await sql`
		SELECT COUNT(*) as count
		FROM users
		WHERE referred_by_id = ${userId}
	`;

	return json(res, 200, {
		referral_code: user.referral_code,
		referral_earnings_total: user.referral_earnings_total,
		referred_users_count: parseInt(referralCount.count, 10),
	});
});
