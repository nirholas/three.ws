// GET /api/fresh-workers: public statistics for the fresh-wallet workers lane.
//
// How many never-used wallets were minted, paid and closed in the last day,
// what they bought (3D props vs datasets), the USDC that recirculated, the SOL
// actually burned as network fees, the rent that round-tripped, and the most
// recent wallets with their funding, payment and sweep signatures. Public and
// key-free by design: the whole point of the lane is that every purchase is
// verifiable on chain.

import { sql, isDbUnavailableError } from './_lib/db.js';
import { cors, json, method, serverError, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { cacheGet, cacheSet } from './_lib/cache.js';
import { explorerTxUrl } from './_lib/avatar-wallet.js';
import { laneStats } from './_lib/x402/fresh-workers/wallets.js';
import { freshWorkersConfig } from './_lib/x402/fresh-workers/plan.js';

const TTL_S = 15;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.publicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://localhost');
	const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
	const cacheKey = `fresh-workers:${limit}`;
	const cached = await cacheGet(cacheKey);
	if (cached) return json(res, 200, cached, { 'cache-control': `public, max-age=${TTL_S}` });

	try {
		const [stats, rows] = await Promise.all([
			laneStats(sql),
			sql`
				SELECT id, pubkey, state, job_kind, job_slug, job_title, amount_atomic, fund_sig, pay_sig, sweep_sig,
				       sol_funded_lamports, sol_reclaimed_lamports, rent_reclaimed_lamports, error, created_at, closed_at
				FROM x402_fresh_wallets ORDER BY created_at DESC LIMIT ${limit}`,
		]);
		const cfg = freshWorkersConfig();
		const payload = {
			enabled: cfg.enabled,
			cadence: { wallets_per_minute: cfg.perTick, forge_every_n_ticks: cfg.forgeEveryNTicks, daily_cap_usdc: cfg.dailyCapAtomic / 1e6 },
			...stats,
			wallets: rows.map((r) => ({
				pubkey: r.pubkey,
				state: r.state,
				job_kind: r.job_kind,
				job_slug: r.job_slug,
				job_title: r.job_title,
				price_usdc: Number(r.amount_atomic || 0) / 1e6,
				sol_fees: r.state === 'closed' ? Math.max(0, Number(r.sol_funded_lamports || 0) - Number(r.sol_reclaimed_lamports || 0)) / 1e9 : null,
				rent_recycled_sol: Number(r.rent_reclaimed_lamports || 0) / 1e9,
				fund_tx: r.fund_sig ? explorerTxUrl(r.fund_sig) : null,
				pay_tx: r.pay_sig ? explorerTxUrl(r.pay_sig) : null,
				sweep_tx: r.sweep_sig ? explorerTxUrl(r.sweep_sig) : null,
				error: r.error,
				created_at: r.created_at,
				closed_at: r.closed_at,
			})),
		};
		await cacheSet(cacheKey, payload, TTL_S);
		return json(res, 200, payload, { 'cache-control': `public, max-age=${TTL_S}` });
	} catch (err) {
		if (isDbUnavailableError(err)) {
			return json(res, 503, { error: 'db_unavailable', error_description: 'Briefly unavailable. Retry shortly.' }, { 'cache-control': 'no-store', 'retry-after': '5' });
		}
		return serverError(res, 500, 'fresh_workers_error', err);
	}
}
