#!/usr/bin/env node
/**
 * Live link check for the Awesome 3D Agents list (data/awesome.json).
 *
 * An awesome list is only worth publishing if every link resolves, so this
 * fetches each url and reports what came back. It is deliberately NOT wired
 * into the deploy path: it talks to a hundred and something third-party hosts,
 * and a flaky CDN must never turn someone else's deploy red. Run it whenever
 * you edit the list.
 *
 *   node scripts/check-awesome-links.mjs
 *   node scripts/check-awesome-links.mjs --concurrency 16 --timeout 20000
 *   node scripts/check-awesome-links.mjs --strict-blocked
 *
 * Three outcomes, because they need three different reactions:
 *   ok       the url answered. Nothing to do.
 *   moved    it answered somewhere else. Point the entry at its new home.
 *   blocked  403 or 429 from a bot filter. Several of these hosts refuse any
 *            request from a datacenter address, so this is a "check by hand",
 *            not a dead link. Escalate it with --strict-blocked.
 *   broken   no answer, or 4xx/5xx that is not a bot filter. Fix or remove.
 *
 * Exits 1 on any broken url, and on duplicate urls, which are the other way an
 * awesome list rots.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = argv.indexOf(name);
	return i === -1 ? fallback : argv[i + 1];
};

const concurrency = Number(flag('--concurrency', '12'));
const timeoutMs = Number(flag('--timeout', '25000'));
const strictBlocked = argv.includes('--strict-blocked');

const list = JSON.parse(readFileSync(path.join(root, 'data/awesome.json'), 'utf8'));

const targets = [];
for (const section of list.sections) {
	for (const item of section.items) targets.push({ section: section.id, name: item.name, url: item.url });
}

// A duplicate entry is a curation bug the network can never surface, so it is
// checked here rather than in a second script nobody remembers to run.
const seen = new Map();
const duplicates = [];
for (const t of targets) {
	const key = t.url.replace(/\/+$/, '').toLowerCase();
	if (seen.has(key)) duplicates.push(`${t.section}/${t.name} repeats ${seen.get(key)} (${t.url})`);
	else seen.set(key, `${t.section}/${t.name}`);
}

// A browser user agent: several of these hosts answer 403 to anything that
// looks like a script, which would report a healthy page as broken.
const UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function probe(url) {
	const options = {
		redirect: 'follow',
		headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*' },
		signal: AbortSignal.timeout(timeoutMs),
	};
	// HEAD first because it is cheap. A host that refuses HEAD, or that only
	// applies its bot filter to HEAD, gets a real GET before we call it broken.
	let head = null;
	try {
		head = await fetch(url, { ...options, method: 'HEAD' });
		if (head.ok) return { status: head.status, finalUrl: head.url };
	} catch {
		head = null;
	}
	const res = await fetch(url, { ...options, method: 'GET' });
	return { status: res.status, finalUrl: res.url };
}

const results = [];
let cursor = 0;

async function worker() {
	while (cursor < targets.length) {
		const target = targets[cursor++];
		try {
			const { status, finalUrl } = await probe(target.url);
			results.push({ ...target, status, finalUrl });
		} catch (error) {
			results.push({ ...target, status: 0, error: error.message });
		}
	}
}

await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

// Compare without the fragment: an anchor into a single-page docs site is
// resolved in the browser, so the server answering the bare page is correct.
const normalise = (u) =>
	u
		.replace(/#.*$/, '')
		.replace(/\/+$/, '')
		.replace(/^https?:\/\/www\./, 'https://');

const blockedCodes = new Set([403, 429]);
const broken = results.filter((r) => r.status === 0 || (r.status >= 400 && !blockedCodes.has(r.status)));
const blocked = results.filter((r) => blockedCodes.has(r.status));
const moved = results.filter(
	(r) => r.status >= 200 && r.status < 400 && r.finalUrl && normalise(r.finalUrl) !== normalise(r.url),
);

for (const r of moved) console.log(`[moved]   ${r.name}\n          ${r.url}\n       -> ${r.finalUrl}`);
for (const r of blocked) console.log(`[blocked] ${r.section}/${r.name} ${r.url} HTTP ${r.status} (bot filter, verify by hand)`);
for (const r of broken) console.error(`[broken]  ${r.section}/${r.name} ${r.url} ${r.error ?? `HTTP ${r.status}`}`);
for (const d of duplicates) console.error(`[dupe]    ${d}`);

const ok = results.length - broken.length - blocked.length;
console.log(
	`\n[awesome-links] ${ok}/${results.length} reachable, ${moved.length} redirecting, ${blocked.length} bot-filtered, ${broken.length} broken`,
);

if (broken.length || duplicates.length || (strictBlocked && blocked.length)) process.exit(1);
