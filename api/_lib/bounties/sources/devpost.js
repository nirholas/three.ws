// Open hackathons from the largest public hackathon directory.
//
// Its hackathon index is served as JSON to its own listing page, sorted by
// prize pool, with the open state, dates, themes, organizer and total prize
// amount per event. Three pages covers every open event with a cash prize.

import { fetchUpstreamJson } from '../../upstream-fetch.js';
import { htmlToText, tagList } from '../normalize.js';

export const id = 'devpost';
export const label = 'Hackathon directory';
export const venue = 'Devpost';
export const venueUrl = 'https://devpost.com/hackathons';

const PAGES = 3;
const SYMBOLS = { $: 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', '¥': 'JPY' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "$<span>740,000</span>" -> { amount: 740000, currency: 'USD' }. Pure. */
export function parsePrize(html) {
	const text = htmlToText(html || '').replace(/\s+/g, '');
	const m = /^([$€£₹¥])([\d,]+(?:\.\d+)?)/.exec(text);
	if (!m) return { amount: null, currency: null };
	const amount = Number(m[2].replace(/,/g, ''));
	return Number.isFinite(amount) && amount > 0 ? { amount, currency: SYMBOLS[m[1]] } : { amount: null, currency: null };
}

/**
 * End of a submission window such as "Jul 31 - Oct 01, 2026" or
 * "Sep 01 - 30, 2026", as the last second of that UTC day. Pure.
 */
export function parseSubmissionEnd(dates) {
	const s = String(dates || '').trim();
	const year = /(\d{4})\s*$/.exec(s)?.[1];
	if (!year) return null;
	const [startPart, endPart = startPart] = s.replace(/,\s*\d{4}\s*$/, '').split(/\s+-\s+/);
	const startMonth = /^([A-Za-z]{3})/.exec(startPart.trim())?.[1];
	const endMatch = /^(?:([A-Za-z]{3})\s+)?(\d{1,2})$/.exec(endPart.trim());
	if (!endMatch) return null;
	const month = MONTHS.indexOf(String(endMatch[1] || startMonth || '').toLowerCase());
	if (month < 0) return null;
	const d = new Date(Date.UTC(Number(year), month, Number(endMatch[2]), 23, 59, 59));
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Map one hackathon record to a listing. Pure. */
export function mapHackathon(h) {
	if (!h?.id || !h.title || !h.url) return null;
	const url = String(h.url).startsWith('//') ? `https:${h.url}` : String(h.url);
	const { amount, currency } = parsePrize(h.prize_amount);
	const themes = (h.themes || []).map((t) => t?.name).filter(Boolean);
	const where = h.displayed_location?.location || null;
	const summaryParts = [
		h.organization_name ? `Hosted by ${h.organization_name}.` : null,
		where ? `${where}.` : null,
		themes.length ? `Themes: ${themes.join(', ')}.` : null,
		h.prizes_counts?.cash ? `${h.prizes_counts.cash} cash prizes.` : null,
		h.time_left_to_submission ? `${h.time_left_to_submission} to submit.` : null,
	].filter(Boolean);
	return {
		source: id,
		externalId: String(h.id),
		kind: 'hackathon',
		title: h.title,
		summary: summaryParts.join(' ') || null,
		body: summaryParts.join('\n'),
		url,
		venue,
		venueUrl,
		sponsor: h.organization_name || null,
		sponsorLogo: h.thumbnail_url ? (String(h.thumbnail_url).startsWith('//') ? `https:${h.thumbnail_url}` : h.thumbnail_url) : null,
		rewardAmount: amount,
		rewardCurrency: currency,
		rewardUsd: currency === 'USD' ? amount : null,
		deadline: parseSubmissionEnd(h.submission_period_dates),
		requirements: [
			'Register for the hackathon on its page.',
			'Build a project inside the submission window and submit it with a demo video and repository link.',
		],
		skills: tagList(themes),
		agentEligible: h.invite_only ? false : null,
		submitMode: 'checklist',
		status: h.open_state === 'open' && !h.invite_only ? 'open' : 'closed',
		submissionsCount: null,
		raw: { registrations: h.registrations_count ?? null, dates: h.submission_period_dates || null, gallery: h.submission_gallery_url || null },
	};
}

export async function fetchListings() {
	const out = [];
	for (let page = 1; page <= PAGES; page++) {
		const data = await fetchUpstreamJson(
			`https://devpost.com/api/hackathons?status[]=open&order_by=prize-amount&page=${page}`,
			{ headers: { accept: 'application/json', 'user-agent': 'three.ws-bounty-feed' } },
			{ name: 'bounties-devpost', timeoutMs: 12_000, label: 'hackathon directory' },
		);
		const items = Array.isArray(data?.hackathons) ? data.hackathons : [];
		for (const h of items) {
			const l = mapHackathon(h);
			if (l) out.push(l);
		}
		if (!items.length) break;
	}
	return out;
}
