#!/usr/bin/env node
// One-shot: read data/archives/<account>_tweets_*.json and seed
// data/rss/items.json with one curated entry per substantive original tweet.
// Preserves the original tweet text verbatim (cleaned of scraper artifacts).
// Usage: node scripts/seed-rss-from-archive.mjs [--account=trythreews] [--min=140]

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const ARCHIVES_DIR = path.join(ROOT, 'data', 'archives');
const ITEMS_FILE = path.join(ROOT, 'data', 'rss', 'items.json');

const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const m = a.match(/^--([^=]+)=(.*)$/);
		return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
	}),
);
const ACCOUNT = args.account || 'trythreews';
const MIN_LEN = Number(args.min ?? 140);

function cleanText(s) {
	return String(s)
		.replace(/\r\n/g, '\n')
		.replace(/^\s*https?:\/\/\s*\n?/u, '')
		.replace(/\bhttps?:\/\/\s*\n\s*/g, '')
		.replace(/\n[ \t]*https?:\/\/[ \t]*\n/g, '\n')
		.replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function linkify(html) {
	const urls = [];
	let buf = html.replace(/\bhttps?:\/\/[^\s<]+/g, (url) => {
		const trimmed = url.replace(/[.,!?)]+$/, '');
		const tail = url.slice(trimmed.length);
		urls.push({ trimmed, tail });
		return ` URL${urls.length - 1} `;
	});
	buf = buf.replace(/(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{1,15})/g, (_m, pre, h) =>
		`${pre}<a href="https://x.com/${h}" rel="noopener">@${h}</a>`,
	);
	return buf.replace(/ URL(\d+) /g, (_m, i) => {
		const { trimmed, tail } = urls[Number(i)];
		return `<a href="${trimmed}" rel="noopener">${trimmed}</a>${tail}`;
	});
}

function deriveTitle(text) {
	const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) || text;
	const firstSentence = firstLine.split(/(?<=[.!?])\s+/)[0] || firstLine;
	const candidate = firstSentence.length > 90 ? firstLine : firstSentence;
	if (candidate.length <= 90) return candidate;
	const cut = candidate.slice(0, 87);
	const lastSpace = cut.lastIndexOf(' ');
	return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '…';
}

function deriveSummary(text) {
	const oneLine = text.replace(/\s+/g, ' ').trim();
	return oneLine.length > 280 ? oneLine.slice(0, 277) + '…' : oneLine;
}

function renderBodyHtml(text) {
	const paragraphs = text
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean)
		.map((p) => '<p>' + linkify(escapeHtml(p)).replace(/\n/g, '<br>') + '</p>');
	return paragraphs.join('\n');
}

const files = (await readdir(ARCHIVES_DIR)).filter(
	(f) => f.startsWith(`${ACCOUNT}_tweets_`) && f.endsWith('.json'),
);
if (files.length === 0) {
	console.error(`No archive files found for account="${ACCOUNT}" in ${ARCHIVES_DIR}`);
	process.exit(1);
}
files.sort();
const newest = files[files.length - 1];
console.log(`Using archive: ${newest}`);

const archive = JSON.parse(await readFile(path.join(ARCHIVES_DIR, newest), 'utf8'));
const author = `@${archive.profile}`;

const entries = [];
const seen = new Set();
for (const t of archive.tweets || []) {
	if (t?.type?.isRetweet || t?.type?.isReply) continue;
	const text = cleanText(t.text || '');
	if (text.length < MIN_LEN) continue;
	if (seen.has(t.id)) continue;
	seen.add(t.id);
	entries.push({
		id: `t-${t.id}`,
		title: deriveTitle(text),
		date: t.timestamp,
		link: t.url,
		author,
		summary: deriveSummary(text),
		body_html: renderBodyHtml(text),
		tags: [],
	});
}
entries.sort((a, b) => new Date(b.date) - new Date(a.date));

const out = {
	_readme:
		'Curated RSS items for https://three.ws/rss/announcements.xml. ' +
		'Edit this file to control exactly what HackerNoon (and any RSS reader) sees. ' +
		'Each entry needs: id (stable slug), title, date (ISO 8601), body_html. ' +
		'Optional: link, author, summary, tags. ' +
		'Items are served newest-first by date; cap is 50. ' +
		`Seeded from data/archives/${newest} on ${new Date().toISOString().slice(0, 10)} ` +
		`(${entries.length} entries). Re-run scripts/seed-rss-from-archive.mjs to refresh from a newer scrape.`,
	items: entries,
};

await writeFile(ITEMS_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`Wrote ${entries.length} entries to ${ITEMS_FILE}`);
