// Route table for an agent's portfolio, in the v1 API contract
// (api/_lib/agents-v1/http.js: one envelope, per-route auth and scopes,
// rate limits). Mounted at /api/v1/agents/:id/portfolio by
// api/v1/agents/[id]/portfolio/index.js and [...path].js.
//
//   GET /agents/:id/portfolio          live valuation (records a snapshot)
//   GET /agents/:id/portfolio/history  net-worth snapshots + realized curve
//   GET /agents/:id/portfolio/pnl      realized/unrealized P&L by source
//
// Owner-only and wallet:read, because attribution reads the custody ledger.
// The same modules back the MCP tools get_portfolio, get_balance_history and
// get_pnl (api/_mcpagent/portfolio-tools.js).

import { apiError, requireUuid, intParam } from './agents-v1/http.js';
import { loadPortfolioAgent, portfolioWithSnapshot, getBalanceHistory, pnlDigest } from './portfolio-history.js';

function networkOf(query) {
	const n = query.network || 'mainnet';
	if (n !== 'mainnet' && n !== 'devnet') throw apiError(400, 'invalid_network', 'network must be mainnet or devnet.');
	return n;
}

async function ownedAgent(params, principal) {
	const agentId = requireUuid(params.id, 'agent');
	await loadPortfolioAgent(agentId, principal.userId);
	return agentId;
}

async function valued(params, principal, query) {
	const agentId = await ownedAgent(params, principal);
	const p = await portfolioWithSnapshot({ agentId, network: networkOf(query) });
	if (!p) throw apiError(404, 'not_found', 'No agent with that id.');
	return p;
}

export const portfolioRoutes = [
	{
		method: 'GET', path: '/agents/:id/portfolio', name: 'portfolio.get', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, query }) => valued(params, principal, query),
	},
	{
		method: 'GET', path: '/agents/:id/portfolio/history', name: 'portfolio.history', auth: 'required', scope: 'wallet:read',
		handler: async ({ params, principal, query }) => {
			const agentId = await ownedAgent(params, principal);
			return getBalanceHistory({
				agentId,
				network: networkOf(query),
				days: intParam(query.days, { name: 'days', min: 1, max: 365, fallback: 30 }),
				maxPoints: intParam(query.max_points, { name: 'max_points', min: 2, max: 500, fallback: 120 }),
			});
		},
	},
	{
		method: 'GET', path: '/agents/:id/portfolio/pnl', name: 'portfolio.pnl', auth: 'required', scope: 'wallet:read',
		handler: async ({ params, principal, query }) => pnlDigest(await valued(params, principal, query)),
	},
];
