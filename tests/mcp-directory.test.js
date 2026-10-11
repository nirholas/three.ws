// Shape of the public MCP directory (public/.well-known/mcp.json): the server
// list, the per-client `clients` block, and the guarantee that every endpoint
// an agent is told to connect to is actually served by this deployment.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = JSON.parse(readFileSync(resolve(ROOT, 'public/.well-known/mcp.json'), 'utf8'));
const vercel = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8'));

const CLIENTS = ['claude', 'chatgpt', 'cursor', 'vscode', 'grok-bot', 'ibm-bob'];
const AUTH_MODES = ['none', 'oauth2.1', 'api-key'];

// A path is served when a route in vercel.json rewrites it, or, as for every
// hosted MCP server, when it resolves to a handler file in api/ through the
// route table's {handle:"filesystem"} phase.
function isRouted(pathname) {
	const viaRoute = (vercel.routes || []).some((r) => {
		if (!r.src) return false;
		try {
			return new RegExp(`^${r.src}$`).test(pathname);
		} catch {
			return false;
		}
	});
	if (viaRoute) return true;
	const file = pathname.replace(/^\//, '');
	return existsSync(resolve(ROOT, `${file}.js`));
}

describe('public/.well-known/mcp.json', () => {
	it('lists servers with the fields a client needs', () => {
		expect(directory.name).toBe('three.ws');
		expect(directory.servers.length).toBeGreaterThan(0);
		for (const s of directory.servers) {
			for (const f of ['name', 'endpoint', 'transport', 'auth', 'description', 'documentation']) {
				expect(s[f], `${s.name}: ${f}`).toBeTruthy();
			}
			expect(s.transport).toBe('streamable-http');
		}
	});

	it('routes every server endpoint', () => {
		for (const s of directory.servers) {
			const url = new URL(s.endpoint);
			expect(url.origin).toBe('https://three.ws');
			expect(isRouted(url.pathname), `${s.endpoint} is not routed`).toBe(true);
		}
	});

	it('carries a setup block for each supported client', () => {
		expect(Object.keys(directory.clients).filter((k) => !k.startsWith('$') && k !== 'documentation').sort()).toEqual([...CLIENTS].sort());
		expect(directory.clients.documentation).toMatch(/^https:\/\/three\.ws\//);
	});

	it.each(CLIENTS)('%s names a listed, routed server and a known auth mode', (id) => {
		const c = directory.clients[id];
		expect(c.name).toBeTruthy();
		expect(AUTH_MODES).toContain(c.auth);
		expect(c.settings.where).toBeTruthy();
		const server = directory.servers.find((s) => s.endpoint === c.recommendedServer);
		expect(server, `${id}: ${c.recommendedServer} is not in servers[]`).toBeTruthy();
		expect(isRouted(new URL(c.recommendedServer).pathname)).toBe(true);
		const urls = [c.settings.fields?.url, c.settings.config?.servers?.['three-ws']?.url, c.settings.config?.mcpServers?.['three-ws']?.url].filter(Boolean);
		expect(urls.length, `${id}: settings carry no url`).toBeGreaterThan(0);
		for (const u of urls) expect(u).toBe(c.recommendedServer);
		expect(c.guide).toMatch(/^https:\/\/three\.ws\//);
	});

	it('gives Grok Bot the free Grok server, a public URL, and the skill file', () => {
		const g = directory.clients['grok-bot'];
		expect(g.recommendedServer).toBe('https://three.ws/api/mcp-grok');
		expect(g.auth).toBe('none');
		expect(g.settings.fields.transport).toBe('streamable-http');
		expect(g.settings.fields.url).not.toMatch(/localhost|127\.0\.0\.1/);
		expect(g.authUpgrade.mode).toBe('oauth2.1');
		expect(g.authUpgrade.adds).toMatch(/never a wallet/);
		expect(g.skill).toBe('https://three.ws/grok-skill.md');
		expect(existsSync(resolve(ROOT, 'public/grok-skill.md'))).toBe(true);
	});

	it('gives IBM Bob the free studio in the streamable-http shape Bob documents', () => {
		const b = directory.clients['ibm-bob'];
		expect(b.recommendedServer).toBe('https://three.ws/api/mcp-studio');
		expect(b.auth).toBe('none');
		expect(b.settings.config.mcpServers['three-ws'].type).toBe('streamable-http');
		expect(b.settings.where).toMatch(/\.bob\/mcp\.json/);
		expect(b.authUpgrade.mode).toBe('oauth2.1');
		expect(directory.servers.some((s) => s.endpoint === b.authUpgrade.url)).toBe(true);
	});
});
