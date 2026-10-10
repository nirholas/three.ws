#!/usr/bin/env node
// Apply the growth kit (scripts/lib/repo-growth-kit.mjs) to every public,
// non-fork, non-archived repository on the owner's GitHub account, from the
// least-starred to the most-starred so the flagship repos are touched last,
// after the process has been proven on the long tail.
//
// Per repo it: shallow-clones, adds the README growth block and badge row,
// adds whichever agent-discovery and community-health files are missing (never
// overwriting a file that exists), commits with a message describing exactly
// what changed, pushes the default branch, then applies repository settings
// (topics, description, homepage, Discussions, branch hygiene, vulnerability
// alerts and secret scanning).
//
// Dry run unless --apply. Idempotent: a repo already carrying the current kit
// produces no diff and is skipped. Progress is recorded so --resume continues.
//
//   node scripts/boost-github-repos.mjs                      # plan every repo
//   node scripts/boost-github-repos.mjs --apply              # run the whole fleet
//   node scripts/boost-github-repos.mjs --apply --only a,b   # named repos
//   node scripts/boost-github-repos.mjs --apply --limit 25   # first N in star order
//   node scripts/boost-github-repos.mjs --apply --resume     # skip repos already done
//   node scripts/boost-github-repos.mjs --apply --include-gated  # owner-approved set
//   node scripts/boost-github-repos.mjs --only a --keep      # keep the clone to inspect the diff
//
// Repos whose subject is another crypto project are held back by default (see
// GATED); committing content that references them needs the owner's approval.
//
// Auth: gh must be authenticated as the owner.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	OWNER,
	applyBadges,
	applyGrowthBlock,
	badgeRow,
	growthBlock,
	mergeTopics,
	missingFiles,
} from './lib/repo-growth-kit.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
	const i = args.indexOf(`--${n}`);
	return i === -1 ? null : args[i + 1];
};
const APPLY = flag('apply');
const RESUME = flag('resume');
const INCLUDE_GATED = flag('include-gated');
const KEEP = flag('keep');
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null;
const LIMIT = opt('limit') ? Number(opt('limit')) : Infinity;
const WORK = opt('workdir') || join(process.env.TMPDIR || '/tmp', 'repo-fleet');
const STATE = opt('state') || join(WORK, 'state.json');

// Repos named for, or built around, a specific third-party crypto project.
const GATED = /agenc|agora-mcp|binance|bnbchain|bitrefill|flock|lyra|memescope|metaplex|sherwood|techdollar|loxley|wisconsin|ucai|kol-quest|three-ws-intel/i;

const COAUTHOR = 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>';

function gh(args2, input) {
	return execFileSync('gh', args2, { encoding: 'utf8', input, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Seconds until the core REST quota resets, or 0 when there is headroom. rate_limit itself is free. */
function quotaWaitSeconds(need = 40) {
	try {
		const core = ghJson(['api', 'rate_limit']).resources.core;
		return core.remaining >= need ? 0 : Math.max(core.reset - Math.floor(Date.now() / 1000), 1) + 5;
	} catch {
		return 0;
	}
}

function sleepSync(seconds) {
	console.log(`  waiting ${seconds}s for the GitHub API quota to reset`);
	spawnSync('sleep', [String(seconds)]);
}

const isRateLimit = (e) => /rate limit|secondary rate|abuse detection/i.test(String(e.message) + String(e.stderr || ''));

function ghJson(args2, input) {
	return JSON.parse(gh(args2, input));
}

function git(cwd, ...a) {
	const r = spawnSync('git', ['-c', 'credential.helper=!gh auth git-credential', ...a], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')} failed: ${(r.stderr || r.stdout).trim().slice(0, 400)}`);
	return r.stdout;
}

function listRepos() {
	const rows = ghJson(['repo', 'list', OWNER, '--limit', '1000', '--json', 'name,stargazerCount,isPrivate,isFork,isArchived']);
	return rows
		.filter((r) => !r.isPrivate && !r.isFork && !r.isArchived)
		.sort((a, b) => a.stargazerCount - b.stargazerCount || a.name.localeCompare(b.name));
}

function describeChange(added, readmeChanged) {
	const parts = [];
	if (readmeChanged) parts.push('star call to action, share links and badges');
	const names = Object.keys(added).filter((p) => !p.startsWith('.github/ISSUE_TEMPLATE/'));
	if (Object.keys(added).some((p) => p.startsWith('.github/ISSUE_TEMPLATE/'))) names.push('issue forms');
	if (names.length) parts.push(names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more discovery and community files` : names.join(', '));
	return parts.join(' plus ');
}

function boostOne(repo) {
	const dir = join(WORK, 'clones', repo.name);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(join(WORK, 'clones'), { recursive: true });
	const meta = ghJson(['api', `repos/${OWNER}/${repo.name}`]);
	git(WORK, 'clone', '--quiet', '--depth', '1', `https://github.com/${OWNER}/${repo.name}.git`, dir);

	const files = new Set(git(dir, 'ls-files').split('\n').filter(Boolean));
	const readmeName = [...files].find((p) => /^readme(\.md)?$/i.test(p));
	if (!readmeName) return { repo: repo.name, status: 'no-readme' };
	const readmePath = join(dir, readmeName);
	const original = readFileSync(readmePath, 'utf8');
	const pkgPath = join(dir, 'package.json');
	let pkg = null;
	try {
		pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
	} catch {
		pkg = null;
	}
	const license = meta.license && meta.license.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : null;
	const description = meta.description || pkg?.description || '';
	const homepage = meta.homepage || (meta.has_pages ? `https://${OWNER}.github.io/${repo.name}/` : 'https://three.ws');
	const ctx = { name: repo.name, description, files, readme: original, homepage, pkg, license, language: meta.language };

	const added = missingFiles(ctx);
	for (const [rel, body] of Object.entries(added)) {
		const full = join(dir, rel);
		mkdirSync(join(full, '..'), { recursive: true });
		writeFileSync(full, body);
	}
	const finalFiles = new Set([...files, ...Object.keys(added)]);
	let readme = applyBadges(original, badgeRow({ name: repo.name, hasLicense: Boolean(license) }));
	readme = applyGrowthBlock(readme, growthBlock({ name: repo.name, description, files: finalFiles, readme }));
	const readmeChanged = readme !== original;
	if (readmeChanged) writeFileSync(readmePath, readme);

	const result = { repo: repo.name, stars: repo.stargazerCount, added: Object.keys(added), readmeChanged, pushed: false, settings: [] };
	if (APPLY && (readmeChanged || Object.keys(added).length)) {
		git(dir, 'add', '--', readmeName, ...Object.keys(added));
		const subject = `docs: add ${describeChange(added, readmeChanged)}`;
		const body = [
			'Makes the repository easier to find and to share, for people and for AI agents.',
			'',
			...(readmeChanged ? ['- README: star call to action, one-click share links, agent entry points, contributors wall and star history'] : []),
			...Object.keys(added).map((p) => `- add ${p}`),
			'',
			COAUTHOR,
		].join('\n');
		git(dir, 'commit', '--quiet', '-m', subject, '-m', body);
		try {
			git(dir, 'push', '--quiet', 'origin', `HEAD:${meta.default_branch}`);
		} catch {
			git(dir, 'pull', '--quiet', '--rebase', 'origin', meta.default_branch);
			git(dir, 'push', '--quiet', 'origin', `HEAD:${meta.default_branch}`);
		}
		result.pushed = true;
	}
	result.settings = applySettings(meta, repo, description, homepage);
	if (!KEEP) rmSync(dir, { recursive: true, force: true });
	return result;
}

function applySettings(meta, repo, description, homepage) {
	const done = [];
	const patch = {};
	if (!meta.has_issues) patch.has_issues = true;
	if (!meta.has_discussions) patch.has_discussions = true;
	if (!meta.delete_branch_on_merge) patch.delete_branch_on_merge = true;
	if (!meta.description && description) patch.description = String(description).replace(/\s+/g, ' ').slice(0, 350);
	if (!meta.homepage) patch.homepage = homepage;
	const sa = meta.security_and_analysis || {};
	if (sa.secret_scanning?.status !== 'enabled' || sa.secret_scanning_push_protection?.status !== 'enabled') {
		patch.security_and_analysis = { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } };
	}
	const topics = mergeTopics(meta.topics || [], meta.language);
	const topicsChanged = topics.join() !== (meta.topics || []).join();
	if (!APPLY) return [...Object.keys(patch), ...(topicsChanged ? ['topics'] : [])];
	if (Object.keys(patch).length) {
		try {
			gh(['api', '-X', 'PATCH', `repos/${OWNER}/${repo.name}`, '--input', '-'], JSON.stringify(patch));
			done.push(...Object.keys(patch));
		} catch (e) {
			if (isRateLimit(e)) throw e;
			if (patch.security_and_analysis) {
				const { security_and_analysis: _drop, ...rest } = patch;
				if (Object.keys(rest).length) {
					gh(['api', '-X', 'PATCH', `repos/${OWNER}/${repo.name}`, '--input', '-'], JSON.stringify(rest));
					done.push(...Object.keys(rest));
				}
				done.push('security_and_analysis:unavailable');
			} else throw e;
		}
	}
	if (topicsChanged) {
		gh(['api', '-X', 'PUT', `repos/${OWNER}/${repo.name}/topics`, '--input', '-'], JSON.stringify({ names: topics }));
		done.push('topics');
	}
	if (sa.dependabot_security_updates?.status !== 'enabled') {
		for (const ep of ['vulnerability-alerts', 'automated-security-fixes']) {
			try {
				gh(['api', '-X', 'PUT', `repos/${OWNER}/${repo.name}/${ep}`]);
				done.push(ep);
			} catch (e) {
				if (isRateLimit(e)) throw e;
				done.push(`${ep}:unavailable`);
			}
		}
	}
	return done;
}

function loadState() {
	try {
		return JSON.parse(readFileSync(STATE, 'utf8'));
	} catch {
		return {};
	}
}

mkdirSync(WORK, { recursive: true });
const state = RESUME ? loadState() : {};
let repos = listRepos();
const held = repos.filter((r) => GATED.test(r.name));
if (!INCLUDE_GATED) repos = repos.filter((r) => !GATED.test(r.name));
if (ONLY) repos = repos.filter((r) => ONLY.has(r.name));
repos = repos.slice(0, LIMIT);

console.log(`${APPLY ? 'APPLY' : 'PLAN'}: ${repos.length} repos (${held.length} held for owner approval${INCLUDE_GATED ? ', included' : ''}), ${repos[0]?.stargazerCount ?? '-'} to ${repos.at(-1)?.stargazerCount ?? '-'} stars`);
let ok = 0;
const failures = [];
for (const repo of repos) {
	if (RESUME && state[repo.name]?.ok) continue;
	try {
		let r;
		for (let attempt = 0; ; attempt++) {
			const wait = quotaWaitSeconds();
			if (wait) sleepSync(wait);
			try {
				r = boostOne(repo);
				break;
			} catch (e) {
				if (!isRateLimit(e) || attempt >= 3) throw e;
				sleepSync(Math.max(quotaWaitSeconds(5000), 60));
			}
		}
		state[repo.name] = { ok: true, ...r };
		ok++;
		console.log(`${String(repo.stargazerCount).padStart(5)}  ${repo.name}  ${r.status || (r.pushed ? 'pushed' : 'unchanged')}  +${r.added?.length ?? 0} files${r.readmeChanged ? ' +readme' : ''}${r.settings?.length ? '  settings:' + r.settings.join(',') : ''}`);
	} catch (e) {
		state[repo.name] = { ok: false, error: String(e.message).slice(0, 300) };
		failures.push(repo.name);
		console.log(`${String(repo.stargazerCount).padStart(5)}  ${repo.name}  FAILED  ${String(e.message).slice(0, 200)}`);
	}
	writeFileSync(STATE, JSON.stringify(state, null, 1));
}
console.log(`done: ${ok} ok, ${failures.length} failed${failures.length ? ` (${failures.join(', ')})` : ''}`);
if (held.length) console.log(`held for owner approval (${held.length}): ${held.map((r) => r.name).join(' ')}`);
process.exit(failures.length ? 1 : 0);
