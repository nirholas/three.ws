// integrations/hermes/three-ws is the portable Agent Plugins package listed in
// the Hermes plugin catalog. The catalog pins a commit of this repository, so a
// skill copy that drifts from its source, or a server URL that points anywhere
// but the free studio, would ship to every Hermes install at the next re-pin.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN = join(ROOT, 'integrations/hermes/three-ws');
const read = (p) => readFileSync(p, 'utf8');

describe('Hermes plugin package', () => {
	it('declares a valid portable manifest', () => {
		const m = JSON.parse(read(join(PLUGIN, 'plugin.json')));
		expect(m.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
		expect(m.name).toBe('three-ws');
		expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(m.repository).toBe('https://github.com/nirholas/three.ws');
		expect(m.license).toBe('Apache-2.0');
		expect(read(join(PLUGIN, 'LICENSE'))).toBe(read(join(ROOT, 'LICENSE')));
	});

	// Hermes translates a portable streamable-http server to {url, headers} only: the Agent
	// Plugins v1 remote entry has no auth field, so Hermes never runs OAuth for it, and the studio's
	// ?auth=oauth URL answers 401 with zero tools. Verified against Hermes v0.23.5
	// (hermes_cli/agent_plugins.py _REMOTE_FIELDS = {type, url, headers}). The package therefore
	// runs the OAuth sign-in itself through a pinned mcp-remote, the same shape the catalog already
	// admits, and keeps the tokens inside the plugin's own Hermes data folder.
	it('points only at the free studio server through a pinned OAuth proxy Hermes can sign in with', () => {
		const m = JSON.parse(read(join(PLUGIN, 'mcp.json')));
		expect(m.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
		expect(Object.keys(m.mcpServers)).toEqual(['three-ws']);
		const s = m.mcpServers['three-ws'];
		expect(s.type).toBe('stdio');
		expect(s.command).toBe('npx');
		expect(s.args.slice(0, 3)).toEqual(['-y', 'mcp-remote@0.1.49', 'https://three.ws/api/mcp-studio?auth=oauth']);
		expect(s.args).toContain('http-only');
		const meta = JSON.parse(s.args[s.args.indexOf('--static-oauth-client-metadata') + 1]);
		expect(meta.client_name).toBe('Hermes Agent (three.ws)');
		expect(s.env).toEqual({ MCP_REMOTE_CONFIG_DIR: '${PLUGIN_DATA}/mcp-auth' });
	});

	it('bundles skills byte-identical to the .agents/skills sources', () => {
		const skills = readdirSync(join(PLUGIN, 'skills'));
		expect(skills.sort()).toEqual(['create-3d-avatar', 'find-3d-assets', 'generate-3d-model', 'rig-a-model']);
		for (const s of skills) {
			for (const f of readdirSync(join(PLUGIN, 'skills', s))) {
				expect(read(join(PLUGIN, 'skills', s, f)), `${s}/${f}`).toBe(read(join(ROOT, '.agents/skills', s, f)));
			}
			expect(readdirSync(join(PLUGIN, 'skills', s)).sort()).toEqual(readdirSync(join(ROOT, '.agents/skills', s)).sort());
		}
	});
});
