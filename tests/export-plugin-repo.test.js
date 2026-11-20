// scripts/export-plugin-repo.mjs turns a plugin directory in this monorepo into
// the standalone repository a plugin marketplace clones and pins by SHA. These
// tests run the real exporter on the real Grok Build plugin and check that:
//   - the plugin manifest lands at the tree root, with LICENSE, README and a
//     CHANGELOG built from git history;
//   - the result is one git commit, and two exports give the same SHA (the SHA a
//     marketplace entry pins has to be reproducible);
//   - README links that left the plugin directory now point at the source repo;
//   - the validator rejects what Grok Build would reject;
//   - the exporter refuses to write over the repository or the plugin source.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { exportPluginRepo, findManifest, rewriteEscapingLinks, validatePluginTree } from '../scripts/export-plugin-repo.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = 'integrations/grok/three-ws';
const TMP = mkdtempSync(join(tmpdir(), 'export-plugin-repo-'));
const quiet = () => {};
const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe('export-plugin-repo on the Grok Build plugin', () => {
	const first = exportPluginRepo({ src: SRC, out: join(TMP, 'a'), log: quiet });
	const second = exportPluginRepo({ src: SRC, out: join(TMP, 'b'), log: quiet });

	it('puts the plugin at the tree root with LICENSE, README and CHANGELOG', () => {
		const top = readdirSync(first.out).sort();
		expect(top).toEqual(expect.arrayContaining(['.grok-plugin', '.mcp.json', 'CHANGELOG.md', 'LICENSE', 'README.md', 'agents', 'commands', 'skills']));
		expect(existsSync(join(first.out, '.grok-plugin/plugin.json'))).toBe(true);
		expect(findManifest(first.out).manifest.name).toBe('three-ws');
		for (const f of readdirSync(join(ROOT, SRC))) expect(top, f).toContain(f);
	});

	it('copies every plugin file byte for byte (README aside, whose links are rewritten)', () => {
		const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', SRC], { cwd: ROOT, encoding: 'utf8' })
			.split('\n')
			.filter(Boolean)
			.filter((f) => existsSync(join(ROOT, f)));
		expect(files.length).toBeGreaterThan(5);
		for (const f of files) {
			const rel = f.slice(SRC.length + 1);
			if (rel === 'README.md') continue;
			expect(readFileSync(join(first.out, rel)).equals(readFileSync(join(ROOT, f))), rel).toBe(true);
		}
	});

	it('is one commit, by the fixed three.ws identity', () => {
		expect(git(first.out, ['rev-list', '--count', 'HEAD'])).toBe('1');
		expect(git(first.out, ['log', '-1', '--format=%an <%ae>|%cn <%ce>'])).toBe('three.ws <support@three.ws>|three.ws <support@three.ws>');
		expect(git(first.out, ['log', '-1', '--format=%s'])).toBe(`three-ws ${first.manifest.version}`);
		expect(git(first.out, ['status', '--porcelain'])).toBe('');
	});

	it('is deterministic: two exports give the same commit SHA', () => {
		expect(first.sha).toMatch(/^[0-9a-f]{40}$/);
		expect(second.sha).toBe(first.sha);
		expect(git(second.out, ['rev-parse', 'HEAD'])).toBe(first.sha);
	});

	it('builds CHANGELOG.md from the git history of the plugin directory', () => {
		const changelog = readFileSync(join(first.out, 'CHANGELOG.md'), 'utf8');
		expect(changelog.startsWith('# Changelog\n')).toBe(true);
		expect(changelog).toContain(`## ${first.manifest.version}`);
		const shas = git(ROOT, ['log', '--format=%H', '--', SRC]).split('\n').filter(Boolean);
		expect(shas.length).toBeGreaterThan(0);
		for (const sha of shas) expect(changelog, sha).toContain(`/commit/${sha}`);
	});

	it('the exported tree passes the validator', () => {
		expect(validatePluginTree(first.out)).toEqual([]);
	});

	it('leaves no relative README link pointing outside the exported tree', () => {
		const readme = readFileSync(join(first.out, 'README.md'), 'utf8');
		for (const m of readme.matchAll(/\]\((?!https?:|mailto:|#)([^)\s#]+)/g)) {
			expect(existsSync(join(first.out, m[1])), m[1]).toBe(true);
		}
	});
});

describe('rewriteEscapingLinks', () => {
	const opts = { srcRel: 'integrations/grok/three-ws', repoUrl: 'https://github.com/nirholas/three.ws' };

	it('rewrites links that leave the plugin directory and keeps the rest', () => {
		const md = '[guide](../../../docs/grok.md#grok-build) [cmd](commands/make-3d.md) [web](https://three.ws) [dir](../../../docs/) [top](#install)';
		expect(rewriteEscapingLinks(md, opts)).toBe(
			'[guide](https://github.com/nirholas/three.ws/blob/main/docs/grok.md#grok-build) [cmd](commands/make-3d.md) [web](https://three.ws) [dir](https://github.com/nirholas/three.ws/tree/main/docs) [top](#install)',
		);
	});
});

describe('validatePluginTree', () => {
	function fixture(mutate) {
		const dir = mkdtempSync(join(TMP, 'fx-'));
		cpSync(join(ROOT, SRC), dir, { recursive: true });
		mutate(dir);
		return dir;
	}
	const setManifest = (dir, patch) => {
		const p = join(dir, '.grok-plugin/plugin.json');
		writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), ...patch }));
	};

	it('rejects a name Grok Build would reject', () => {
		for (const name of ['Three-WS', '-three', 'three-', 'three_ws', '', 'a'.repeat(65)]) {
			const dir = fixture((d) => setManifest(d, { name }));
			expect(validatePluginTree(dir).join('\n'), JSON.stringify(name)).toMatch(/name/);
		}
	});

	it('rejects a non-semver version, an http MCP server and a command without a description', () => {
		const dir = fixture((d) => {
			setManifest(d, { version: '1.2' });
			writeFileSync(join(d, '.mcp.json'), JSON.stringify({ mcpServers: { x: { type: 'http', url: 'http://three.ws/api/mcp-studio' } } }));
			writeFileSync(join(d, 'commands/broken.md'), '# no frontmatter\n');
		});
		const problems = validatePluginTree(dir).join('\n');
		expect(problems).toMatch(/version "1.2" is not semver/);
		expect(problems).toMatch(/server "x" url must be https/);
		expect(problems).toMatch(/commands\/broken\.md: frontmatter needs a description/);
	});

	it('rejects a plugin agent that declares hooks or MCP servers', () => {
		const dir = fixture((d) => {
			const p = join(d, 'agents/3d-art-director.md');
			writeFileSync(p, readFileSync(p, 'utf8').replace('maxTurns: 14', 'maxTurns: 14\nhooks: {}\nmcpServers: {}'));
		});
		const problems = validatePluginTree(dir).join('\n');
		expect(problems).toMatch(/may not declare hooks/);
		expect(problems).toMatch(/may not declare mcpServers/);
	});

	it('rejects a tree with no manifest', () => {
		const dir = fixture((d) => rmSync(join(d, '.grok-plugin'), { recursive: true }));
		expect(validatePluginTree(dir)[0]).toMatch(/no manifest/);
	});
});

describe('export-plugin-repo guards', () => {
	it('refuses to write over the repository, its parent or the plugin source', () => {
		for (const out of ['.', '..', SRC, `${SRC}/out`]) {
			expect(() => exportPluginRepo({ src: SRC, out, log: quiet }), out).toThrow(/refusing/);
		}
	});

	it('refuses a non-empty directory that is not a previous export', () => {
		const dir = mkdtempSync(join(TMP, 'occupied-'));
		writeFileSync(join(dir, 'keep.txt'), 'mine');
		expect(() => exportPluginRepo({ src: SRC, out: dir, log: quiet })).toThrow(/not a previous export/);
		expect(statSync(join(dir, 'keep.txt')).isFile()).toBe(true);
	});
});
