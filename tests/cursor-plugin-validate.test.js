// scripts/validate-cursor-plugin.mjs is the pre-submission gate for the Cursor
// Marketplace: it must pass the real plugin directory and must name the exact
// problem in each broken copy a reviewer would bounce. Every broken case starts
// from a fresh copy of the real plugin so the failure is the one mutation.

import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';
import { validateCursorMarketplace, validateCursorPlugin } from '../scripts/validate-cursor-plugin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN = join(ROOT, 'integrations/cursor/three-ws');
const SCRIPT = join(ROOT, 'scripts/validate-cursor-plugin.mjs');
const temps = [];

function copyPlugin() {
	const dir = mkdtempSync(join(tmpdir(), 'cursor-plugin-'));
	temps.push(dir);
	cpSync(PLUGIN, dir, { recursive: true });
	return dir;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
const editManifest = (dir, fn) => {
	const p = join(dir, '.cursor-plugin/plugin.json');
	writeJson(p, fn(readJson(p)));
};

afterEach(() => {
	while (temps.length) rmSync(temps.pop(), { recursive: true, force: true });
});

// The manifest Cursor itself ships for its Gamma listing (cursor/plugins,
// third_party/gamma/.cursor-plugin/plugin.json at the vendored commit), so the
// schema is checked against a manifest Cursor's own review accepted.
const CURSOR_LISTING_EXAMPLE = {
	name: 'gamma',
	displayName: 'Gamma',
	version: '1.0.0',
	minClientVersions: { cursor: '3.13.0' },
	description: 'Generate presentations, documents, and webpages.',
	author: { name: 'Cursor', email: 'plugins@cursor.com' },
	homepage: 'https://developers.gamma.app/mcp/gamma-mcp-server.md',
	repository: 'https://github.com/cursor/plugins',
	license: 'MIT',
	logo: 'assets/logo.png',
	keywords: ['gamma', 'presentations', 'slides', 'documents', 'webpages', 'design', 'export', 'mcp'],
	category: 'integrations',
	tags: ['gamma', 'presentations', 'productivity', 'mcp'],
	mcpServers: './mcp.json',
};
const UPSTREAM = 'https://github.com/cursor/plugins/blob/5229aad76c37451561c5b81a9b5072ae1c549a5b/schemas/';

describe('vendored Cursor schemas', () => {
	const plugin = readJson(join(ROOT, 'tests/fixtures/cursor-plugin/plugin.schema.json'));
	const marketplace = readJson(join(ROOT, 'tests/fixtures/cursor-plugin/marketplace.schema.json'));

	it('are the published cursor/plugins schemas, pinned to a commit', () => {
		expect(plugin.$comment).toContain(`${UPSTREAM}plugin.schema.json`);
		expect(marketplace.$comment).toContain(`${UPSTREAM}marketplace.schema.json`);
		expect(plugin.$id).toBe('https://cursor.com/schemas/cursor-plugin/plugin.json');
		expect(marketplace.$id).toBe('https://cursor.com/schemas/cursor-plugin/marketplace.json');
	});

	it('accept a manifest Cursor ships for its own listings and reject undefined fields', () => {
		const validate = new Ajv({ allErrors: true, strict: false }).compile(plugin);
		expect(validate(CURSOR_LISTING_EXAMPLE)).toBe(true);
		expect(validate({ name: 'prompts.chat' })).toBe(true);
		expect(validate({ name: 'My_Plugin' })).toBe(false);
		expect(validate({ ...CURSOR_LISTING_EXAMPLE, iconUrl: 'x.png' })).toBe(false);
		// author takes name and email only; marketplace/plugins/three-ws-3d once shipped author.url.
		expect(validate({ ...CURSOR_LISTING_EXAMPLE, author: { name: 'three.ws', url: 'https://three.ws' } })).toBe(false);
	});
});

describe('validate-cursor-plugin on the real plugin', () => {
	it('passes with no errors and lists every component', () => {
		const res = validateCursorPlugin(PLUGIN);
		expect(res.errors).toEqual([]);
		expect(res.ok).toBe(true);
		expect(res.manifest.name).toBe('three-ws');
		expect(res.components.skills).toHaveLength(4);
		expect(res.components.rules.length).toBeGreaterThan(0);
		expect(res.mcpServers).toEqual([{ name: 'three-ws', url: 'https://three.ws/api/mcp-studio?auth=oauth' }]);
	});

	it('exits 0 from the command line', () => {
		const out = execFileSync(process.execPath, [SCRIPT, PLUGIN], { encoding: 'utf8' });
		expect(out).toMatch(/^PASS {2}0 errors/m);
	});
});

describe('validate-cursor-plugin on broken copies', () => {
	const fails = (dir, pattern) => {
		const res = validateCursorPlugin(dir);
		expect(res.ok).toBe(false);
		expect(res.errors.join('\n')).toMatch(pattern);
		return res;
	};

	it('fails a missing logo, naming the path', () => {
		const dir = copyPlugin();
		unlinkSync(join(dir, 'assets/logo.png'));
		fails(dir, /logo "assets\/logo\.png" does not exist/);
	});

	it('fails an undeclared ${VAR} in mcp.json, naming the variable', () => {
		const dir = copyPlugin();
		writeJson(join(dir, 'mcp.json'), {
			mcpServers: { 'three-ws': { url: 'https://three.ws/api/mcp-studio', headers: { Authorization: 'Bearer ${THREE_WS_API_KEY}' } } },
		});
		fails(dir, /\$\{THREE_WS_API_KEY\} is not declared\. Add "THREE_WS_API_KEY" under "variables\.properties"/);
	});

	it('passes the same ${VAR} once it is declared', () => {
		const dir = copyPlugin();
		writeJson(join(dir, 'mcp.json'), {
			mcpServers: { 'three-ws': { url: 'https://three.ws/api/mcp-studio', headers: { Authorization: 'Bearer ${THREE_WS_API_KEY}' } } },
		});
		editManifest(dir, (m) => ({
			...m,
			variables: { type: 'object', properties: { THREE_WS_API_KEY: { type: 'string', title: 'three.ws API key' } } },
		}));
		expect(validateCursorPlugin(dir).errors).toEqual([]);
	});

	it('fails an MCP server on a host outside the allowlist', () => {
		const dir = copyPlugin();
		writeJson(join(dir, 'mcp.json'), { mcpServers: { other: { url: 'https://mcp.example.com/mcp' } } });
		fails(dir, /points at mcp\.example\.com, which is not on the allowlist \(three\.ws\)/);
	});

	it('fails a look-alike host that only contains the allowed name', () => {
		const dir = copyPlugin();
		writeJson(join(dir, 'mcp.json'), { mcpServers: { x: { url: 'https://three.ws.example.net/api/mcp-studio' } } });
		fails(dir, /not on the allowlist/);
	});

	it('fails a local stdio server', () => {
		const dir = copyPlugin();
		writeJson(join(dir, 'mcp.json'), { mcpServers: { local: { command: 'npx', args: ['-y', 'some-server'] } } });
		fails(dir, /runs a local command \("npx"\)/);
	});

	it("fails a field Cursor's plugin schema does not define", () => {
		const dir = copyPlugin();
		editManifest(dir, (m) => ({ ...m, iconUrl: 'assets/logo.png' }));
		fails(dir, /field "iconUrl" is not defined by Cursor's plugin schema/);
	});

	it('fails an author field Cursor does not accept', () => {
		const dir = copyPlugin();
		editManifest(dir, (m) => ({ ...m, author: { name: 'three.ws', url: 'https://three.ws' } }));
		fails(dir, /field "author\.url" is not defined by Cursor's plugin schema/);
	});

	it('fails a name that is not kebab-case and a non-semver version', () => {
		const dir = copyPlugin();
		editManifest(dir, (m) => ({ ...m, name: 'Three_WS', version: '1.2' }));
		const res = fails(dir, /name "Three_WS" is not lowercase kebab-case/);
		expect(res.errors.join('\n')).toMatch(/version "1\.2" is not a semantic version/);
	});

	it('fails a manifest path that escapes the plugin', () => {
		const dir = copyPlugin();
		editManifest(dir, (m) => ({ ...m, rules: '../outside' }));
		fails(dir, /rules must be a relative path inside the plugin/);
	});

	it('fails a symlink anywhere in the tree', () => {
		const dir = copyPlugin();
		symlinkSync('/etc/hostname', join(dir, 'assets/linked.txt'));
		fails(dir, /assets\/linked\.txt: is a symlink/);
	});

	it('fails a rule without a description and a skill whose name is not its folder', () => {
		const dir = copyPlugin();
		mkdirSync(join(dir, 'rules'), { recursive: true });
		writeFileSync(join(dir, 'rules/bare.mdc'), '---\nalwaysApply: true\n---\nDo the thing.\n');
		const skill = join(dir, 'skills/rig-a-model/SKILL.md');
		writeFileSync(skill, readFileSync(skill, 'utf8').replace(/^name: rig-a-model$/m, 'name: rigger'));
		const res = fails(dir, /rules\/bare\.mdc: frontmatter needs a non-empty "description"/);
		expect(res.errors.join('\n')).toMatch(/frontmatter name "rigger" does not match its directory "rig-a-model"/);
	});

	it('fails a committed API key', () => {
		const dir = copyPlugin();
		writeFileSync(join(dir, 'README.md'), `${readFileSync(join(dir, 'README.md'), 'utf8')}\nkey: sk_live_${'A1b2C3d4'.repeat(3)}\n`);
		fails(dir, /README\.md: contains what looks like a three\.ws API key/);
	});

	it('fails a non-permissive license and a missing README', () => {
		const dir = copyPlugin();
		editManifest(dir, (m) => ({ ...m, license: 'GPL-3.0-only' }));
		unlinkSync(join(dir, 'README.md'));
		const res = fails(dir, /license "GPL-3\.0-only" is not a permissive license/);
		expect(res.errors.join('\n')).toMatch(/README\.md: missing/);
	});

	it('exits 1 from the command line with a FAIL line per problem', () => {
		const dir = copyPlugin();
		unlinkSync(join(dir, 'assets/logo.png'));
		let out = '';
		let code = 0;
		try {
			execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
		} catch (err) {
			code = err.status;
			out = err.stdout;
		}
		expect(code).toBe(1);
		expect(out).toMatch(/FAIL {2}\.cursor-plugin\/plugin\.json: logo "assets\/logo\.png" does not exist/);
		expect(out).toMatch(/^FAIL {2}1 error\(s\)/m);
	});
});

// Cursor reads a multi-plugin repository through .cursor-plugin/marketplace.json
// at its root. The 2026-11-21 Marketplace application named this repository, so
// that file decides which plugin Cursor's reviewers open: it must list the
// maintained, free plugin and nothing that fails the plugin checks.
describe('validateCursorMarketplace', () => {
	function copyRepo() {
		const dir = mkdtempSync(join(tmpdir(), 'cursor-marketplace-'));
		temps.push(dir);
		mkdirSync(join(dir, '.cursor-plugin'));
		cpSync(join(ROOT, '.cursor-plugin/marketplace.json'), join(dir, '.cursor-plugin/marketplace.json'));
		cpSync(PLUGIN, join(dir, 'integrations/cursor/three-ws'), { recursive: true });
		return dir;
	}
	const editMarketplace = (dir, fn) => {
		const p = join(dir, '.cursor-plugin/marketplace.json');
		writeJson(p, fn(readJson(p)));
	};

	it('passes the repository and resolves to the maintained plugin only', () => {
		const res = validateCursorMarketplace(ROOT);
		expect(res.errors).toEqual([]);
		expect(res.ok).toBe(true);
		expect(res.plugins.map((p) => ({ name: p.name, source: p.source }))).toEqual([{ name: 'three-ws', source: 'integrations/cursor/three-ws' }]);
		expect(res.plugins[0].mcpServers).toEqual([{ name: 'three-ws', url: 'https://three.ws/api/mcp-studio?auth=oauth' }]);
	});

	it('fails an entry whose source directory holds no plugin', () => {
		const dir = copyRepo();
		editMarketplace(dir, (m) => ({ ...m, plugins: [{ name: 'three-ws', source: 'marketplace/plugins/missing' }] }));
		const res = validateCursorMarketplace(dir);
		expect(res.ok).toBe(false);
		expect(res.errors.join('\n')).toMatch(/plugins\[0\] \(three-ws\): source "marketplace\/plugins\/missing" has no \.cursor-plugin\/plugin\.json/);
	});

	it('fails an entry whose name differs from the plugin manifest', () => {
		const dir = copyRepo();
		editMarketplace(dir, (m) => ({ ...m, plugins: [{ name: 'three-ws-3d', source: 'integrations/cursor/three-ws' }] }));
		const res = validateCursorMarketplace(dir);
		expect(res.ok).toBe(false);
		expect(res.errors.join('\n')).toMatch(/plugins\[0\]: name "three-ws-3d" does not match "three-ws" in integrations\/cursor\/three-ws\/\.cursor-plugin\/plugin\.json/);
	});

	it('reports the listed plugin\'s own failures, prefixed with its source', () => {
		const dir = copyRepo();
		writeJson(join(dir, 'integrations/cursor/three-ws/mcp.json'), { mcpServers: { local: { command: 'npx', args: ['-y', '@three-ws/mcp-server'] } } });
		const res = validateCursorMarketplace(dir);
		expect(res.ok).toBe(false);
		expect(res.errors.join('\n')).toMatch(/integrations\/cursor\/three-ws\/mcp\.json: server "local" runs a local command/);
	});

	it('fails a source that leaves the repository and a field the marketplace schema does not define', () => {
		const dir = copyRepo();
		editMarketplace(dir, (m) => ({ ...m, metadata: { description: 'x' }, homepage: 'https://three.ws', plugins: [{ name: 'three-ws', source: '../elsewhere' }] }));
		const res = validateCursorMarketplace(dir);
		expect(res.ok).toBe(false);
		const all = res.errors.join('\n');
		expect(all).toMatch(/field "homepage" is not defined by Cursor's marketplace schema/);
		expect(all).toMatch(/source "\.\.\/elsewhere" leaves the repository/);
	});
});
