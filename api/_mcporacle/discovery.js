// 401/402 challenge metadata for the hosted Oracle MCP endpoint. The read tools
// are free and answer without credentials; this block is what an unauthenticated
// call to an account-scoped tool (arming an agent) sees, so the challenge names
// the Oracle server rather than inheriting the main /api/mcp envelope.

import { withService } from '../_lib/x402/bazaar-helpers.js';

export const RESOURCE_DESCRIPTION =
	'three.ws Oracle MCP: Streamable HTTP (MCP 2025-06-18) for the Oracle conviction signal on pump.fun launches. ' +
	'Free read tools need no account: oracle_top_plays, oracle_coin, oracle_feed, oracle_search, oracle_movers, ' +
	'oracle_wins, oracle_backtest, oracle_calibration, oracle_leaderboard, oracle_wallet, oracle_stats. ' +
	'oracle_arm_watch and oracle_watch_status need a three.ws account (OAuth) and arm an agent to act on the live stream ' +
	'inside a spend limit. Live mainnet arming additionally requires the signed real-funds agreements. Operated by three.ws.';

export const ORACLE_CHALLENGE = {
	description: RESOURCE_DESCRIPTION,
	...withService({
		serviceName: 'three.ws Oracle MCP',
		tags: ['oracle', 'mcp', 'solana', 'pump.fun', 'signals'],
	}),
};
