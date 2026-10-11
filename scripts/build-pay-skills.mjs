#!/usr/bin/env node
/**
 * Build the three.ws providers for the Solana Foundation `pay` registry
 * (github.com/solana-foundation/pay-skills) into distributions/pay-skills/.
 *
 *   node scripts/build-pay-skills.mjs            write the provider files
 *   node scripts/build-pay-skills.mjs --check    fail when the committed files are stale
 *   node scripts/build-pay-skills.mjs --verify   write, then run the real `pay catalog check`
 *                                                 against production (live 402 probes)
 *
 * The listings are projected from the service catalog by
 * api/_lib/service-catalog/pay-skills.js, which also enforces the registry's
 * copy rules. --verify runs the registry's own validator, the same check its
 * pull-request CI runs, so a green run here means the PR will pass. Probing is
 * read-only: each paid endpoint is called once without payment and must answer
 * with a Solana-payable 402. Nothing is ever paid.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPaySkills, OPERATOR } from '../api/_lib/service-catalog/pay-skills.js';

// The npm package that ships the `pay` binary, pinned so a validator change
// upstream cannot silently change what --verify means.
const PAY_CLI = '@solana/pay@1.0.26';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, 'distributions/pay-skills');
const operatorDir = join(outRoot, 'providers', OPERATOR);

const check = process.argv.includes('--check');
const verify = process.argv.includes('--verify');

function listFiles(dir, base = dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		return e.isDirectory() ? listFiles(p, base) : [p.slice(base.length + 1)];
	});
}

const files = buildPaySkills();
const expected = new Set(Object.keys(files));
const onDisk = listFiles(operatorDir).map((f) => `providers/${OPERATOR}/${f}`);

if (check) {
	const stale = Object.entries(files)
		.filter(([rel, body]) => {
			const p = join(outRoot, rel);
			return !existsSync(p) || readFileSync(p, 'utf8') !== body;
		})
		.map(([rel]) => rel);
	const orphans = onDisk.filter((rel) => !expected.has(rel));
	if (stale.length || orphans.length) {
		for (const rel of stale) console.error(`stale: distributions/pay-skills/${rel}`);
		for (const rel of orphans) console.error(`orphan: distributions/pay-skills/${rel}`);
		console.error('Run `npm run build:pay-skills` and commit the result.');
		process.exit(1);
	}
	console.log(`pay-skills: ${expected.size} files up to date.`);
	process.exit(0);
}

for (const rel of onDisk) if (!expected.has(rel)) rmSync(join(outRoot, rel));
for (const [rel, body] of Object.entries(files)) {
	const p = join(outRoot, rel);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, body);
}
console.log(`pay-skills: wrote ${expected.size} files to distributions/pay-skills/providers/${OPERATOR}/`);

if (verify) {
	let failed = false;
	for (const rel of Object.keys(files).filter((f) => f.endsWith('/PAY.md'))) {
		console.log(`\n== pay catalog check ${rel}`);
		const r = spawnSync('npx', ['-y', PAY_CLI, 'catalog', 'check', rel, '-v'], {
			cwd: outRoot,
			stdio: 'inherit',
			env: { ...process.env, NO_COLOR: '1' },
		});
		if (r.status !== 0) failed = true;
	}
	process.exit(failed ? 1 : 0);
}
