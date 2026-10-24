#!/usr/bin/env node
// Install test for the standalone skill repos: builds each repo from
// .agents/skills/, runs the open-standard installer (`npx skills add`) against the
// staged directory inside a clean temporary project, and verifies that every skill
// the repo promises landed as <project>/.claude/skills/<name>/SKILL.md and that
// the installer's own listing finds the same set. Nothing is pushed or published;
// the installer reads the local directory.
//
// Usage: node scripts/test-skills-install.mjs [--only <repo>] [--installer skills@1.7.4]
// Needs network access for `npx` to fetch the installer. Exit 1 on any mismatch.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectSkills } from './build-skills-pack.mjs';
import { REPO_SPECS } from './build-standalone-skill-repos.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const valueOf = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
const INSTALLER = valueOf('--installer') || 'skills@1.7.4';
const only = valueOf('--only');

function run(cmd, args, opts) {
	const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 240_000, ...opts });
	if (r.status !== 0) {
		throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
	}
	return r.stdout;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-install-'));
const stage = path.join(work, 'repos');
const allSkills = collectSkills();
let failed = false;

try {
	run('node', [path.join(ROOT, 'scripts', 'build-standalone-skill-repos.mjs'), '--out', stage], { cwd: ROOT });
	for (const spec of REPO_SPECS.filter((s) => !only || s.repo === only)) {
		const expected = allSkills.filter(spec.select).map((s) => s.name).sort();
		const project = path.join(work, `project-${spec.repo}`);
		fs.mkdirSync(project);
		const home = path.join(work, `home-${spec.repo}`);
		fs.mkdirSync(home);
		const env = { ...process.env, HOME: home, CI: '1', DISABLE_TELEMETRY: '1' };
		const repoDir = path.join(stage, spec.repo);

		const listing = run('npx', ['-y', INSTALLER, 'add', repoDir, '--list'], { cwd: project, env });
		const plain = listing.replace(/\u001b\[[0-9;]*m/g, '');
		const listed = expected.filter((n) => new RegExp(`^\\W*${n}\\s*$`, 'm').test(plain));
		run('npx', ['-y', INSTALLER, 'add', repoDir, '--skill', '*', '-a', 'claude-code', '-y'], { cwd: project, env });

		const skillsDir = path.join(project, '.claude', 'skills');
		const installed = fs.existsSync(skillsDir)
			? fs.readdirSync(skillsDir).filter((n) => fs.existsSync(path.join(skillsDir, n, 'SKILL.md'))).sort()
			: [];
		const missingInstalled = expected.filter((n) => !installed.includes(n));
		const extra = installed.filter((n) => !expected.includes(n));
		const missingListed = expected.filter((n) => !listed.includes(n));
		const ok = !missingInstalled.length && !extra.length && !missingListed.length;
		failed ||= !ok;
		console.log(`${ok ? 'ok  ' : 'FAIL'}  ${spec.repo}: listed ${listed.length}/${expected.length}, installed ${installed.length}/${expected.length}`);
		console.log(`        ${installed.join(', ')}`);
		if (missingListed.length) console.log(`        not listed by installer: ${missingListed.join(', ')}`);
		if (missingInstalled.length) console.log(`        not installed: ${missingInstalled.join(', ')}`);
		if (extra.length) console.log(`        unexpected: ${extra.join(', ')}`);
	}
} catch (err) {
	console.error(err.message);
	failed = true;
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
