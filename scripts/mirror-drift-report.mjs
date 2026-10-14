#!/usr/bin/env node
// Read-only drift report between the monorepo and its public GitHub mirrors.
//
// For every outbound mirror in data/standalone-mirrors.json, this finds the
// monorepo commit the mirror was last synced from (via the GitHub commits
// API, searching for a "Sync from three.ws@<sha>" subject), then three-way
// compares: the mirror's current GitHub HEAD, the monorepo directory AT that
// sync commit, and the monorepo directory NOW. That tells apart changes made
// only on GitHub (would be erased by a blind re-sync), changes made only
// here (already covered by the next sync), and changes made in both.
//
// Never checks anything out locally and never adds a remote: upstream
// content is downloaded as a tarball into a scratch dir and read as data.
//
// The commits API is unauthenticated (60 requests/hour). Priority mirrors
// (named in prompts/finish/501, most likely to carry a real fix) are
// resolved first so they get a real lookup before the budget runs out; once
// the API starts returning 403/429 every remaining mirror falls back to a
// timestamp heuristic (the sync point is approximated as the newest
// monorepo commit touching that path at or before the mirror tarball's
// commit time), and the report says so.
//
// Usage: node scripts/mirror-drift-report.mjs   (npm run mirrors:drift)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fixLicenseFooter } from './lib/standalone-kit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'nirholas';

const PRIORITY_REPOS = [
	'avatar-agent-mcp',
	'threews-avatar-mcp',
	'readme-3d',
	'3d-avatar-companion',
	'x402-fetch',
	'x402-server',
	'x402-modal',
	'x402-payment-modal',
];

function git(args) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

// ── manifest + repo-name resolution ─────────────────────────────────────────

const manifest = readJson(join(root, 'data', 'standalone-mirrors.json'));
const candidates = manifest.mirrors.filter((m) => m.exporter === 'sync' && m.direction === 'out');

async function headExists(repo) {
	const res = await fetch(`https://codeload.github.com/${OWNER}/${repo}/tar.gz/HEAD`, { method: 'GET' });
	if (res.body) res.body.cancel?.();
	return res.ok;
}

async function resolveRepoName(m) {
	if (m.repo) return m.repo;
	const base = m.path.split('/').pop();
	const guesses = [base, base.replace(/-sdk$/, '')].filter((v, i, a) => a.indexOf(v) === i);
	for (const guess of guesses) {
		if (await headExists(guess)) return guess;
	}
	return null;
}

// ── GitHub API (budget-aware) ───────────────────────────────────────────────

let apiExhausted = false;
let apiCallCount = 0;
let apiExhaustedAfter = null;

async function findSyncSha(repo) {
	if (apiExhausted) return { method: 'heuristic-skip-api' };
	apiCallCount++;
	let res;
	try {
		res = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/commits?per_page=100`, {
			headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'three.ws-mirror-drift-report' },
		});
	} catch (err) {
		return { method: 'api-error', error: String(err) };
	}
	if (res.status === 403 || res.status === 429) {
		apiExhausted = true;
		apiExhaustedAfter = repo;
		return { method: 'heuristic-rate-limited' };
	}
	if (!res.ok) {
		return { method: 'api-error', error: `HTTP ${res.status}` };
	}
	const commits = await res.json();
	for (const c of commits) {
		const subject = (c.commit?.message || '').split('\n')[0];
		const match = subject.match(/^Sync from three\.ws@([0-9a-f]{7,40})/);
		if (match) return { method: 'api', sha: match[1], commitDate: c.commit?.committer?.date || c.commit?.author?.date };
	}
	return { method: 'api-no-marker' };
}

// ── tarball + tree helpers ──────────────────────────────────────────────────

// Files/dirs the publish pipeline (standalone-enrich.mjs, standalone-kit.mjs,
// repo-growth-kit.mjs) synthesizes on every mirror and that never exist in the
// monorepo source directory. Diffing them would flag the pipeline's own output
// as a "GitHub-only change" on every single mirror, every run.
const GENERATED_EXACT = new Set([
	'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CITATION.cff',
	'CLAUDE.md', '.gitignore', 'llms.txt', 'llms-full.txt', 'LICENSE', 'server.json',
]);
const GENERATED_PREFIX = ['.github/', 'docs/'];

function isGenerated(relPath) {
	return GENERATED_EXACT.has(relPath) || GENERATED_PREFIX.some((p) => relPath.startsWith(p));
}

const README_MARKER_BLOCKS = [
	[/<!-- three\.ws:ecosystem -->[\s\S]*?<!-- \/three\.ws:ecosystem -->\n?/g],
	[/<!-- three\.ws:growth -->[\s\S]*?<!-- \/three\.ws:growth -->\n?/g],
	[/<!-- three\.ws:badges -->[\s\S]*?<!-- \/three\.ws:badges -->\n?/g],
];

// Strip the publish pipeline's injected README blocks and the mechanical
// package.json "repository" rewrite before hashing, so only real content
// differences survive the comparison.
function normalizedBuffer(relPath, buf) {
	if (relPath === 'README.md') {
		let text = buf.toString('utf8');
		for (const [re] of README_MARKER_BLOCKS) text = text.replace(re, '');
		text = fixLicenseFooter(text);
		return Buffer.from(text, 'utf8');
	}
	if (relPath === 'package.json') {
		try {
			const pkg = JSON.parse(buf.toString('utf8'));
			delete pkg.repository;
			return Buffer.from(JSON.stringify(pkg, null, '\t'), 'utf8');
		} catch {
			return buf;
		}
	}
	return buf;
}

function hashTree(dir) {
	const out = new Map();
	function walk(d) {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			if (entry.name === '.git') continue;
			const abs = join(d, entry.name);
			if (entry.isDirectory()) walk(abs);
			else if (entry.isFile()) {
				const rel = relative(dir, abs).split('\\').join('/');
				if (isGenerated(rel)) continue;
				out.set(rel, sha256(normalizedBuffer(rel, readFileSync(abs))));
			}
		}
	}
	if (existsSync(dir)) walk(dir);
	return out;
}

async function downloadTarball(repo, destDir) {
	const res = await fetch(`https://codeload.github.com/${OWNER}/${repo}/tar.gz/HEAD`);
	if (!res.ok) return false;
	const buf = Buffer.from(await res.arrayBuffer());
	const tarPath = join(destDir, '_archive.tar.gz');
	writeFileSync(tarPath, buf);
	mkdirSync(join(destDir, 'tree'), { recursive: true });
	execFileSync('tar', ['-xz', '-f', tarPath, '-C', join(destDir, 'tree'), '--strip-components=1']);
	return true;
}

function tarballHeadMtime(destDir) {
	const treeDir = join(destDir, 'tree');
	const first = readdirSync(treeDir)[0];
	if (!first) return null;
	return statSync(join(treeDir, first)).mtime;
}

function archiveMonorepoAt(sha, path, destDir) {
	mkdirSync(destDir, { recursive: true });
	const tarPath = join(destDir, '_base.tar');
	const tarBuf = execFileSync('git', ['archive', sha, '--', path], { cwd: root, maxBuffer: 1024 * 1024 * 200 });
	writeFileSync(tarPath, tarBuf);
	mkdirSync(join(destDir, 'tree'), { recursive: true });
	try {
		execFileSync('tar', ['-x', '-f', tarPath, '-C', join(destDir, 'tree')]);
	} catch {
		return false;
	}
	return true;
}

function heuristicBaseSha(path, beforeDate) {
	if (!beforeDate) return null;
	const iso = new Date(beforeDate.getTime() + 1000).toISOString();
	try {
		return git(['log', `--before=${iso}`, '-1', '--format=%H', '--', path]) || null;
	} catch {
		return null;
	}
}

// ── classification ──────────────────────────────────────────────────────────

function classify(baseTree, ghTree, nowTree) {
	const keys = new Set([...baseTree.keys(), ...ghTree.keys(), ...nowTree.keys()]);
	const ghOnly = [];
	const hereOnly = [];
	const both = [];
	for (const k of keys) {
		const b = baseTree.get(k) ?? null;
		const g = ghTree.get(k) ?? null;
		const n = nowTree.get(k) ?? null;
		const ghChanged = g !== b;
		const hereChanged = n !== b;
		if (ghChanged && hereChanged) both.push(k);
		else if (ghChanged) ghOnly.push(k);
		else if (hereChanged) hereOnly.push(k);
	}
	return { ghOnly: ghOnly.sort(), hereOnly: hereOnly.sort(), both: both.sort() };
}

function diffNoBase(ghTree, nowTree) {
	const keys = new Set([...ghTree.keys(), ...nowTree.keys()]);
	const changed = [];
	for (const k of keys) {
		if ((ghTree.get(k) ?? null) !== (nowTree.get(k) ?? null)) changed.push(k);
	}
	return changed.sort();
}

function packageJsonDiff(ghTreeDir, nowDirAbs) {
	const ghPkgPath = join(ghTreeDir, 'package.json');
	const nowPkgPath = join(nowDirAbs, 'package.json');
	if (!existsSync(ghPkgPath) || !existsSync(nowPkgPath)) return null;
	const gh = readJson(ghPkgPath);
	const now = readJson(nowPkgPath);
	const diffs = {};
	for (const field of ['version', 'dependencies', 'devDependencies', 'peerDependencies']) {
		const a = JSON.stringify(gh[field] ?? null);
		const b = JSON.stringify(now[field] ?? null);
		if (a !== b) diffs[field] = { github: gh[field] ?? null, monorepo: now[field] ?? null };
	}
	return Object.keys(diffs).length ? diffs : null;
}

function legacyLicenseFooter(ghTreeDir) {
	for (const name of ['README.md', 'LICENSE']) {
		const p = join(ghTreeDir, name);
		if (existsSync(p) && /all rights reserved/i.test(readFileSync(p, 'utf8'))) return true;
	}
	return false;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
	const scratch = mkdtempSync(join(tmpdir(), 'mirror-drift-'));
	const ordered = [...candidates].sort((a, b) => {
		const ap = PRIORITY_REPOS.includes(a.repo) ? 0 : 1;
		const bp = PRIORITY_REPOS.includes(b.repo) ? 0 : 1;
		return ap - bp;
	});

	const results = [];
	let processed = 0;
	for (const m of ordered) {
		const repo = await resolveRepoName(m);
		if (!repo) {
			results.push({ path: m.path, repo: null, status: 'no-mirror-published' });
			continue;
		}
		processed++;
		const mirrorScratch = join(scratch, repo);
		mkdirSync(mirrorScratch, { recursive: true });
		const ok = await downloadTarball(repo, mirrorScratch);
		if (!ok) {
			results.push({ path: m.path, repo, status: 'tarball-fetch-failed' });
			continue;
		}
		const ghTreeDir = join(mirrorScratch, 'tree');
		const ghTree = hashTree(ghTreeDir);
		const nowDirAbs = resolve(root, m.path);
		const nowTree = hashTree(nowDirAbs);

		const sync = await findSyncSha(repo);
		let baseSha = sync.sha ?? null;
		let syncMethod = sync.method;

		if (!baseSha && (sync.method === 'heuristic-rate-limited' || sync.method === 'heuristic-skip-api')) {
			const mtime = tarballHeadMtime(mirrorScratch);
			baseSha = heuristicBaseSha(m.path, mtime);
			syncMethod = baseSha ? 'heuristic' : 'no-sync-base';
		} else if (!baseSha) {
			syncMethod = 'no-sync-base';
		}

		let entry = {
			path: m.path,
			repo,
			npm: m.npm,
			syncMethod,
			baseSha,
			legacyLicenseFooter: legacyLicenseFooter(ghTreeDir),
			packageJsonDiff: packageJsonDiff(ghTreeDir, nowDirAbs),
		};

		if (baseSha) {
			const baseScratch = join(mirrorScratch, 'base');
			const archived = archiveMonorepoAt(baseSha, m.path, baseScratch);
			if (archived) {
				const baseTreeDir = join(baseScratch, 'tree', m.path);
				const baseTree = hashTree(baseTreeDir);
				const { ghOnly, hereOnly, both } = classify(baseTree, ghTree, nowTree);
				entry = { ...entry, status: 'compared', ghOnly, hereOnly, both };
			} else {
				entry = { ...entry, status: 'base-archive-failed', changed: diffNoBase(ghTree, nowTree) };
			}
		} else {
			entry = { ...entry, status: 'no-sync-base', changed: diffNoBase(ghTree, nowTree) };
		}
		results.push(entry);
	}

	rmSync(scratch, { recursive: true, force: true });

	const legacyFooterCount = results.filter((r) => r.legacyLicenseFooter).length;
	const ghOnlyRepos = results.filter((r) => r.ghOnly?.length).map((r) => r.repo);
	const bothRepos = results.filter((r) => r.both?.length).map((r) => r.repo);
	const pkgDiffRepos = results.filter((r) => r.packageJsonDiff).map((r) => ({ repo: r.repo, diff: r.packageJsonDiff }));

	const report = {
		generated: new Date().toISOString(),
		mirrorsConsidered: ordered.length,
		mirrorsResolved: processed,
		apiCallsMade: apiCallCount,
		apiExhaustedAfterRepo: apiExhaustedAfter,
		aggregate: {
			legacyLicenseFooterCount: legacyFooterCount,
			reposWithGithubOnlyChanges: ghOnlyRepos,
			reposWithChangesInBoth: bothRepos,
			reposWithPackageJsonDiff: pkgDiffRepos,
		},
		mirrors: results,
	};

	const date = new Date().toISOString().slice(0, 10);
	const outPath = join(root, 'tasks', `mirror-drift-${date}.json`);
	writeFileSync(outPath, JSON.stringify(report, null, '\t') + '\n');

	console.log(`three.ws mirror drift report (${report.generated})`);
	console.log(`  ${processed}/${ordered.length} mirrors resolved and compared; ${apiCallCount} GitHub API calls made${apiExhaustedAfter ? ` (rate-limited after "${apiExhaustedAfter}", rest used the timestamp heuristic)` : ''}.`);
	console.log(`  Legacy "All rights reserved" footer still present in ${legacyFooterCount} mirror READMEs/LICENSEs.`);
	console.log('');
	for (const r of results) {
		if (r.status === 'no-mirror-published') {
			console.log(`  - ${r.path}: no mirror published yet`);
			continue;
		}
		if (r.status === 'tarball-fetch-failed') {
			console.log(`  - ${r.repo} (${r.path}): tarball fetch failed`);
			continue;
		}
		const tag = PRIORITY_REPOS.includes(r.repo) ? '*' : ' ';
		if (r.status === 'compared') {
			console.log(`${tag} ${r.repo} (${r.path}) [${r.syncMethod}]: github-only=${r.ghOnly.length} here-only=${r.hereOnly.length} both=${r.both.length}${r.legacyLicenseFooter ? ' legacy-footer' : ''}${r.packageJsonDiff ? ' pkg-diff' : ''}`);
			if (r.ghOnly.length) console.log(`      github-only: ${r.ghOnly.join(', ')}`);
			if (r.packageJsonDiff) console.log(`      package.json diff: ${JSON.stringify(r.packageJsonDiff)}`);
		} else {
			console.log(`${tag} ${r.repo} (${r.path}) [${r.status}]: changed=${(r.changed || []).length}${r.legacyLicenseFooter ? ' legacy-footer' : ''}`);
		}
	}
	console.log('');
	console.log(`Full report: ${relative(root, outPath)}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
