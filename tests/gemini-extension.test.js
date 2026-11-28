// The three.ws Gemini CLI extension (integrations/gemini/three-ws) is listed in
// the Gemini CLI extension gallery from its own repository, which
// scripts/export-plugin-repo.mjs generates. These tests pin what Gemini CLI and
// the gallery read: the manifest at the root, an OAuth-only https server, the
// commands and skills it loads, a validator that rejects the mistakes Gemini CLI
// rejects, and an export that is reproducible and still valid.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';
import { afterAll, describe, expect, it } from 'vitest';
import { exportPluginRepo } from '../scripts/export-plugin-repo.mjs';
import { validateGeminiExtension } from '../scripts/validate-gemini-extension.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = 'integrations/gemini/three-ws';
const EXT = join(ROOT, SRC);
const TMP = mkdtempSync(join(tmpdir(), 'gemini-extension-'));
const quiet = () => {};
const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const manifest = JSON.parse(readFileSync(join(EXT, 'gemini-extension.json'), 'utf8'));

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** A writable copy of the extension with `edit` applied to its manifest. */
function brokenCopy(name, edit) {
	const dir = join(TMP, name);
	cpSync(EXT, dir, { recursive: true });
	const m = JSON.parse(readFileSync(join(dir, 'gemini-extension.json'), 'utf8'));
	edit(m, dir);
	writeFileSync(join(dir, 'gemini-extension.json'), JSON.stringify(m, null, 2));
	return dir;
}

describe('gemini-extension.json', () => {
	it('names the extension, a semver version and the context file', () => {
		expect(manifest.name).toBe('three-ws');
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(manifest.contextFileName).toBe('GEMINI.md');
		expect(manifest.description).toMatch(/\/mcp auth three-ws/);
	});

	it('connects only to the free studio server over Streamable HTTP with OAuth', () => {
		expect(manifest.mcpServers).toEqual({ 'three-ws': { url: 'https://three.ws/api/mcp-studio?auth=oauth', type: 'http' } });
	});

	it('passes the validator with every component found', () => {
		const res = validateGeminiExtension(EXT);
		expect(res.errors).toEqual([]);
		expect(res.warnings).toEqual([]);
		expect(res.components.servers).toEqual(['three-ws']);
		expect(res.components.commands.sort()).toEqual(['/embed', '/make-3d', '/rig']);
		expect(res.components.skills).toEqual(['create-3d-avatar', 'find-3d-assets', 'generate-3d-model', 'rig-a-model']);
		expect(res.components.context).toEqual(['GEMINI.md']);
	});
});

describe('extension content', () => {
	it('ships byte-identical copies of the three.ws skill pack', () => {
		for (const skill of readdirSync(join(EXT, 'skills'))) {
			for (const f of readdirSync(join(EXT, 'skills', skill))) {
				expect(readFileSync(join(EXT, 'skills', skill, f), 'utf8'), `skills/${skill}/${f}`).toBe(readFileSync(join(ROOT, '.agents/skills', skill, f), 'utf8'));
			}
		}
	});

	it('every command parses, takes the user input and tells the user how to sign in', () => {
		for (const f of readdirSync(join(EXT, 'commands'))) {
			const doc = parseToml(readFileSync(join(EXT, 'commands', f), 'utf8'));
			expect(Object.keys(doc).sort(), f).toEqual(['description', 'prompt']);
			expect(doc.prompt, f).toContain('{{args}}');
			if (f !== 'embed.toml') expect(doc.prompt, f).toContain('/mcp auth three-ws');
		}
	});

	it('keeps the pinned, integrity-checked embed scripts', () => {
		const { prompt } = parseToml(readFileSync(join(EXT, 'commands/embed.toml'), 'utf8'));
		expect(prompt).toContain('https://three.ws/agent-3d/1.5.2/agent-3d.js');
		expect(prompt).toContain('integrity="sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q"');
		expect(prompt).toContain('@google/model-viewer@4.4.0/dist/model-viewer.min.js');
		expect(prompt).toContain('integrity="sha384-wjsPzEO+lXOf7d9csIDfAQpPt2OKuUU3m0K9qsdKIuzX4N8czSF6hdh23eAbZa3p"');
	});

	it('the context file teaches catalog-first, render-check and sign-in', () => {
		const ctx = readFileSync(join(EXT, 'GEMINI.md'), 'utf8');
		for (const s of ['search_catalog', 'look_at_model', '/mcp auth three-ws']) expect(ctx).toContain(s);
	});

	it('carries the repository license', () => {
		expect(readFileSync(join(EXT, 'LICENSE'), 'utf8')).toBe(readFileSync(join(ROOT, 'LICENSE'), 'utf8'));
	});
});

describe('validate-gemini-extension rejects what Gemini CLI rejects', () => {
	const cases = [
		['deprecated httpUrl', (m) => (m.mcpServers['three-ws'] = { httpUrl: 'https://three.ws/api/mcp-studio' }), /deprecated "httpUrl"/],
		['trust on a server', (m) => (m.mcpServers['three-ws'].trust = true), /sets "trust"/],
		['an uppercase name', (m) => (m.name = 'Three_WS'), /name "Three_WS" must be lowercase/],
		['a non-semver version', (m) => (m.version = 'v1'), /version "v1" is not semver/],
		['a plain http url', (m) => (m.mcpServers['three-ws'].url = 'http://three.ws/api/mcp-studio'), /url must be https/],
		['a header env var with no default', (m) => (m.mcpServers['three-ws'].headers = { Authorization: 'Bearer ${THREE_WS_API_KEY}' }), /no default/],
		['a missing context file', (m) => (m.contextFileName = 'MISSING.md'), /context file "MISSING\.md" is missing/],
		['a context file outside the extension', (m) => (m.contextFileName = '../GEMINI.md'), /resolves outside the extension/],
		['a shipped .env', (m, dir) => writeFileSync(join(dir, '.env'), 'X=1\n'), /\.env: settings values must not ship/],
		['a command without a prompt', (m, dir) => writeFileSync(join(dir, 'commands/bad.toml'), 'description = "x"\n'), /commands\/bad\.toml: needs a string "prompt"/],
	];
	for (const [label, edit, msg] of cases) {
		it(label, () => {
			const res = validateGeminiExtension(brokenCopy(label.replace(/\W+/g, '-'), edit));
			expect(res.ok).toBe(false);
			expect(res.errors.join('\n')).toMatch(msg);
		});
	}

	it('accepts a header env var that has a default', () => {
		const dir = brokenCopy('header-default', (m) => (m.mcpServers['three-ws'].headers = { Authorization: 'Bearer ${THREE_WS_API_KEY:-}' }));
		expect(validateGeminiExtension(dir).errors).toEqual([]);
	});
});

describe('export-plugin-repo on the Gemini extension', () => {
	const first = exportPluginRepo({ src: SRC, out: join(TMP, 'a'), log: quiet });
	const second = exportPluginRepo({ src: SRC, out: join(TMP, 'b'), log: quiet });

	it('puts gemini-extension.json at the root beside every component', () => {
		const top = readdirSync(first.out);
		for (const f of ['gemini-extension.json', 'GEMINI.md', 'commands', 'skills', 'README.md', 'LICENSE', 'CHANGELOG.md', '.gitignore']) expect(top, f).toContain(f);
		expect(existsSync(join(first.out, 'gemini-extension.json'))).toBe(true);
	});

	it('passes the Gemini validator after export', () => {
		expect(validateGeminiExtension(first.out).errors).toEqual([]);
	});

	it('rewrites README links that leave the extension to absolute URLs', () => {
		const readme = readFileSync(join(first.out, 'README.md'), 'utf8');
		expect(readme).not.toContain('](../');
		expect(readme).toMatch(/\]\(https:\/\/github\.com\/nirholas\/three\.ws\/tree\/[^)]*\.agents\/skills/);
	});

	it('is one clean, reproducible commit', () => {
		expect(git(first.out, ['rev-list', '--count', 'HEAD'])).toBe('1');
		expect(git(first.out, ['status', '--porcelain'])).toBe('');
		expect(second.sha).toBe(first.sha);
	});

	it('refuses to export an extension the validator rejects', () => {
		const inRepo = join(ROOT, '.data', `gemini-extension-test-${process.pid}`);
		mkdirSync(inRepo, { recursive: true });
		try {
			const src = join(inRepo, 'broken');
			cpSync(EXT, src, { recursive: true });
			const m = JSON.parse(readFileSync(join(src, 'gemini-extension.json'), 'utf8'));
			m.mcpServers['three-ws'].trust = true;
			writeFileSync(join(src, 'gemini-extension.json'), JSON.stringify(m));
			const out = join(TMP, 'broken-out');
			expect(() => exportPluginRepo({ src, out, log: quiet })).toThrow(/sets "trust"/);
			expect(existsSync(out)).toBe(false);
		} finally {
			rmSync(inRepo, { recursive: true, force: true });
		}
	});
});
