#!/usr/bin/env node
// Sync every publishable three.ws package (MCP servers AND library SDKs) to its
// own standalone GitHub repo, idempotently. The monorepo (nirholas/three.ws)
// stays the canonical source of truth; each standalone repo is a generated,
// read-only MIRROR of one package.
//
// Why mirrors and not a live split: this repo's operating rules make threews the
// single source of truth, and `git subtree`/`git filter-repo` aren't available
// here. A deterministic snapshot push is the professional pattern for generated
// mirrors — every sync force-pushes one commit whose message records the exact
// monorepo SHA it came from, so provenance is never lost.
//
// A package is in scope when its dir holds a non-private package.json. Scoping
// on server.json (the old rule) silently excluded every library package, so the
// 18 SDKs under packages/ had no mirror at all; --kind narrows it back down when
// you only want one lane.
//
// For each package it:
//   1. resolves the standalone repo name (unscoped npm name, overridable below);
//   2. creates github.com/<owner>/<repo> via `gh` if it doesn't exist (public);
//   3. snapshots the package dir into a temp working tree, rewrites the mirror's
//      package.json + server.json `repository` to point at the standalone repo
//      (the monorepo copy is never touched), commits, and force-pushes to main.
//
// Auth: needs `gh` authenticated as the repo OWNER (so it can create/push under
// that account). The default owner is `nirholas`; override with --owner.
//
// Usage:
//   node scripts/sync-standalone-repos.mjs --dry-run            # plan only (default)
//   node scripts/sync-standalone-repos.mjs --execute            # create + push all
//   node scripts/sync-standalone-repos.mjs --execute --only agent-sniper,copy-mcp
//   node scripts/sync-standalone-repos.mjs --execute --owner my-org
//   node scripts/sync-standalone-repos.mjs --kind mcp     # MCP servers only
//   node scripts/sync-standalone-repos.mjs --kind lib     # library packages only
//   node scripts/sync-standalone-repos.mjs --new          # only repos that don't exist yet
//   node scripts/sync-standalone-repos.mjs --execute --metadata-only   # re-apply description, topics,
//                                                         # homepage and Discussions to EXISTING repos, no push

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { applyRepoSettings, enrichMirror, enrichPackageJson } from './lib/standalone-enrich.mjs';
import { boostMirror } from './lib/standalone-kit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── flags ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const execute = argv.includes('--execute');
const dryRun = !execute; // dry-run is the default; --execute opts in to writes
const owner = flagValue('--owner') || 'nirholas';
const onlyArg = flagValue('--only');
const kind = flagValue('--kind') || 'all'; // all | mcp | lib
const newOnly = argv.includes('--new');
const metadataOnly = argv.includes('--metadata-only');
const settingsOnly = argv.includes('--settings-only');
// A scoped token passed as GH_PAT also authenticates the `gh` calls below.
if (process.env.GH_PAT && !process.env.GH_TOKEN) process.env.GH_TOKEN = process.env.GH_PAT;
const only = onlyArg ? onlyArg.split(',').map((s) => s.trim()).filter(Boolean) : null;

function flagValue(name) {
	const eq = argv.find((a) => a.startsWith(`${name}=`));
	if (eq) return eq.slice(name.length + 1);
	const i = argv.indexOf(name);
	return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
}

// Standalone repo names that shouldn't just be the unscoped npm name (e.g. where
// the dir name is the clearer public identity). Keyed by package dir basename.
// Packages whose public identity is built around another crypto project. Existing
// mirrors keep syncing; a NEW repo for one waits for explicit owner approval
// (CLAUDE.md commit gate), so --execute skips creating it.
const HOLD_NEW = new Set(['agenc']);

const REPO_NAME_OVERRIDES = {
	'mcp-server': '3d-agent-mcp',
	'mcp-bridge': 'x402-bridge',
	'threews-avatar-mcp': 'threews-avatar-mcp',
	'avatar-agent-mcp': 'avatar-agent-mcp',
	// Renamed on GitHub; the old name only redirects, and the settings API
	// answers 307 on a redirected slug.
	'agent-sniper': 'solana-sniper-mcp',
};

/**
 * The standalone repo name for a package.
 *
 * On npm the `@three-ws` scope carries the identity, so a package can be called
 * `see` or `render`. A repo cannot: github.com/nirholas/render says nothing
 * about what it is or who ships it, and single-token names are the ones most
 * likely to collide with something else later. Single-token `@three-ws/*` names
 * therefore mirror as `three-ws-<name>`; anything already hyphenated (glb-diff,
 * x402-preflight, agent-vitals) is distinctive enough to stand alone.
 */
function repoNameFor(base, pkg) {
	if (REPO_NAME_OVERRIDES[base]) return REPO_NAME_OVERRIDES[base];
	const unscoped = pkg.name.replace(/^@[^/]+\//, '');
	const scoped = pkg.name.startsWith('@three-ws/');
	return scoped && !unscoped.includes('-') ? `three-ws-${unscoped}` : unscoped;
}

// ── helpers ─────────────────────────────────────────────────────────────────────
const log = (...a) => console.log(...a);
function git(args, opts = {}) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }).trim();
}
function gh(args, opts = {}) {
	return execFileSync('gh', args, { encoding: 'utf8', ...opts }).trim();
}
function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

// Discover every mirrorable package: a dir holding a non-private package.json.
// A server.json in the dir marks it as an MCP server (kind 'mcp'); everything
// else is a library package (kind 'lib').
function discoverPackages() {
	const dirs = [
		'mcp-server',
		'mcp-bridge',
		'assistant-sdk',
		...readdirSync(join(root, 'packages')).map((d) => `packages/${d}`),
	];
	const out = [];
	for (const dir of dirs) {
		const abs = resolve(root, dir);
		if (!existsSync(join(abs, 'package.json'))) continue;
		const pkg = readJson(join(abs, 'package.json'));
		if (pkg.private) continue; // never mirror a private package
		const base = basename(dir);
		const packageKind = existsSync(join(abs, 'server.json')) ? 'mcp' : 'lib';
		if (kind !== 'all' && kind !== packageKind) continue;
		const repo = repoNameFor(base, pkg);
		out.push({ key: base, dir, abs, pkg, repo, kind: packageKind });
	}
	return out.sort((a, b) => a.repo.localeCompare(b.repo));
}

function repoExists(slug) {
	try {
		gh(['repo', 'view', slug, '--json', 'name'], { stdio: ['ignore', 'pipe', 'ignore'] });
		return true;
	} catch {
		return false;
	}
}

// Rewrite a mirror's metadata so the standalone repo is self-consistent: its
// package.json + server.json point at THEMSELVES, not the monorepo subfolder.
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
		if (m.repository) {
			m.repository = { url: `https://github.com/${slug}`, source: 'github' };
		}
		writeFileSync(manifestPath, JSON.stringify(m, null, '\t') + '\n');
	}
}


// ── discovery metadata ──────────────────────────────────────────────────────────
// Topics are how both people and agents find a repo on GitHub. The package's own
// keywords come first (they are the author's words), then a fixed set that every
// three.ws mirror carries so the whole family is one search away.
const BASE_TOPICS = ['three-ws', 'ai-agents', 'mcp', 'model-context-protocol'];
const KIND_TOPICS = { mcp: ['mcp-server'], lib: ['sdk'] };

function topicsFor(p) {
	const clean = (t) => String(t).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
	const own = (p.pkg.keywords || []).map(clean).filter(Boolean);
	const seen = new Set();
	const out = [];
	for (const t of [...own, ...(KIND_TOPICS[p.kind] || []), ...BASE_TOPICS]) {
		if (t && !seen.has(t)) { seen.add(t); out.push(t); }
	}
	return out.slice(0, 20); // GitHub allows 20
}

function homepageFor(p) {
	return /^https?:\/\//.test(p.pkg.homepage || '') && !/github\.com/.test(p.pkg.homepage) ? p.pkg.homepage : 'https://three.ws';
}

function applyRepoMetadata(p, slug) {
	const desc = (p.pkg.description || '').slice(0, 350);
	gh(['repo', 'edit', slug, '--description', desc, '--homepage', homepageFor(p), '--enable-discussions']);
	const topics = topicsFor(p);
	gh(['api', '-X', 'PUT', `repos/${slug}/topics`, ...topics.flatMap((t) => ['-f', `names[]=${t}`]), '--silent']);
}

// Files a mirror needs to be a first-class repo on its own. Written only when the
// package does not already ship one, so an author's own file always wins. These are
// generated into the mirror and never touch the monorepo copy.
function communityFiles(p, slug) {
	const name = p.pkg.name;
	const desc = p.pkg.description || '';
	const npm = `https://www.npmjs.com/package/${name}`;
	const docs = homepageFor(p);
	const bin = p.kind === 'mcp' ? `npx -y ${name}` : `npm install ${name}`;
	return {
		'AGENTS.md': `# AGENTS.md\n\n${name}: ${desc}\n\n## Install\n\n\`\`\`bash\n${bin}\n\`\`\`\n\n## Where things are\n\n- \`README.md\`: usage, configuration and the public API.\n- \`src/\`: the implementation.\n- \`test/\`: the test suite. Run it with \`npm test\` after \`npm install\`.\n- npm: ${npm}\n- Docs and the rest of the platform: ${docs}\n- Machine-readable index of the platform: https://three.ws/llms.txt\n\n## Rules for agents working in this repo\n\n- This repository is a generated read-only mirror. The canonical source is https://github.com/nirholas/three.ws (path \`${p.dir}\`), so open pull requests there.\n- Do not commit credentials. Configuration is read from environment variables documented in the README.\n- Keep changes small and covered by a test.\n`,
		'llms.txt': `# ${name}\n\n> ${desc}\n\nPart of three.ws, a platform for embodied AI agents: 3D avatars, wallets, tools and a paid-API economy.\n\n## Docs\n\n- [README](https://github.com/${slug}#readme): install, usage and API\n- [npm package](${npm})\n- [three.ws](${docs}): the platform this package belongs to\n- [Platform index for LLMs](https://three.ws/llms.txt)\n\n## Source\n\n- [Mirror](https://github.com/${slug}): generated read-only mirror\n- [Canonical monorepo](https://github.com/nirholas/three.ws): source of truth and where pull requests go\n`,
		'CONTRIBUTING.md': `# Contributing to ${name}\n\nThanks for helping. This repository is a generated mirror of one package in the three.ws monorepo, so the workflow is:\n\n1. **Issues and questions:** open them here. Use Discussions for questions and ideas.\n2. **Code changes:** open the pull request against https://github.com/nirholas/three.ws, in \`${p.dir}\`. A change merged here would be overwritten by the next sync.\n3. Run \`npm install && npm test\` in the package before you open it, and add a test for new behavior.\n4. Keep commit messages in the form \`type(scope): what changed and why\`.\n`,
		'SECURITY.md': `# Security policy\n\nPlease report vulnerabilities in ${name} privately rather than in a public issue.\n\n- Use GitHub's private vulnerability reporting: https://github.com/${slug}/security/advisories/new\n- Or email security@three.ws\n\nInclude the version, what you did, what you expected and what happened. You will get an acknowledgement within three working days. Never include live credentials or private keys in a report.\n`,
	};
}

function addCommunityFiles(workDir, p, slug) {
	for (const [file, body] of Object.entries(communityFiles(p, slug))) {
		const target = join(workDir, file);
		if (!existsSync(target)) writeFileSync(target, body);
	}
}

// Last line of defense before a public push: refuse to publish a tree that holds
// something shaped like a credential or a private key.
const SECRET_SHAPES = [
	/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
	/\bgh[pousr]_[A-Za-z0-9]{30,}/,
	/\bgithub_pat_[A-Za-z0-9_]{40,}/,
	/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/,
	/\bAKIA[0-9A-Z]{16}\b/,
];
function assertNoSecrets(dir) {
	const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
		const f = join(d, e.name);
		return e.isDirectory() ? (e.name === '.git' ? [] : walk(f)) : [f];
	});
	for (const f of walk(dir)) {
		if (/\.(png|jpe?g|gif|webp|ico|glb|gltf|wasm|woff2?|zip|gz)$/i.test(f)) continue;
		const text = readFileSync(f, 'utf8');
		for (const re of SECRET_SHAPES) {
			if (re.test(text)) throw new Error(`refusing to publish: ${f.slice(dir.length + 1)} matches a credential pattern (${re.source.slice(0, 24)})`);
		}
	}
}

// Snapshot one package into a fresh git repo and force-push it to the mirror's main.
async function pushSnapshot(p, slug, sourceSha) {
	const tmp = mkdtempSync(join(tmpdir(), `mirror-${p.repo}-`));
	try {
		// Copy the package's working-tree contents (respecting the npm files set is
		// overkill for a source mirror; the full dir is the source repo).
		cpSync(p.abs, tmp, {
			recursive: true,
			filter: (src) => !/(^|\/)node_modules(\/|$)/.test(src),
		});
		rewriteMirrorMetadata(tmp, slug);
		enrichPackageJson(tmp, { slug, kind: p.kind });
		const mirrorPkg = JSON.parse(readFileSync(join(tmp, 'package.json'), 'utf8'));
		enrichMirror(tmp, { pkg: mirrorPkg, slug, kind: p.kind });
		await boostMirror(tmp, { pkg: mirrorPkg, slug, kind: p.kind, sourceDir: p.dir, monorepoLicense: readFileSync(join(root, 'LICENSE'), 'utf8') });

		assertNoSecrets(tmp);

		const run = (args) => execFileSync('git', args, { cwd: tmp, stdio: 'pipe', encoding: 'utf8' });
		run(['init', '-q', '-b', 'main']);
		run(['add', '-A']);
		run([
			'-c', 'user.name=three.ws sync',
			'-c', 'user.email=sync@three.ws',
			'commit', '-q', '-m',
			`Sync from three.ws@${sourceSha.slice(0, 12)}\n\nGenerated mirror of packages path ${p.dir}. Canonical source: https://github.com/nirholas/three.ws`,
		]);
		run(['remote', 'add', 'origin', `https://github.com/${slug}.git`]);
		// Auth without leaking the token: when GH_PAT is set, a credential helper
		// reads it from the environment at push time, so the token never lands in a
		// remote URL, in process args, or in any error message.
		// The empty `credential.helper=` first RESETS any globally-configured helper
		// (e.g. gh's, which would otherwise auth as the wrong account); our token
		// helper is then the only one git consults.
		const authArgs = process.env.GH_PAT
			? ['-c', 'credential.helper=', '-c', 'credential.helper=!f() { echo username=x-access-token; echo "password=$GH_PAT"; }; f']
			: [];
		run([...authArgs, 'push', '--force', 'origin', 'main']);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

// ── main ─────────────────────────────────────────────────────────────────────
const pkgs = discoverPackages().filter((p) => !only || only.includes(p.key) || only.includes(p.repo));
const sourceSha = git(['rev-parse', 'HEAD']);

const lanes = `${pkgs.filter((p) => p.kind === 'mcp').length} MCP, ${pkgs.filter((p) => p.kind === 'lib').length} library`;
log(`${dryRun ? 'DRY RUN' : 'EXECUTE'}: mirroring ${pkgs.length} package(s) (${lanes}) to github.com/${owner}/*`);
log(`source: three.ws@${sourceSha.slice(0, 12)}\n`);

if (execute) {
	// Fail fast if gh can't act as the owner, before touching anything.
	try {
		const who = gh(['api', 'user', '--jq', '.login']);
		if (who.toLowerCase() !== owner.toLowerCase()) {
			log(`⚠ gh is authenticated as "${who}", not "${owner}". Creating/pushing under`);
			log(`  ${owner} requires that account's credentials (or org membership with repo-create rights).`);
			log(`  Re-auth with: gh auth login  (as ${owner}), then re-run.\n`);
		}
	} catch {
		log('⚠ could not resolve `gh api user` — is gh authenticated? Run `gh auth status`.\n');
	}
}

let created = 0, pushed = 0, failed = 0, skipped = 0;
const plannedNew = [];
for (const p of pkgs) {
	let slug = `${owner}/${p.repo}`;
	const exists = (() => { try { return repoExists(slug); } catch { return false; } })();
	// A repo renamed since it was created answers on its old name only through a
	// redirect that git follows but `gh api -X PUT/POST` does not, so settings and
	// Pages URLs must be built from the canonical name.
	if (exists) {
		try { slug = gh(['api', `repos/${slug}`, '--jq', '.full_name']) || slug; } catch { /* keep the requested name */ }
	}
	if (newOnly && exists) { skipped++; continue; }
	if (!exists && HOLD_NEW.has(p.key)) { skipped++; log(`── ${p.pkg.name}: new repo held for owner approval (references another crypto project)`); continue; }
	if (!exists) plannedNew.push(slug);
	log(`── ${p.pkg.name}  [${p.kind}]  →  github.com/${slug}  ${exists ? '(exists)' : '(NEW)'}`);

	if (dryRun) {
		if (!exists) log(`   would: gh repo create ${slug} --public`);
		if (!metadataOnly) log(`   would: snapshot ${p.dir} → force-push to ${slug}#main`);
		log(`   would: set homepage ${homepageFor(p)}, Discussions on, topics ${topicsFor(p).join(', ')}`);
		continue;
	}
	if (metadataOnly && !exists) { skipped++; continue; }

	try {
		if (!exists) {
			const desc = (p.pkg.description || '').slice(0, 350);
			gh(['repo', 'create', slug, '--public', '--description', desc, '--homepage', 'https://three.ws']);
			created++;
			log('   created repo');
		}
		if (!settingsOnly) {
			await pushSnapshot(p, slug, sourceSha);
			pushed++;
			log('   pushed snapshot');
		}
		const enriched = JSON.parse(readFileSync(join(p.abs, 'package.json'), 'utf8'));
		log(`   settings: ${applyRepoSettings(gh, { pkg: enriched, slug, kind: p.kind }).join(' | ')}`);
	} catch (err) {
		failed++;
		log(`   ✗ ${err.message.split('\n')[0]}`);
	}
}

if (dryRun) {
	log(`\nDry run complete. ${pkgs.length - skipped} package(s) planned, ${plannedNew.length} of them NEW repos.`);
	if (plannedNew.length) log(`  new: ${plannedNew.join(', ')}`);
	log(`Re-run with --execute (and gh auth as ${owner}) to apply.`);
} else {
	log(`\nDone. ${created} created, ${pushed} pushed, ${skipped} skipped, ${failed} failed.`);
}
if (failed) process.exitCode = 1;
