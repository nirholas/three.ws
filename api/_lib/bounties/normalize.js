// Pure helpers shared by every bounty source adapter. No I/O, so the adapters'
// mapping logic unit-tests without the network.
//
// Every adapter maps its upstream record into one normalized listing:
//   { source, externalId, kind, title, summary, body, url, venue, venueUrl,
//     sponsor, sponsorLogo, rewardAmount, rewardMax, rewardCurrency, rewardUsd,
//     deadline, requirements[], skills[], agentEligible, submitMode, status,
//     submissionsCount, programRoundId, raw }
// and the store computes `contentHash` over the fields that should trigger a
// fresh LLM triage when they change.

import { createHash } from 'node:crypto';
import { parse as parseHtml } from 'node-html-parser';

export const KINDS = Object.freeze(['bounty', 'project', 'hackathon', 'grant', 'task']);

// Stablecoins the feed prices at par. Anything else keeps a null USD value
// unless the source itself priced it; the feed never guesses a price.
const USD_PEGGED = new Set(['USD', 'USDC', 'USDG', 'USDT', 'PYUSD', 'USDS']);

const BODY_CAP = 12_000;
const SUMMARY_CAP = 400;
const TITLE_CAP = 240;

/** Collapse whitespace and cap length on a word boundary. */
export function clip(text, max) {
	const s = String(text ?? '').replace(/\s+/g, ' ').trim();
	if (s.length <= max) return s;
	const cut = s.slice(0, max);
	const sp = cut.lastIndexOf(' ');
	return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}...`;
}

/** Visible text of an HTML fragment, block elements separated by newlines. */
export function htmlToText(html) {
	if (!html) return '';
	const root = parseHtml(String(html), { blockTextElements: { script: false, style: false } });
	for (const el of root.querySelectorAll('br')) el.replaceWith('\n');
	for (const el of root.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,div,tr')) el.insertAdjacentHTML('afterend', '\n');
	for (const el of root.querySelectorAll('li')) el.insertAdjacentHTML('afterbegin', '- ');
	return root.textContent
		.replace(/ /g, ' ')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n\s*\n\s*\n+/g, '\n\n')
		.trim();
}

/** Markdown to plain-ish text: strips fences, images, emphasis and link syntax. */
export function markdownToText(md) {
	return String(md ?? '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[*_~`>#]+/g, '')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n\s*\n\s*\n+/g, '\n\n')
		.trim();
}

export function capBody(text) {
	const s = String(text ?? '').trim();
	return s.length > BODY_CAP ? `${s.slice(0, BODY_CAP)}...` : s;
}

export function capSummary(text) {
	return clip(text, SUMMARY_CAP);
}

export function capTitle(text) {
	return clip(text, TITLE_CAP);
}

/** USD value of an amount in `currency`, only when it is pegged. */
export function peggedUsd(amount, currency) {
	const n = Number(amount);
	if (!Number.isFinite(n) || n <= 0) return null;
	return USD_PEGGED.has(String(currency || '').toUpperCase()) ? Math.round(n * 100) / 100 : null;
}

/**
 * Parse a dollar label such as "$50", "$1.2k", "$780", "$2,500" into USD.
 * Returns null for anything else.
 */
export function parseUsdLabel(label) {
	const m = /^\s*\$\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?\s*$/.exec(String(label ?? ''));
	if (!m) return null;
	let n = Number(m[1].replace(/,/g, ''));
	if (!Number.isFinite(n)) return null;
	if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000;
	return n > 0 ? n : null;
}

/** ISO string for a date-ish value, or null. */
export function isoOrNull(v) {
	if (!v) return null;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Deduplicated, trimmed, lowercased tags, capped. */
export function tagList(values, max = 16) {
	const out = [];
	const seen = new Set();
	for (const v of values || []) {
		const t = String(v ?? '').trim().toLowerCase().slice(0, 48);
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
		if (out.length >= max) break;
	}
	return out;
}

/** Hash of the fields whose change should re-run the LLM triage. */
export function contentHash(l) {
	return createHash('sha256')
		.update(JSON.stringify([l.title, l.body || l.summary || '', l.requirements || [], l.skills || [], l.rewardAmount, l.rewardCurrency, l.deadline]))
		.digest('hex')
		.slice(0, 40);
}

/** Validate an adapter's output. Returns the listing, or null when it is unusable. */
export function finalizeListing(l) {
	if (!l || !l.source || !l.externalId || !l.title || !l.url) return null;
	if (!/^https:\/\//.test(l.url)) return null;
	const deadline = isoOrNull(l.deadline);
	const status = l.status === 'closed' || (deadline && new Date(deadline) < new Date()) ? 'closed' : 'open';
	return {
		source: String(l.source),
		externalId: String(l.externalId).slice(0, 200),
		kind: KINDS.includes(l.kind) ? l.kind : 'bounty',
		title: capTitle(l.title),
		summary: l.summary ? capSummary(l.summary) : null,
		body: l.body ? capBody(l.body) : null,
		url: l.url,
		venue: String(l.venue || l.source),
		venueUrl: l.venueUrl || null,
		sponsor: l.sponsor ? clip(l.sponsor, 120) : null,
		sponsorLogo: l.sponsorLogo && /^https?:\/\//.test(l.sponsorLogo) ? l.sponsorLogo : null,
		rewardAmount: Number.isFinite(Number(l.rewardAmount)) && Number(l.rewardAmount) > 0 ? Number(l.rewardAmount) : null,
		rewardMax: Number.isFinite(Number(l.rewardMax)) && Number(l.rewardMax) > 0 ? Number(l.rewardMax) : null,
		rewardCurrency: l.rewardCurrency ? String(l.rewardCurrency).slice(0, 24) : null,
		rewardUsd: Number.isFinite(Number(l.rewardUsd)) && Number(l.rewardUsd) > 0 ? Math.round(Number(l.rewardUsd) * 100) / 100 : null,
		deadline,
		requirements: (l.requirements || []).map((r) => clip(r, 400)).filter(Boolean).slice(0, 24),
		skills: tagList(l.skills),
		agentEligible: typeof l.agentEligible === 'boolean' ? l.agentEligible : null,
		submitMode: l.submitMode === 'api' ? 'api' : 'checklist',
		status,
		submissionsCount: Number.isFinite(Number(l.submissionsCount)) ? Math.max(0, Math.floor(Number(l.submissionsCount))) : null,
		programRoundId: l.programRoundId || null,
		raw: l.raw && typeof l.raw === 'object' ? l.raw : {},
	};
}
