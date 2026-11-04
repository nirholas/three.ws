#!/usr/bin/env node
/**
 * check-kit-links: report dead links in a marketing kit or partner packet.
 *
 *   node scripts/check-kit-links.mjs <file.md> [<file.md> ...] [--site https://three.ws] [--json]
 *
 * Partner kits are sent by hand, often weeks after they were written, and a
 * dead link in a partner email costs more than the fix. Run this on the send
 * day. Every http(s) link is fetched with a plain GET (redirects followed);
 * relative links must resolve to a file in the repo; root-relative links
 * ("/docs/solana") are fetched against --site.
 *
 * Exit 0 when every link is alive, 1 when any link is dead, 2 on bad usage.
 * Transient answers (429, 5xx, network errors, timeouts) are retried with
 * backoff before a link is reported dead.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SITE = 'https://three.ws';
const USER_AGENT = 'Mozilla/5.0 (compatible; three.ws-kit-link-check/1.0; +https://three.ws)';
const TIMEOUT_MS = 20_000;
const RETRIES = 2;
const CONCURRENCY = 6;

// Characters that end a sentence or close surrounding markup but are never the
// last character of a real URL in these documents.
const TRAILING = new Set([...').,;:!?\'"`*_>]']);

/**
 * Drop sentence punctuation and closing markup from the end of a URL, one
 * character at a time. A closing paren is kept when it balances an opening one
 * inside the URL (wiki-style paths such as `/wiki/Foo_(bar)`).
 */
function trimTrailing(url) {
	let out = url;
	while (out && TRAILING.has(out.at(-1))) {
		if (out.at(-1) === ')') {
			const opens = out.split('(').length - 1;
			const closes = out.split(')').length - 1;
			if (opens >= closes) break;
		}
		out = out.slice(0, -1);
	}
	return out;
}

/**
 * Pull every link out of a markdown document, in first-seen order, deduped.
 *
 * Covers inline links and images `[text](target "title")`, autolinks
 * `<https://...>`, and bare http(s) URLs anywhere in the text, including inside
 * fenced and inline code, because kits keep their ready-to-post copy in fences
 * and those links ship. Anchors (`#x`), `mailto:` and `tel:` are skipped.
 * Template placeholders (`${...}`, `<...>`, `[...]` inside a URL) and elided
 * URLs containing `...` are skipped: they are not addresses anyone can open.
 *
 * @param {string} markdown
 * @returns {{ url: string, kind: 'http' | 'site' | 'file', line: number }[]}
 */
export function extractLinks(markdown) {
	const found = new Map();
	const lines = String(markdown).split('\n');

	const add = (raw, lineNo) => {
		let url = String(raw).trim();
		if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1);
		url = trimTrailing(url);
		if (!url || url.startsWith('#')) return;
		if (/^(mailto|tel|sms|javascript|data):/i.test(url)) return;
		if (/\$\{|\.\.\.|[<>[\]{}]/.test(url)) return;
		const kind = /^https?:\/\//i.test(url) ? 'http' : url.startsWith('/') ? 'site' : 'file';
		if (kind === 'file' && /^[a-z][a-z0-9+.-]*:/i.test(url)) return; // other schemes (wss:, ipfs:)
		if (!found.has(url)) found.set(url, { url, kind, line: lineNo });
	};

	lines.forEach((text, i) => {
		const lineNo = i + 1;
		// Inline links and images: [text](target) or [text](target "title").
		for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+(?:\([^\s)]*\)[^\s)]*)*)(?:\s+"[^"]*")?\s*\)/g)) {
			add(m[1], lineNo);
		}
		// Autolinks and bare URLs.
		for (const m of text.matchAll(/<(https?:\/\/[^>\s]+)>|https?:\/\/[^\s<>"'`|]+/gi)) {
			add(m[1] || m[0], lineNo);
		}
	});
	return [...found.values()];
}

/** Strip `#fragment` and `?query` from a repo-relative link before resolving it. */
function filePart(url) {
	return decodeURIComponent(url.split('#')[0].split('?')[0]);
}

async function fetchStatus(url) {
	let last = { ok: false, status: 0, detail: 'not attempted' };
	for (let attempt = 0; attempt <= RETRIES; attempt++) {
		if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
		try {
			const res = await fetch(url, {
				method: 'GET',
				redirect: 'follow',
				signal: ctrl.signal,
				headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
			});
			// Release the socket; only the status matters.
			res.body?.cancel().catch(() => {});
			last = { ok: res.status < 400, status: res.status, detail: res.statusText || '' };
			if (last.ok || (res.status !== 429 && res.status < 500)) return last;
		} catch (err) {
			const cause = err?.cause?.code || err?.cause?.message || err?.name || 'error';
			last = { ok: false, status: 0, detail: err?.name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : String(cause) };
		} finally {
			clearTimeout(timer);
		}
	}
	return last;
}

/**
 * Check every link in one markdown file.
 * @returns {Promise<{ file: string, results: { url, kind, line, ok, status, detail }[] }>}
 */
export async function checkFile(path, { site = DEFAULT_SITE } = {}) {
	const abs = resolve(path);
	const links = extractLinks(readFileSync(abs, 'utf8'));
	const results = new Array(links.length);
	let next = 0;
	const worker = async () => {
		while (next < links.length) {
			const i = next++;
			const link = links[i];
			if (link.kind === 'file') {
				const target = resolve(dirname(abs), filePart(link.url));
				const ok = existsSync(target);
				results[i] = { ...link, ok, status: ok ? 'file' : 'missing', detail: ok ? '' : `no file at ${target}` };
			} else {
				const url = link.kind === 'site' ? new URL(link.url, site).href : link.url;
				results[i] = { ...link, ...(await fetchStatus(url)) };
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, links.length) }, worker));
	return { file: path, results };
}

function parseArgs(argv) {
	const files = [];
	let site = DEFAULT_SITE;
	let json = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--json') json = true;
		else if (a === '--site') site = argv[++i];
		else if (a.startsWith('--site=')) site = a.slice('--site='.length);
		else if (a === '-h' || a === '--help') return { help: true };
		else files.push(a);
	}
	return { files, site, json };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.files?.length) {
		console.error('usage: node scripts/check-kit-links.mjs <file.md> [<file.md> ...] [--site https://three.ws] [--json]');
		process.exit(args.help ? 0 : 2);
	}
	for (const f of args.files) {
		if (!existsSync(f)) {
			console.error(`check-kit-links: no such file: ${f}`);
			process.exit(2);
		}
	}
	let dead = 0;
	const reports = [];
	for (const f of args.files) {
		const report = await checkFile(f, { site: args.site });
		reports.push(report);
		const bad = report.results.filter((r) => !r.ok);
		dead += bad.length;
		if (!args.json) {
			console.log(`${f}: ${report.results.length} links, ${bad.length} dead`);
			for (const r of report.results) {
				const mark = r.ok ? 'ok  ' : 'DEAD';
				console.log(`  ${mark} ${String(r.status).padEnd(7)} L${r.line} ${r.url}${r.ok || !r.detail ? '' : `  (${r.detail})`}`);
			}
		}
	}
	if (args.json) console.log(JSON.stringify(reports, null, 2));
	process.exit(dead ? 1 : 0);
}
