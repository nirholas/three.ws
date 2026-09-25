// Hackathons open for applications on a second public hackathon platform.
//
// Its search endpoint returns every event whose applications are open, with
// the full description, prize list, themes and registration deadline. Prize
// money is stated inside prize descriptions ("a total cash prize pool of
// $1,000"), so the reward is the largest amount the organizer wrote down,
// never an estimate.

import { fetchUpstreamJson } from '../../upstream-fetch.js';
import { markdownToText, tagList } from '../normalize.js';

export const id = 'devfolio';
export const label = 'Hackathon platform';
export const venue = 'Devfolio';
export const venueUrl = 'https://devfolio.co/hackathons';

const PAGE_SIZE = 50;
const AMOUNT_RE = /([$₹])\s?([\d,]+(?:\.\d+)?)\s*([kKmM]|lakh|lakhs|L)?\b/g;

/** Largest stated prize amount in free text, preferring USD. Pure. */
export function largestPrize(texts) {
	const best = { USD: 0, INR: 0 };
	for (const t of texts) {
		for (const m of String(t || '').matchAll(AMOUNT_RE)) {
			let n = Number(m[2].replace(/,/g, ''));
			if (!Number.isFinite(n)) continue;
			const unit = (m[3] || '').toLowerCase();
			if (unit === 'k') n *= 1_000;
			else if (unit === 'm') n *= 1_000_000;
			else if (unit.startsWith('l')) n *= 100_000;
			const cur = m[1] === '$' ? 'USD' : 'INR';
			if (n > best[cur]) best[cur] = n;
		}
	}
	if (best.USD > 0) return { amount: best.USD, currency: 'USD' };
	if (best.INR > 0) return { amount: best.INR, currency: 'INR' };
	return { amount: null, currency: null };
}

/** Map one search hit to a listing. Pure. */
export function mapHackathon(s) {
	if (!s?.uuid || !s.name || !s.slug) return null;
	const prizes = Array.isArray(s.prizes) ? s.prizes : [];
	const { amount, currency } = largestPrize([...prizes.map((p) => `${p.name || ''} ${p.desc || ''}`), s.desc]);
	const themes = (s.themes || []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
	const where = s.is_online ? 'Online' : [s.city, s.country].filter(Boolean).join(', ') || s.location || null;
	const body = markdownToText(s.desc || '');
	const deadline = s.hackathon_setting?.reg_ends_at || s.ends_at || null;
	return {
		source: id,
		externalId: String(s.uuid),
		kind: 'hackathon',
		title: s.name,
		summary: [s.tagline, where].filter(Boolean).join(' · ') || null,
		body,
		url: `https://${s.slug}.devfolio.co/`,
		venue,
		venueUrl,
		sponsor: s.hosted_by?.name || null,
		sponsorLogo: typeof s.cover_img === 'string' && /^https:\/\//.test(s.cover_img) ? s.cover_img : null,
		rewardAmount: amount,
		rewardCurrency: currency,
		rewardUsd: currency === 'USD' ? amount : null,
		deadline,
		requirements: [
			'Apply to the hackathon before registration closes.',
			s.team_size ? `Teams of ${s.team_min || 1} to ${s.team_size}.` : null,
			s.is_online ? null : `Attend in person${where ? ` in ${where}` : ''}.`,
			'Submit the project on the hackathon page before judging.',
		].filter(Boolean),
		skills: tagList(themes),
		agentEligible: s.is_online ? null : false,
		submitMode: 'checklist',
		status: 'open',
		submissionsCount: Number.isFinite(s.projects_submitted) ? s.projects_submitted : null,
		raw: { starts_at: s.starts_at || null, ends_at: s.ends_at || null, participants: s.participants_count ?? null, online: !!s.is_online },
	};
}

export async function fetchListings() {
	const out = [];
	for (let from = 0; from < 200; from += PAGE_SIZE) {
		const data = await fetchUpstreamJson(
			'https://api.devfolio.co/api/search/hackathons',
			{
				method: 'POST',
				headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'three.ws-bounty-feed' },
				body: JSON.stringify({ type: 'application_open', from, size: PAGE_SIZE }),
			},
			{ name: 'bounties-devfolio', timeoutMs: 12_000, label: 'hackathon platform' },
		);
		const hits = Array.isArray(data?.hits?.hits) ? data.hits.hits : [];
		for (const h of hits) {
			const l = mapHackathon(h?._source);
			if (l) out.push(l);
		}
		const total = Number(data?.hits?.total?.value || 0);
		if (hits.length < PAGE_SIZE || from + PAGE_SIZE >= total) break;
	}
	return out;
}
