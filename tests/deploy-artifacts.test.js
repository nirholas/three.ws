// Guards against the deploy-artifact failure classes behind the 2026-06-11
// production outage (465 consecutive 500s, every deploy red for 90 minutes):
//
//   1. Committed symlinks — Vercel's function bundler cannot resolve them;
//      data/skills/metamask-* killed every build after ~18 min of tracing.
//   2. Unsatisfied peer dependencies — .npmrc legacy-peer-deps=true means npm
//      never auto-installs peers; helius-sdk 3.0's @solana-program/stake peer
//      silently vanished and every /api/cron/* died with ERR_MODULE_NOT_FOUND.
//   3. Undeclared (phantom) bare imports in api/ — they resolve today only via
//      hoisting from some transitive dep, and disappear on the next dedupe.
//   4. An install tree that drifted from package-lock.json. The image installs
//      from the lockfile while local tests run whatever is on disk, so a bump
//      nobody reinstalled ships untested (@x402/extensions 2.25.0, 2026-09-17:
//      every paid x402 route 500ed on import while the suite stayed green).
//
// The same checks gate the Vercel build (scripts/build-vercel.mjs phase 1);
// running them here means `npm test` catches the regression before a push.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
	findCommittedSymlinks,
	findUnsatisfiedPeers,
	findUndeclaredApiImports,
	findLockDrift,
	findWorkspaceLockMismatch,
} from '../scripts/audit-deploy-artifacts.mjs';

const scratchDirs = [];
function scratchDir() {
	const dir = mkdtempSync(join(tmpdir(), 'deploy-artifacts-'));
	scratchDirs.push(dir);
	return dir;
}
afterEach(() => {
	while (scratchDirs.length) rmSync(scratchDirs.pop(), { recursive: true, force: true });
});

describe('deploy artifacts', () => {
	it('has no committed symlinks (Vercel function tracing cannot resolve them)', () => {
		expect(findCommittedSymlinks()).toEqual([]);
	});

	it('has no unsatisfied non-optional peer dependencies in the production lock tree', () => {
		expect(findUnsatisfiedPeers()).toEqual([]);
	});

	it('has no undeclared bare imports in api/', async () => {
		expect(await findUndeclaredApiImports()).toEqual([]);
	});

	it('runs against the dependency versions the lockfile will install in the image', () => {
		expect(findLockDrift()).toEqual([]);
	});

	it('describes every workspace package.json in the lockfile, or npm ci in the image refuses to install', () => {
		expect(findWorkspaceLockMismatch()).toEqual([]);
	});
});

describe('findWorkspaceLockMismatch logic', () => {
	function workspace(root, dir, manifest) {
		mkdirSync(join(root, dir), { recursive: true });
		writeFileSync(join(root, dir, 'package.json'), JSON.stringify(manifest));
	}

	it('reports a renamed, a bumped and an unlocked workspace', () => {
		const root = scratchDir();
		workspace(root, 'packages/cli', { name: '@scope/cli', version: '0.1.1' });
		workspace(root, 'packages/mcp', { name: '@scope/mcp', version: '0.2.7' });
		workspace(root, 'packages/new', { name: '@scope/new', version: '1.0.0' });
		const pkg = { workspaces: ['packages/cli', 'packages/mcp', 'packages/new'] };
		const lock = {
			packages: {
				'packages/cli': { name: 'cli', version: '0.1.1' },
				'packages/mcp': { name: '@scope/mcp', version: '0.2.6' },
			},
		};
		expect(findWorkspaceLockMismatch({ lock, pkg, root })).toEqual([
			{ dir: 'packages/cli', name: '@scope/cli', version: '0.1.1', locked: 'cli@0.1.1' },
			{ dir: 'packages/mcp', name: '@scope/mcp', version: '0.2.7', locked: '@scope/mcp@0.2.6' },
			{ dir: 'packages/new', name: '@scope/new', version: '1.0.0', locked: null },
		]);
	});

	it('passes a workspace whose name and version match its lock entry', () => {
		const root = scratchDir();
		workspace(root, 'packages/cli', { name: '@scope/cli', version: '0.1.1' });
		const pkg = { workspaces: ['packages/cli'] };
		const lock = { packages: { 'packages/cli': { name: '@scope/cli', version: '0.1.1' } } };
		expect(findWorkspaceLockMismatch({ lock, pkg, root })).toEqual([]);
	});
});

describe('findUndeclaredApiImports logic', () => {
	// vitest is a declared devDependency of this repo, which makes it a stable
	// stand-in for "tooling package that is present but not a runtime dependency".
	it('allows a lazy import of a declared devDependency', async () => {
		const apiDir = scratchDir();
		writeFileSync(join(apiDir, 'tool.js'), "export async function run() {\n\treturn import('vitest');\n}\n");
		expect(await findUndeclaredApiImports({ apiDir })).toEqual([]);
	});

	it('still fails a static import of a devDependency, which would load with the handler', async () => {
		const apiDir = scratchDir();
		writeFileSync(join(apiDir, 'handler.js'), "import { vi } from 'vitest';\nexport default vi;\n");
		const problems = await findUndeclaredApiImports({ apiDir });
		expect(problems.map((p) => p.specifier)).toEqual(['vitest']);
	});

	it('still fails a lazy import of a package declared nowhere', async () => {
		const apiDir = scratchDir();
		writeFileSync(join(apiDir, 'tool.js'), "export const load = () => import('three-ws-undeclared-package');\n");
		const problems = await findUndeclaredApiImports({ apiDir });
		expect(problems.map((p) => p.specifier)).toEqual(['three-ws-undeclared-package']);
	});
});

describe('findLockDrift logic', () => {
	function installTree(packages) {
		const root = scratchDir();
		for (const [path, version] of Object.entries(packages)) {
			mkdirSync(join(root, path), { recursive: true });
			writeFileSync(join(root, path, 'package.json'), JSON.stringify({ version }));
		}
		return root;
	}

	it('reports a package installed at a different version than the lockfile pins', () => {
		const root = installTree({ 'node_modules/some-sdk': '2.14.0' });
		const lock = { packages: { '': {}, 'node_modules/some-sdk': { version: '2.25.0' } } };
		expect(findLockDrift({ lock, root })).toEqual([
			{ path: 'node_modules/some-sdk', locked: '2.25.0', installed: '2.14.0', kind: 'stale' },
		]);
	});

	it('reports a locked production package that is not installed at all', () => {
		const root = installTree({});
		const lock = { packages: { '': {}, 'node_modules/some-sdk': { version: '1.0.0' } } };
		expect(findLockDrift({ lock, root })).toEqual([
			{ path: 'node_modules/some-sdk', locked: '1.0.0', installed: null, kind: 'missing' },
		]);
	});

	it('passes a tree that matches, nested installs included', () => {
		const root = installTree({
			'node_modules/some-sdk': '2.25.0',
			'node_modules/some-sdk/node_modules/core': '2.25.0',
		});
		const lock = {
			packages: {
				'': {},
				'node_modules/some-sdk': { version: '2.25.0' },
				'node_modules/some-sdk/node_modules/core': { version: '2.25.0' },
			},
		};
		expect(findLockDrift({ lock, root })).toEqual([]);
	});

	it('ignores dev-only packages, absent optional ones, and workspace links', () => {
		const root = installTree({ 'node_modules/dev-tool': '1.0.0' });
		const lock = {
			packages: {
				'': {},
				'node_modules/dev-tool': { version: '9.9.9', dev: true },
				'node_modules/other-platform-binary': { version: '1.0.0', optional: true },
				'node_modules/workspace-pkg': { resolved: 'packages/workspace-pkg', link: true },
			},
		};
		expect(findLockDrift({ lock, root })).toEqual([]);
	});
});

describe('findUnsatisfiedPeers logic', () => {
	it('flags a missing non-optional peer (the @solana-program/stake class)', () => {
		const lock = {
			packages: {
				'': { dependencies: { 'some-sdk': '^1.0.0' } },
				'node_modules/some-sdk': {
					version: '1.0.0',
					peerDependencies: { 'missing-peer': '^2.0.0' },
				},
			},
		};
		expect(findUnsatisfiedPeers({ lock })).toEqual([
			{ importer: 'node_modules/some-sdk', peer: 'missing-peer' },
		]);
	});

	it('accepts a peer satisfied at the root', () => {
		const lock = {
			packages: {
				'': {},
				'node_modules/some-sdk': {
					version: '1.0.0',
					peerDependencies: { 'present-peer': '^2.0.0' },
				},
				'node_modules/present-peer': { version: '2.1.0' },
			},
		};
		expect(findUnsatisfiedPeers({ lock })).toEqual([]);
	});

	it('accepts a peer satisfied by a nested install on the ancestor chain', () => {
		const lock = {
			packages: {
				'': {},
				'node_modules/parent/node_modules/child': {
					version: '1.0.0',
					peerDependencies: { 'nested-peer': '^1.0.0' },
				},
				'node_modules/parent/node_modules/nested-peer': { version: '1.0.0' },
			},
		};
		expect(findUnsatisfiedPeers({ lock })).toEqual([]);
	});

	it('respects peerDependenciesMeta.optional', () => {
		const lock = {
			packages: {
				'': {},
				'node_modules/some-sdk': {
					version: '1.0.0',
					peerDependencies: { 'optional-peer': '^2.0.0' },
					peerDependenciesMeta: { 'optional-peer': { optional: true } },
				},
			},
		};
		expect(findUnsatisfiedPeers({ lock })).toEqual([]);
	});

	it('ignores dev-only packages (not installed on Vercel function runtime path)', () => {
		const lock = {
			packages: {
				'': {},
				'node_modules/dev-tool': {
					version: '1.0.0',
					dev: true,
					peerDependencies: { 'missing-peer': '^2.0.0' },
				},
			},
		};
		expect(findUnsatisfiedPeers({ lock })).toEqual([]);
	});
});
