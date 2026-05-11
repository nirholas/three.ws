#!/usr/bin/env node
import { argv } from 'process';

const cmd = argv[2];

if (cmd === 'init') {
	const { runInit } = await import('../src/init.js');
	await runInit();
} else if (cmd === 'status') {
	const { runStatus } = await import('../src/status.js');
	await runStatus();
} else if (cmd === '--help' || cmd === '-h') {
	process.stdout.write([
		'three-ws-mcp — local MCP sidecar for three.ws',
		'',
		'Usage:',
		'  three-ws-mcp          Start MCP stdio server (default)',
		'  three-ws-mcp init     Interactive setup: API key, network, spend limit',
		'  three-ws-mcp status   Print config, remote health, session spend, cache stats',
		'',
		'Environment overrides:',
		'  THREE_WS_API_KEY      API key (from https://three.ws/dashboard)',
		'  THREE_WS_NETWORK      mainnet | devnet  (default: mainnet)',
		'  THREE_WS_REMOTE       Remote base URL   (default: https://three.ws)',
		'  THREE_WS_SPEND_LIMIT  Session USDC cap  (default: 1.0)',
		'',
		'Claude Desktop config snippet:',
		'  { "mcpServers": { "three-ws": { "command": "npx", "args": ["-y", "three-ws-mcp"], "env": { "THREE_WS_API_KEY": "<key>" } } } }',
		'',
	].join('\n'));
} else {
	const { runServer } = await import('../src/server.js');
	await runServer();
}
