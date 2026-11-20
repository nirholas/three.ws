// The Grok Build plugin (integrations/grok/three-ws) is what xAI's marketplace
// reviewers and every Grok Build user read first. three.ws makes and rigs models
// only for a signed-in account: an anonymous forge_free, forge_avatar, rig_mesh
// or refine_model answers sign_in_required. Catalog search, docs search, model
// rendering and embedding stay free with no account. A sentence anywhere in the
// plugin that says generation works without an account would send users into a
// sign-in wall the copy promised was not there, so this test reads every text
// file in the plugin, sentence by sentence.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN = join(ROOT, 'integrations/grok/three-ws');

const NO_ACCOUNT = /\b(no|without( an?)?|zero) (three\.ws )?(account|api key|sign[- ]?in|signup|sign[- ]?up|login|auth)\b|\banonymous(ly)?\b|\bno credentials\b/i;
// The surfaces that really are free with no account. A plugin-level clause that
// says "no account" must name one of them, so a bare "Free and anonymous: no
// account, no API key" (the copy the marketplace entry once pinned) fails.
const FREE_SCOPE = /\b(catalog|search(es|ing)?|docs?|render(s|ing)?|look_at_model|look at|view(er|ing)?|embed(s|ding)?|brows\w*)\b/i;
const GENERATES = /\b(generat\w*|mak(e|es|ing)|forg\w*|rig(s|ged|ging)?|creat\w*|text[- ]to[- ]3d|image[- ]to[- ]3d|refin\w*|avatar|textured)\b/i;

function textFiles(dir) {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) return textFiles(p);
		return /\.(md|json)$/.test(f) ? [p] : [];
	});
}

// Clauses, not lines: "Catalog search is free with no account; making a model
// needs an account" is two claims, and only one of them is about generation.
function clauses(text) {
	return text
		.replace(/```[\s\S]*?```/g, ' ')
		.split(/(?<=[.!?;:])\s+|\n{2,}|\n\s*[-*|]\s|\s\|\s/)
		.map((c) => c.replace(/\s+/g, ' ').trim())
		.filter(Boolean);
}

// strict: plugin-level copy (manifest, server note, README, commands, agent,
// template) speaks for the whole plugin, so every no-account clause must be
// scoped to a free surface. Bundled skills are byte-identical copies of
// .agents/skills, each about one task, so there only a clause that ties "no
// account" to generation fails.
export function generationWithoutAccountClaims(text, { strict = true } = {}) {
	return clauses(text).filter((c) => NO_ACCOUNT.test(c) && (GENERATES.test(c) || (strict && !FREE_SCOPE.test(c))));
}

describe('Grok Build plugin copy', () => {
	it('the detector catches a no-account generation claim and passes the accurate catalog line', () => {
		expect(generationWithoutAccountClaims('Generate a textured 3D model with no account or API key.')).toHaveLength(1);
		expect(generationWithoutAccountClaims('Rig any GLB anonymously.')).toHaveLength(1);
		expect(generationWithoutAccountClaims('Make avatars without an account.')).toHaveLength(1);
		// The unscoped copy the marketplace entry pinned at 60226f15, verbatim.
		expect(generationWithoutAccountClaims('No account, no API key, no payment. No tool in this plugin spends money or moves value.')).toHaveLength(1);
		expect(generationWithoutAccountClaims('three.ws hosted MCP server for Grok. Free and anonymous: no account, no API key, no payment.').length).toBeGreaterThan(0);
		expect(generationWithoutAccountClaims('Free: no account, no API key, no payment.', { strict: false })).toEqual([]);
		expect(
			generationWithoutAccountClaims('Catalog search is free with no account; making or rigging a model needs a free three.ws account.'),
		).toEqual([]);
	});

	it('no file in the plugin claims generation works without an account', () => {
		const hits = [];
		for (const f of textFiles(PLUGIN)) {
			const rel = relative(PLUGIN, f);
			const strict = !rel.startsWith('skills/');
			for (const c of generationWithoutAccountClaims(readFileSync(f, 'utf8'), { strict })) hits.push(`${rel}: ${c}`);
		}
		expect(hits).toEqual([]);
	});

	it('the manifest, the server note and the README say making a model needs a free account', () => {
		const manifest = JSON.parse(readFileSync(join(PLUGIN, '.grok-plugin/plugin.json'), 'utf8'));
		expect(manifest.description).toMatch(/Catalog search is free with no account/);
		expect(manifest.description).toMatch(/making or rigging a model needs a free three\.ws account/);
		const note = JSON.parse(readFileSync(join(PLUGIN, '.mcp.json'), 'utf8')).mcpServers['three-ws'].note;
		expect(note).toMatch(/needs a free three\.ws account/);
		const readme = readFileSync(join(PLUGIN, 'README.md'), 'utf8');
		expect(readme).toMatch(/free with no account/i);
		expect(readme).toMatch(/needs a free three\.ws account/);
		expect(readme).toMatch(/API key/);
	});

	it('every command that makes or rigs a model handles sign_in_required', () => {
		for (const c of ['make-3d.md', 'rig.md']) {
			expect(readFileSync(join(PLUGIN, 'commands', c), 'utf8'), c).toMatch(/`sign_in_required`: .*free three\.ws account/);
		}
		expect(readFileSync(join(PLUGIN, 'agents/3d-art-director.md'), 'utf8')).toMatch(/`sign_in_required`: .*free three\.ws account/);
	});
});
