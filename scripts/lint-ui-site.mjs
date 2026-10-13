#!/usr/bin/env node
// Runs lintapple over every static page in data/pages.json against a running dev server.
// Usage: node scripts/lint-ui-site.mjs [--base http://localhost:3000] [--concurrency 4] [--limit N] [--out dir]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : fallback;
};
const base = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const concurrency = Number(arg('concurrency', 4));
const limit = Number(arg('limit', 0));
const out = arg('out', 'ui-lint-report');
const timeoutMs = Number(arg('timeout', 240000));

const pages = JSON.parse(readFileSync('data/pages.json', 'utf8'));
let paths = [
	...new Set(
		pages.sections.flatMap((s) => (s.pages || []).map((p) => p.path)).filter((p) => p && p.startsWith('/') && !/[:*]/.test(p)),
	),
];
if (limit) paths = paths.slice(0, limit);
mkdirSync(join(out, 'pages'), { recursive: true });
const fileFor = (path) => join(out, 'pages', (path === '/' ? 'home' : path.slice(1).replace(/\//g, '__')) + '.json');

function run(path) {
	return new Promise((resolve) => {
		const child = spawn('npx', ['lintapple', base + path, '--ready', 'body', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
		child.stdout.on('data', (d) => (stdout += d));
		child.stderr.on('data', (d) => (stderr += d));
		child.on('close', (code) => {
			clearTimeout(timer);
			let findings = [];
			let error = null;
			if (code === 0 || code === 1) {
				try {
					findings = JSON.parse(stdout).findings;
				} catch (e) {
					error = `unparseable output: ${stdout.slice(0, 200)}`;
				}
			} else {
				const text = (stderr + stdout).trim();
				error = (text.match(/UI check could not finish: [^\n]*/) || [text.split('\n').slice(0, 2).join(' ')])[0].slice(0, 300) || `exit ${code}`;
			}
			resolve({ path, code, error, findings });
		});
	});
}

const results = [];
const todo = [];
for (const path of paths) {
	if (existsSync(fileFor(path))) {
		const r = JSON.parse(readFileSync(fileFor(path), 'utf8'));
		if (!r.error) {
			results.push(r);
			continue;
		}
	}
	todo.push(path);
}
console.log(`${results.length} cached, ${todo.length} to run`);
let next = 0;
async function worker() {
	while (next < todo.length) {
		const path = todo[next++];
		const r = await run(path);
		writeFileSync(fileFor(path), JSON.stringify(r));
		results.push(r);
		console.log(`${results.length}/${paths.length} ${path} ${r.error ? 'ERROR ' + r.error : r.findings.length + ' findings'}`);
	}
}
await Promise.all(Array.from({ length: concurrency }, worker));

const byRule = {};
for (const r of results) for (const f of r.findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
const summary = {
	base,
	pages: results.length,
	clean: results.filter((r) => !r.error && !r.findings.length).length,
	withFindings: results.filter((r) => r.findings.length).length,
	errored: results.filter((r) => r.error).length,
	byRule,
};
const pageRows = results
	.map((r) => ({ path: r.path, error: r.error, count: r.findings.length }))
	.sort((a, b) => b.count - a.count);
writeFileSync(join(out, 'summary.json'), JSON.stringify({ summary, pages: pageRows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
