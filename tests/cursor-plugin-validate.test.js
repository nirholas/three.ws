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
import { validateCursorPlugin } from '../scripts/validate-cursor-plugin.mjs';

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

describe('vendored Cursor manifest schema', () => {
	const schema = readJson(join(ROOT, 'tests/fixtures/cursor-plugin/plugin.schema.json'));

	it('cites its source page and template commit', () => {
		expect(schema.$comment).toContain('https://cursor.com/docs/reference/plugins');
		expect(schema.$comment).toContain('46216072ac5750f782f95bb325b4d12b7c3ae9c9');
	});

	it('accepts the reference example manifest and rejects an undocumented field', () => {
		const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
		const example = {
			name: 'enterprise-plugin',
			version: '1.2.0',
			description: 'Enterprise development tools with security scanning and compliance checks',
			author: { name: 'ACME DevTools', email: 'devtools@acme.com' },
			keywords: ['enterprise', 'security', 'compliance'],
			logo: 'assets/logo.svg',
		};
		expect(validate(example)).toBe(true);
		expect(validate({ ...example, displayName: 'Enterprise' })).toBe(false);
		expect(validate({ name: 'prompts.chat' })).toBe(true);
		expect(validate({ name: 'My_Plugin' })).toBe(false);
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
		unlinkSync(join(dir, 'assets/logo.svg'));
		fails(dir, /logo "assets\/logo\.svg" does not exist/);
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

	it('fails a field the manifest reference does not define', () => {
		const dir = copyPlugin();
		editManifest(dir, (m) => ({ ...m, displayName: 'three.ws 3D Studio' }));
		fails(dir, /field "displayName" is not defined by the Cursor manifest reference/);
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
		unlinkSync(join(dir, 'assets/logo.svg'));
		let out = '';
		let code = 0;
		try {
			execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
		} catch (err) {
			code = err.status;
			out = err.stdout;
		}
		expect(code).toBe(1);
		expect(out).toMatch(/FAIL {2}\.cursor-plugin\/plugin\.json: logo "assets\/logo\.svg" does not exist/);
		expect(out).toMatch(/^FAIL {2}1 error\(s\)/m);
	});
});
