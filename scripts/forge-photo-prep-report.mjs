#!/usr/bin/env node
/**
 * Print the measurement tables for docs/forge-photo-prep.md from the bench
 * output (scripts/forge-photo-prep-bench.mjs), so the published numbers are the
 * recorded ones and a rerun refreshes them with one paste.
 *
 * Usage: node scripts/forge-photo-prep-report.mjs [--out=docs/forge-photo-prep/bench]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outArg = process.argv.find((a) => a.startsWith('--out='));
const outDir = resolve(outArg ? outArg.slice(6) : 'docs/forge-photo-prep/bench');
const results = JSON.parse(readFileSync(join(outDir, 'results.json'), 'utf8'));
const names = Object.keys(results.photos).sort();
const KEYS = ['original', 'prepared', 'cutout'];

const kb = (n) => (n == null ? 'n/a' : `${Math.round(n / 1000).toLocaleString('en-US')} KB`);
const sec = (ms) => (ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
const pct = (a, b) => (a == null || b == null ? '' : ` (${Math.round((a / b - 1) * 100) > 0 ? '+' : ''}${Math.round((a / b - 1) * 100)}%)`);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};

const lines = [];
lines.push('| Photo | Warnings | Prep on device | Upload: original | prepared | cutout | End to end: original | prepared | cutout | GPU: original | prepared | cutout |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const name of names) {
	const p = results.photos[name];
	const v = p.variants || {};
	const o = v.original || {};
	const cells = [
		name,
		p.prep.warnings.length ? p.prep.warnings.join(', ') : 'none',
		sec(p.prep.timings?.totalMs),
		kb(o.bytes),
		kb(v.prepared?.bytes) + pct(v.prepared?.bytes, o.bytes),
		kb(v.cutout?.bytes) + pct(v.cutout?.bytes, o.bytes),
		...KEYS.map((k) => (v[k]?.task && v[k].task.status !== 'done' ? v[k].task.status : sec(v[k]?.endToEndMs))),
		...KEYS.map((k) => sec(v[k]?.task?.gpu_ms)),
	];
	lines.push(`| ${cells.join(' | ')} |`);
}

lines.push('');
lines.push('| Variant | Total upload | Median upload | Median end to end | Median GPU | Jobs done |');
lines.push('|---|---|---|---|---|---|');
for (const k of KEYS) {
	const vs = names.map((n) => results.photos[n].variants?.[k]).filter(Boolean);
	const done = vs.filter((v) => v.task?.status === 'done');
	lines.push(
		`| ${k} | ${kb(sum(vs.map((v) => v.bytes)))} | ${kb(median(vs.map((v) => v.bytes)))} | ${sec(median(done.map((v) => v.endToEndMs)))} | ${sec(median(done.map((v) => v.task.gpu_ms).filter((x) => x != null)))} | ${done.length} of ${vs.length} |`,
	);
}

lines.push('');
lines.push('| Photo | Original | Prepared | Cutout |');
lines.push('|---|---|---|---|');
for (const name of names) {
	const v = results.photos[name].variants || {};
	const img = (k) => (v[k]?.render ? `![${name} ${k}](forge-photo-prep/bench/${name}/${v[k].render})` : (v[k]?.task?.status ?? 'not run'));
	lines.push(`| ${name} | ${KEYS.map(img).join(' | ')} |`);
}

console.log(lines.join('\n'));
