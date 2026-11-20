// The Cursor and Grok Build plugins promise reviewers and users that nothing
// they connect to can move money. This opens a real MCP session to every server
// their configs name, on production, and fails if any tool listed there reads as
// a wallet, transfer, send, swap, trade, launch, payment, x402 or withdraw
// surface. The tool list is printed so a run doubles as a record of what the
// plugin exposes today.
//
// Needs THREE_WS_API_KEY (a free three.ws account's key; the studio refuses an
// anonymous session when the client asked to sign in). Run:
//   node --env-file=.env node_modules/vitest/vitest.mjs run tests/cursor-plugin-tool-surface.test.js
// The offline half (the matcher itself) always runs.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openSession, pluginMcpConfig, readMcpServers, spendSurfaceHits } from '../scripts/lib/plugin-mcp.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGINS = ['integrations/cursor/three-ws', 'integrations/grok/three-ws'];
const KEY = process.env.THREE_WS_API_KEY;

const servers = [];
for (const plugin of PLUGINS) {
	for (const s of readMcpServers(pluginMcpConfig(join(ROOT, plugin)))) {
		if (!servers.some((x) => x.url === s.url)) servers.push({ ...s, plugin });
	}
}

describe('spend-surface matcher', () => {
	it('catches spend tools however they are spelled', () => {
		const hits = spendSurfaceHits([
			{ name: 'pay_and_call', description: 'Call an endpoint.' },
			{ name: 'wallet-status', description: 'Balances.' },
			{ name: 'quote', description: 'Swaps one token for another.' },
			{ name: 'claim', description: 'Withdraws creator fees.' },
			{ name: 'mint', description: 'Launches a new coin.' },
			{ name: 'settle', description: 'Settles an x402 payment.' },
		]);
		expect(new Set(hits.map((h) => h.tool))).toEqual(new Set(['pay_and_call', 'wallet-status', 'quote', 'claim', 'mint', 'settle']));
	});

	it('leaves ordinary 3D tool text alone', () => {
		expect(
			spendSurfaceHits([
				{ name: 'forge_free', description: 'Generate a textured GLB from a prompt. Returns the payload with a viewer link.' },
				{ name: 'look_at_model', description: 'Render a model from several angles so the agent can see it.' },
			]),
		).toEqual([]);
	});
});

describe.skipIf(!KEY)('live plugin tool surface (production)', () => {
	it('every plugin config names at least one server', () => {
		expect(servers.length).toBeGreaterThan(0);
	});

	for (const server of servers) {
		it(`${server.url} exposes no wallet, transfer, swap, trade, launch or payment tool`, async () => {
			const session = await openSession(server.url, KEY);
			try {
				const { tools } = await session.client.listTools();
				console.log(`[tool-surface] ${server.url} (${server.plugin}): ${tools.length} tools\n  ${tools.map((t) => t.name).join('\n  ')}`);
				expect(tools.length).toBeGreaterThan(0);
				expect(spendSurfaceHits(tools)).toEqual([]);
			} finally {
				await session.close();
			}
		}, 60_000);
	}
});
