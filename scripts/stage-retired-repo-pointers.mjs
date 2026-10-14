#!/usr/bin/env node
// Stage a one-file, one-commit pointer README for every repo in
// data/retired-repos.json under dist/retired-repos/<repo>/, ready for the
// owner to force-push over the repo's current README and archive it.
//
// This script never pushes and never talks to the GitHub API: it only writes
// under dist/ (gitignored) and prints the exact push + `gh repo archive`
// commands, same split of responsibility as sync-standalone-repos.mjs.
//
// Usage:
//   node scripts/stage-retired-repo-pointers.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const owner = 'nirholas';
const STAGE_ROOT = join(root, 'dist', 'retired-repos');
const today = new Date().toISOString().slice(0, 10);

const manifest = JSON.parse(readFileSync(join(root, 'data', 'retired-repos.json'), 'utf8'));

function readme(entry) {
	return `# ${entry.repo} (archived)

**This repository is archived as of ${today}.** ${entry.reason}

The capability now lives at [${entry.replacedByText}](${entry.replacedByUrl}).

No further commits will land here. Issues and pull requests are closed on
archive; open them against the link above instead.
`;
}

function stage(entry) {
	const dest = join(STAGE_ROOT, entry.repo);
	rmSync(dest, { recursive: true, force: true });
	mkdirSync(dest, { recursive: true });
	writeFileSync(join(dest, 'README.md'), readme(entry));

	const run = (args) => execFileSync('git', args, { cwd: dest, stdio: 'pipe', encoding: 'utf8' });
	run(['init', '-q', '-b', 'main']);
	run(['add', '-A']);
	run([
		'-c', 'user.name=three.ws sync',
		'-c', 'user.email=sync@three.ws',
		'commit', '-q', '-m',
		`Archive: point to ${entry.replacedByText}`,
	]);
	return `${owner}/${entry.repo}`;
}

console.log(`STAGE: ${manifest.repos.length} retired-repo pointer(s) under dist/retired-repos/*\n`);

const commands = [];
for (const entry of manifest.repos) {
	const slug = stage(entry);
	console.log(`-- ${entry.repo}  ->  dist/retired-repos/${entry.repo}  (github.com/${slug})`);
	commands.push(`git -C dist/retired-repos/${entry.repo} push --force https://github.com/${slug}.git HEAD:main`);
	commands.push(`gh repo archive ${slug} --yes`);
}

console.log(`\nStaged ${manifest.repos.length} pointer README(s). 0 repos pushed, 0 archived (this tool never does either).`);
console.log('\nTo publish and archive, run (owner-gated, two lines per repo):\n');
for (const line of commands) console.log(`  ${line}`);
