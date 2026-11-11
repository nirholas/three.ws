#!/usr/bin/env node
// Keep a prompts/ handoff log under the paste limit by moving its oldest
// entries, verbatim, into read-only archive parts beside it.
//
// Why: prompts/ documents are pasted into or read by fresh agent chats, which
// cap a prompt at 50,000 characters (scripts/check-rules.mjs enforces it on
// every changed prompts/*.md). Progress logs are append-only and grow past that
// on their own. This script is the one-command fix: the live log keeps its
// header, every undated policy section and its newest entries by date, plus a
// pointer to the archive parts; agents keep appending to the same path.
//
// Usage:
//   node scripts/split-progress-log.mjs prompts/finish/_context/plan-PROGRESS.md [more logs...]
//   node scripts/split-progress-log.mjs --check <logs...>   exit 1 if any would be split
//
// An entry starts at a top-level `## ` heading (outside code fences), or at a
// top-level `- 2026-...` bullet for logs written as one bullet per entry.
// Existing archive parts are never rewritten; numbering continues after them.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROMPT_CHAR_LIMIT = 50_000;
const KEEP_BUDGET = 40_000; // live log target, leaves room for several appends
const PART_BUDGET = 46_000;
const DATE = /20\d\d-\d\d-\d\d/g;
const POINTER_PREFIX = '**Older entries:**';

export const charCount = (s) => [...s].length;
const size = (lines) => lines.reduce((n, l) => n + charCount(l) + 1, 0);
const datesOf = (line) => line.match(DATE) || [];

// Entry boundaries: every top-level `## ` heading, plus one-line-per-entry
// records (`2026-11-03 ...` or `- 2026-11-03 ...`) that sit outside any `## `
// section. Inside a section a dated line is body text, not a new entry.
function entryStarts(lines) {
	const starts = [];
	let fence = null;
	let inSection = false;
	lines.forEach((line, i) => {
		const m = line.trimStart().match(/^(`{3,}|~{3,})/);
		if (m) {
			if (!fence) fence = m[1];
			else if (line.trim() === fence[0].repeat(line.trim().length) && line.trim().length >= fence.length) fence = null;
			return;
		}
		if (fence) return;
		if (line.startsWith('## ')) {
			inSection = true;
			starts.push(i);
		} else if (!inSection && /^(- )?(\*\*)?20\d\d-\d\d-\d\d/.test(line)) starts.push(i);
	});
	return starts;
}

// Pure: returns { live, archives: [{ index, text }] } or null when the log
// already fits. `firstIndex` is the next free archive number.
export function splitProgressLog(text, { baseName, firstIndex = 1, today }) {
	if (charCount(text) <= KEEP_BUDGET + 4_000) return null;
	const lines = text.replace(/\n+$/, '').split('\n');
	const starts = entryStarts(lines);
	const first = starts.find((s) => datesOf(lines[s]).length);
	if (first === undefined) throw new Error(`${baseName}: no dated entries to archive`);
	const bounds = starts.filter((s) => s >= first);
	let pre = lines.slice(0, first);
	const entries = bounds.map((s, k) => lines.slice(s, bounds[k + 1] ?? lines.length));

	// An earlier split left a pointer line in the preamble: drop it, it is rebuilt below
	// with every part listed.
	const oldPointer = pre.find((l) => l.startsWith(POINTER_PREFIX));
	pre = pre.filter((l) => !l.startsWith(POINTER_PREFIX));

	const undated = new Set(entries.map((e, i) => (datesOf(e[0]).length ? -1 : i)).filter((i) => i >= 0));
	const dated = entries
		.map((e, i) => ({ i, d: datesOf(e[0]).sort().at(-1) }))
		.filter((x) => x.d)
		.sort((a, b) => (a.d === b.d ? b.i - a.i : a.d < b.d ? 1 : -1));
	let budget = KEEP_BUDGET - size(pre) - 1_500;
	for (const i of undated) budget -= size(entries[i]);
	const keep = new Set(undated);
	for (const { i } of dated) {
		if (size(entries[i]) > budget) break;
		keep.add(i);
		budget -= size(entries[i]);
	}
	const old = entries.filter((_, i) => !keep.has(i));
	if (!old.length) return null;

	const parts = [];
	let cur = [];
	for (const e of old) {
		if (cur.length && size(cur.flat()) + size(e) > PART_BUDGET - 800) {
			parts.push(cur);
			cur = [];
		}
		cur.push(e);
	}
	parts.push(cur);

	const range = (es) => {
		const ds = es.flatMap((e) => datesOf(e[0])).sort();
		return ds.length ? `${ds[0]} to ${ds.at(-1)}` : 'undated';
	};
	const archives = parts.map((p, k) => {
		const index = firstIndex + k;
		const body = [
			`# ${baseName}, archive ${index} (${range(p)})`,
			'',
			`Older entries moved verbatim out of [${baseName}.md](${baseName}.md) on ${today} so every file stays under the ${PROMPT_CHAR_LIMIT.toLocaleString('en-US')}-character limit. Read-only record: append new entries to [${baseName}.md](${baseName}.md), never here.`,
			'',
		];
		for (const e of p) {
			body.push(...e);
			if (e.at(-1) !== '') body.push('');
		}
		return { index, range: range(p), text: `${body.join('\n').replace(/\n+$/, '')}\n` };
	});

	const links = archives.map((a) => `[${baseName}-archive-${a.index}.md](${baseName}-archive-${a.index}.md) (${a.range})`);
	const earlier = oldPointer ? oldPointer.match(/\[[^\]]+-archive-\d+\.md\]\([^)]+\) \([^)]*\)/g) || [] : [];
	const pointer = `${POINTER_PREFIX} ${[...earlier, ...links].join(', ')}. They were moved there verbatim to keep every file under the ${PROMPT_CHAR_LIMIT.toLocaleString('en-US')}-character limit; search them too when you need history.`;

	while (pre.length && pre.at(-1) === '') pre.pop();
	const tail = [];
	if (pre.at(-1)?.trim() === '---') {
		tail.push(pre.pop(), '');
		while (pre.length && pre.at(-1) === '') pre.pop();
	}
	const live = [...pre, '', pointer, '', ...tail, ...entries.filter((_, i) => keep.has(i)).flat()];
	return { live: `${live.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}\n`, archives };
}

function main(argv) {
	const check = argv.includes('--check');
	const files = argv.filter((a) => !a.startsWith('--'));
	if (!files.length) {
		console.error('usage: node scripts/split-progress-log.mjs [--check] <progress-log.md>...');
		process.exit(2);
	}
	const today = new Date().toISOString().slice(0, 10);
	let wouldSplit = 0;
	for (const file of files) {
		const dir = path.dirname(file);
		const baseName = path.basename(file, '.md');
		let firstIndex = 1;
		while (existsSync(path.join(dir, `${baseName}-archive-${firstIndex}.md`))) firstIndex += 1;
		const result = splitProgressLog(readFileSync(file, 'utf8'), { baseName, firstIndex, today });
		if (!result) {
			console.log(`[split-progress-log] ${file}: fits, nothing to move`);
			continue;
		}
		wouldSplit += 1;
		if (check) {
			console.error(`[split-progress-log] ${file}: over budget, run without --check to archive old entries`);
			continue;
		}
		for (const a of result.archives) {
			if (charCount(a.text) > PROMPT_CHAR_LIMIT) throw new Error(`${baseName}: a single entry exceeds the limit; shorten it by hand`);
			writeFileSync(path.join(dir, `${baseName}-archive-${a.index}.md`), a.text);
		}
		writeFileSync(file, result.live);
		console.log(
			`[split-progress-log] ${file}: now ${charCount(result.live)} chars; archived into ${result.archives
				.map((a) => `${baseName}-archive-${a.index}.md`)
				.join(', ')}`,
		);
	}
	if (check && wouldSplit) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
