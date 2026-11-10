// services/autopilot/run.sh installs dependencies only when they are out of
// date. A tick whose `npm ci` fails must not leave the next tick believing the
// install is current: on 2026-11-10 a failed install at 16:05 moved the clone's
// HEAD forward, the 18:10 tick saw no lockfile change since that HEAD, skipped
// `npm ci`, and ran on a broken node_modules. These tests run the real
// install_deps from run.sh against a stub npm in a throwaway git repo.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const runSh = readFileSync(join(import.meta.dirname, '..', 'services', 'autopilot', 'run.sh'), 'utf8');

// Every top-level function the install step depends on, copied verbatim from run.sh.
function fn(name) {
	const m = runSh.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'));
	return m ? m[0] : '';
}
const installFns = ['changed_since_prev', 'installed_matches', 'mark_installed', 'install_deps'].map(fn).filter(Boolean).join('\n');

let root;
let repo;
let calls;

function git(...args) {
	const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
	expect(r.status, r.stderr).toBe(0);
	return r.stdout.trim();
}

function commitLock(version) {
	writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ version }));
	git('add', 'package-lock.json');
	git('commit', '-qm', `lock ${version}`);
	return git('rev-parse', 'HEAD');
}

// One tick's install step: PREV_HEAD is the clone's HEAD before this tick's sync.
function tick(prevHead, { failCi = false } = {}) {
	const script = [
		'set -uo pipefail',
		'log() { :; }',
		'note() { :; }',
		`BASE_DIR=${JSON.stringify(root)}`,
		`PREV_HEAD=${JSON.stringify(prevHead)}`,
		installFns,
		`cd ${JSON.stringify(repo)}`,
		'install_deps',
	].join('\n');
	return spawnSync('bash', ['-c', script], {
		encoding: 'utf8',
		env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, FAIL_CI: failCi ? '1' : '', CALLS: calls },
	});
}

const ciRuns = () => (existsSync(calls) ? readFileSync(calls, 'utf8') : '').split('\n').filter((l) => l === 'npm ci --no-audit --no-fund').length;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'autopilot-install-'));
	repo = join(root, 'three.ws');
	calls = join(root, 'calls.log');
	mkdirSync(join(root, 'bin'));
	// npm and npx stubs: record every call; `npm ci` at the root fails when FAIL_CI is set.
	writeFileSync(join(root, 'bin', 'npm'), '#!/bin/bash\necho "npm $*" >>"$CALLS"\nif [ "$1" = ci ] && [ -n "$FAIL_CI" ] && [ "$2" != --prefix ]; then exit 1; fi\nexit 0\n');
	writeFileSync(join(root, 'bin', 'npx'), '#!/bin/bash\necho "npx $*" >>"$CALLS"\nexit 0\n');
	chmodSync(join(root, 'bin', 'npm'), 0o755);
	chmodSync(join(root, 'bin', 'npx'), 0o755);
	mkdirSync(repo);
	git('init', '-q');
	git('config', 'user.email', 'autopilot@test.invalid');
	git('config', 'user.name', 'autopilot test');
	mkdirSync(join(repo, 'character-studio', 'build'), { recursive: true });
	writeFileSync(join(repo, 'character-studio', 'package.json'), '{}');
	writeFileSync(join(repo, 'character-studio', 'build', 'index.html'), '');
	git('add', 'character-studio/package.json');
	mkdirSync(join(repo, 'node_modules'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('autopilot install_deps', () => {
	it('retries npm ci on the next tick after a failed install, even with no new lockfile change', () => {
		const first = commitLock(1);
		// Establish an installed baseline at lock 1.
		expect(tick('0000000000000000000000000000000000000000').status).toBe(0);
		const second = commitLock(2);
		// The 16:05 tick: lockfile changed, npm ci fails.
		expect(tick(first, { failCi: true }).status).toBe(1);
		const before = ciRuns();
		// The 18:10 tick: the clone already sits at `second`, so nothing changed since its HEAD.
		expect(tick(second).status).toBe(0);
		expect(ciRuns()).toBe(before + 1);
	});

	it('skips npm ci when the lockfile it last installed successfully is unchanged', () => {
		const head = commitLock(1);
		expect(tick('0000000000000000000000000000000000000000').status).toBe(0);
		const before = ciRuns();
		expect(tick(head).status).toBe(0);
		expect(ciRuns()).toBe(before);
	});
});
