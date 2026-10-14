#!/usr/bin/env node
// Stage every outbound standalone mirror listed in data/standalone-mirrors.json
// under dist/standalone-mirrors/<repo>/, idempotently. The monorepo
// (nirholas/three.ws) stays the canonical source of truth; each standalone repo
// is a generated, read-only MIRROR of one directory here.
//
// This script never pushes and never talks to the GitHub API. It used to
// force-push straight to main, which broke the owner's "git push is owner-gated"
// rule every run; now it only writes under dist/ (gitignored) and prints the
// exact push command, so the owner decides when a mirror actually updates.
//
// The manifest (data/standalone-mirrors.json) is the one list of "which
// directory is which public repo, in which direction": this script only
// acts on entries where direction is "out" and exporter is "sync" (the
// "in" entries, e.g. robinhood/*, are reference copies this tool never
// touches; order 503 decides their fate).
//
// Usage:
//   node scripts/sync-standalone-repos.mjs                     # stage every sync entry
//   node scripts/sync-standalone-repos.mjs --only tty-avatar,x402-bridge
//   node scripts/sync-standalone-repos.mjs --check              # diff staged vs. live, write nothing

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fixLicenseFooter } from './lib/standalone-kit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAGE_ROOT = join(root, 'dist', 'standalone-mirrors');

// ── flags ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const owner = flagValue('--owner') || 'nirholas';
const onlyArg = flagValue('--only');
const check = argv.includes('--check');
const only = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : null;

function flagValue(name) {
	const eq = argv.find((a) => a.startsWith(`${name}=`));
	if (eq) return eq.slice(name.length + 1);
	const i = argv.indexOf(name);
	return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

const log = (...a) => console.log(...a);
function git(args, opts = {}) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }).trim();
}
function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

// ── manifest ─────────────────────────────────────────────────────────────────
const manifest = readJson(join(root, 'data', 'standalone-mirrors.json'));
const entries = manifest.mirrors
	.filter((m) => m.exporter === 'sync' && m.direction === 'out' && m.repo)
	.filter((p) => !only || only.includes(p.repo) || only.includes(p.path))
	.map((m) => ({ ...m, abs: resolve(root, m.path), kind: existsSync(join(root, m.path, 'server.json')) ? 'mcp' : 'lib' }))
	.sort((a, b) => a.repo.localeCompare(b.repo));

// Rewrite a mirror's own manifests so they point at THEMSELVES, not the
// monorepo subfolder. This, and the license footer fix below, are the only
// content changes staging makes: everything else in the snapshot is a
// byte-for-byte copy of the source directory.
function rewriteMirrorMetadata(workDir, slug) {
	const url = `https://github.com/${slug}.git`;
	const pkgPath = join(workDir, 'package.json');
	if (existsSync(pkgPath)) {
		const pkg = readJson(pkgPath);
		pkg.repository = { type: 'git', url: `git+${url}` };
		writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
	}
	const manifestPath = join(workDir, 'server.json');
	if (existsSync(manifestPath)) {
		const m = readJson(manifestPath);
		if (m.repository) m.repository = { url: `https://github.com/${slug}`, source: 'github' };
		writeFileSync(manifestPath, JSON.stringify(m, null, '\t') + '\n');
	}
}

// 93 mirrors currently ship a stale "All rights reserved" README footer and/or
// LICENSE from before this package was Apache-2.0'd. Fix both at stage time so
// the next owner push corrects all of them in one pass.
function fixLicense(workDir, monorepoLicense) {
	const readmePath = join(workDir, 'README.md');
	if (existsSync(readmePath)) {
		const readme = readFileSync(readmePath, 'utf8');
		const fixed = fixLicenseFooter(readme);
		if (fixed !== readme) writeFileSync(readmePath, fixed);
	}
	const licensePath = join(workDir, 'LICENSE');
	if (!existsSync(licensePath) || /all rights reserved/i.test(readFileSync(licensePath, 'utf8'))) {
		writeFileSync(licensePath, monorepoLicense);
	}
}

// Last line of defense before a public repo sees this tree: refuse to stage
// something shaped like a credential or a private key.
const SECRET_SHAPES = [
	/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
	/\bgh[pousr]_[A-Za-z0-9]{30,}/,
	/\bgithub_pat_[A-Za-z0-9_]{40,}/,
	/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/,
	/\bAKIA[0-9A-Z]{16}\b/,
];
function walk(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const f = join(dir, e.name);
		return e.isDirectory() ? (e.name === '.git' ? [] : walk(f)) : [f];
	});
}
function assertNoSecrets(dir) {
	for (const f of walk(dir)) {
		if (/\.(png|jpe?g|gif|webp|ico|glb|gltf|wasm|woff2?|zip|gz)$/i.test(f)) continue;
		const text = readFileSync(f, 'utf8');
		for (const re of SECRET_SHAPES) {
			if (re.test(text)) throw new Error(`refusing to stage: ${f.slice(dir.length + 1)} matches a credential pattern (${re.source.slice(0, 24)})`);
		}
	}
}

// Build one mirror's snapshot as a fresh one-commit git repo at `dest`.
function stage(entry, sourceSha, dest, monorepoLicense) {
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(entry.abs, dest, {
		recursive: true,
		filter: (src) => !/(^|\/)node_modules(\/|$)/.test(src),
	});
	const slug = `${owner}/${entry.repo}`;
	rewriteMirrorMetadata(dest, slug);
	fixLicense(dest, monorepoLicense);
	assertNoSecrets(dest);

	const run = (args) => execFileSync('git', args, { cwd: dest, stdio: 'pipe', encoding: 'utf8' });
	run(['init', '-q', '-b', 'main']);
	run(['add', '-A']);
	run([
		'-c', 'user.name=three.ws sync',
		'-c', 'user.email=sync@three.ws',
		'commit', '-q', '-m',
		`Sync from three.ws@${sourceSha.slice(0, 12)}\n\nGenerated mirror of ${entry.path}. Canonical source: https://github.com/nirholas/three.ws`,
	]);
	return slug;
}

// Fetch a repo's default-branch tree via codeload (not rate limited, never a
// git remote) and extract it to `dest`. Returns false when the mirror has no
// history yet (never pushed) instead of throwing.
function fetchLiveTree(slug, dest) {
	mkdirSync(dest, { recursive: true });
	try {
		execFileSync('sh', ['-c', `curl -sfL "https://codeload.github.com/${slug}/tar.gz/HEAD" | tar -xz -C "${dest}" --strip-components=1`], { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

function filesOf(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const f = join(dir, e.name);
		if (e.name === '.git') return [];
		return e.isDirectory() ? filesOf(f) : [f.slice(dir.length + 1)];
	});
}

function treesDiffer(stagedDir, liveDir) {
	const stagedFiles = new Set(filesOf(stagedDir));
	const liveFiles = new Set(filesOf(liveDir));
	if (stagedFiles.size !== liveFiles.size) return true;
	for (const f of stagedFiles) {
		if (!liveFiles.has(f)) return true;
		if (!readFileSync(join(stagedDir, f)).equals(readFileSync(join(liveDir, f)))) return true;
	}
	return false;
}

// ── main ─────────────────────────────────────────────────────────────────────
const sourceSha = git(['rev-parse', 'HEAD']);
const monorepoLicense = readFileSync(join(root, 'LICENSE'), 'utf8');

if (check) {
	log(`CHECK: comparing ${entries.length} staged mirror(s) against their live GitHub tree\n`);
	const drifted = [];
	const scratch = mkdtempSync(join(tmpdir(), 'mirror-check-'));
	try {
		for (const entry of entries) {
			const slug = `${owner}/${entry.repo}`;
			const stagedDir = join(scratch, 'staged', entry.repo);
			const liveDir = join(scratch, 'live', entry.repo);
			stage(entry, sourceSha, stagedDir, monorepoLicense);
			const fetched = fetchLiveTree(slug, liveDir);
			const differs = !fetched || treesDiffer(stagedDir, liveDir);
			log(`${differs ? 'DRIFT' : 'clean'}  ${entry.repo}${fetched ? '' : '  (no history on GitHub yet)'}`);
			if (differs) drifted.push(entry.repo);
		}
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
	log(`\n${drifted.length} of ${entries.length} mirror(s) drifted from what is staged.`);
	if (drifted.length) {
		log(`drifted: ${drifted.join(', ')}`);
		process.exitCode = 1;
	}
	process.exit();
}

log(`STAGE: ${entries.length} mirror(s) under dist/standalone-mirrors/*`);
log(`source: three.ws@${sourceSha.slice(0, 12)}\n`);

const pushLines = [];
for (const entry of entries) {
	const dest = join(STAGE_ROOT, entry.repo);
	const slug = stage(entry, sourceSha, dest, monorepoLicense);
	log(`-- ${entry.path}  [${entry.kind}]  ->  dist/standalone-mirrors/${entry.repo}  (github.com/${slug})`);
	pushLines.push(`git -C dist/standalone-mirrors/${entry.repo} push --force https://github.com/${slug}.git HEAD:main`);
}

log(`\nStaged ${entries.length} mirror(s). 0 repos created, 0 pushed (this tool never does either).`);
if (pushLines.length) {
	log('\nTo publish, run (owner-gated, one line per mirror):\n');
	for (const line of pushLines) log(`  ${line}`);
}
