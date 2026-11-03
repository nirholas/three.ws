// Every element id in a shipped HTML page must be unique. getElementById and
// label[for] silently take the FIRST match, so a duplicate is never an error
// in the console: the second widget just stops responding. Merges of parallel
// branches produced exactly that (2026-10): /grok rendered its "Made on
// three.ws" and "What Grok gets" sections twice, /connect carried two cloud
// connector blocks, and the homepage API playground bound its tabs to the
// embed playground's strip because both were id="pg-tabs".
//
// Only static markup counts. Ids inside <script>, <template>, <pre>, <code>,
// <textarea> and comments are alternatives a script renders one at a time, or
// code samples, so they are stripped before counting.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;

const SKIP = [
	/(^|\/)node_modules\//,
	/^third_party\//,
	/(^|\/)vendor\//,
	/(^|\/)dist\//,
	/\/docs\/api\//,
	/^character-studio\//,
	/^chat\//,
	/^public\/chat\//,
];

function trackedHtml() {
	return execFileSync('git', ['ls-files', '*.html'], { cwd: ROOT, encoding: 'utf8' })
		.split('\n')
		.filter(Boolean)
		.filter((p) => !SKIP.some((re) => re.test(p)));
}

export function duplicateIds(html) {
	const stripped = html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(script|template|pre|code|textarea|style)\b[\s\S]*?<\/\1>/gi, '');
	const seen = new Map();
	for (const m of stripped.matchAll(/<[a-z][\w-]*\b[^>]*?\sid\s*=\s*(["'])([^"'$]*?)\1/gi)) {
		const id = m[2];
		if (!id || id.includes('{')) continue;
		seen.set(id, (seen.get(id) || 0) + 1);
	}
	return [...seen].filter(([, n]) => n > 1).map(([id]) => id).sort();
}

describe('duplicateIds', () => {
	it('flags a repeated static id and ignores script, template and code alternatives', () => {
		const html = `
			<div id="a"></div><section id="a"></section>
			<p id="b"></p>
			<template><p id="b"></p></template>
			<script>el.innerHTML = '<p id="b"></p>';</script>
			<pre><code>&lt;iframe id="b"&gt;</code></pre>
			<!-- <p id="b"></p> -->`;
		expect(duplicateIds(html)).toEqual(['a']);
	});
});

describe('shipped HTML pages', () => {
	const files = trackedHtml();

	it('finds the pages to check', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it('use every element id once', () => {
		const offenders = [];
		for (const file of files) {
			const dups = duplicateIds(readFileSync(`${ROOT}${file}`, 'utf8'));
			if (dups.length) offenders.push(`${file}: ${dups.join(', ')}`);
		}
		expect(offenders).toEqual([]);
	});
});
