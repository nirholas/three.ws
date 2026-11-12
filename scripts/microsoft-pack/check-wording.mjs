#!/usr/bin/env node
/**
 * Wording gate for the Microsoft co-marketing and programs pack.
 *
 * Every file under docs/partners/microsoft/ is read by Microsoft staff or
 * posted to Microsoft-owned channels, so it must only make the two approved
 * partnership claims. The rules live in wording.mjs, which build-deck.mjs
 * also applies to the text of every slide.
 *
 * Usage: node scripts/microsoft-pack/check-wording.mjs [file ...]
 * With no arguments it checks every .md and .html file in the pack.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { forbidden, repoRoot, wordingProblems } from './wording.mjs';

const packDir = join(repoRoot, 'docs/partners/microsoft');

function listPackFiles(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...listPackFiles(full));
		else if (['.md', '.html'].includes(extname(name))) out.push(full);
	}
	return out;
}

const files = process.argv.length > 2 ? process.argv.slice(2).map((f) => resolve(f)) : listPackFiles(packDir);
const problems = files.flatMap((file) => wordingProblems(readFileSync(file, 'utf8'), relative(repoRoot, file)));

if (problems.length) {
	console.error(problems.join('\n'));
	console.error(`\n${problems.length} wording problem(s) in ${files.length} file(s).`);
	process.exit(1);
}
console.log(`wording clean: ${files.length} file(s) checked against ${forbidden.length} forbidden phrases and the approved claims.`);
