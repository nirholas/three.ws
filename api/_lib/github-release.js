// Shared GitHub Release logic for nirholas/three.ws.
//
// One implementation, two callers: scripts/github-release.mjs (owner-run
// preview and backfill) and api/cron/github-release.js (the weekly release).
// Both build notes from changelog entries, pass them through the same public
// filter the X lane uses (data/changelog-x-filter.json via loadXFilter and
// xFilterReason), and drop any entry naming a $TICKER other than $THREE.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadXFilter, xFilterReason } from './changelog-push.js';

export const REPO = 'nirholas/three.ws';
export const SITE = 'https://three.ws';
export const MAX_BODY_CHARS = 120_000;
const SECTIONS = [
	['feature', 'New'],
	['improvement', 'Improved'],
	['sdk', 'SDKs and packages'],
];
// Releases whose tags sort in the platform line (v1.5.2, v2026.11.03). Product
// releases such as forge-v0.5.0 or desktop builds are not weekly windows.
const PLATFORM_TAG = /^v\d/;

/** Accepts the bare array or the { entries } wrapper data/changelog.json uses. */
export function entriesOf(feed) {
	return Array.isArray(feed) ? feed : feed?.entries || [];
}

export function loadBundledEntries() {
	return entriesOf(JSON.parse(readFileSync(join(process.cwd(), 'data', 'changelog.json'), 'utf8')));
}

function firstSentence(text) {
	const m = String(text || '').match(/^.*?[.!?](\s|$)/);
	return (m ? m[0] : String(text || '')).trim();
}

function entryLine(e) {
	const link = e.link ? ` [Open](${e.link.startsWith('http') ? e.link : SITE + e.link})` : '';
	return `- **${e.title}.** ${firstSentence(e.summary)}${link}`;
}

/**
 * Project names to leave out of a release, from an env var (GITHUB_RELEASE_EXCLUDE_TERMS).
 * Comma or newline separated. Kept in the runtime environment, not the repo, because
 * committing a name would itself put that commit under the other-coin gate.
 * @param {string | undefined} value
 * @returns {string[]}
 */
export function excludeTermsFromEnv(value) {
	return String(value || '')
		.split(/[,\n]/)
		.map((t) => t.trim())
		.filter(Boolean);
}

/** Matcher for entries naming another project: any $TICKER but $THREE, plus optional names. */
export function otherProjectMatcher(terms = []) {
	const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const byName = terms.length ? new RegExp(`\\b(${terms.map(escape).join('|')})\\b`, 'i') : null;
	const ticker = /\$(?!THREE\b)[A-Z][A-Z0-9]{1,9}\b/;
	return (e) => {
		const text = `${e.title}\n${e.summary}`;
		return ticker.test(text) || (byName ? byName.test(text) : false);
	};
}

/**
 * Release notes for entries dated from..to inclusive (YYYY-MM-DD).
 * @returns {{ body: string, kept: number, total: number, name: string }}
 */
export function buildReleaseNotes(entries, { from, to, title, terms = [], filter = loadXFilter() }) {
	const namesOtherProject = otherProjectMatcher(terms);
	const inWindow = entries.filter((e) => e.date >= from && e.date <= to);
	const kept = inWindow.filter((e) => !xFilterReason(e, filter) && !namesOtherProject(e));
	const seen = new Set();
	const parts = [
		`Everything three.ws shipped from ${from} to ${to}, taken from the public changelog. ${kept.length} user-facing changes.`,
		'',
		`Try it at [three.ws](${SITE}), read the [docs](${SITE}/docs), follow the [full changelog](${SITE}/changelog) ([RSS](${SITE}/changelog.xml)), or connect your assistant to the 3D Studio MCP server at [three.ws/connect](${SITE}/connect).`,
	];
	for (const [tag, heading] of SECTIONS) {
		const rows = kept.filter((e) => (e.tags || []).includes(tag) && !seen.has(e)).sort((a, b) => b.date.localeCompare(a.date));
		if (!rows.length) continue;
		rows.forEach((e) => seen.add(e));
		parts.push('', `## ${heading}`, '', ...rows.map(entryLine));
	}
	parts.push('', '---', '', `Apache-2.0. Issues and discussions are open: [contribute](https://github.com/${REPO}/blob/main/CONTRIBUTING.md).`);
	return { body: parts.join('\n'), kept: kept.length, total: inWindow.length, name: `three.ws ${title}` };
}

/**
 * Notes counted only by how many entries survive the filter. The weekly cron
 * publishes only when this is above zero, and a release made only of entries
 * under no section heading would be empty, so sectioned entries are what count.
 */
export function sectionedCount(entries, opts) {
	const filter = opts.filter || loadXFilter();
	const namesOtherProject = otherProjectMatcher(opts.terms || []);
	const tags = SECTIONS.map(([t]) => t);
	return entries.filter(
		(e) => e.date >= opts.from && e.date <= opts.to && !xFilterReason(e, filter) && !namesOtherProject(e) && (e.tags || []).some((t) => tags.includes(t)),
	).length;
}

export const utcDate = (d) => d.toISOString().slice(0, 10);

export function addDays(date, n) {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return utcDate(d);
}

/** Weekly tag and title for a run at `now` (UTC). */
export function weeklyIdentity(now) {
	const day = utcDate(now);
	return { day, tag: `v${day.replace(/-/g, '.')}`, title: `Week of ${day}` };
}

/**
 * The commit production runs: the build stamp (dist/build-info.json, written
 * by scripts/write-build-info.mjs at image build), else a COMMIT_SHA env var,
 * else null so the caller targets main.
 */
export function deployedSha({ cwd = process.cwd(), env = process.env } = {}) {
	const valid = (s) => (typeof s === 'string' && /^[0-9a-f]{40}$/i.test(s) ? s.toLowerCase() : null);
	try {
		const info = JSON.parse(readFileSync(join(cwd, 'dist', 'build-info.json'), 'utf8'));
		const sha = valid(info.commit);
		if (sha) return sha;
	} catch {
		/* no stamp in this runtime */
	}
	return valid(env.COMMIT_SHA) || valid(env.GIT_SHA) || null;
}

function makeClient(token, fetchImpl) {
	return async (path, init = {}) => {
		const res = await fetchImpl(`https://api.github.com${path}`, {
			...init,
			signal: AbortSignal.timeout(20_000),
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'Content-Type': 'application/json',
			},
		});
		const data = await res.json().catch(() => ({}));
		return { status: res.status, ok: res.ok, data };
	};
}

/** Newest published platform release (v* tag), or null when there is none. */
export async function latestPlatformRelease(gh) {
	const r = await gh(`/repos/${REPO}/releases?per_page=100`);
	if (!r.ok) throw new Error(`GitHub list releases -> ${r.status}: ${r.data?.message || ''}`);
	const published = (Array.isArray(r.data) ? r.data : []).filter((x) => !x.draft && !x.prerelease && PLATFORM_TAG.test(x.tag_name) && x.published_at);
	published.sort((a, b) => b.published_at.localeCompare(a.published_at));
	return published[0] || null;
}

/**
 * One weekly run. Never throws for expected conditions; returns a status:
 *   { ok: true, skipped: 'missing_token' | 'tag_exists' | 'no_entries' | 'tag_race' }
 *   { ok: true, created: true, tag, url, ... }
 * Real GitHub failures throw so wrapCron records a failed heartbeat.
 */
export async function runWeeklyRelease({ token, now = new Date(), entries, filter, terms = [], sha, fetchImpl = fetch } = {}) {
	if (!token) return { ok: true, skipped: 'missing_token', detail: 'GITHUB_RELEASE_TOKEN is not set' };
	const { day, tag, title } = weeklyIdentity(now);
	const gh = makeClient(token, fetchImpl);

	const existing = await gh(`/repos/${REPO}/releases/tags/${tag}`);
	if (existing.ok) return { ok: true, skipped: 'tag_exists', tag };
	if (existing.status !== 404) throw new Error(`GitHub get release ${tag} -> ${existing.status}: ${existing.data?.message || ''}`);

	const last = await latestPlatformRelease(gh);
	const from = last ? addDays(last.published_at.slice(0, 10), 1) : addDays(day, -7);
	const opts = { from, to: day, title, terms, filter };
	if (sectionedCount(entries, opts) === 0) {
		return { ok: true, skipped: 'no_entries', from, to: day, since: last?.tag_name || null };
	}
	const notes = buildReleaseNotes(entries, opts);
	if (notes.body.length > MAX_BODY_CHARS) throw new Error(`release body is ${notes.body.length} chars, over GitHub's limit`);

	const created = await gh(`/repos/${REPO}/releases`, {
		method: 'POST',
		body: JSON.stringify({ tag_name: tag, target_commitish: sha || 'main', name: notes.name, body: notes.body, make_latest: 'true' }),
	});
	if (created.status === 422 && JSON.stringify(created.data).includes('already_exists')) return { ok: true, skipped: 'tag_race', tag };
	if (!created.ok) throw new Error(`GitHub create release ${tag} -> ${created.status}: ${created.data?.message || ''}`);
	return { ok: true, created: true, tag, url: created.data.html_url, target: sha || 'main', from, to: day, kept: notes.kept, since: last?.tag_name || null };
}
