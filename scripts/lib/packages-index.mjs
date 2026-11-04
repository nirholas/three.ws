// Completeness check for packages/README.md, the front door to every package
// under packages/. Shared by scripts/audit-docs.mjs (so `npm run audit:docs`
// fails on a gap) and tests/packages-index.test.js.
//
// The index has two tables. "Publishable packages" lists every directory whose
// package.json is not private: those are what `npm run publish:packages` and
// `npm run publish:mcp` discover. "Internal and engine-bridge packages" lists
// the rest: a private package.json, or no package.json at all (the Godot and
// Unreal bridges ship through their engines' own plugin channels). A row in the
// wrong table is a finding, because the intro tells readers the first table is
// what they can install from npm.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const PUBLISHABLE_HEADING = '## Publishable packages';
export const INTERNAL_HEADING = '## Internal and engine-bridge packages';

/** True when packages/<name> is something publish:packages or publish:mcp ships. */
export function isPublishable(packagesDir, name) {
	const manifest = join(packagesDir, name, 'package.json');
	if (!existsSync(manifest)) return false;
	return !JSON.parse(readFileSync(manifest, 'utf8')).private;
}

/** Package directory names, sorted, ignoring dotfiles. */
export function packageDirs(packagesDir) {
	return readdirSync(packagesDir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
		.map((e) => e.name)
		.sort();
}

/**
 * Parse the index into { section -> [{ name, target, line }] } for every
 * `| [name](target) |` row, keyed by the `## ` heading the row sits under.
 */
export function parseIndex(markdown) {
	const sections = new Map();
	let current = '';
	markdown.split('\n').forEach((text, i) => {
		if (text.startsWith('## ')) {
			current = text.trim();
			if (!sections.has(current)) sections.set(current, []);
			return;
		}
		const m = text.match(/^\| \[([^\]]+)\]\(([^)]+)\) \|/);
		if (!m) return;
		if (!sections.has(current)) sections.set(current, []);
		sections.get(current).push({ name: m[1], target: m[2], line: i + 1 });
	});
	return sections;
}

/**
 * Every way packages/README.md disagrees with the packages/ directory.
 * @returns {{ name: string, line: number, detail: string }[]}
 */
export function packagesIndexGaps(packagesDir) {
	const readme = join(packagesDir, 'README.md');
	if (!existsSync(readme)) return [{ name: 'README.md', line: 0, detail: 'packages/README.md is missing' }];
	const sections = parseIndex(readFileSync(readme, 'utf8'));
	const gaps = [];
	const rowsBySection = (heading) => sections.get(heading) || [];
	for (const heading of [PUBLISHABLE_HEADING, INTERNAL_HEADING]) {
		if (!sections.has(heading)) gaps.push({ name: heading, line: 0, detail: `section "${heading}" is missing` });
	}

	const seen = new Map();
	for (const [heading, rows] of sections) {
		for (const row of rows) {
			if (seen.has(row.name)) {
				gaps.push({ name: row.name, line: row.line, detail: `listed twice (also line ${seen.get(row.name)})` });
				continue;
			}
			seen.set(row.name, row.line);
			if (row.target !== `${row.name}/README.md`) {
				gaps.push({ name: row.name, line: row.line, detail: `links to ${row.target}, expected ${row.name}/README.md` });
			}
			if (!existsSync(join(packagesDir, row.name))) {
				gaps.push({ name: row.name, line: row.line, detail: 'no such directory under packages/' });
				continue;
			}
			if (!existsSync(join(packagesDir, row.target))) {
				gaps.push({ name: row.name, line: row.line, detail: `linked README ${row.target} does not exist` });
			}
			const want = isPublishable(packagesDir, row.name) ? PUBLISHABLE_HEADING : INTERNAL_HEADING;
			if (heading !== want) {
				gaps.push({ name: row.name, line: row.line, detail: `belongs under "${want}", found under "${heading || '(no heading)'}"` });
			}
		}
	}

	for (const name of packageDirs(packagesDir)) {
		if (seen.has(name)) continue;
		const want = isPublishable(packagesDir, name) ? PUBLISHABLE_HEADING : INTERNAL_HEADING;
		gaps.push({ name, line: 0, detail: `not in the index; add a row under "${want}"` });
	}

	for (const heading of [PUBLISHABLE_HEADING, INTERNAL_HEADING]) {
		const names = rowsBySection(heading).map((r) => r.name);
		const sorted = [...names].sort((a, b) => a.localeCompare(b));
		const at = names.findIndex((n, i) => n !== sorted[i]);
		if (at !== -1) {
			const row = rowsBySection(heading)[at];
			gaps.push({ name: row.name, line: row.line, detail: `out of alphabetical order under "${heading}" (expected ${sorted[at]} here)` });
		}
	}
	return gaps;
}
