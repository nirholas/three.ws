// The Cursor Marketplace reviews a plugin as its own repository, so
// scripts/export-plugin-repo.mjs has to turn integrations/cursor/three-ws into a
// tree with .cursor-plugin/plugin.json at the root, rules and skills beside it,
// one reproducible commit, and nothing the Cursor validator would bounce. A
// broken plugin must not produce an export at all.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { exportPluginRepo } from '../scripts/export-plugin-repo.mjs';
import { validateCursorPlugin } from '../scripts/validate-cursor-plugin.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = 'integrations/cursor/three-ws';
const TMP = mkdtempSync(join(tmpdir(), 'cursor-plugin-export-'));
// A broken copy has to live inside the repository (the exporter only reads
// plugins it can take git history from); .data/ is gitignored scratch space.
const IN_REPO_TMP = join(ROOT, '.data', `cursor-plugin-export-test-${process.pid}`);
const quiet = () => {};
const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true });
	rmSync(IN_REPO_TMP, { recursive: true, force: true });
});

describe('export-plugin-repo on the Cursor plugin', () => {
	const first = exportPluginRepo({ src: SRC, out: join(TMP, 'a'), log: quiet });
	const second = exportPluginRepo({ src: SRC, out: join(TMP, 'b'), log: quiet });

	it('puts .cursor-plugin/plugin.json at the root with every component and the repository files', () => {
		expect(existsSync(join(first.out, '.cursor-plugin/plugin.json'))).toBe(true);
		const top = readdirSync(first.out);
		for (const f of ['mcp.json', 'rules', 'skills', 'assets', 'README.md', 'LICENSE', 'CHANGELOG.md', '.gitignore']) expect(top, f).toContain(f);
		for (const f of readdirSync(join(ROOT, SRC))) expect(top, f).toContain(f);
		expect(readFileSync(join(first.out, '.gitignore'), 'utf8')).toBe('node_modules/\n.DS_Store\n');
	});

	it('passes the Cursor validator after export', () => {
		const res = validateCursorPlugin(first.out);
		expect(res.errors).toEqual([]);
		expect(res.components.rules.length).toBeGreaterThan(0);
	});

	it('is one clean, reproducible commit', () => {
		expect(git(first.out, ['rev-list', '--count', 'HEAD'])).toBe('1');
		expect(git(first.out, ['status', '--porcelain'])).toBe('');
		expect(second.sha).toBe(first.sha);
	});

	it('records every commit that touched the plugin in CHANGELOG.md', () => {
		const changelog = readFileSync(join(first.out, 'CHANGELOG.md'), 'utf8');
		for (const sha of git(ROOT, ['log', '--format=%H', '--', SRC]).split('\n').filter(Boolean)) expect(changelog, sha).toContain(`/commit/${sha}`);
	});
});

describe('export-plugin-repo refuses a Cursor plugin the validator rejects', () => {
	it('writes nothing when the logo the manifest names is missing', () => {
		mkdirSync(IN_REPO_TMP, { recursive: true });
		const src = join(IN_REPO_TMP, 'broken');
		cpSync(join(ROOT, SRC), src, { recursive: true });
		unlinkSync(join(src, 'assets/logo.svg'));
		const out = join(TMP, 'broken-out');
		expect(() => exportPluginRepo({ src, out, log: quiet })).toThrow(/validate-cursor-plugin[\s\S]*logo "assets\/logo\.svg" does not exist/);
		expect(existsSync(out)).toBe(false);
	});
});
