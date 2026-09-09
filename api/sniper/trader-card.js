/**
 * Trader card: the compact, embeddable read of one trader's record.
 *
 *   GET /api/sniper/trader-card?agent=<uuid>&network=mainnet&window=30d&ref=<code>
 *
 * What `<trader-card>` (public/trader-card/element.js) renders on a third-party
 * page, and small enough to be worth putting there: the headline record, the
 * last few closed round-trips, whatever is open right now, and absolute links
 * back into three.ws to fork a coin or ghost-copy the trader.
 *
 * Same truth layer as the leaderboard and the profile (`getTraderStats`), so an
 * embedded card cannot claim a record three.ws would dispute. Public, CORS open
 * by design (an embed is cross-origin by definition) and IP rate-limited.
 */

import { cors, json, method, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getTraderStats, WINDOWS } from '../_lib/trader-stats.js';
import { buildTraderCard } from '../_lib/trader-card.js';
import { isUuid } from '../_lib/validate.js';

const NETWORKS = new Set(['mainnet', 'devnet']);
// Referral codes travel from the widget into every link it renders, so the value
// is bounded and character-checked before it is ever put in a URL.
const REF_RE = /^[A-Za-z0-9_-]{1,32}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const params = new URL(req.url, `http://${req.headers.host || 'x'}`).searchParams;
	const agentId = (params.get('agent') || params.get('agent_id') || '').trim();
	if (!isUuid(agentId)) {
		return error(res, 400, 'invalid_agent', 'agent must be a valid agent UUID');
	}
	const rawNetwork = params.get('network');
	if (rawNetwork && !NETWORKS.has(rawNetwork)) {
		return error(res, 400, 'invalid_network', 'network must be mainnet or devnet');
	}
	const rawWindow = params.get('window');
	if (rawWindow && !WINDOWS.has(rawWindow)) {
		return error(res, 400, 'invalid_window', `window must be one of ${[...WINDOWS].join(', ')}`);
	}
	const ref = params.get('ref');
	if (ref && !REF_RE.test(ref)) {
		return error(res, 400, 'invalid_ref', 'ref must be 1 to 32 letters, digits, hyphens or underscores');
	}

	const stats = await getTraderStats({
		agentId,
		network: rawNetwork || 'mainnet',
		window: rawWindow || '30d',
	});
	if (!stats || !stats.agent.is_public) {
		return error(res, 404, 'not_found', 'No such agent, or it is not public.');
	}

	const card = buildTraderCard(stats, { ref: ref || null });
	return json(res, 200, card, { 'cache-control': 'public, max-age=60, s-maxage=120' });
});
