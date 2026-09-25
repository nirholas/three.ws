// Open-source code bounties posted as GitHub issues.
//
// Paid bounty platforms for open source (the largest routes payment through a
// GitHub app) mark a funded issue with a "💎 Bounty" label plus one "$N" label
// per pledge, and flip a "💰 Rewarded" label on once it is paid. The public
// issue search exposes all of it, so this adapter reads the label convention
// directly: no scraping, no account. An optional GITHUB_TOKEN raises the
// search quota from 10 to 30 requests a minute; the hourly refresh needs two.

import { fetchUpstreamJson } from '../../upstream-fetch.js';
import { markdownToText, parseUsdLabel, tagList } from '../normalize.js';

export const id = 'github';
export const label = 'GitHub code bounties';
export const venue = 'GitHub';
export const venueUrl = 'https://github.com';

const BOUNTY_LABEL = '💎 Bounty';
const REWARDED_LABEL = '💰 Rewarded';
const PAGES = 2;
const PER_PAGE = 50;

// Labels that describe the work rather than the money or triage state.
const NOISE_LABELS = new Set(['bounty', 'help wanted', 'good first issue', 'enhancement', 'bug', 'feature', 'documentation']);

function authHeaders() {
	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
	const h = { accept: 'application/vnd.github+json', 'user-agent': 'three.ws-bounty-feed' };
	if (token) h.authorization = `Bearer ${token}`;
	return h;
}

/** owner/repo from an issue's repository_url. */
function repoOf(issue) {
	const m = /repos\/([^/]+\/[^/]+)$/.exec(String(issue.repository_url || ''));
	return m ? m[1] : null;
}

/**
 * Map one search hit to a listing. Pure.
 * @param {any} issue
 */
export function mapIssue(issue) {
	const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
	if (!labels.includes(BOUNTY_LABEL)) return null;
	const pledges = labels.map(parseUsdLabel).filter((n) => n != null);
	const reward = pledges.length ? Math.max(...pledges) : null;
	const rewarded = labels.includes(REWARDED_LABEL);
	const repo = repoOf(issue);
	const body = markdownToText(issue.body || '');
	const skills = tagList(
		labels.filter((l) => l !== BOUNTY_LABEL && l !== REWARDED_LABEL && parseUsdLabel(l) == null && !NOISE_LABELS.has(l.toLowerCase())),
	);
	return {
		source: id,
		externalId: String(issue.id),
		kind: 'bounty',
		title: issue.title,
		summary: body ? body.slice(0, 400) : null,
		body,
		url: issue.html_url,
		venue,
		venueUrl: repo ? `https://github.com/${repo}` : venueUrl,
		sponsor: repo,
		sponsorLogo: issue.user?.avatar_url || null,
		rewardAmount: reward,
		rewardCurrency: reward != null ? 'USD' : null,
		rewardUsd: reward,
		deadline: null,
		requirements: ['Open a pull request that resolves the issue and reference it in the PR description.'],
		skills,
		agentEligible: true,
		submitMode: 'checklist',
		status: rewarded || issue.state === 'closed' ? 'closed' : 'open',
		submissionsCount: Number.isFinite(issue.comments) ? issue.comments : null,
		raw: { repo, number: issue.number, labels, created_at: issue.created_at, updated_at: issue.updated_at },
	};
}

export async function fetchListings() {
	const q = encodeURIComponent(`label:"${BOUNTY_LABEL}" -label:"${REWARDED_LABEL}" state:open is:issue`);
	const out = [];
	for (let page = 1; page <= PAGES; page++) {
		const url = `https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=${PER_PAGE}&page=${page}`;
		const data = await fetchUpstreamJson(url, { headers: authHeaders() }, { name: 'bounties-github', timeoutMs: 12_000, label: 'github bounty search' });
		const items = Array.isArray(data?.items) ? data.items : [];
		for (const it of items) {
			const l = mapIssue(it);
			if (l) out.push(l);
		}
		if (items.length < PER_PAGE) break;
	}
	return out;
}

/**
 * Live payout state of one issue: the venue marks a paid bounty "💰 Rewarded".
 * @param {{ repo: string, number: number }} ref
 */
export async function payoutStatus(ref) {
	const issue = await fetchUpstreamJson(`https://api.github.com/repos/${ref.repo}/issues/${ref.number}`, { headers: authHeaders() }, {
		name: 'bounties-github',
		label: 'github issue',
	});
	const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l?.name));
	return {
		paid: labels.includes(REWARDED_LABEL),
		state: issue.state,
		closed_at: issue.closed_at || null,
		pledges_usd: labels.map(parseUsdLabel).filter((n) => n != null),
		url: issue.html_url,
	};
}
