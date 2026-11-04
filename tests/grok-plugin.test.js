// integrations/grok/three-ws is the Grok Build plugin submitted to xAI's plugin
// marketplace (github.com/xai-org/plugin-marketplace), which pins a commit of
// this repository and clones the folder at install time. A skill copy that
// drifts from its source, a server URL that points anywhere but the Grok door,
// or a component the marketplace's static security review rejects (hooks,
// install scripts) would ship to every Grok Build install at the next re-pin.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN = join(ROOT, 'integrations/grok/three-ws');
const read = (p) => readFileSync(p, 'utf8');
const SKILLS = ['anatomy', 'create-3d-avatar', 'embed-three-ws-avatar', 'find-3d-assets', 'generate-3d-model', 'rig-a-model'];

describe('Grok Build plugin package', () => {
	it('declares a manifest the marketplace accepts, with brand-scoped keywords', () => {
		const m = JSON.parse(read(join(PLUGIN, '.grok-plugin/plugin.json')));
		expect(m.name).toBe('three-ws');
		expect(m.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		expect(m.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(m.repository).toBe('https://github.com/nirholas/three.ws');
		expect(m.homepage).toMatch(/^https:\/\/three\.ws\//);
		expect(m.license).toBe('Apache-2.0');
		expect(m.description.length).toBeGreaterThan(40);
		// Keywords drive Grok Build's plugin suggestion; a generic term would fire
		// it on unrelated requests and the marketplace review sends it back.
		for (const k of m.keywords) expect(k).toMatch(/three/);
		expect(read(join(PLUGIN, 'LICENSE'))).toBe(read(join(ROOT, 'LICENSE')));
	});

	it('connects only the open Grok door, which serves no value-moving tool', () => {
		const m = JSON.parse(read(join(PLUGIN, '.mcp.json')));
		expect(Object.keys(m.mcpServers)).toEqual(['three-ws']);
		const s = m.mcpServers['three-ws'];
		expect(s.type).toBe('http');
		expect(s.url).toBe('https://three.ws/api/mcp-grok');
		expect(s.command).toBeUndefined();
		expect(s.headers).toBeUndefined();
	});

	it('ships no hooks, agents, install scripts or executables', () => {
		const top = readdirSync(PLUGIN).sort();
		expect(top).toEqual(['.grok-plugin', '.mcp.json', 'LICENSE', 'README.md', 'commands', 'skills']);
		const walk = (dir) => readdirSync(dir).flatMap((f) => {
			const p = join(dir, f);
			return statSync(p).isDirectory() ? walk(p) : [p];
		});
		for (const f of walk(PLUGIN)) {
			expect(f, f).toMatch(/\.(md|json)$|LICENSE$/);
			expect(statSync(f).mode & 0o111, `${f} is executable`).toBe(0);
		}
	});

	it('bundles skills byte-identical to the .agents/skills sources', () => {
		expect(readdirSync(join(PLUGIN, 'skills')).sort()).toEqual(SKILLS);
		for (const s of SKILLS) {
			const files = readdirSync(join(PLUGIN, 'skills', s)).sort();
			expect(files).toEqual(readdirSync(join(ROOT, '.agents/skills', s)).sort());
			for (const f of files) {
				expect(read(join(PLUGIN, 'skills', s, f)), `${s}/${f}`).toBe(read(join(ROOT, '.agents/skills', s, f)));
			}
		}
	});

	it('the tour command names only tools the Grok door serves', () => {
		const tour = read(join(PLUGIN, 'commands/three-ws-tour.md'));
		const named = [...tour.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
		expect(named.length).toBeGreaterThan(4);
		const studio = read(join(ROOT, 'api/_mcp-studio/tools.js')) + read(join(ROOT, 'api/_mcp-studio/job-tools.js')) + read(join(ROOT, 'api/_mcp-studio/catalog-tools.js'));
		for (const n of named.filter((x) => x !== 'idempotency_key' && x !== 'job_id')) {
			expect(studio, `${n} is not a studio tool`).toContain(`name: '${n}'`);
		}
	});
});
