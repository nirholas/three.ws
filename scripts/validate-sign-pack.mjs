#!/usr/bin/env node
// Lint a sign language pack and print its review coverage.
//
//   npm run sign:validate-pack -- asl            (registered pack, by id or name)
//   npm run sign:validate-pack -- src/sign-packs/rms.js   (a pack file being authored)
//
// Checks the pack metadata, every sign's structure against what the engine
// knows (handshapes, anchors, contact parts, directions, face markers),
// Battison's Symmetry and Dominance conditions, aliases, and the committed
// review ledger (src/sign-packs/linguistics.js). Then reports how many signs
// fluent reviewers have approved against each sign's current content: only
// those are served. Exits 1 on any lint problem, 0 otherwise.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

import { getPack, listPacks } from '../src/sign-packs/index.js';
import { lintPack } from '../src/sign-packs/linguistics.js';
import { packReview } from '../src/sign-packs/review.js';

const NAMES = { asl: 'ase', lsr: 'rms' };

async function loadPack(arg) {
	if (/[/\\]|\.m?js$/.test(arg)) {
		const file = resolve(arg);
		if (!existsSync(file)) throw new Error(`no pack file at ${file}`);
		const mod = await import(pathToFileURL(file).href);
		if (!mod.default) throw new Error(`${arg} has no default export (the pack object)`);
		return mod.default;
	}
	const pack = getPack(NAMES[arg.toLowerCase()] ?? arg);
	if (!pack) {
		const known = listPacks()
			.map((p) => p.id)
			.join(', ');
		throw new Error(`no registered pack "${arg}". Registered: ${known}. Pass a file path to lint a pack being authored.`);
	}
	return pack;
}

const arg = process.argv[2];
if (!arg) {
	console.error('usage: npm run sign:validate-pack -- <pack id | path to pack file>');
	process.exit(2);
}

let pack;
try {
	pack = await loadPack(arg);
} catch (err) {
	console.error(`[sign:validate-pack] ${err.message}`);
	process.exit(2);
}

const issues = lintPack(pack);
const review = packReview(pack);
const total = Object.keys(pack.signs ?? {}).length;
const aliasCount = Object.keys(pack.aliases ?? {}).length;

console.log(`${pack.name} (${pack.id}): ${total} signs, ${aliasCount} aliases, status ${pack.status}`);
if (pack.status === 'native') {
	console.log('  review: native pack, served without per-sign review rows');
} else {
	const counts = {};
	for (const s of Object.values(review.signs)) counts[s.state] = (counts[s.state] ?? 0) + 1;
	console.log(`  review: ${review.approved.length} of ${total} signs approved (${review.required} distinct approvals each)`);
	for (const state of ['approved', 'in_review', 'needs_change', 'rejected', 'unreviewed']) {
		if (counts[state]) console.log(`    ${state.padEnd(13)} ${counts[state]}`);
	}
	console.log(review.approved.length ? '  served: approved signs only' : '  served: nothing yet (no approved sign)');
}

if (issues.length) {
	console.error(`\n${issues.length} problem${issues.length === 1 ? '' : 's'}:`);
	for (const issue of issues) console.error(`  - ${issue}`);
	process.exit(1);
}
console.log('  lint: ok');
