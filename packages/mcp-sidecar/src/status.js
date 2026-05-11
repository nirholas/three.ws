import { loadConfig, configPath } from './config.js';
import { spendStats } from './spend.js';
import { cacheStats } from './cache.js';
import { fetchRemoteTools } from './proxy.js';

export async function runStatus() {
	const cfg = loadConfig();

	let remoteToolCount = null;
	let remoteReachable = false;
	try {
		const tools = await fetchRemoteTools(cfg);
		remoteToolCount = tools.length;
		remoteReachable = true;
	} catch {
		// connectivity check only — ignore error
	}

	const out = {
		config: {
			path: configPath(),
			remote: cfg.remote,
			network: cfg.network,
			api_key: cfg.apiKey ? `****${cfg.apiKey.slice(-4)}` : null,
			spend_limit_usdc: cfg.spendLimitUsdc,
			cache_enabled: cfg.cache?.enabled !== false,
		},
		remote: {
			reachable: remoteReachable,
			tool_count: remoteToolCount,
		},
		session: spendStats(),
		cache: cacheStats(),
	};

	process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
