#!/usr/bin/env node
/**
 * Re-verify every Robinhood Chain package under robinhood/ in one command.
 *
 * Per package: install from its own lockfile (skipped when node_modules is
 * already present), run its `build` script if it has one, then its `test`
 * script. Once per run it also probes the live chain: `eth_chainId` against the
 * mainnet (4663) and testnet (46630) RPC endpoints the SDK documents. Prints one
 * row per package and exits non-zero when any package or probe fails.
 *
 * The robinhood/ copies are reference snapshots of standalone repos (see
 * robinhood/README.md), so this script never publishes or syncs anything.
 *
 * `--live` additionally runs each package's opt-in `test:live` suite. Those hit
 * real upstreams; when the public Blockscout explorer answers this machine with
 * a Cloudflare bot challenge (datacenter egress), a failing live suite is
 * reported as `blocked` instead of `FAIL`, because no code change can pass it.
 *
 * Usage:
 *   node scripts/verify-robinhood-repos.mjs [--jobs N] [--only a,b] [--live]
 *                                           [--skip-install] [--skip-build]
 *                                           [--skip-probe] [--json]
 *
 * Exit codes: 0 all green, 1 at least one package or probe failed, 2 bad usage.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITE = path.join(ROOT, 'robinhood');

/** Chain endpoints the SDK documents (robinhood/robinhood-chain-sdk). */
export const PROBES = [
	{ name: 'mainnet', url: 'https://rpc.mainnet.chain.robinhood.com', chainId: 4663 },
	{ name: 'testnet', url: 'https://rpc.testnet.chain.robinhood.com', chainId: 46630 },
];

/** @param {string[]} argv */
export function parseArgs(argv) {
	const opts = { jobs: 2, only: null, live: false, install: true, build: true, probe: true, json: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--jobs') opts.jobs = Number(argv[++i]);
		else if (a === '--only') opts.only = String(argv[++i] || '').split(',').filter(Boolean);
		else if (a === '--live') opts.live = true;
		else if (a === '--skip-install') opts.install = false;
		else if (a === '--skip-build') opts.build = false;
		else if (a === '--skip-probe') opts.probe = false;
		else if (a === '--json') opts.json = true;
		else throw new Error(`Unknown argument: ${a}`);
	}
	if (!Number.isInteger(opts.jobs) || opts.jobs < 1) throw new Error('--jobs needs a positive integer');
	return opts;
}

/** Names of sibling packages this one links with a `file:../name` dependency. */
export function siblingDeps(pkg) {
	const found = new Set();
	for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
		for (const spec of Object.values(pkg[field] || {})) {
			const m = /^file:\.\.\/([^/]+)/.exec(spec);
			if (m) found.add(m[1]);
		}
	}
	return [...found];
}

/** Every direct child of robinhood/ that has a package.json, sorted by name. */
export function discoverPackages(suiteDir = SUITE) {
	return readdirSync(suiteDir)
		.filter((n) => statSync(path.join(suiteDir, n)).isDirectory())
		.filter((n) => existsSync(path.join(suiteDir, n, 'package.json')))
		.sort()
		.map((name) => {
			const dir = path.join(suiteDir, name);
			const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
			return {
				name,
				dir,
				siblings: siblingDeps(pkg),
				hasLock: existsSync(path.join(dir, 'package-lock.json')),
				hasModules: existsSync(path.join(dir, 'node_modules')),
				hasBuild: Boolean(pkg.scripts?.build),
				hasTest: Boolean(pkg.scripts?.test),
				hasLive: Boolean(pkg.scripts?.['test:live']),
			};
		});
}

/**
 * Run a command, capture combined output, resolve with { code, out, ms }.
 * @param {string} cmd @param {string[]} args @param {string} cwd
 */
function run(cmd, args, cwd) {
	return new Promise((resolve) => {
		const started = Date.now();
		const child = spawn(cmd, args, { cwd, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (out += d));
		child.on('error', (e) => resolve({ code: 127, out: String(e), ms: Date.now() - started }));
		child.on('close', (code) => resolve({ code: code ?? 1, out, ms: Date.now() - started }));
	});
}

/** Last few meaningful lines of a failed step, for the failure report. */
function tail(out, n = 12) {
	return out.trim().split('\n').slice(-n).join('\n');
}

/** Pull "N passed" out of vitest or node:test output. Null when not found. */
export function parseTestCount(raw) {
	const out = raw.replace(/\u001b\[[0-9;]*m/g, '');
	const vitest = out.match(/Tests\s+(?:\d+ failed \| )?(\d+) passed/);
	if (vitest) return Number(vitest[1]);
	const nodeTest = out.match(/^(?:#|\u2139)\s*pass (\d+)/m);
	if (nodeTest) return Number(nodeTest[1]);
	return null;
}

async function verifyPackage(p, opts) {
	const row = { name: p.name, install: 'skip', build: 'skip', test: 'skip', tests: null, live: 'skip', ok: true, failure: '' };
	const fail = (step, res) => {
		row[step] = 'FAIL';
		row.ok = false;
		row.failure = `${step} exited ${res.code}\n${tail(res.out)}`;
	};

	if (opts.install && !p.hasModules) {
		const args = p.hasLock
			? ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline']
			: ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'];
		const res = await run('npm', args, p.dir);
		if (res.code !== 0) {
			fail('install', res);
			return row;
		}
		row.install = 'ok';
	} else if (p.hasModules) {
		row.install = 'cached';
	}

	if (opts.build && p.hasBuild) {
		const res = await run('npm', ['run', 'build', '--silent'], p.dir);
		if (res.code !== 0) {
			fail('build', res);
			return row;
		}
		row.build = 'ok';
	}

	if (p.hasTest) {
		const res = await run('npm', ['test', '--silent'], p.dir);
		if (res.code !== 0) {
			fail('test', res);
			return row;
		}
		row.test = 'ok';
		row.tests = parseTestCount(res.out);
	}

	if (opts.live && p.hasLive) {
		const res = await run('npm', ['run', 'test:live', '--silent'], p.dir);
		if (res.code === 0) row.live = 'ok';
		else if (opts.explorerChallenged) row.live = 'blocked';
		else fail('live', res);
	}
	return row;
}

/** eth_chainId against one endpoint. */
export async function probeChain({ name, url, chainId }, fetchImpl = fetch) {
	try {
		const res = await fetchImpl(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) return { name, url, ok: false, detail: `HTTP ${res.status}` };
		const body = await res.json();
		const got = Number.parseInt(body.result, 16);
		return got === chainId
			? { name, url, ok: true, detail: `chain ${got}` }
			: { name, url, ok: false, detail: `expected chain ${chainId}, got ${body.result ?? JSON.stringify(body.error)}` };
	} catch (err) {
		return { name, url, ok: false, detail: err?.message || String(err) };
	}
}

/**
 * Verify every package with at most `limit` in flight, starting a package only
 * after the sibling packages it links via `file:../` have finished: those
 * resolve through the sibling's built dist/, so verifying them concurrently
 * races the sibling's build.
 */
/**
 * True when the public explorer answers with a Cloudflare managed challenge,
 * which every Blockscout-backed live suite then fails on regardless of code.
 */
export async function explorerChallenged(fetchImpl = fetch) {
	try {
		const res = await fetchImpl('https://robinhoodchain.blockscout.com/api/v2/stats', {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(15_000),
		});
		return res.headers.get('cf-mitigated') === 'challenge';
	} catch {
		return false;
	}
}

async function verifyAll(packages, opts) {
	const byName = new Map(packages.map((p) => [p.name, p]));
	const done = new Map();
	let free = opts.jobs;
	const waiters = [];
	const acquire = () =>
		free > 0 ? (free--, Promise.resolve()) : new Promise((resolve) => waiters.push(resolve));
	const release = () => (waiters.length ? waiters.shift()() : free++);

	const start = (p) => {
		if (!done.has(p.name)) {
			const deps = p.siblings.filter((n) => byName.has(n)).map((n) => start(byName.get(n)));
			done.set(
				p.name,
				Promise.all(deps).then(async () => {
					await acquire();
					try {
						return await verifyPackage(p, opts);
					} finally {
						release();
					}
				}),
			);
		}
		return done.get(p.name);
	};
	return Promise.all(packages.map(start));
}

function pad(s, n) {
	return String(s).padEnd(n);
}

/** Tracked-file changes under robinhood/, as `git status --porcelain` lines. */
function dirtyLines() {
	try {
		const out = execFileSync('git', ['status', '--porcelain', '--', 'robinhood'], { cwd: ROOT, encoding: 'utf8' });
		return new Set(out.split('\n').filter(Boolean));
	} catch {
		return new Set();
	}
}

async function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(`verify-robinhood-repos: ${err.message}`);
		process.exit(2);
	}

	let packages = discoverPackages();
	if (opts.only) {
		const unknown = opts.only.filter((n) => !packages.some((p) => p.name === n));
		if (unknown.length) {
			console.error(`verify-robinhood-repos: no such package: ${unknown.join(', ')}`);
			process.exit(2);
		}
		packages = packages.filter((p) => opts.only.includes(p.name));
	}

	const dirtyBefore = dirtyLines();
	const probeTask = opts.probe ? Promise.all(PROBES.map((p) => probeChain(p))) : Promise.resolve([]);
	if (opts.live) opts.explorerChallenged = await explorerChallenged();
	const rows = await verifyAll(packages, opts);
	const probes = await probeTask;

	if (opts.json) {
		console.log(JSON.stringify({ packages: rows, probes }, null, 2));
	} else {
		console.log(`${pad('package', 28)}${pad('install', 9)}${pad('build', 7)}${pad('test', 7)}${pad('tests', 7)}${opts.live ? 'live' : ''}`);
		for (const r of rows) {
			console.log(`${pad(r.name, 28)}${pad(r.install, 9)}${pad(r.build, 7)}${pad(r.test, 7)}${pad(r.tests ?? '-', 7)}${opts.live ? r.live : ''}`);
		}
		for (const pr of probes) {
			console.log(`probe ${pad(pr.name, 8)} ${pad(pr.ok ? 'ok' : 'FAIL', 5)} ${pr.url} (${pr.detail})`);
		}
		if (opts.live && opts.explorerChallenged) {
			console.log('note: the Blockscout explorer is behind a Cloudflare challenge from this machine; failing live suites are marked blocked');
		}
		for (const r of rows.filter((x) => !x.ok)) console.error(`\n--- ${r.name}: ${r.failure}`);
		const touched = [...dirtyLines()].filter((l) => !dirtyBefore.has(l));
		if (touched.length) {
			console.log('\nnote: building regenerated tracked files under robinhood/ (restore with git checkout -- <path> if unwanted):');
			for (const l of touched) console.log(`  ${l}`);
		}
		const bad = rows.filter((r) => !r.ok).length + probes.filter((p) => !p.ok).length;
		console.log(`\n${rows.length} package row(s), ${probes.length} probe(s), ${bad} failing`);
	}

	process.exit(rows.every((r) => r.ok) && probes.every((p) => p.ok) ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
