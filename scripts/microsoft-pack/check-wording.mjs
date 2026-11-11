#!/usr/bin/env node
/**
 * Wording gate for the Microsoft co-marketing and programs pack.
 *
 * Every file under docs/partners/microsoft/ is read by Microsoft staff or
 * posted to Microsoft-owned channels, so it must only make the two approved
 * partnership claims (see docs/microsoft.md#saying-it-correctly). This fails
 * when a file contains:
 *   - any phrase on the `forbidden` list in data/x-content/partners/microsoft.json
 *     (tiers, endorsement, certification, Azure hosting, and the rest);
 *   - an em-dash or en-dash (house style, CLAUDE.md "Tone");
 *   - a partnership sentence that is not one of the approved claims.
 *
 * Usage: node scripts/microsoft-pack/check-wording.mjs [file ...]
 * With no arguments it checks every .md and .html file in the pack.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packDir = join(root, 'docs/partners/microsoft');
const forbidden = JSON.parse(readFileSync(join(root, 'data/x-content/partners/microsoft.json'), 'utf8')).forbidden;

// A sentence that pairs "partner" or "partnership" with Microsoft must be one
// of these, in substance. Anything else (a tier, a programme status, "official
// partner") is a claim the owner has not confirmed.
const APPROVED_PARTNERSHIP = [
	/three\.ws and microsoft (have )?announced a partnership/i,
	/three\.ws is (now )?live on microsoft marketplace/i,
];
const PARTNERSHIP_MENTION = /microsoft[^.\n]{0,40}\bpartnership\b|\bpartnership\b[^.\n]{0,40}microsoft/i;
const DASHES = /[\u2013\u2014]/;

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
const problems = [];

for (const file of files) {
	const text = readFileSync(file, 'utf8');
	const lower = text.toLowerCase();
	const rel = relative(root, file);
	for (const phrase of forbidden) {
		if (lower.includes(phrase.toLowerCase())) problems.push(`${rel}: forbidden phrase "${phrase}"`);
	}
	text.split('\n').forEach((line, i) => {
		if (DASHES.test(line)) problems.push(`${rel}:${i + 1}: em-dash or en-dash`);
		for (const sentence of line.split(/(?<=[.!?])\s+/)) {
			if (PARTNERSHIP_MENTION.test(sentence) && !APPROVED_PARTNERSHIP.some((re) => re.test(sentence))) {
				problems.push(`${rel}:${i + 1}: partnership sentence is not an approved claim: "${sentence.trim().slice(0, 140)}"`);
			}
		}
	});
}

if (problems.length) {
	console.error(problems.join('\n'));
	console.error(`\n${problems.length} wording problem(s) in ${files.length} file(s).`);
	process.exit(1);
}
console.log(`wording clean: ${files.length} file(s) checked against ${forbidden.length} forbidden phrases and the approved claims.`);
