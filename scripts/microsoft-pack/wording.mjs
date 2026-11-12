/**
 * The wording rules for everything in the Microsoft co-marketing and programs
 * pack, shared by check-wording.mjs (Markdown and HTML files) and
 * build-deck.mjs (the text of every slide).
 *
 * A text fails when it contains:
 *   - any phrase on the `forbidden` list in data/x-content/partners/microsoft.json
 *     (tiers, endorsement, certification, Azure hosting, and the rest);
 *   - an em-dash or en-dash (house style, CLAUDE.md "Tone");
 *   - a partnership sentence that is not one of the two approved claims
 *     (docs/microsoft.md#saying-it-correctly).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const forbidden = JSON.parse(
	readFileSync(join(repoRoot, 'data/x-content/partners/microsoft.json'), 'utf8'),
).forbidden;

// A sentence that pairs "partner" or "partnership" with Microsoft must be one
// of these, in substance. Anything else (a tier, a programme status, "official
// partner") is a claim the owner has not confirmed.
const APPROVED_PARTNERSHIP = [
	/three\.ws and microsoft (have )?announced a partnership/i,
	/three\.ws is (now )?live on microsoft marketplace/i,
];
const PARTNERSHIP_MENTION = /microsoft[^.\n]{0,40}\bpartnership\b|\bpartnership\b[^.\n]{0,40}microsoft/i;
const DASHES = /[\u2013\u2014]/;

/** Returns one message per problem in `text`, each prefixed with `label`. */
export function wordingProblems(text, label) {
	const problems = [];
	const lower = text.toLowerCase();
	for (const phrase of forbidden) {
		if (lower.includes(phrase.toLowerCase())) problems.push(`${label}: forbidden phrase "${phrase}"`);
	}
	text.split('\n').forEach((line, i) => {
		if (DASHES.test(line)) problems.push(`${label}:${i + 1}: em-dash or en-dash`);
		for (const sentence of line.split(/(?<=[.!?])\s+/)) {
			if (PARTNERSHIP_MENTION.test(sentence) && !APPROVED_PARTNERSHIP.some((re) => re.test(sentence))) {
				problems.push(`${label}:${i + 1}: partnership sentence is not an approved claim: "${sentence.trim().slice(0, 140)}"`);
			}
		}
	});
	return problems;
}
