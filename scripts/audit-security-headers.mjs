#!/usr/bin/env node
// Fails when any swept response is missing an HTTP security header or carries
// a weakened one, and checks /.well-known/security.txt against RFC 9116.
//
// The policy itself (what "weakened" means) lives in
// scripts/lib/security-header-policy.mjs. This script only fetches.
//
// Usage:
//   npm run audit:security-headers                          # dev server on :3000
//   npm run audit:security-headers -- --base http://localhost:3140
//   npm run audit:security-headers -- --base https://three.ws
//   npm run audit:security-headers -- --base https://three.ws --all   # every page in data/pages.json
//   npm run audit:security-headers -- --json                # machine-readable result
//   npm run audit:security-headers -- /trust /login         # only these paths
//
// The default sweep covers each kind of response the route table treats
// differently: plain pages, the auth/account pages with their stricter CSP,
// embeddable pages that allow framing from anywhere, JSON from the API, and
// static text from .well-known. `--base https://three.ws` is "production"
// (CSP hashes are required there); any other origin is held to the same rules
// except that one, because only the production server rewrites inline scripts.
//
// Exit codes: 0 clean, 1 a header or security.txt problem, 2 a page did not load.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateSecurityHeaders } from './lib/security-header-policy.mjs';
import { validateSecurityTxt } from './lib/security-txt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
	const i = args.indexOf(name);
	return i === -1 ? null : args[i + 1];
};
const base = (flag('--base') || 'http://localhost:3000').replace(/\/$/, '');
const asJson = args.includes('--json');
const production = /^https:\/\/(www\.)?three\.ws$/.test(base);

const DEFAULT_PATHS = [
	'/',
	'/trust',
	'/trust/subprocessors',
	'/legal/privacy',
	'/status',
	'/teams',
	'/login',
	'/settings',
	'/widget',
	'/viewer',
	'/api/healthz',
	'/.well-known/security.txt',
];

function allCataloguedPaths() {
	const catalogue = JSON.parse(readFileSync(path.join(ROOT, 'data', 'pages.json'), 'utf8'));
	const paths = [];
	for (const section of catalogue.sections || []) {
		for (const page of section.pages || []) {
			if (typeof page.path === 'string' && page.path.startsWith('/')) paths.push(page.path);
		}
	}
	return [...new Set(paths)];
}

const explicit = args.filter((a) => a.startsWith('/'));
const paths = explicit.length ? explicit : args.includes('--all') ? allCataloguedPaths() : DEFAULT_PATHS;

async function check(p) {
	const res = await fetch(base + p, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
	const headers = {};
	for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
	const body = await res.text();
	const isHtml = /text\/html/i.test(headers['content-type'] || '');
	if (res.status >= 400) return { path: p, status: res.status, loadError: `HTTP ${res.status}`, problems: [] };
	const problems = evaluateSecurityHeaders(headers, { path: new URL(res.url).pathname, isHtml, production });
	if (p === '/.well-known/security.txt') {
		for (const issue of validateSecurityTxt(body, { now: new Date(), origin: production ? base : null }))
			problems.push(`security.txt: ${issue}`);
	}
	return { path: p, status: res.status, problems };
}

async function main() {
	const results = [];
	const queue = [...paths];
	const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
		while (queue.length) {
			const p = queue.shift();
			try {
				results.push(await check(p));
			} catch (err) {
				results.push({ path: p, status: 0, loadError: err.message, problems: [] });
			}
		}
	});
	await Promise.all(workers);
	results.sort((a, b) => paths.indexOf(a.path) - paths.indexOf(b.path));

	const failing = results.filter((r) => r.problems.length);
	const unloaded = results.filter((r) => r.loadError);
	if (asJson) {
		console.log(JSON.stringify({ base, production, results }, null, 2));
	} else {
		console.log(`Security headers on ${base}${production ? ' (production rules)' : ''}: ${results.length} response(s)`);
		for (const r of results) {
			const mark = r.loadError ? 'LOAD' : r.problems.length ? 'FAIL' : 'ok  ';
			console.log(`  ${mark} ${r.path}${r.loadError ? `  (${r.loadError})` : ''}`);
			for (const problem of r.problems) console.log(`         - ${problem}`);
		}
		if (!failing.length && !unloaded.length) console.log('Every response meets the header policy.');
	}
	if (unloaded.length) process.exit(2);
	if (failing.length) process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
