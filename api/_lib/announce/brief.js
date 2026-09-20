// The evidence brief: everything true about one surface, gathered before a word
// of copy is written.
//
// A post is only publishable here if every number and absolute in it sits in a
// claim backed by evidence that a machine can re-check (api/_lib/x-content/verify.js).
// Writing the copy first and hunting for evidence afterwards is what makes that
// expensive, so this module inverts it: collect the checkable facts first, then
// let the drafter write only from them.
//
// Five sources, in descending order of how much a reader can trust them:
//
//   live page      the rendered text of the route itself, harvested through the
//                  same Playwright reader the verifier uses. A sentence taken
//                  from here is evidence that passes by construction, because
//                  the check is "the live page contains this text".
//   changelog      data/changelog.json already holds plain-language summaries
//                  of user-visible changes, written for the community. When a
//                  surface has entries, they are the best raw material we own.
//   docs           docs/<slug>.md and anything under docs/ that names the route.
//   package        README and package.json for a package, worker, or service.
//   archive        the closest posts @trythreews already published, so the
//                  drafter is told what not to repeat rather than discovering
//                  it at the similarity gate.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { copySimilarity } from '../x-content/quality.js';
import { loadHistory } from '../x-content/queue.js';

const SITE = 'https://three.ws';
// The house style bans both dash glyphs everywhere, including quoted evidence,
// and a pack that embeds one fails `npm run check:announce`. A candidate that
// carries one is dropped rather than rewritten, because the verifier matches
// the string against the live page character for character.
const DASHED = new RegExp('[\\u2014\\u2013]');
const ENDPOINT_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[A-Za-z0-9/:_.\-{}]+)/g;

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

// Prose paragraphs of a Markdown file, with the scaffolding (headings, tables,
// code, badges) removed. Those carry the mechanism; a table cell does not.
function paragraphs(markdown, limit = 4) {
	const blocks = markdown
		.replace(/```[\s\S]*?```/g, '')
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter((block) => block && !block.startsWith('#') && !block.startsWith('|') && !block.startsWith('<') && !/^[-*]\s/.test(block))
		.map((block) => block.replace(/\s+/g, ' '));
	return blocks.slice(0, limit);
}

function headings(markdown, limit = 12) {
	return [...markdown.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => match[1].trim()).slice(0, limit);
}

function endpointsIn(text) {
	return [...new Set([...text.matchAll(ENDPOINT_RE)].map((match) => `${match[1]} ${match[2]}`))].slice(0, 8);
}

// Docs that describe this surface: the file named after it, and any doc that
// names the route in its body.
function docsFor(root, slug, url) {
	const dir = join(root, 'docs');
	const found = [];
	const direct = join(dir, `${slug}.md`);
	if (existsSync(direct)) found.push({ path: `docs/${slug}.md`, body: read(direct) });
	const folder = join(dir, slug);
	if (existsSync(folder) && statSync(folder).isDirectory()) {
		for (const name of readdirSync(folder).filter((file) => file.endsWith('.md')).slice(0, 3)) {
			found.push({ path: `docs/${slug}/${name}`, body: read(join(folder, name)) });
		}
	}
	if (!found.length && url) {
		const needle = `](${url})`;
		for (const name of readdirSync(dir).filter((file) => file.endsWith('.md'))) {
			const body = read(join(dir, name));
			if (body.includes(needle)) {
				found.push({ path: `docs/${name}`, body });
				if (found.length >= 2) break;
			}
		}
	}
	return found.map((entry) => ({
		path: entry.path,
		headings: headings(entry.body),
		paragraphs: paragraphs(entry.body),
		endpoints: endpointsIn(entry.body),
		quotable: quotableLines(entry.body),
	}));
}

// Lines a `file` evidence check can quote. The verifier matches the raw bytes
// of the file, so a paragraph that was joined across newlines would never be
// found: only whole lines, exactly as they sit on disk, can be cited.
export function quotableLines(body, limit = 8) {
	const skip = /^(?:#|\||`{3}|<|!\[|\[!)/;
	const out = [];
	for (const raw of String(body || '').split('\n')) {
		// Blockquote and list markers are stripped, never the text after them:
		// what is left is still a contiguous substring of the file, which is
		// what the `file` evidence check matches against.
		const line = raw.trim().replace(/^(?:>\s?|[-*+]\s|\d+\.\s)+/, '').trim();
		if (!line || skip.test(line)) continue;
		for (const sentence of line.split(/(?<=[.!?])\s+/).map((part) => part.trim())) {
			if (sentence.length < 60 || sentence.length > 200) continue;
			if (!/[.!?]$/.test(sentence) || DASHED.test(sentence)) continue;
			// A line that wraps mid-sentence leaves a tail that reads as a
			// fragment. Evidence is quoted in the pack a human approves from, so
			// only a sentence that starts like one is worth offering.
			if (!/^[A-Z0-9`[$]/.test(sentence)) continue;
			if (/^https?:/.test(sentence)) continue;
			if (!out.includes(sentence)) out.push(sentence);
			if (out.length >= limit) return out;
		}
	}
	return out;
}

// Changelog entries about this surface: linked to it, or naming its title.
export function changelogFor(root, { url, title }) {
	const path = join(root, 'data/changelog.json');
	if (!existsSync(path)) return [];
	const { entries = [] } = JSON.parse(readFileSync(path, 'utf8'));
	const name = String(title || '').toLowerCase();
	return entries
		.filter((entry) => (url && entry.link === url) || (name.length > 5 && `${entry.title} ${entry.summary}`.toLowerCase().includes(name)))
		.sort((left, right) => right.date.localeCompare(left.date))
		.slice(0, 6)
		.map((entry) => ({ date: entry.date, title: entry.title, summary: entry.summary, tags: entry.tags }));
}

// Lines of the rendered page that could carry a claim: long enough to say
// something, short enough to quote, and not navigation furniture.
export function harvestFacts(pageText, limit = 24) {
	const junk = /^(?:home|docs|sign in|sign up|menu|skip to|cookie|©|all rights)/i;
	const lines = String(pageText || '')
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter((line) => line.length >= 30 && line.length <= 220)
		.filter((line) => !junk.test(line))
		.filter((line) => /[a-z]/.test(line))
		.filter((line) => !DASHED.test(line))
		// A whole sentence, not a card label or a truncated gallery caption. The
		// verifier matches the string against the live page, so a fragment that
		// the page clips with an ellipsis would fail the check it was picked for.
		.filter((line) => /^[A-Z0-9$]/.test(line) && /[.!?]$/.test(line));
	const seen = new Set();
	const unique = lines.filter((line) => !seen.has(line.toLowerCase()) && seen.add(line.toLowerCase()));
	// A line with a number or a mechanism verb beats a line of marketing.
	const weight = (line) => (/\d/.test(line) ? 2 : 0) + (/\b(?:runs?|returns?|signs?|uploads?|renders?|retargets?|settles?|pays?|streams?|verif|generat|captur)/i.test(line) ? 1 : 0);
	return unique.sort((left, right) => weight(right) - weight(left)).slice(0, limit);
}

// The counters a page leads with, which harvestFacts cannot offer. It takes
// whole sentences only, because a clipped card caption fails the very check it
// was picked for, and that rule also throws away the single strongest fact on
// any page built around numbers: /awesome renders "ENTRIES 152" as a tile and
// "152 entries across 15 sections" as a summary line, and neither ends in a
// full stop. The `number` pattern exists to lead on exactly those, so they are
// harvested separately here. Both forms survive as literal substrings of the
// rendered page once whitespace is collapsed, which is what verify.js matches.
const STAT_LABEL = /^[A-Za-z][A-Za-z0-9 .&'/]{1,26}$/;
const STAT_VALUE = /^\$?\d[\d,.]*\s?(?:%|k|m|b|x|\+)?$/i;
const COUNTED_LINE = /^\$?\d[\d,.]*\s+[a-z][A-Za-z0-9 %+,./']{6,96}$/;
const STAT_JUNK = /^(?:home|docs|menu|search|sign in|sign up|console|chat|walk|build|discover|show everything|skip to|cookie|page|step|version|v\d)/i;

export function harvestStats(pageText, limit = 8) {
	const lines = String(pageText || '')
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim());
	const out = [];
	const add = (candidate) => {
		if (!DASHED.test(candidate) && !out.includes(candidate)) out.push(candidate);
	};
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (!line || STAT_JUNK.test(line)) continue;
		// "152 entries across 15 sections": a countable statement the page
		// writes as a line of its own rather than as a sentence.
		if (COUNTED_LINE.test(line) && !/[.!?]$/.test(line)) add(line);
		// A tile: its label, then its value on the next line.
		const value = lines[index + 1];
		if (value && STAT_LABEL.test(line) && STAT_VALUE.test(value)) add(`${line} ${value}`);
	}
	return out.slice(0, limit);
}

export function closestPriorPosts(root, text, limit = 3) {
	return loadHistory(root)
		.map((prior) => ({ text: prior.replace(/\s+/g, ' ').trim(), similarity: copySimilarity(text, prior) }))
		.sort((left, right) => right.similarity - left.similarity)
		.slice(0, limit);
}

export async function buildBrief(slot, { root, ledgerEntry = {}, pages = null, site = SITE }) {
	const url = slot.url ? `${site}${slot.url}` : null;
	const docs = docsFor(root, slot.id, slot.url);
	const dir = ledgerEntry.dir ? join(root, ledgerEntry.dir) : null;
	const readme = dir && existsSync(join(dir, 'README.md')) ? read(join(dir, 'README.md')) : '';

	let liveFacts = [];
	let liveStats = [];
	let liveStatus = null;
	if (url && pages) {
		const { status, text, raw, main } = await pages.text(url);
		liveStatus = status;
		// The surface's own text when the reader could isolate it, so a fact
		// never comes out of the header menu or the footer of every other page.
		const body = main || raw || text;
		liveFacts = harvestFacts(body);
		liveStats = harvestStats(body);
	}

	const readmePath = ledgerEntry.dir ? `${ledgerEntry.dir}/README.md` : null;
	const fileFacts = [
		...docs.map((doc) => ({ path: doc.path, lines: doc.quotable })),
		...(readme && readmePath ? [{ path: readmePath, lines: quotableLines(readme) }] : []),
	].filter((row) => row.lines.length);

	// Counters first: a post that can cite the page's own number is the one the
	// engagement report measured as the strongest shape we publish.
	const evidence = [
		...liveStats.map((fact) => ({ type: 'page', url, contains: fact })),
		...liveFacts.slice(0, 12).map((fact) => ({ type: 'page', url, contains: fact })),
		...fileFacts.flatMap((row) => row.lines.map((line) => ({ type: 'file', path: row.path, contains: line }))),
	].filter((row) => row.contains && !DASHED.test(row.contains));

	return {
		id: slot.id,
		key: slot.key,
		url,
		route: slot.url,
		lane: slot.lane,
		pattern: slot.pattern,
		tier: slot.tier,
		notBefore: slot.notBefore,
		surface: {
			kind: slot.kind,
			section: slot.section,
			title: ledgerEntry.title || slot.id,
			description: ledgerEntry.description || '',
			shipped: ledgerEntry.added || null,
			score: slot.score,
			signals: ledgerEntry.signals || {},
		},
		partner: slot.partner ? { handle: slot.partner, why: null } : null,
		docs,
		readme: readme ? { path: readmePath, paragraphs: paragraphs(readme), endpoints: endpointsIn(readme) } : null,
		changelog: changelogFor(root, { url: slot.url, title: ledgerEntry.title }),
		endpoints: [...new Set([...docs.flatMap((doc) => doc.endpoints), ...(readme ? endpointsIn(readme) : [])])].slice(0, 8),
		live: { status: liveStatus, stats: liveStats, facts: liveFacts },
		fileFacts,
		evidenceCandidates: evidence,
		avoid: closestPriorPosts(root, `${ledgerEntry.title || ''} ${ledgerEntry.description || ''}`),
		media: {
			shot: slot.shot,
			route: slot.url,
			motion: slot.motion,
			gate: slot.mediaGate,
		},
	};
}

export function briefPath(id) {
	return `data/announce-plan/briefs/${id}.json`;
}

export function loadBrief(root, id) {
	const path = resolve(root, briefPath(id));
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}
