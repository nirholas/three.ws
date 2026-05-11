import { createInterface } from 'readline';
import { loadConfig, saveConfig, configPath } from './config.js';
import { runOAuthFlow } from './auth.js';

function ask(rl, question) {
	return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

export async function runInit() {
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	const current = loadConfig();

	const hr = '─'.repeat(40);
	process.stderr.write(`\nthree.ws MCP sidecar — setup\n${hr}\n\n`);

	// Auth method
	const authHint = current.apiKey ? '(A) already set' : '(A) get one at https://three.ws/dashboard';
	process.stderr.write(`How do you want to authenticate?\n  A) API key ${authHint}\n  B) OAuth 2.1 browser login\n\n`);
	const authChoice = (await ask(rl, 'Choice [A]: ')).toUpperCase() || 'A';

	let apiKey = current.apiKey;

	if (authChoice === 'B') {
		rl.close();
		process.stderr.write('\nOpening browser for OAuth login...\n');
		try {
			const { authUrl, accessToken } = await runOAuthFlow(current);
			process.stderr.write(`\nAuthorize at: ${authUrl}\n`);
			apiKey = accessToken;
			process.stderr.write('OAuth login successful.\n\n');
		} catch (err) {
			process.stderr.write(`OAuth failed: ${err.message}\nFalling back to API key setup.\n\n`);
			const rl2 = createInterface({ input: process.stdin, output: process.stderr });
			const raw = await ask(rl2, `API key [${current.apiKey ? '****' + current.apiKey.slice(-4) : 'none'}]: `);
			rl2.close();
			if (raw) apiKey = raw;
		}
	} else {
		const raw = await ask(rl, `\nAPI key [${current.apiKey ? '****' + current.apiKey.slice(-4) : 'none'}]: `);
		if (raw) apiKey = raw;

		const networkRaw = await ask(rl, `Network [${current.network}] mainnet/devnet: `);
		const limitRaw = await ask(rl, `Session spend limit USDC [${current.spendLimitUsdc}] (0 = unlimited): `);
		const cacheRaw = await ask(rl, `Enable response caching? [${current.cache?.enabled !== false ? 'Y' : 'N'}] Y/N: `);
		rl.close();

		const cfg = {
			...current,
			apiKey: apiKey || current.apiKey,
			network: ['mainnet', 'devnet'].includes(networkRaw) ? networkRaw : current.network,
			spendLimitUsdc: limitRaw !== '' ? (parseFloat(limitRaw) || 0) : current.spendLimitUsdc,
			cache: { enabled: cacheRaw.toUpperCase() !== 'N' },
		};

		saveConfig(cfg);
		process.stderr.write(`\nConfig saved → ${configPath()}\n`);
		printSnippet(cfg);
		return;
	}

	const cfg = { ...current, apiKey };
	saveConfig(cfg);
	process.stderr.write(`\nConfig saved → ${configPath()}\n`);
	printSnippet(cfg);
}

function printSnippet(cfg) {
	const env = cfg.apiKey ? { THREE_WS_API_KEY: cfg.apiKey } : {};

	const desktop = {
		mcpServers: {
			'three-ws': { command: 'npx', args: ['-y', 'three-ws-mcp'], env },
		},
	};

	const cursor = {
		'three-ws': { command: 'npx', args: ['-y', 'three-ws-mcp'], env },
	};

	process.stderr.write('\n' + '─'.repeat(40) + '\n');
	process.stderr.write('Claude Desktop  (~/.config/claude/claude_desktop_config.json):\n\n');
	process.stderr.write(JSON.stringify(desktop, null, 2) + '\n\n');
	process.stderr.write('Cursor / Windsurf  (.cursor/mcp.json):\n\n');
	process.stderr.write(JSON.stringify(cursor, null, 2) + '\n\n');
}
