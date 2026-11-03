#!/usr/bin/env node
// Publish a GitHub Release for nirholas/three.ws built from the public changelog.
//
// A release reaches every watcher and stargazer through GitHub's own feed, so
// it is the cheapest distribution channel the repo has. The notes are the
// changelog entries dated inside the window, read from data/changelog.json AT
// THE TARGET COMMIT (the one production runs), and passed through the same
// public-feed filter the X lane uses (data/changelog-x-filter.json): no wallet
// or payment internals, no security work, no gated project names, no bare fixes.
//
//   node scripts/github-release.mjs --from 2026-08-29 --to 2026-09-30 \
//     --tag v1.5.2 --target 774ca7287 --title "September 2026"          # preview
//   ... --apply                                                          # publish
//
// Entries naming a $TICKER other than $THREE are always left out. To leave out
// projects written by name, pass --exclude-terms <file> (JSON array of names)
// kept outside the repo: naming them in a committed file would itself put the
// commit under the other-coin gate, which is why data/announce-gate-terms.json
// stays empty unless the owner fills it.
//
// The note-building and filter logic lives in api/_lib/github-release.js, shared
// with the weekly cron (api/cron/github-release.js, Mondays 15:00 UTC), which
// publishes vYYYY.MM.DD releases on its own. Use this script for previews,
// backfills and one-off windows; the cron skips a tag that already exists.
//
// Auth for --apply: GITHUB_TOKEN, else the gh CLI's stored token
// (~/.config/gh/hosts.yml). The token needs the `repo` scope.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { REPO, MAX_BODY_CHARS, buildReleaseNotes, entriesOf } from '../api/_lib/github-release.js';

function parseArgs(argv) {
	const args = { apply: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--apply') args.apply = true;
		else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
	}
	for (const k of ['from', 'to', 'tag', 'target', 'title']) {
		if (!args[k]) throw new Error(`missing --${k}`);
	}
	return args;
}

function feedAt(commit) {
	const raw = execFileSync('git', ['show', `${commit}:data/changelog.json`], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
	return entriesOf(JSON.parse(raw));
}

function githubToken() {
	if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
	const hosts = join(homedir(), '.config', 'gh', 'hosts.yml');
	if (existsSync(hosts)) {
		const m = readFileSync(hosts, 'utf8').match(/oauth_token:\s*(\S+)/);
		if (m) return m[1];
	}
	throw new Error('no GitHub token: set GITHUB_TOKEN or run `gh auth login`');
}

async function github(path, init = {}) {
	const res = await fetch(`https://api.github.com${path}`, {
		...init,
		headers: { Authorization: `token ${githubToken()}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
	});
	const json = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path} -> ${res.status}: ${json.message || ''}`);
	return json;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const sha = execFileSync('git', ['rev-parse', args.target], { encoding: 'utf8' }).trim();
	const terms = args['exclude-terms'] ? JSON.parse(readFileSync(args['exclude-terms'], 'utf8')) : [];
	const notes = buildReleaseNotes(feedAt(sha), { ...args, terms });
	if (notes.body.length > MAX_BODY_CHARS) throw new Error(`release body is ${notes.body.length} chars, over GitHub's limit`);
	console.log(`${notes.name} (${args.tag} at ${sha.slice(0, 9)}): ${notes.kept} of ${notes.total} entries pass the public filter, ${notes.body.length} chars\n`);
	if (!args.apply) {
		console.log(notes.body);
		console.log('\nPreview only. Re-run with --apply to publish.');
		return;
	}
	await github(`/repos/${REPO}/commits/${sha}`);
	const release = await github(`/repos/${REPO}/releases`, {
		method: 'POST',
		body: JSON.stringify({ tag_name: args.tag, target_commitish: sha, name: notes.name, body: notes.body, make_latest: 'true' }),
	});
	console.log(`published: ${release.html_url}`);
}

main().catch((err) => {
	console.error(`[github-release] ${err.message}`);
	process.exit(1);
});
