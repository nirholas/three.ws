// The Grok Build plugin promises xAI's marketplace reviewers and every user that
// no tool it reaches can move money. This opens a real MCP session to every
// server in integrations/grok/three-ws/.mcp.json, on production, with the
// official MCP client, and fails if:
//   - a first connect without credentials does not answer 401 with the OAuth
//     discovery chain Grok Build follows to run the three.ws sign-in;
//   - any listed tool's name or description reads as a wallet, transfer, send,
//     swap, trade, launch, payment, x402 or withdraw surface;
//   - a command, the agent or the AGENTS.md template names a tool the signed-in
//     server does not list (a command that calls a missing tool fails at runtime).
// The tool list is printed, so a run doubles as the record of what the plugin
// exposes today.
//
// Needs THREE_WS_API_KEY (a free three.ws account's key) for the signed-in half:
//   node --env-file=.env node_modules/vitest/vitest.mjs run tests/grok-build-plugin-tools.test.js

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPEND_WORDS, openSession, pluginMcpConfig, probeUnauthenticated, readMcpServers, spendSurfaceHits } from '../scripts/lib/plugin-mcp.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN = join(ROOT, 'integrations/grok/three-ws');
const KEY = process.env.THREE_WS_API_KEY;
const servers = readMcpServers(pluginMcpConfig(PLUGIN));

// Argument and result fields the components name in backticks; every other
// snake_case token there is a tool call.
const FIELDS = new Set(['embed_html', 'eta_seconds', 'glb_url', 'idempotency_key', 'job_id', 'parent_prompt', 'poster_png_url', 'sign_in_required', 'viewer_url']);

function toolsNamedByComponents() {
	const files = [
		...readdirSync(join(PLUGIN, 'commands')).map((f) => join(PLUGIN, 'commands', f)),
		...readdirSync(join(PLUGIN, 'agents')).map((f) => join(PLUGIN, 'agents', f)),
		join(PLUGIN, 'templates/AGENTS.md'),
	];
	const names = new Set();
	for (const f of files) {
		for (const m of readFileSync(f, 'utf8').matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) if (!FIELDS.has(m[1])) names.add(m[1]);
	}
	return [...names].sort();
}

describe('Grok Build plugin server config', () => {
	it('names only HTTPS three.ws servers, with no headers or local commands', () => {
		expect(servers.length).toBeGreaterThan(0);
		const raw = JSON.parse(readFileSync(join(PLUGIN, '.mcp.json'), 'utf8')).mcpServers;
		for (const [name, s] of Object.entries(raw)) {
			expect(new URL(s.url).origin, name).toBe('https://three.ws');
			expect(s.command, name).toBeUndefined();
			expect(s.headers, name).toBeUndefined();
		}
	});

	it('the spend matcher covers every word the order bans', () => {
		for (const w of ['wallet', 'transfer', 'send', 'swap', 'trade', 'launch', 'pay', 'x402', 'withdraw']) expect(SPEND_WORDS.test(w), w).toBe(true);
	});

	it('the components call real tool names', () => {
		const named = toolsNamedByComponents();
		expect(named).toEqual(expect.arrayContaining(['forge_free', 'get_job', 'look_at_model', 'refine_model', 'rig_mesh', 'search_catalog']));
	});
});

describe('live Grok Build plugin tool surface (production)', () => {
	for (const server of servers) {
		it(`${server.url} asks a first connect to sign in through OAuth discovery`, async () => {
			const probe = await probeUnauthenticated(server.url);
			expect(probe.error).toBeNull();
			expect(probe.unauthorized).toBe(true);
			expect(probe.challenge.status).toBe(401);
			expect(probe.resourceMetadata.authorization_servers).toContain('https://three.ws');
			expect(probe.authServer.authorization_endpoint).toMatch(/^https:\/\/three\.ws\//);
			expect(probe.authServer.token_endpoint).toMatch(/^https:\/\/three\.ws\//);
			// Grok Build registers itself (RFC 7591) before the browser sign-in.
			expect(probe.authServer.registration_endpoint).toMatch(/^https:\/\/three\.ws\//);
		}, 60_000);

		it.skipIf(!KEY)(`${server.url} signed in: no spend tool, and every tool the components call is listed`, async () => {
			const session = await openSession(server.url, KEY);
			try {
				const { tools } = await session.client.listTools();
				console.log(`[grok-build tool surface] ${server.url}: ${tools.length} tools\n  ${tools.map((t) => t.name).join('\n  ')}`);
				expect(tools.length).toBeGreaterThan(0);
				expect(spendSurfaceHits(tools)).toEqual([]);
				const listed = new Set(tools.map((t) => t.name));
				for (const n of toolsNamedByComponents()) expect(listed.has(n), `${n} is not served by ${server.url}`).toBe(true);
			} finally {
				await session.close();
			}
		}, 60_000);
	}
});
