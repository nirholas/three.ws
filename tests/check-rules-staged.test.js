// The pre-commit hook runs `check-rules.mjs --staged`. It must judge only what
// the commit will contain: an untracked file in a shared worktree (another
// agent's draft) cannot be part of the commit, so it must not block it.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'check-rules.mjs');
const DASH = String.fromCharCode(0x2014);

let repo;
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const run = (...args) =>
	spawnSync(process.execPath, ['scripts/check-rules.mjs', ...args], { cwd: repo, encoding: 'utf8' });

beforeEach(() => {
	repo = mkdtempSync(path.join(tmpdir(), 'check-rules-'));
	git('init', '-q');
	git('config', 'user.email', 'test@example.invalid');
	git('config', 'user.name', 'test');
	mkdirSync(path.join(repo, 'scripts'));
	copyFileSync(SCRIPT, path.join(repo, 'scripts', 'check-rules.mjs'));
	writeFileSync(path.join(repo, 'clean.js'), 'export const a = 1;\n');
	git('add', '.');
	git('commit', '-q', '-m', 'test: seed repository');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('check-rules --staged', () => {
	it('ignores an untracked file that cannot be part of the commit', () => {
		writeFileSync(path.join(repo, 'draft.js'), `// draft ${DASH} not staged\n`);
		writeFileSync(path.join(repo, 'clean.js'), 'export const a = 2;\n');
		git('add', 'clean.js');
		const r = run('--staged');
		expect(r.stderr).not.toMatch(/draft\.js/);
		expect(r.status).toBe(0);
	});

	it('still blocks a staged violation', () => {
		writeFileSync(path.join(repo, 'clean.js'), `// staged ${DASH} line\n`);
		git('add', 'clean.js');
		const r = run('--staged');
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/clean\.js:1/);
	});

	it('still scans untracked files in the default working-tree mode', () => {
		writeFileSync(path.join(repo, 'draft.js'), `// draft ${DASH} not staged\n`);
		const r = run();
		expect(r.status).toBe(1);
		expect(r.stderr).toMatch(/draft\.js/);
	});
});
