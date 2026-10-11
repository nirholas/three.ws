#!/usr/bin/env node
/**
 * Deploy-artifact pre-flight audit.
 *
 * Catches, in seconds, the two failure classes that took production down on
 * 2026-06-11 (465 consecutive 500s + every deploy failing for 90 minutes):
 *
 *   1. Committed symlinks. Vercel's function bundler cannot resolve symlinks
 *      checked into the repo — data/skills/metamask-* (symlinks into
 *      .agents/skills/) failed every build after ~18 minutes of tracing with
 *      "File …/.agents/skills/metamask-agent-workflows does not exist",
 *      which kept the cron/avatar fixes from ever reaching production.
 *
 *   2. Unresolvable runtime imports. .npmrc sets legacy-peer-deps=true, so
 *      npm never auto-installs peer dependencies: when helius-sdk 3.0 moved
 *      @solana-program/stake to peerDependencies, the package silently
 *      vanished from the install tree and every /api/cron/* invocation died
 *      at module load with ERR_MODULE_NOT_FOUND. Two checks close that gap:
 *        a. every non-optional peerDependency in the production lock tree
 *           resolves (with a documented allowlist of known-unused peers);
 *        b. every bare import in api/**∕*.js is declared in package.json —
 *           phantom deps that only exist via hoisting disappear on dedupe.
 *
 *   3. An install tree that no longer matches the lockfile. The image is built
 *      with a clean install from package-lock.json, but every local test and
 *      every deploy worktree (which hardlinks this node_modules) runs whatever
 *      is on disk. When a dependency bump lands in the lockfile and nobody
 *      reinstalls, the suite keeps passing against the OLD version while
 *      production boots the NEW one. On 2026-09-17 that shipped
 *      @x402/extensions 2.25.0, whose resource-server extension throws at
 *      construction without an `origin`: api/_lib/siwx-server.js built it at
 *      module load, so every paidEndpoint() route, /api/mcp, the facilitator
 *      and /.well-known/x402 answered 500 while local tests (on 2.14.0)
 *      stayed green.
 *
 *   4. A workspace package.json that the lockfile does not describe. Renaming
 *      or bumping a workspace (packages/*, the SDKs) without regenerating
 *      package-lock.json leaves the local tree working, because the workspace
 *      is a symlink, while npm ci in the image refuses the whole install. On
 *      2026-10-10 the rename of packages/three-ws-cli to @three-ws/cli failed
 *      the Docker step with "Missing: @three-ws/cli@0.1.1 from lock file".
 *
 * Runs standalone (`node scripts/audit-deploy-artifacts.mjs`), as phase 1 of
 * scripts/build-vercel.mjs, and via tests/deploy-artifacts.test.js.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import { init, parse } from 'es-module-lexer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// 1. Committed symlinks
// ---------------------------------------------------------------------------

/**
 * Returns the repo paths of every symlink in the git index (mode 120000).
 * Local-only symlinks (e.g. .claude/skills/, created by setup-claude-skills.mjs)
 * are gitignored and never appear here; anything that does appear will reach
 * Vercel's checkout and break function tracing.
 */
export function findCommittedSymlinks({ cwd = ROOT } = {}) {
	let out;
	try {
		out = execFileSync('git', ['ls-files', '-s'], {
			cwd,
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch {
		// Vercel's build container has no .git directory, so the index is
		// unavailable there. Committed symlinks materialize as real symlinks in
		// the checkout, so scan the filesystem instead. Skipped dirs are the
		// install-time symlink producers that never reach the git index
		// (node_modules/.bin, setup-claude-skills.mjs → .claude/skills).
		return findSymlinksOnDisk(cwd);
	}
	const symlinks = [];
	for (const line of out.split('\n')) {
		if (line.startsWith('120000 ')) {
			symlinks.push(line.split('\t')[1]);
		}
	}
	return symlinks;
}

const SYMLINK_SCAN_SKIP = new Set(['node_modules', '.git', '.claude', '.vercel', '.next']);

function findSymlinksOnDisk(root) {
	const symlinks = [];
	const stack = [''];
	while (stack.length) {
		const rel = stack.pop();
		let entries;
		try {
			entries = readdirSync(resolve(root, rel), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (SYMLINK_SCAN_SKIP.has(entry.name)) continue;
			const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isSymbolicLink()) symlinks.push(entryRel);
			else if (entry.isDirectory()) stack.push(entryRel);
		}
	}
	return symlinks.sort();
}

// ---------------------------------------------------------------------------
// 2. Unsatisfied peer dependencies in the production lock tree
// ---------------------------------------------------------------------------

// Known-unsatisfied peers verified unused at runtime (types-only packages,
// react-native in a web app, codegen CLIs, optional transports). Keyed as
// "<importer package name>|<peer name>" so npm dedupe moves don't churn the
// list. Anything NOT listed here fails the audit: either install the peer or,
// after verifying the code paths that need it are never reached, add it here
// with a justification.
const KNOWN_UNUSED_PEERS = new Set([
	'@solana/pay|@solana-program/memo', // memo ix builder — we never attach memos via @solana/pay
	'@solana/pay|@solana-program/token-2022', // token-2022 transfers unused (legacy SPL only)
	'@solana/pay|@solana/kit-plugin-instruction-plan', // kit plugin paths unused
	'@solana/pay|@solana/kit-plugin-payer', // kit plugin paths unused
	'@solana/pay|@solana/kit-plugin-rpc', // kit plugin paths unused
	'@hey-api/client-fetch|@hey-api/openapi-ts', // codegen CLI, build-time only
	'@lit/react|@types/react', // types-only
	'@recast-navigation/three|@types/three', // types-only
	'@solana-mobile/mobile-wallet-adapter-protocol|react-native', // web build never hits RN paths
	'@solana/codecs-strings|fastestsmallesttextencoderdecoder', // polyfill for envs without TextEncoder; Node has it
	'@types/react-transition-group|@types/react', // types-only
	'arweave-stream-tx|arweave', // arweave upload path unused
	'colyseus|@colyseus/uwebsockets-transport', // we use the default WS transport
	'livekit-client|@types/dom-mediacapture-record', // types-only
	'react-native-webrtc|react-native', // web build never hits RN paths
	'three-gpu-pathtracer|xatlas-web', // UVUnwrapper-only; we import WebGLPathTracer from the index, which never re-exports UVUnwrapper
	'@web3auth/auth|color', // referenced only in whitelabel .d.ts type declarations, never imported in dist runtime code
	'manifold-3d|esbuild-wasm', // only lib/bundler.js (the manifold-cad editor) imports esbuild; we load manifold.js, the core WASM kernel, which never touches it
]);

function packageNameFromLockPath(lockPath) {
	const idx = lockPath.lastIndexOf('node_modules/');
	return idx === -1 ? lockPath : lockPath.slice(idx + 'node_modules/'.length);
}

/**
 * Walks package-lock.json and returns every non-optional peerDependency of a
 * production package that does not resolve anywhere in the importer's
 * node_modules ancestor chain. This is exactly the hole legacy-peer-deps
 * opens: npm records the peer requirement but never installs it.
 */
export function findUnsatisfiedPeers({ lock } = {}) {
	if (!lock) {
		lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8'));
	}
	const pkgs = lock.packages || {};
	const problems = [];
	for (const [path, info] of Object.entries(pkgs)) {
		if (!path || info.link) continue;
		if (info.dev || info.devOptional) continue;
		const peers = info.peerDependencies || {};
		const meta = info.peerDependenciesMeta || {};
		for (const peer of Object.keys(peers)) {
			if (meta[peer]?.optional) continue;
			let found = false;
			let base = path;
			for (;;) {
				const candidate = `${base ? `${base}/` : ''}node_modules/${peer}`;
				if (pkgs[candidate]) {
					found = true;
					break;
				}
				const idx = base.lastIndexOf('node_modules/');
				if (idx === -1) break;
				base = base.slice(0, idx).replace(/\/$/, '');
			}
			if (!found && !pkgs[`node_modules/${peer}`]) {
				const key = `${packageNameFromLockPath(path)}|${peer}`;
				if (!KNOWN_UNUSED_PEERS.has(key)) {
					problems.push({ importer: path, peer });
				}
			}
		}
	}
	return problems;
}

// ---------------------------------------------------------------------------
// 3. Undeclared bare imports in api/
// ---------------------------------------------------------------------------

function bareSpecifierToPackageName(spec) {
	const parts = spec.split('/');
	return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function workspacePackageNames(rootPkg) {
	const names = new Set();
	for (const pattern of rootPkg.workspaces || []) {
		for (const dir of globSync(pattern, { cwd: ROOT })) {
			const manifest = resolve(ROOT, dir, 'package.json');
			if (!existsSync(manifest)) continue;
			try {
				const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
				if (name) names.add(name);
			} catch {
				// unreadable workspace manifest — covered by npm install itself
			}
		}
	}
	return names;
}

/**
 * Lexes every api/**∕*.js file (static AND literal dynamic imports) and
 * returns bare specifiers whose package is not a Node builtin, not declared
 * in package.json dependencies/optionalDependencies, and not a workspace
 * package. Those imports work today only via hoisting from some transitive
 * dependency — an upstream bump or dedupe deletes them with no signal until
 * the function 500s at runtime.
 */
export async function findUndeclaredApiImports({ apiDir = resolve(ROOT, 'api') } = {}) {
	await init;
	const rootPkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
	const declared = new Set([
		...Object.keys(rootPkg.dependencies || {}),
		...Object.keys(rootPkg.optionalDependencies || {}),
		...workspacePackageNames(rootPkg),
	]);
	// A devDependency is declared, so it is not a phantom, and the Cloud Run image
	// installs devDependencies. It is still only acceptable behind a dynamic
	// import: those are lazy tooling paths (the x-content reviewer's browser and
	// spell checker) that never run at module load, so they cannot take a handler
	// down on import. A static import of one stays a failure.
	const declaredDev = new Set(Object.keys(rootPkg.devDependencies || {}));
	const builtins = new Set(builtinModules);
	const problems = [];
	// Test and test-config files under api/ run via vitest only; they are never
	// part of a deployed function bundle, so their devDep imports are fine.
	const files = globSync('**/*.js', {
		cwd: apiDir,
		absolute: true,
		ignore: ['**/*.test.js', '**/vitest.config.js'],
	});
	for (const file of files) {
		let imports;
		try {
			[imports] = parse(readFileSync(file, 'utf8'));
		} catch (err) {
			problems.push({ file, specifier: null, reason: `parse error: ${err.message}` });
			continue;
		}
		for (const imp of imports) {
			const spec = imp.specifier;
			if (!spec) continue; // non-literal dynamic import
			if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
			const name = bareSpecifierToPackageName(spec);
			if (builtins.has(name) || declared.has(name)) continue;
			if (imp.type === 'dynamic' && declaredDev.has(name)) continue;
			problems.push({
				file,
				specifier: spec,
				reason: 'not declared in package.json dependencies',
			});
		}
	}
	return problems;
}

// ---------------------------------------------------------------------------
// 4. Critical static runtime assets in dist/
// ---------------------------------------------------------------------------
// The Draco/Basis decoder binaries are gitignored (regenerated from
// node_modules by scripts/copy-three-decoders.mjs at postinstall/prebuild),
// so nothing in git guarantees they reach the built dist/. The 2026-07-17
// production sweep found the whole /three/ decoder tree missing from the
// running image: /scene hard-failed and every Draco/KTX2-compressed GLB was
// one asset swap away from breaking. Assert their presence whenever a dist/
// exists (i.e. in any post-build / pre-deploy run).

export function findMissingDistAssets() {
	const dist = resolve(ROOT, 'dist');
	if (!existsSync(dist)) return { skipped: true, missing: [] };
	const required = [
		'three/draco/draco_decoder.wasm',
		'three/draco/gltf/draco_decoder.wasm',
		'three/basis/basis_transcoder.wasm',
		// Scene Studio's <script src="/three/draco/draco_encoder.js"> (pages/scene.html)
		// It shares the single decoder copy rather than carrying its own.
		'three/draco/draco_encoder.js',
		'scene-studio/basis/basis_transcoder.wasm',
	];
	return { skipped: false, missing: required.filter((p) => !existsSync(resolve(dist, p))) };
}

// ---------------------------------------------------------------------------
// 5. Install tree matches the lockfile
// ---------------------------------------------------------------------------

/**
 * Compares every production package in package-lock.json with what is actually
 * installed and returns the ones that differ: `stale` (a different version on
 * disk) or `missing` (nothing on disk). Dev-only packages never reach the
 * image, and optional ones are legitimately absent on a platform they do not
 * target, so neither is reported.
 */
export function findLockDrift({ lock, root = ROOT } = {}) {
	if (!lock) {
		lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
	}
	const drift = [];
	for (const [path, info] of Object.entries(lock.packages || {})) {
		if (!path.startsWith('node_modules/') || info.link) continue;
		if (info.dev || info.devOptional) continue;
		let installed = null;
		try {
			installed = JSON.parse(readFileSync(resolve(root, path, 'package.json'), 'utf8')).version;
		} catch {
			if (info.optional || info.peer) continue;
		}
		if (installed === info.version) continue;
		drift.push({
			path,
			locked: info.version,
			installed,
			kind: installed === null ? 'missing' : 'stale',
		});
	}
	return drift;
}

// ---------------------------------------------------------------------------
// 6. Every workspace package.json matches its lockfile entry
// ---------------------------------------------------------------------------

/**
 * Returns each workspace whose package.json name or version differs from its
 * package-lock.json entry, or that has no entry at all. npm ci rejects the
 * install on any of these, so the image build would fail at the Docker step.
 */
export function findWorkspaceLockMismatch({ lock, pkg, root = ROOT } = {}) {
	if (!lock) lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
	if (!pkg) pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
	const entries = lock.packages || {};
	const mismatches = [];
	for (const dir of pkg.workspaces || []) {
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(resolve(root, dir, 'package.json'), 'utf8'));
		} catch {
			continue;
		}
		const locked = entries[dir];
		if (!locked) {
			mismatches.push({ dir, name: manifest.name, version: manifest.version, locked: null });
			continue;
		}
		if (locked.name !== manifest.name || locked.version !== manifest.version) {
			mismatches.push({
				dir,
				name: manifest.name,
				version: manifest.version,
				locked: `${locked.name}@${locked.version}`,
			});
		}
	}
	return mismatches;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const start = Date.now();
	let failed = false;

	const symlinks = findCommittedSymlinks();
	if (symlinks.length) {
		failed = true;
		console.error(
			`[audit:deploy] FAIL — ${symlinks.length} committed symlink(s); Vercel's bundler cannot resolve them (broke every deploy after c96cdefd):`,
		);
		for (const s of symlinks) console.error(`  ${s}  → replace with a real copy of the target`);
	}

	const peers = findUnsatisfiedPeers();
	if (peers.length) {
		failed = true;
		console.error(
			`[audit:deploy] FAIL — ${peers.length} unsatisfied peer dependency(ies); legacy-peer-deps never installs peers, so these are missing at runtime (the @solana-program/stake outage):`,
		);
		for (const { importer, peer } of peers) {
			console.error(
				`  ${importer} requires ${peer}  → add "${peer}" to package.json dependencies (or allowlist in scripts/audit-deploy-artifacts.mjs after verifying it is unused)`,
			);
		}
	}

	const undeclared = await findUndeclaredApiImports();
	if (undeclared.length) {
		failed = true;
		console.error(
			`[audit:deploy] FAIL — ${undeclared.length} undeclared bare import(s) in api/; phantom deps vanish on dedupe:`,
		);
		for (const { file, specifier, reason } of undeclared) {
			console.error(`  ${file}: ${specifier ?? ''} (${reason})`);
		}
	}

	const distAssets = findMissingDistAssets();
	if (distAssets.skipped) {
		console.log('[audit:deploy] note — no dist/ present, decoder-asset check skipped (run after build to enable)');
	} else if (distAssets.missing.length) {
		failed = true;
		console.error(
			`[audit:deploy] FAIL — ${distAssets.missing.length} critical decoder asset(s) missing from dist/ (the /scene draco outage): run npm install so copy-three-decoders.mjs regenerates public/three, then rebuild:`,
		);
		for (const m of distAssets.missing) console.error(`  dist/${m}`);
	}

	const drift = findLockDrift();
	if (drift.length) {
		failed = true;
		console.error(
			`[audit:deploy] FAIL: ${drift.length} installed package(s) do not match package-lock.json, so local tests are not exercising the versions the image will run (the @x402/extensions 2.25.0 outage). Run \`npm install\`, then \`npm test\`, before deploying:`,
		);
		for (const d of drift.slice(0, 15)) {
			console.error(`  ${d.path}  locked ${d.locked}, ${d.kind === 'missing' ? 'not installed' : `installed ${d.installed}`}`);
		}
		if (drift.length > 15) console.error(`  ... and ${drift.length - 15} more`);
		console.error(
			'  In a deploy worktree node_modules is hardlinked to the shared tree, so do not run npm install or npm ci there: it writes through the links. The shared tree is what drifted (often another agent installing against an uncommitted lockfile). Restore a missing package in the worktree only: `npm pack <name>@<locked version> --pack-destination /tmp`, then untar it into node_modules/<name> with --strip-components=1.',
		);
	}

	const workspaceDrift = findWorkspaceLockMismatch();
	if (workspaceDrift.length) {
		failed = true;
		console.error(
			`[audit:deploy] FAIL: ${workspaceDrift.length} workspace package.json(s) disagree with package-lock.json, so npm ci in the image will refuse to install (the @three-ws/cli rename). Run \`npm install --package-lock-only --ignore-scripts\` in the shared tree and commit package-lock.json:`,
		);
		for (const w of workspaceDrift) {
			console.error(`  ${w.dir}  is ${w.name}@${w.version}, lockfile has ${w.locked ?? 'no entry'}`);
		}
	}

	const elapsed = ((Date.now() - start) / 1000).toFixed(1);
	if (failed) {
		console.error(`\n[audit:deploy] failed in ${elapsed}s`);
		process.exit(1);
	}
	console.log(
		`[audit:deploy] clean in ${elapsed}s: no committed symlinks, no unsatisfied peers, no undeclared api imports, install tree and workspaces match the lockfile, decoder assets ${distAssets.skipped ? 'skipped (no dist/)' : 'present'}`,
	);
}
