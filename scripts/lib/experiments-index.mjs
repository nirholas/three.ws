// The public experiment log: validation and the published index.
//
// data/experiments.json lists every experiment three.ws has run in public; each
// one points at a write-up in docs/<doc>.md that follows the template in
// docs/experiments.md. scripts/build-page-index.mjs calls validateExperiments()
// on every `npm run build:pages` and fails the build on the first problem, then
// writes buildExperimentsJson() to public/experiments.json for the /experiments
// page. A bad entry therefore never reaches the site.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const EXPERIMENT_STATUSES = Object.freeze(['running', 'concluded', 'killed']);

// The six template sections, in the order every write-up must carry them.
export const WRITEUP_SECTIONS = Object.freeze([
	'The question',
	'Method',
	'Spend',
	'Result',
	'What we got wrong',
	'What we changed because of it',
]);

const REQUIRED = ['slug', 'title', 'question', 'published', 'spend_usd', 'status', 'doc'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The `## ` headings of a markdown document, in order. */
export function markdownHeadings(markdown) {
	return String(markdown)
		.split('\n')
		.filter((line) => /^## /.test(line))
		.map((line) => line.slice(3).trim());
}

/**
 * Throw on the first invalid entry. `readDoc(slug)` returns the write-up's
 * markdown, or null when it does not exist.
 *
 * @param {unknown} data parsed data/experiments.json
 * @param {{ readDoc: (doc: string) => string | null }} io
 * @returns {Array<object>} the validated entries
 */
export function validateExperiments(data, { readDoc }) {
	const entries = data && Array.isArray(data.experiments) ? data.experiments : null;
	if (!entries) throw new Error('data/experiments.json: expected an "experiments" array');
	const seen = new Set();
	entries.forEach((e, i) => {
		const ctx = `data/experiments.json entry ${i} (${e?.slug || 'no slug'})`;
		for (const field of REQUIRED) {
			if (e?.[field] === undefined || e[field] === null || e[field] === '') {
				throw new Error(`${ctx}: missing required field "${field}"`);
			}
		}
		if (!SLUG_RE.test(e.slug)) throw new Error(`${ctx}: slug must be lowercase kebab-case`);
		if (seen.has(e.slug)) throw new Error(`${ctx}: duplicate slug "${e.slug}"`);
		seen.add(e.slug);
		if (!DATE_RE.test(e.published) || Number.isNaN(Date.parse(`${e.published}T00:00:00Z`))) {
			throw new Error(`${ctx}: published must be a real YYYY-MM-DD date`);
		}
		if (typeof e.spend_usd !== 'number' || !Number.isFinite(e.spend_usd) || e.spend_usd < 0) {
			throw new Error(`${ctx}: spend_usd must be a number of dollars, 0 or more`);
		}
		if (!EXPERIMENT_STATUSES.includes(e.status)) {
			throw new Error(`${ctx}: status must be one of ${EXPERIMENT_STATUSES.join(', ')}`);
		}
		if (e.doc !== `experiments-${e.slug}`) {
			throw new Error(`${ctx}: doc must be "experiments-${e.slug}" (the write-up lives at docs/experiments-${e.slug}.md)`);
		}
		const markdown = readDoc(e.doc);
		if (markdown == null) throw new Error(`${ctx}: write-up docs/${e.doc}.md does not exist`);
		const headings = markdownHeadings(markdown);
		let from = 0;
		for (const section of WRITEUP_SECTIONS) {
			const at = headings.indexOf(section, from);
			if (at === -1) throw new Error(`${ctx}: docs/${e.doc}.md is missing the "## ${section}" section, or has it out of order`);
			from = at + 1;
		}
		if (e.live_url !== undefined && !(typeof e.live_url === 'string' && e.live_url.startsWith('/'))) {
			throw new Error(`${ctx}: live_url must be a site path starting with "/"`);
		}
		if (e.related !== undefined) {
			if (!Array.isArray(e.related)) throw new Error(`${ctx}: related must be an array of { label, href }`);
			for (const r of e.related) {
				if (!r?.label || typeof r.href !== 'string' || !r.href.startsWith('/')) {
					throw new Error(`${ctx}: every related link needs a label and a site path href`);
				}
			}
		}
	});
	return entries;
}

/** The public index the /experiments page reads, newest first. */
export function buildExperimentsJson(entries) {
	const experiments = [...entries]
		.sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : a.title.localeCompare(b.title)))
		.map((e) => ({
			slug: e.slug,
			title: e.title,
			question: e.question,
			headline: e.headline || null,
			published: e.published,
			spend_usd: e.spend_usd,
			status: e.status,
			doc: e.doc,
			url: `/docs/${e.doc}`,
			live_url: e.live_url || null,
			related: e.related || [],
		}));
	return `${JSON.stringify({ generated: true, count: experiments.length, experiments }, null, '\t')}\n`;
}

/** Read, validate and render in one call, for scripts/build-page-index.mjs. */
export function loadExperiments(root) {
	const data = JSON.parse(readFileSync(resolve(root, 'data/experiments.json'), 'utf8'));
	const entries = validateExperiments(data, {
		readDoc: (doc) => {
			const file = resolve(root, 'docs', `${doc}.md`);
			return existsSync(file) ? readFileSync(file, 'utf8') : null;
		},
	});
	return { entries, json: buildExperimentsJson(entries) };
}
