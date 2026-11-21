#!/usr/bin/env node
// Pulls the official xAI developer docs (https://docs.x.ai) into a local,
// gitignored reference copy at docs/vendor/xai-docs/ so agents can read them
// offline while building Grok integrations.
//
// Why local-only: docs.x.ai publishes llms-full.txt for exactly this use and its
// robots.txt declares "Content-Signal: ai-train=no, search=yes, ai-input=yes".
// Reading the docs as input while building is allowed; training on them is not,
// and the text is xAI's copyright, so we never commit or redistribute it.
// This script is the committed artifact: anyone can re-pull with one command.
//
// Usage: node scripts/sync-xai-docs.mjs [--out <dir>]
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://docs.x.ai';
const UA = 'three.ws-docs-sync/1.0 (single fetch of the published llms-full.txt)';
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = path.resolve(outIdx >= 0 ? argv[outIdx + 1] : 'docs/vendor/xai-docs');

async function get(p) {
	const res = await fetch(BASE + p, { headers: { 'User-Agent': UA } });
	if (!res.ok) throw new Error(`GET ${BASE + p} failed: ${res.status}`);
	return res.text();
}

const robots = await get('/robots.txt');
if (/^\s*Disallow:\s*\/\s*$/im.test(robots)) throw new Error('robots.txt disallows the docs root; aborting');
if (/ai-input\s*=\s*no/i.test(robots)) throw new Error('Content-Signal ai-input=no; aborting');

const [index, full] = await Promise.all([get('/llms.txt'), get('/llms-full.txt')]);

const pages = [];
let cur = null;
for (const line of full.split('\n')) {
	const m = /^===(\/[A-Za-z0-9/_.-]*)===$/.exec(line);
	if (m) {
		cur = { route: m[1], lines: [] };
		pages.push(cur);
	} else if (cur) cur.lines.push(line);
}
if (pages.length < 50) throw new Error(`parsed only ${pages.length} pages; llms-full.txt format changed`);

await rm(OUT, { recursive: true, force: true });
for (const p of pages) {
	const file = path.join(OUT, p.route.replace(/^\//, '') + '.md');
	await mkdir(path.dirname(file), { recursive: true });
	const body = `<!-- source: ${BASE}${p.route} | (c) xAI, reference copy, do not redistribute or train on -->\n${p.lines.join('\n').trim()}\n`;
	await writeFile(file, body);
}
await writeFile(path.join(OUT, 'llms.txt'), index);
await writeFile(path.join(OUT, 'llms-full.txt'), full);
await writeFile(
	path.join(OUT, 'README.md'),
	`# xAI docs reference copy\n\nPulled ${new Date().toISOString()} from ${BASE}/llms-full.txt (${pages.length} pages).\n\nLocal only (gitignored). Copyright xAI. Allowed use per their robots.txt Content-Signal: ai-input=yes, search=yes, ai-train=no.\nRefresh: \`npm run sync:xai-docs\`. Start at \`llms.txt\` for the page index.\n`,
);
console.log(`wrote ${pages.length} pages to ${path.relative(process.cwd(), OUT)}`);
