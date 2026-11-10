#!/usr/bin/env node
// Append the owner's attribution footer to the README of every public
// nirholas repository that is NOT part of the three.ws platform, walking the
// repos from least starred to most starred.
//
// The footer is marker-delimited (<!-- nirholas:watermark --> ... <!-- /nirholas:watermark -->),
// so a re-run skips any README that already carries it, and GitHub itself is
// the record of which repos have it (use --report).
//
// A repo counts as three.ws-related, and is left alone, when any of these hold:
//   - it is a generated mirror listed in data/standalone-mirrors.json
//   - its homepage is on three.ws
//   - its name or description names three.ws / three-ws / threews / 3d-agent / $THREE
//   - its README, minus the shared three.ws:badges and three.ws:growth blocks
//     every repo carries, mentions three.ws at least CORE_MENTION_MIN times
//     (the @three-ws/* packages and the engines behind three.ws features)
//     (the @three-ws/* packages and the engines behind three.ws features). This
//     one is a heuristic: it keeps the footer off, but never removes an existing one.
// The repo topic "three-ws" is ignored: it was applied account-wide, so it says nothing.
// Forks are skipped (the work in them is not the owner's). Archived repos are
// unarchived for the one commit and archived again straight after.
//
// Usage (needs GH_TOKEN with contents:write, plus administration:write for archived repos):
//   node scripts/github-readme-watermark.mjs            # dry run: print the ordered plan
//   node scripts/github-readme-watermark.mjs --apply    # commit the footer least stars first, and pull it
//                                                       # back off any repo that turns out to be three.ws code
//   node scripts/github-readme-watermark.mjs --report   # which public repos carry the footer now

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = 'nirholas';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const REPORT = argv.includes('--report');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) {
	console.error('Set GH_TOKEN (a token for the nirholas account with contents:write).');
	process.exit(1);
}

export const MARK_START = '<!-- nirholas:watermark -->';
export const MARK_END = '<!-- /nirholas:watermark -->';
export const FOOTER = [
	MARK_START,
	'',
	'---',
	'',
	'<p align="center">',
	'  Built by <a href="https://github.com/nirholas"><b>nirholas</b></a> · <a href="https://x.com/nichxbt">@nichxbt</a> · <a href="https://github.com/nirholas">github.com/nirholas</a>',
	'</p>',
	'',
	MARK_END,
	'',
].join('\n');
const TRAILER = '\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>';
const ADD_MESSAGE = 'docs(readme): add the nirholas attribution footer (x.com/nichxbt, github.com/nirholas)' + TRAILER;
const REMOVE_MESSAGE = 'docs(readme): drop the personal attribution footer, this repo is three.ws platform code' + TRAILER;

const RELATED_RE = /three\.ws|three-ws|threews|3d-agent|\$THREE\b/i;
const SHARED_BLOCK_RE = /<!-- three\.ws:(\w+) -->[\s\S]*?<!-- \/three\.ws:\1 -->/g;
const CORE_MENTION_RE = /three\.ws|three-ws|\$THREE\b|3d-agent/gi;
const CORE_MENTION_MIN = 4;
const README_REASON = 'README is three.ws platform code';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(method, path, body, accept = 'application/vnd.github+json') {
	for (let attempt = 0; attempt < 6; attempt++) {
		const res = await fetch(`https://api.github.com${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${TOKEN}`,
				Accept: accept,
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'nirholas-readme-watermark',
				...(body ? { 'Content-Type': 'application/json' } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		const text = await res.text();
		const limited =
			(res.status === 403 || res.status === 429) &&
			(res.headers.get('retry-after') || res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(text));
		if (limited) {
			const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
			const wait = Number(res.headers.get('retry-after')) * 1000 || (reset ? Math.max(reset - Date.now(), 1000) : 60000);
			console.error(`  rate limited, waiting ${Math.ceil(wait / 1000)}s`);
			await sleep(wait + 1000);
			continue;
		}
		if (res.status >= 500) {
			await sleep(5000 * (attempt + 1));
			continue;
		}
		const data = accept.endsWith('raw') ? text : text ? JSON.parse(text) : {};
		return { status: res.status, data };
	}
	return { status: 599, data: { message: 'retries exhausted' } };
}

async function listRepos() {
	const out = [];
	for (let page = 1; ; page++) {
		const { status, data } = await gh('GET', `/users/${OWNER}/repos?type=owner&per_page=100&page=${page}`);
		if (status !== 200) throw new Error(`listing repos failed: ${status} ${data.message || ''}`);
		out.push(...data);
		if (data.length < 100) return out.filter((r) => !r.private && !r.fork);
	}
}

function mirrorNames() {
	const { mirrors } = JSON.parse(readFileSync(resolve(root, 'data/standalone-mirrors.json'), 'utf8'));
	// Only "out" entries are generated from this monorepo. "in" entries are
	// standalone repos the monorepo keeps a reference copy of; they stay eligible.
	return new Set(
		mirrors
			.filter((m) => m.direction === 'out')
			.map((m) => String(m.repo || '').split('/').pop())
			.filter(Boolean),
	);
}

async function readme(repo) {
	const { status, data } = await gh('GET', `/repos/${OWNER}/${repo.name}/readme?ref=${encodeURIComponent(repo.default_branch)}`);
	if (status !== 200) return null;
	return { path: data.path, sha: data.sha, text: Buffer.from(data.content, 'base64').toString('utf8') };
}

export function coreMentions(text) {
	const core = text.replace(SHARED_BLOCK_RE, '');
	return (core.match(CORE_MENTION_RE) || []).length;
}

export function withFooter(text) {
	const nl = text.includes('\r\n') ? '\r\n' : '\n';
	return text.replace(/\s+$/, '') + nl + nl + FOOTER.replace(/\n/g, nl);
}

export function withoutFooter(text) {
	const nl = text.includes('\r\n') ? '\r\n' : '\n';
	const re = /\s*<!-- nirholas:watermark -->[\s\S]*?<!-- \/nirholas:watermark -->\s*/;
	return text.replace(re, nl).replace(/\s+$/, '') + nl;
}

/** Returns the reason a repo is three.ws-related, or null when it should get the footer. */
function relatedReason(repo, mirrors, text) {
	if (mirrors.has(repo.name)) return 'standalone mirror of the monorepo';
	if (/(^|\/\/|\.)three\.ws(\/|$)/i.test(repo.homepage || '')) return 'homepage on three.ws';
	if (RELATED_RE.test(repo.name) || RELATED_RE.test(repo.description || '')) return 'name or description names three.ws';
	if (text != null && coreMentions(text) >= CORE_MENTION_MIN) return README_REASON;
	return null;
}

async function setArchived(repo, archived) {
	const { status, data } = await gh('PATCH', `/repos/${OWNER}/${repo.name}`, { archived });
	if (status !== 200) throw new Error(`${archived ? 'archive' : 'unarchive'} ${status} ${data.message || ''}`);
}

async function commitReadme(repo, file, text, message) {
	const body = {
		message,
		content: Buffer.from(text, 'utf8').toString('base64'),
		sha: file.sha,
		branch: repo.default_branch,
	};
	const { status, data } = await gh('PUT', `/repos/${OWNER}/${repo.name}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}`, body);
	if (status !== 200 && status !== 201) throw new Error(`commit ${status} ${data.message || ''}`);
	return data.commit.html_url;
}

async function main() {
	const mirrors = mirrorNames();
	const repos = (await listRepos()).sort((a, b) => a.stargazers_count - b.stargazers_count || a.name.localeCompare(b.name));
	const add = [];
	const strip = [];
	const marked = [];
	let excluded = 0;
	for (const repo of repos) {
		const file = await readme(repo);
		const reason = relatedReason(repo, mirrors, file?.text ?? null);
		const has = Boolean(file?.text.includes(MARK_START));
		if (has) marked.push({ repo, reason });
		if (reason || !file) excluded++;
		// The README count is a heuristic, so it only ever withholds the footer; it
		// never pulls back one the owner already has on a repo. Removal needs a firm
		// signal (an outbound mirror, a three.ws homepage, the name or description).
		if (reason && has && reason !== README_REASON) strip.push({ repo, file, reason });
		else if (!reason && file && !has) add.push({ repo, file });
	}

	const line = ({ repo, reason }) =>
		`  ${repo.stargazers_count}\t${repo.name}${repo.archived ? '\t(archived)' : ''}${reason ? `\t(three.ws-related: ${reason})` : ''}`;

	if (REPORT) {
		console.log(`${marked.length} public repos carry the footer:`);
		marked.forEach((m) => console.log(line(m)));
		console.log(`${add.length} unrelated repos still need it, ${strip.length} three.ws-related repos should lose it.`);
		return;
	}

	console.log(`${repos.length} public non-fork repos, ${excluded} excluded (three.ws-related or no README).`);
	console.log(`${add.length} to watermark, least stars first:`);
	add.forEach((a) => console.log(line(a)));
	console.log(`${strip.length} three.ws-related repos to remove the footer from:`);
	strip.forEach((s) => console.log(line(s)));
	if (!APPLY) {
		console.log('\nDry run. Re-run with --apply to commit.');
		return;
	}

	const jobs = [
		...add.map((a) => ({ ...a, kind: 'add', text: withFooter(a.file.text), message: ADD_MESSAGE })),
		...strip.map((s) => ({ ...s, kind: 'remove', text: withoutFooter(s.file.text), message: REMOVE_MESSAGE })),
	];
	let ok = 0;
	const failed = [];
	for (const { repo, file, kind, text, message } of jobs) {
		try {
			if (repo.archived) await setArchived(repo, false);
			try {
				const url = await commitReadme(repo, file, text, message);
				console.log(`${kind}\t${repo.stargazers_count}\t${repo.name}\t${url}`);
				ok++;
			} finally {
				if (repo.archived) await setArchived(repo, true);
			}
		} catch (err) {
			console.log(`error\t${repo.stargazers_count}\t${repo.name}\t${err.message}`);
			failed.push(repo.name);
		}
		await sleep(2000);
	}
	console.log(`\n${ok} committed, ${failed.length} failed${failed.length ? ': ' + failed.join(', ') : ''}`);
	if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
