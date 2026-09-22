#!/usr/bin/env node
/**
 * Keep community-skills/ and its public mirror (nirholas/three-ws-community-skills)
 * in step. Canonical source is this monorepo; outsiders open pull requests on
 * the small mirror, which is easier to fork than a 60-directory monorepo.
 *
 *   node scripts/sync-community-skills.mjs export [--dir <path>]
 *       Validate, then write the mirror's working tree (default
 *       .data/community-skills-mirror, gitignored) and commit it there. Prints
 *       the exact push, or the one-time `gh repo create`, for the owner to run.
 *
 *   node scripts/sync-community-skills.mjs import --from <mirror checkout>
 *       Validate a checkout of the mirror (e.g. after merging a contributor's
 *       PR there), then copy its skills/ back into community-skills/skills and
 *       regenerate registry.json. Commit the result here like any other change.
 *
 * Nothing is pushed or created on GitHub by this script: publishing is
 * owner-gated (CLAUDE.md), so it ends by printing the command instead.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRegistry, serializeRegistry, REGISTRY_MIRROR } from '../community-skills/tools/registry.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'community-skills');
const [mode, ...rest] = process.argv.slice(2);
const flag = (name) => {
	const i = rest.indexOf(`--${name}`);
	return i >= 0 ? rest[i + 1] : undefined;
};
const MIRROR_REPO = REGISTRY_MIRROR.replace('https://github.com/', '');

function git(cwd, ...args) {
	const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr.trim()}`);
	return r.stdout.trim();
}

function validateOrExit(dir, label) {
	const { ok, errors, registry } = buildRegistry(dir);
	if (!ok) {
		console.error(`${label}: ${errors.length} problem(s)`);
		for (const e of errors) console.error(`  ${e.slug}: ${e.message}`);
		process.exit(1);
	}
	return registry;
}

// Replace everything in `dest` except its .git directory with a copy of `src`.
function mirrorTree(src, dest) {
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(dest)) if (entry !== '.git') rmSync(join(dest, entry), { recursive: true, force: true });
	for (const entry of readdirSync(src)) cpSync(join(src, entry), join(dest, entry), { recursive: true });
}

if (mode === 'export') {
	const registry = validateOrExit(source, 'community-skills');
	const dest = resolve(root, flag('dir') || '.data/community-skills-mirror');
	mirrorTree(source, dest);
	writeFileSync(join(dest, 'registry.json'), serializeRegistry(registry));
	const fresh = !existsSync(join(dest, '.git'));
	if (fresh) git(dest, 'init', '-q', '-b', 'main');
	git(dest, 'add', '-A');
	const status = git(dest, 'status', '--porcelain');
	if (status) {
		const sha = git(root, 'rev-parse', '--short', 'HEAD');
		git(dest, 'commit', '-q', '-m', `sync: ${registry.count} skills from three.ws@${sha}`);
	}
	console.log(`mirror tree at ${dest}: ${registry.count} skills, ${status ? 'committed' : 'no changes'}`);
	console.log('\nTo publish (owner approval required):');
	if (fresh) {
		console.log(`  cd ${dest} && gh repo create ${MIRROR_REPO} --public --source=. --push --description "Community skills for three.ws agents: prompt-only SKILL.md files anyone can contribute and import onto an agent in one click."`);
	} else {
		console.log(`  cd ${dest} && git push origin main`);
	}
} else if (mode === 'import') {
	const from = flag('from');
	if (!from || !existsSync(join(resolve(from), 'skills'))) {
		console.error('usage: node scripts/sync-community-skills.mjs import --from <mirror checkout with a skills/ directory>');
		process.exit(2);
	}
	validateOrExit(resolve(from), 'mirror');
	mirrorTree(join(resolve(from), 'skills'), join(source, 'skills'));
	const registry = validateOrExit(source, 'community-skills');
	writeFileSync(join(source, 'registry.json'), serializeRegistry(registry));
	console.log(`imported ${registry.count} skills from ${from}; review with \`git diff community-skills/\` and commit`);
} else {
	console.error('usage: node scripts/sync-community-skills.mjs export [--dir <path>] | import --from <path>');
	process.exit(2);
}
