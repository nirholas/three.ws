// JSON-RPC dispatch for the Oracle MCP server: the shared payment-free
// dispatcher (api/_lib/mcp-dispatch.js) bound to this server's catalog.
import { makeDispatcher, PROTOCOL_VERSION } from '../_lib/mcp-dispatch.js';
import { TOOL_CATALOG, TOOLS } from './catalog.js';

export { PROTOCOL_VERSION };
export { isPublicTool } from './catalog.js';

const INSTRUCTIONS = [
	'Oracle scores pump.fun launches 0-100 and tiers them prime, strong, lean, watch or avoid.',
	'Start with oracle_stats and oracle_backtest to see how much the signal has earned, then oracle_top_plays for the board',
	'and oracle_coin for one mint. Every read is free. A transient error means the data store is degraded, not that the market is empty: retry.',
	'oracle_arm_watch arms your agent to act on the stream inside a spend limit; it defaults to simulate and live mainnet needs signed agreements.',
].join(' ');

export const dispatch = makeDispatcher({
	serverInfo: { name: 'three-ws-oracle', version: '1.0.0' },
	instructions: INSTRUCTIONS,
	catalog: TOOL_CATALOG,
	tools: TOOLS,
	logName: 'mcp-oracle',
});
