/**
 * GET /api/agents/pumpfun
 * -----------------------
 * Read-only proxy to the upstream pumpfun-claims-bot MCP server. Backs the
 * `pumpfun-recent-claims` and `pumpfun-token-intel` skills, plus any external
 * MCP client that wants enriched pump.fun intel without standing up its own
 * indexer.
 *
 * Query:
 *   ?op=claims        &limit=10
 *   ?op=graduations   &limit=10
 *   ?op=token         &mint=<base58>
 *   ?op=creator       &wallet=<base58>
 *
 * Auth: session OR bearer (scope `mcp` or `profile`).
 * Cache: per-op, short TTL handled in api/_lib/pumpfun-mcp.js.
 */

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, json, method, error, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { pumpfunMcp, pumpfunBotEnabled } from '../_lib/pumpfun-mcp.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) return error(res, 401, 'unauthorized', 'sign in required');
	if (bearer && !hasScope(bearer.scope, 'mcp') && !hasScope(bearer.scope, 'profile')) {
		return error(res, 403, 'insufficient_scope', 'requires mcp or profile scope');
	}

	const userId = session?.id ?? bearer.userId;
	const rl = await limits.mcpUser(String(userId));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const op = url.searchParams.get('op') || 'claims';
	const limit = clamp(Number(url.searchParams.get('limit')) || 10, 1, 50);

	// Soft-degrade to empty data when the upstream feed isn't configured —
	// callers get a usable 200 rather than a noisy 503 on every poll.
	if (!pumpfunBotEnabled()) {
		const empty = op === 'token' || op === 'creator' ? {} : { items: [] };
		return json(res, 200, empty);
	}

	let result;
	switch (op) {
		case 'claims':
			result = await pumpfunMcp.recentClaims({ limit });
			break;
		case 'graduations':
			result = await pumpfunMcp.graduations({ limit });
			break;
		case 'token': {
			const mint = url.searchParams.get('mint');
			if (!mint) return error(res, 400, 'validation_error', 'mint required');
			result = await pumpfunMcp.tokenIntel({ mint });
			break;
		}
		case 'creator': {
			const wallet = url.searchParams.get('wallet');
			if (!wallet) return error(res, 400, 'validation_error', 'wallet required');
			result = await pumpfunMcp.creatorIntel({ wallet });
			break;
		}
		default:
			return error(res, 400, 'validation_error', 'unknown op');
	}

	if (!result.ok) {
		return error(res, 502, 'upstream_error', result.error || 'pumpfun bot unavailable');
	}

	const payload = Array.isArray(result.data) ? { items: result.data } : result.data;
	return json(res, 200, payload);
});

function clamp(n, lo, hi) {
	return Math.max(lo, Math.min(hi, n));
}
