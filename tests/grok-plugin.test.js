// integrations/grok/three-ws is the Grok Build plugin submitted to xAI's plugin
// marketplace (github.com/xai-org/plugin-marketplace), which pins a commit of
// this repository and clones the folder at install time. A skill copy that
// drifts from its source, a server URL that points anywhere but the studio
// door, a command that names a tool the server does not have, or a component the
// marketplace's static security review rejects (hooks, install scripts) would
// ship to every Grok Build install at the next re-pin.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN = join(ROOT, 'integrations/grok/three-ws');
const read = (p) => readFileSync(p, 'utf8');
const SKILLS = ['anatomy', 'create-3d-avatar', 'embed-three-ws-avatar', 'find-3d-assets', 'generate-3d-model', 'rig-a-model'];
const COMMANDS = ['embed.md', 'make-3d.md', 'rig.md', 'three-ws-init.md', 'three-ws-tour.md'];
const STUDIO_DIR = join(ROOT, 'api/_mcp-studio');
const studioSource = () => readdirSync(STUDIO_DIR).filter((f) => f.endsWith('.js')).map((f) => read(join(STUDIO_DIR, f))).join('\n');
// Result and argument fields the commands name in backticks. Everything else in
// snake_case must be a tool the studio door registers.
const FIELDS = new Set(['embed_html', 'eta_seconds', 'glb_url', 'idempotency_key', 'job_id', 'parent_prompt', 'poster_png_url', 'sign_in_required', 'viewer_url']);
const frontmatter = (text) => {
	const m = text.match(/^---\n([\s\S]*?)\n---\n/);
	return m ? m[1] : null;
};

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

	// Making or rigging a model needs a three.ws account, and the bare studio door
	// answers an anonymous create with sign_in_required. Marketplace headers are
	// literal and may not hold secrets, so ?auth=oauth makes the first connect
	// answer 401 and Grok Build runs the three.ws sign-in. The studio door, not
	// the /api/mcp-grok door: signed in, the Grok door adds market and agent
	// tools, and Grok Build runs on the user's machine like Cursor does.
	it('connects only the studio door, asking Grok Build to sign in', () => {
		const m = JSON.parse(read(join(PLUGIN, '.mcp.json')));
		expect(Object.keys(m.mcpServers)).toEqual(['three-ws']);
		const s = m.mcpServers['three-ws'];
		expect(s.type).toBe('http');
		expect(s.url).toBe('https://three.ws/api/mcp-studio?auth=oauth');
		expect(s.note).toMatch(/needs a free three\.ws account/);
		expect(s.command).toBeUndefined();
		expect(s.headers).toBeUndefined();
	});

	it('ships no hooks, LSP servers, install scripts or executables', () => {
		const top = readdirSync(PLUGIN).sort();
		expect(top).toEqual(['.grok-plugin', '.mcp.json', 'LICENSE', 'README.md', 'agents', 'commands', 'skills', 'templates']);
		const walk = (dir) => readdirSync(dir).flatMap((f) => {
			const p = join(dir, f);
			return statSync(p).isDirectory() ? walk(p) : [p];
		});
		for (const f of walk(PLUGIN)) {
			expect(f, f).toMatch(/\.(md|json)$|LICENSE$/);
			expect(statSync(f).mode & 0o111, `${f} is executable`).toBe(0);
		}
	});

	it('ships the commands and the art-director agent, each with valid frontmatter', () => {
		expect(readdirSync(join(PLUGIN, 'commands')).sort()).toEqual(COMMANDS);
		for (const c of COMMANDS) {
			const fm = frontmatter(read(join(PLUGIN, 'commands', c)));
			expect(fm, c).toMatch(/^description: .{20,}$/m);
		}
		// Commands that take an argument must place it, or Grok appends it loosely.
		for (const c of ['embed.md', 'make-3d.md', 'rig.md']) {
			const text = read(join(PLUGIN, 'commands', c));
			expect(frontmatter(text), c).toMatch(/^argument-hint: <.+>$/m);
			expect(text, c).toContain('$ARGUMENTS');
		}
		expect(readdirSync(join(PLUGIN, 'agents'))).toEqual(['3d-art-director.md']);
		const fm = frontmatter(read(join(PLUGIN, 'agents/3d-art-director.md')));
		expect(fm).toMatch(/^name: 3d-art-director$/m);
		expect(fm).toMatch(/^description: .{40,}$/m);
		// Plugin agents may not declare MCP servers, hooks or a bypass mode; the
		// agent reaches only the plugin's own server and has a bounded run.
		expect(fm).not.toMatch(/^(mcpServers|hooks|permissionMode):/m);
		expect(fm).toMatch(/^mcpInheritance:\n {2}named:\n {4}- three-ws$/m);
		expect(fm).toMatch(/^tools: search_tool, use_tool, Read$/m);
		const turns = Number(fm.match(/^maxTurns: (\d+)$/m)?.[1]);
		expect(turns).toBeGreaterThan(0);
		expect(turns).toBeLessThanOrEqual(20);
	});

	it('the art director stops after two iterations', () => {
		const body = read(join(PLUGIN, 'agents/3d-art-director.md'));
		expect(body).toMatch(/## Iteration 1/);
		expect(body).toMatch(/## Iteration 2/);
		expect(body).not.toMatch(/## Iteration 3/);
		expect(body).toMatch(/Hard stop\.\*\* Never start a third generation or a second refinement/);
	});

	it('/three-ws-init installs the bundled AGENTS.md template and never overwrites the file', () => {
		const init = read(join(PLUGIN, 'commands/three-ws-init.md'));
		expect(init).toContain('${GROK_PLUGIN_ROOT}/templates/AGENTS.md');
		expect(init).toMatch(/Never change or remove anything else/);
		const tpl = read(join(PLUGIN, 'templates/AGENTS.md'));
		expect(tpl.split('\n')[0]).toBe('## 3D assets (three.ws)');
		expect(init).toContain('## 3D assets (three.ws)');
	});

	// /embed prints these tags verbatim. A pin that drifts from the one the site
	// and the embed skill publish would hand users a script the browser refuses.
	it('/embed pins the same viewer builds and integrity hashes the site publishes', () => {
		const embed = read(join(PLUGIN, 'commands/embed.md'));
		const snippets = read(join(ROOT, 'api/_lib/asset-snippets.js'));
		const mvSrc = snippets.match(/MODEL_VIEWER_SRC =\s*'([^']+)'/)[1];
		const mvSri = snippets.match(/MODEL_VIEWER_SRI =\s*'([^']+)'/)[1];
		expect(embed).toContain(`src="${mvSrc}"`);
		expect(embed).toContain(`integrity="${mvSri}"`);
		const skill = read(join(ROOT, '.agents/skills/embed-three-ws-avatar/SKILL.md'));
		const a3Src = skill.match(/src="(https:\/\/three\.ws\/agent-3d\/\d+\.\d+\.\d+\/agent-3d\.js)"/)[1];
		const a3Sri = skill.match(new RegExp(`src="${a3Src.replace(/[.\/]/g, '\\$&')}"\\s*integrity="([^"]+)"`))[1];
		expect(embed).toContain(`src="${a3Src}"`);
		expect(embed).toContain(`integrity="${a3Sri}"`);
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

	it('every command, the agent and the template name only tools and fields the studio door serves', () => {
		const studio = studioSource();
		const files = [...COMMANDS.map((c) => `commands/${c}`), 'agents/3d-art-director.md', 'templates/AGENTS.md'];
		const tools = new Set();
		for (const f of files) {
			const named = [...read(join(PLUGIN, f)).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
			for (const n of named) {
				if (FIELDS.has(n)) expect(studio, `${f}: field ${n} is not in the studio source`).toContain(n);
				else {
					expect(studio, `${f}: ${n} is not a studio tool`).toContain(`name: '${n}'`);
					tools.add(n);
				}
			}
		}
		for (const t of ['forge_free', 'forge_avatar', 'rig_mesh', 'refine_model', 'get_job', 'look_at_model', 'search_catalog']) {
			expect(tools.has(t), `no component uses ${t}`).toBe(true);
		}
	});
});
