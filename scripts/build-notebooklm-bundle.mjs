#!/usr/bin/env node
// Builds a single Markdown source for Google NotebookLM (one file, under its
// 500,000-word per-source limit) plus a zip of it in the repo root.
//
//   node scripts/build-notebooklm-bundle.mjs
//
// Order: NotebookLM prompt, partnership material, README, newest changelog,
// then every remaining tracked .md file (smallest first, each capped) until the
// word budget is spent. Generated and vendored files are skipped.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_MD = 'three-ws-notebooklm.md';
const OUT_ZIP = 'three-ws-notebooklm.zip';
const WORD_BUDGET = 485_000; // NotebookLM limit is 500,000 words per source.
const PER_FILE_CAP = 6_000; // Words per file in the breadth tier.
const CHANGELOG_WORDS = 45_000; // Newest entries only; the full file is ~490k words.

const words = (s) => (s.match(/\S+/g) || []).length;
const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 28 }).toString();
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);

const SKIP = [
	/^third_party\//, /(^|\/)node_modules\//, /^docs\/ALL\.md$/, /^CHANGELOG\.md$/,
	/^STRUCTURE\.md$/, /^README\.md$/, /^CLAUDE\.md$/, /^AGENTS\.md$/, /^prompts\//,
	/^docs\/prompts\//, /^_context\//, /^\.claude\//, /^\.agents\//, /^data\/skills\//,
	/\/SUBMITTING\.md$/, /^scripts\/notebooklm-prompt\.md$/, /^three-ws-notebooklm/, /CODE_OF_CONDUCT/, /LICENSE/i,
];
const isMd = (p) => p.endsWith('.md') && !SKIP.some((r) => r.test(p));

const PARTNER = [
	/^docs\/partners\.md$/, /^docs\/partners\//, /^docs\/partner-/, /^docs\/announcements\//,
	/^docs\/(ibm|microsoft|nvidia|openai|aws|alibaba|quicknode|hackernoon|dextools)/i,
	/^docs\/(listings|press-kit|syndication|integrations|x-partner-series|mcp-studio|mcp-3d-studio|spatial-mcp|chatgpt)/,
	/^docs\/ops\/gcp-(credits-plan|production|model-workers)\.md$/,
	/^docs\/(aws-|ibm-|nvidia-|chatgpt-)/,
	/^marketing\/(openai-select-partner|ibm-partner-plus|nvidia-inception|quicknode|dextools|pumpfun-verified|partner-packets|open-source-ecosystem|x402-milestone|x402-three|three-utility-season|the-first-19-weeks|README|OPERATING-PLAN)/,
	/^marketing\/growth\/kits\//, /^data\/x-content\/articles\/partner-/, /^deploy\/x-partners\//,
];
const BLOG = /^blog\/three-ws-.*(partner|alibaba|google-cloud|hackernoon|microsoft|quicknode|aws|openai|ibm).*\.html$/;

function htmlToText(html) {
	const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
	const body = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || [html])[0];
	const text = body
		.replace(/<(script|style|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, '')
		.replace(/<\/(p|div|h[1-6]|li|tr|section)>/gi, '\n')
		.replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n' + '#'.repeat(+n) + ' ')
		.replace(/<li[^>]*>/gi, '- ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&mdash;|&ndash;/g, '-')
		.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
	return `# ${title.replace(/\s+/g, ' ').trim()}\n\n${text}`;
}

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
function cap(text, limit) {
	const w = text.match(/\S+\s*/g) || [];
	if (w.length <= limit) return text;
	return w.slice(0, limit).join('') + '\n\n[Truncated for length. Full text in the repository.]\n';
}

const seen = new Set();
const sections = [];
let total = 0;
function add(path, text, label) {
	if (seen.has(path)) return;
	const n = words(text);
	if (total + n > WORD_BUDGET) return;
	seen.add(path);
	total += n;
	sections.push({ path, label, text, n });
}

const prompt = read('scripts/notebooklm-prompt.md').trim();
total += words(prompt);

// Tier 1: partnerships.
for (const p of tracked.filter(isMd).filter((p) => PARTNER.some((r) => r.test(p))).sort()) {
	add(p, cap(read(p), 12_000), 'Partnerships');
}
for (const p of tracked.filter((p) => BLOG.test(p)).sort()) add(p, htmlToText(read(p)), 'Partnership announcements');

// Tier 2: overview and newest changelog.
add('README.md', cap(read('README.md'), 20_000), 'Overview');
const cl = read('CHANGELOG.md');
const clBody = cl.slice(cl.indexOf('\n## '));
add('CHANGELOG.md', '# Changelog (newest first)\n' + cap(clBody, CHANGELOG_WORDS), 'What is new');

// Tier 3: everything else, smallest first, so the most distinct documents fit.
const rest = tracked.filter(isMd).filter((p) => !seen.has(p)).map((p) => {
	const t = cap(read(p), PER_FILE_CAP);
	return { p, t, n: words(t) };
}).filter((x) => x.n > 40).sort((a, b) => a.n - b.n);
for (const x of rest) add(x.p, x.t, 'Documentation');

const date = new Date().toISOString().slice(0, 10);
const clean = (s) => s.replace(/\s?[\u2014\u2013]\s?/g, ' - ');
const outFiles = [];
const write = (name, s) => { writeFileSync(resolve(ROOT, name), s); outFiles.push(name); return words(s); };

// Part 1: prompt + priority material.
const toc = sections.map((s) => `- ${s.path} (${s.label})`).join('\n');
const n1 = write(OUT_MD, clean([
	prompt,
	`\n\n---\n\n# Source index (part 1)\n\nGenerated ${date}. ${sections.length} documents, about ${total.toLocaleString('en-US')} words. Each document starts with a "## FILE:" heading naming its path in the repository. Further parts hold the rest of the repository's Markdown in full.\n\n${toc}\n`,
	...sections.map((s) => `\n\n---\n\n## FILE: ${s.path}\n\n${s.text.trim()}\n`),
].join('')));

// Overflow parts: every remaining tracked .md file in full (tails of truncated files), vendored last.
const consumed = new Map(sections.map((s) => [s.path, s.text.endsWith('in the repository.]\n') ? s.n : -1]));
const chunks = [];
const order = (p) => (p.startsWith('third_party/') ? 3 : /^(docs|marketing|specs)\//.test(p) ? 0 : /^(packages|agents|public|hubs|api|src)\//.test(p) ? 1 : 2);
const pool = tracked.filter((p) => p.endsWith('.md') && !/^docs\/ALL\.md$|(^|\/)node_modules\//.test(p) && !p.startsWith('three-ws-notebooklm'))
	.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
for (const p of pool) {
	const raw = read(p);
	let toks = raw.match(/\S+\s*/g) || [];
	const done = seen.has(p) ? consumed.get(p) : 0;
	if (done === -1 || (seen.has(p) && p !== 'README.md' && p !== 'CHANGELOG.md' && done !== 0 && !consumed.has(p))) continue;
	if (seen.has(p) && done <= 0) continue;
	let label = p;
	if (done > 0) { toks = toks.slice(done); label = `${p} (continued)`; }
	if (p === 'CHANGELOG.md' && seen.has(p)) { toks = (raw.slice(raw.indexOf('\n## ')).match(/\S+\s*/g) || []).slice(CHANGELOG_WORDS); label = `${p} (older entries)`; }
	if (toks.length < 30) continue;
	for (let i = 0; i < toks.length; i += 60_000) {
		chunks.push({ label: i ? `${label} (part ${i / 60_000 + 1})` : label, text: toks.slice(i, i + 60_000).join(''), n: Math.min(60_000, toks.length - i) });
	}
}
const PART_BUDGET = 480_000;
let part = 2, cur = [], curN = 0;
const flush = () => {
	if (!cur.length) return;
	const name = `three-ws-notebooklm-part-${String(part++).padStart(2, '0')}.md`;
	write(name, clean(`# three.ws combined documentation, ${name.replace('.md', '')}\n\nGenerated ${date}. Continuation of the main file. Each document starts with a "## FILE:" heading naming its path in the repository.\n\n` + cur.map((c) => `\n\n---\n\n## FILE: ${c.label}\n\n${c.text.trim()}\n`).join('')));
	cur = []; curN = 0;
};
for (const c of chunks) { if (curN + c.n > PART_BUDGET) flush(); cur.push(c); curN += c.n; }
flush();

if (existsSync(resolve(ROOT, OUT_ZIP))) rmSync(resolve(ROOT, OUT_ZIP));
execFileSync('zip', ['-9', '-q', OUT_ZIP, ...outFiles], { cwd: ROOT });
console.log(`${outFiles.length} files, main file ${n1.toLocaleString('en-US')} words, ${chunks.length} overflow chunks`);
console.log(`${OUT_ZIP} written to repo root`);
