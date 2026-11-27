// Tests for the deploy-worktree stager (scripts/prepare-deploy-worktree.mjs).
//
// The script exists because staging a deploy tree by hand failed in three ways
// that all surface minutes later, disguised as something else. Two things are
// worth pinning: that a missing REQUIRED artifact is BUILT rather than quietly
// skipped (skipping is exactly what produced the exit-144 and missing-svelte
// dead builds), and that the hardlink target is rejected up front when it
// cannot possibly hardlink.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	ARTIFACTS,
	planArtifacts,
	cpArgsFor,
	vanishedDuringCopy,
	nodeModulesStrategy,
	installRoomError,
	INSTALL_FREE_FLOOR,
	behindWarning,
	nextSteps,
} from '../scripts/prepare-deploy-worktree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts/prepare-deploy-worktree.mjs');

// Plan-mode targets derived from this checkout, never from one machine's layout
// (the default /workspaces/.deploy-wt only exists in a codespace).
const sameDevice = (dir) => existsSync(dir) && statSync(dir).dev === statSync(ROOT).dev;
// A directory beside the checkout when that shares its filesystem, else one
// inside it; either way a path that does not exist yet, so plan mode can run.
const PLAN_PARENT = sameDevice(path.dirname(ROOT)) ? path.dirname(ROOT) : ROOT;
const UNUSED_TARGET = path.join(PLAN_PARENT, `.deploy-wt-vitest-unused-${process.pid}`);
// A mount that is certainly not the checkout's, for the cross-filesystem guard.
const FOREIGN_FS = ['/dev', '/proc', '/sys', tmpdir()].find((dir) => existsSync(dir) && !sameDevice(dir));

/** Run the script in plan mode. It writes nothing, so this is safe in CI. */
function plan(args) {
	try {
		const stdout = execFileSync('node', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
		return { code: 0, out: stdout };
	} catch (err) {
		return { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
	}
}

describe('ARTIFACTS', () => {
	it('covers every artifact a fresh worktree cannot produce, none of them optional', () => {
		const required = ARTIFACTS.filter((a) => !a.optional).map((a) => a.rel);
		expect(required).toEqual([
			'node_modules',
			'chat/node_modules',
			'character-studio/build',
			// Gitignored, so a fresh worktree has agent-payments-sdk/ source with
			// no entry behind its package.json main/module/exports.
			'agent-payments-sdk/dist',
		]);
	});

	it('can regenerate every required artifact except the root dependency tree', () => {
		for (const a of ARTIFACTS.filter((x) => !x.optional && x.rel !== 'node_modules')) {
			expect(a.build, `${a.rel} needs a build command`).toBeTruthy();
		}
		// node_modules cannot be rebuilt from inside a deploy prep step without
		// re-resolving the lockfile, so its absence must stop the run instead.
		expect(ARTIFACTS.find((a) => a.rel === 'node_modules').build).toBe(null);
	});

	it('stages every nested workspace dependency tree the root lockfile records', () => {
		// A workspace whose deps conflict with the root's gets its own
		// node_modules (packages/skill-import holds js-yaml 5 under a root
		// js-yaml 3). Left out of the worktree, Node resolves the hoisted copy
		// instead, and check:api-imports dies on "does not provide an export
		// named 'load'" for a commit that is fine (2026-10-30).
		const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
		const nested = new Set();
		for (const key of Object.keys(lock.packages)) {
			if (!key || key.startsWith('node_modules/') || !key.includes('/node_modules/')) continue;
			nested.add(`${key.split('/node_modules/')[0]}/node_modules`);
		}
		const staged = new Set(ARTIFACTS.map((a) => a.rel));
		expect([...nested].filter((rel) => !staged.has(rel)).sort()).toEqual([]);
	});
});

describe('planArtifacts', () => {
	it('stages everything when the source tree is fully populated', () => {
		const p = planArtifacts(() => true);
		expect(p.every((x) => x.action === 'stage')).toBe(true);
	});

	it('builds a missing nested artifact rather than skipping it', () => {
		const p = planArtifacts((rel) => rel !== 'character-studio/build' && rel !== 'chat/node_modules');
		const byRel = Object.fromEntries(p.map((x) => [x.rel, x.action]));
		expect(byRel['character-studio/build']).toBe('build');
		expect(byRel['chat/node_modules']).toBe('build');
	});

	it('blocks, never builds, when the root dependency tree is absent', () => {
		const p = planArtifacts((rel) => rel !== 'node_modules');
		expect(p.find((x) => x.rel === 'node_modules').action).toBe('blocked');
	});

	it('skips an absent optional artifact without blocking the run', () => {
		const p = planArtifacts((rel) => !rel.startsWith('character-studio/node_modules'));
		expect(p.find((x) => x.rel === 'character-studio/node_modules').action).toBe('skip');
		expect(p.some((x) => x.action === 'blocked')).toBe(false);
	});

	it('hands node_modules and every nested workspace tree to npm ci when installing fresh, even if the source lacks them', () => {
		const artifacts = [
			{ rel: 'node_modules', build: null },
			{ rel: 'chat/node_modules', build: ['npm', ['run', 'deps:chat']] },
			{ rel: 'packages/skill-import/node_modules', build: null, optional: true },
		];
		const p = planArtifacts(() => false, artifacts, new Set(['node_modules', 'packages/skill-import/node_modules']));
		expect(p.map((x) => x.action)).toEqual(['install', 'build', 'install']);
	});
});

describe('cpArgsFor', () => {
	it('hardlinks the whole artifact when the worktree has no such directory', () => {
		expect(cpArgsFor('/src/node_modules', '/wt/node_modules', false)).toEqual([
			'-al',
			'/src/node_modules',
			'/wt/node_modules',
		]);
	});

	it('fills in a directory git already created rather than skipping it', () => {
		// animation-sources is half tracked (.fbx) and half gitignored (.glb), so
		// checkout creates it with only the tracked half. Skipping it on the
		// grounds that it exists is what left the glb-diff and model-diff suites
		// failing on 25 missing fixtures in a freshly staged tree.
		expect(cpArgsFor('/src/animation-sources', '/wt/animation-sources', true)).toEqual([
			'-al',
			'--update=none',
			'/src/animation-sources/.',
			'/wt/animation-sources/',
		]);
	});

	it('never overwrites a file the worktree already owns', () => {
		// A tracked file hardlinked from the source tree would make an edit in the
		// deploy tree rewrite the shared tree through the shared inode.
		expect(cpArgsFor('/src/x', '/wt/x', true)).toContain('--update=none');
	});
});

describe('vanishedDuringCopy', () => {
	// 2026-11-06: a vitest run in the shared tree deleted its own
	// node_modules/.vitest-cache temp file while `cp -al` walked node_modules,
	// and prep:worktree died on a file nobody needed.
	const gone = () => false;

	it('accepts a copy whose only errors are source files deleted mid-walk', () => {
		const stderr =
			"cp: cannot stat '/r/node_modules/.vitest-cache/.tmp-1793924678541-p1u50spvi9': No such file or directory\n";
		expect(vanishedDuringCopy(stderr, gone)).toEqual(['/r/node_modules/.vitest-cache/.tmp-1793924678541-p1u50spvi9']);
	});

	it('refuses when the "missing" file is actually still there', () => {
		const stderr = "cp: cannot stat '/r/node_modules/a.js': No such file or directory\n";
		expect(vanishedDuringCopy(stderr, () => true)).toBeNull();
	});

	it('refuses any other cp failure, alone or mixed with a vanished file', () => {
		expect(vanishedDuringCopy("cp: cannot create hard link '/wt/x' to '/r/x': No space left on device\n", gone)).toBeNull();
		const mixed =
			"cp: cannot stat '/r/node_modules/.cache/t': No such file or directory\ncp: cannot create hard link '/wt/y' to '/r/y': Invalid cross-device link\n";
		expect(vanishedDuringCopy(mixed, gone)).toBeNull();
	});

	it('refuses an empty stderr, since then the failure is unexplained', () => {
		expect(vanishedDuringCopy('', gone)).toBeNull();
	});
});

describe('guards (plan mode, writes nothing)', () => {
	it('refuses a target on another filesystem, where cp -al cannot hardlink', () => {
		expect(FOREIGN_FS, 'no mount on this host differs from the checkout').toBeTruthy();
		const r = plan(['--path', path.join(FOREIGN_FS, 'deploy-wt-vitest-probe')]);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/different filesystem/);
	});

	it('refuses a --path with no argument instead of staging somewhere unintended', () => {
		const r = plan(['--path', '--apply']);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/--path needs a directory argument/);
	});

	it('refuses to stage over the main worktree', () => {
		const r = plan(['--path', ROOT]);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/must not be the main worktree/);
	});

	it('plans without applying by default, and says so', () => {
		expect(existsSync(UNUSED_TARGET)).toBe(false);
		const r = plan(['--path', UNUSED_TARGET]);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/Plan only\. Re-run with --apply/);
		for (const a of ARTIFACTS.filter((x) => !x.optional)) expect(r.out).toContain(a.rel);
		expect(existsSync(UNUSED_TARGET)).toBe(false);
	});
});

// The shared checkout can sit far behind the tip while other sessions hold
// uncommitted work in it, so HEAD is not always the commit the owner means to
// ship (2026-11-27: local main was 226 commits behind threews/main and
// could not fast-forward). --ref stages any commit without moving that tree.
describe('--ref (plan mode, writes nothing)', () => {
	it('stages the commit --ref names instead of HEAD', () => {
		const parent = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: ROOT, encoding: 'utf8' }).trim();
		const r = plan(['--path', UNUSED_TARGET, '--ref', 'HEAD~1']);
		expect(r.code, r.out).toBe(0);
		expect(r.out).toContain(`at ${parent.slice(0, 9)}`);
	});

	it('refuses a --ref that is not a commit here, and says how to fix it', () => {
		const r = plan(['--path', UNUSED_TARGET, '--ref', 'no-such-branch-vitest']);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/--ref no-such-branch-vitest is not a commit in this repository/);
		expect(r.out).toContain('git fetch threews');
	});

	it('refuses a --ref with no argument instead of staging HEAD by surprise', () => {
		// --ref last and no --apply anywhere: if the flag ever stops being parsed,
		// this run stays a plan and fails the assertion instead of staging a tree.
		const r = plan(['--path', UNUSED_TARGET, '--ref']);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/--ref needs a commit argument/);
		expect(existsSync(UNUSED_TARGET)).toBe(false);
	});
});

// A hardlinked node_modules that does not match the lockfile being shipped is a
// guaranteed audit:deploy refusal fifteen minutes later, and npm ci cannot be
// run inside a hardlinked tree because it writes through the links.
describe('nodeModulesStrategy', () => {
	it('hardlinks the shared tree when it matches the lockfile being shipped', () => {
		expect(nodeModulesStrategy([])).toEqual({ mode: 'hardlink' });
	});

	it('installs fresh when any production package differs, and names the drift', () => {
		const s = nodeModulesStrategy([
			{ path: 'node_modules/cborg', locked: '7.0.0', installed: '6.2.1', kind: 'stale' },
			{ path: 'node_modules/ai/node_modules/@ai-sdk/provider', locked: '4.0.39', installed: null, kind: 'missing' },
		]);
		expect(s.mode).toBe('install');
		expect(s.count).toBe(2);
		expect(s.reason).toContain('node_modules/cborg locked 7.0.0, installed 6.2.1');
		expect(s.reason).toContain('node_modules/ai/node_modules/@ai-sdk/provider locked 4.0.39, not installed');
	});
});

// A fresh install is about 5.5 GB on this repository, on a disk other sessions
// share. Starting one that cannot finish fills the disk for everyone.
describe('installRoomError', () => {
	it('allows the install when the target filesystem has room for it', () => {
		expect(installRoomError(INSTALL_FREE_FLOOR)).toBeNull();
		expect(installRoomError(40 * 1024 ** 3)).toBeNull();
	});

	it('refuses before installing on a nearly full disk, and says how to make room', () => {
		const msg = installRoomError(3 * 1024 ** 3);
		expect(msg).toContain('3.0 GiB free');
		expect(msg).toContain('npm run clean:worktrees -- --apply');
	});
});

describe('behindWarning', () => {
	it('says nothing when the staged commit already carries the tip', () => {
		expect(behindWarning('10eca1fed00', 0)).toBeNull();
	});

	it('names the gap and the flag that ships the tip instead', () => {
		const w = behindWarning('cb2caf88d00', 226);
		expect(w).toContain('cb2caf88d is 226 commit(s) behind threews/main');
		expect(w).toContain('--ref threews/main');
	});
});

describe('nextSteps', () => {
	it('hands over the one gated deploy command, never a bare gcloud builds submit', () => {
		const out = nextSteps('/srv/.deploy-wt', {}).join('\n');
		expect(out).toContain('cd /srv/.deploy-wt && npm run deploy:gcp:full');
		expect(out).not.toContain('gcloud builds submit');
	});

	it('submits only for a project that has not cut over, so crons never run twice', () => {
		const out = nextSteps('/srv/.deploy-wt', { GCP_PROJECT: 'three-ws', GCP_BUILD_MACHINE_TYPE: 'e2-medium' }).join('\n');
		expect(out).toContain('cd /srv/.deploy-wt && npm run build:gcp && GCP_PROJECT=three-ws GCP_BUILD_MACHINE_TYPE=e2-medium npm run deploy:gcp:submit');
		expect(out).not.toContain('deploy:gcp:full');
		expect(out).not.toContain('gcloud builds submit');
	});
});
