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

	it('points only at the free, anonymous studio server', () => {
		const m = JSON.parse(read(join(PLUGIN, 'mcp.json')));
		expect(m.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
		expect(m.mcpServers).toEqual({
			'three-ws': { type: 'streamable-http', url: 'https://three.ws/api/mcp-studio' },
		});
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
