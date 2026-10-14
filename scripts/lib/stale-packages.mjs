// Shared staleness check for every npm-publishable package in this repo:
// `scripts/publish-packages.mjs --stale` and `scripts/publish-mcp-servers.mjs --stale`
// both call into this module so the rule lives in exactly one place.
//
// A package is STALE when its local `version` is already on npm and the
// source directory has commits after that version's publish timestamp that
// touch something other than README.md, CHANGELOG.md, or a test file. It is
// UNPUBLISHED when npm has no record of that version at all (a 404 for the
// whole name, or a version npm has never seen) - that is not an error, it
// just means nobody has run the publish script yet.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// Top-level directories (outside packages/) that publish to npm on their own,
// pulled in by name rather than discovered, because they are the only ones.
export const TOP_LEVEL_PUBLISHABLE_DIRS = ['assistant-sdk', 'mcp-server', 'mcp-bridge', 'robinhood/hood-mcp'];

export function isIgnorableFile(path) {
	const base = basename(path);
	if (base === 'README.md' || base === 'CHANGELOG.md') return true;
	if (/\.test\.[cm]?[jt]sx?$/.test(path)) return true;
	if (/(^|\/)(tests?|__tests__)\//.test(path)) return true;
	return false;
}

/**
 * Commits touching `dir` since `sinceISO`, excluding ones whose only changed
 * files are README.md, CHANGELOG.md, or a test file. Runs against whatever
 * git repo contains `cwd` (or `dir` when `cwd` is omitted), so a test can
 * point it at a throwaway repo.
 */
export function commitsSince(dir, sinceISO, { cwd } = {}) {
	// `--since` is inclusive, which would count the publish commit itself (its
	// package.json version bump is real source, not an ignorable file). Push
	// the cutoff one second past the publish timestamp so only commits
	// strictly after it are counted.
	const exclusiveSince = new Date(new Date(sinceISO).getTime() + 1000).toISOString();
	let out;
	try {
		out = execFileSync(
			'git',
			['log', `--since=${exclusiveSince}`, '--name-only', '--pretty=format:%H%x01%s', '--', dir],
			{ cwd: cwd || dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
		);
	} catch {
		return [];
	}
	if (!out.trim()) return [];
	const commits = [];
	for (const block of out.trim().split(/\n\s*\n/)) {
		const lines = block.split('\n').filter((l) => l.length > 0);
		if (!lines.length) continue;
		const sep = lines[0].indexOf('\x01');
		if (sep === -1) continue;
		const hash = lines[0].slice(0, sep);
		const subject = lines[0].slice(sep + 1);
		const files = lines.slice(1).filter((f) => !isIgnorableFile(f));
		if (files.length) commits.push({ hash, subject });
	}
	return commits;
}

/** The highest dist-tag-independent version key in a `npm view <name> time --json` payload. */
export function latestPublishedVersion(npmTime) {
	const keys = Object.keys(npmTime).filter((k) => k !== 'created' && k !== 'modified');
	return keys[keys.length - 1];
}

/**
 * Pure classification: given the local version, the registry's `time`
 * payload (or `null` for "name never published", or `'unreadable'` for a
 * 403), and the commits already filtered by `commitsSince`, decide the
 * status. No I/O, so this is what the recorded-fixture test exercises.
 */
export function classify({ name, dir, localVersion, npmTime, commits }) {
	if (npmTime === 'unreadable') return { name, dir, localVersion, status: 'unreadable' };
	if (npmTime === null) return { name, dir, localVersion, status: 'unpublished' };
	const publishedAt = npmTime[localVersion];
	if (!publishedAt) return { name, dir, localVersion, status: 'unpublished' };
	return {
		name,
		dir,
		localVersion,
		publishedAt,
		npmLatest: latestPublishedVersion(npmTime),
		status: commits.length > 0 ? 'stale' : 'ok',
		commits: commits.length,
		newestCommitSubject: commits[0]?.subject || '',
	};
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

/** `npm view <name> time --json`, treating 404 as "never published" and 403 as "unreadable". */
async function npmViewTime(name, { retries = 3 } = {}) {
	for (let attempt = 0; ; attempt++) {
		try {
			const out = execFileSync('npm', ['view', name, 'time', '--json'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			return JSON.parse(out);
		} catch (err) {
			const stderr = String(err.stderr || err.message || '');
			if (/E404|404 Not Found/i.test(stderr)) return null;
			if (/E403|403 Forbidden/i.test(stderr)) return 'unreadable';
			if (/E429|429 Too Many Requests/i.test(stderr) && attempt < retries) {
				await sleep(500 * 2 ** attempt);
				continue;
			}
			throw new Error(`npm view ${name} time --json failed: ${stderr.split('\n')[0] || err.message}`);
		}
	}
}

async function mapLimit(items, limit, fn) {
	const results = new Array(items.length);
	let next = 0;
	async function worker() {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i], i);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

function readPkg(dir) {
	return JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
}

/**
 * Every directory under `root` that publishes a non-private package.json:
 * all of packages/*, plus the top-level SDK/MCP directories that publish on
 * their own. Lane (library vs MCP server) does not matter here - staleness
 * is checked the same way regardless of which script ships the version bump.
 */
export function discoverPublishableDirs(root) {
	const found = [];
	const packagesDir = resolve(root, 'packages');
	if (existsSync(packagesDir)) {
		for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = `packages/${entry.name}`;
			if (!existsSync(resolve(root, dir, 'package.json'))) continue;
			if (readPkg(resolve(root, dir)).private) continue;
			found.push(dir);
		}
	}
	for (const dir of TOP_LEVEL_PUBLISHABLE_DIRS) {
		if (!existsSync(resolve(root, dir, 'package.json'))) continue;
		if (readPkg(resolve(root, dir)).private) continue;
		found.push(dir);
	}
	return found.sort();
}

/**
 * Runs the full stale check over `dirs` (repo-relative paths) and returns one
 * row per package. `concurrency` caps simultaneous `npm view` calls so a
 * full sweep does not trip the registry's rate limiter.
 */
export async function checkStale(root, dirs, { concurrency = 4 } = {}) {
	return mapLimit(dirs, concurrency, async (dir) => {
		const pkg = readPkg(resolve(root, dir));
		const name = pkg.name;
		const localVersion = pkg.version;
		let npmTime;
		try {
			npmTime = await npmViewTime(name);
		} catch (err) {
			return { name, dir, localVersion, status: 'error', error: err.message };
		}
		const commits =
			npmTime && npmTime !== 'unreadable' && npmTime[localVersion]
				? commitsSince(dir, npmTime[localVersion], { cwd: root })
				: [];
		return classify({ name, dir, localVersion, npmTime, commits });
	});
}

export function formatReport(rows, { root } = {}) {
	const lines = [];
	const stale = rows.filter((r) => r.status === 'stale');
	const ok = rows.filter((r) => r.status === 'ok');
	const unpublished = rows.filter((r) => r.status === 'unpublished');
	const unreadable = rows.filter((r) => r.status === 'unreadable');
	const errored = rows.filter((r) => r.status === 'error');

	lines.push(`${rows.length} publishable packages checked.\n`);
	lines.push(
		'package'.padEnd(38) +
			'local'.padEnd(10) +
			'npm latest'.padEnd(14) +
			'commits since publish'.padEnd(24) +
			'newest commit',
	);
	for (const r of [...stale, ...ok]) {
		lines.push(
			r.name.padEnd(38) +
				r.localVersion.padEnd(10) +
				(r.npmLatest || '').padEnd(14) +
				String(r.commits).padEnd(24) +
				(r.newestCommitSubject || ''),
		);
	}

	if (unpublished.length) {
		lines.push('\nNever published (not an error - nobody has run the publish script for this version yet):');
		for (const r of unpublished) lines.push(`  - ${r.name}@${r.localVersion} (${r.dir})`);
	}
	if (unreadable.length) {
		lines.push('\nUnreadable from this machine (403 on a public lookup):');
		for (const r of unreadable) lines.push(`  - ${r.name} (${r.dir})`);
	}
	if (errored.length) {
		lines.push('\nFailed to check:');
		for (const r of errored) lines.push(`  - ${r.name} (${r.dir}): ${r.error}`);
	}
	if (stale.length) {
		lines.push('\nStale: local version is on npm, but source has moved since. Bump and publish:');
		for (const r of stale) {
			lines.push(`\n${r.name} (${r.dir})`);
			lines.push(`  ${r.commits} commit(s) since ${r.publishedAt}, newest: "${r.newestCommitSubject}"`);
			lines.push(`  bump:    npm version patch --no-git-tag-version --prefix ${r.dir}`);
			const lane = root && existsSync(resolve(root, r.dir, 'server.json'))
				? 'scripts/publish-mcp-servers.mjs'
				: 'scripts/publish-packages.mjs';
			lines.push(`  publish: node ${lane} --only ${basename(r.dir)}`);
		}
	}
	return lines.join('\n');
}

/** Shared CLI entry point so both publish scripts print and exit identically on `--stale`. */
export async function runStaleCli(root) {
	const dirs = discoverPublishableDirs(root);
	const rows = await checkStale(root, dirs);
	console.log(formatReport(rows, { root }));
	const failed = rows.some((r) => r.status === 'error');
	const stale = rows.some((r) => r.status === 'stale');
	if (failed) return 1;
	return stale ? 1 : 0;
}
