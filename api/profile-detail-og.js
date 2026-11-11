/**
 * Crawler page for a public profile (/u/:username)
 * -------------------------------------------------
 * GET /api/profile-detail-og?username=<username>
 *
 * Wired via vercel.json: when a crawler User-Agent hits /u/<username>, a "has"
 * condition rewrites to this endpoint, the same way /agents/:id and
 * /avatars/:id reach their crawler pages. The browser page (pages/profile.html)
 * fetches the profile client-side, so before this every one of the profiles in
 * sitemap/profiles.xml was indexed as the same generic shell: no canonical, one
 * shared title and one shared description.
 *
 * Content parity with the interactive page: the name, bio, location, website,
 * and the public agents and avatars the profile lists. ProfilePage JSON-LD with
 * the person as its mainEntity. See the header of api/_lib/crawler-page.js.
 */

import { sql } from './_lib/db.js';
import { cors, method, wrap } from './_lib/http.js';
import { env } from './_lib/env.js';
import { esc, isSearchCrawler, renderCrawlerPage, renderCrawlerNotFound } from './_lib/crawler-page.js';

const USERNAME_RE = /^[a-z0-9_-]{3,30}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const username = String(url.searchParams.get('username') || '').toLowerCase();
	const origin = env.APP_ORIGIN || 'https://three.ws';
	const redirect = !isSearchCrawler(req.headers?.['user-agent']);

	if (!USERNAME_RE.test(username)) return gone(res, origin);

	let user;
	let counts;
	let agents;
	let avatars;
	try {
		[user] = await sql`
			select id, username, display_name, bio, website, location, avatar_url,
			       created_at, updated_at, service_account
			from users
			where lower(username) = ${username} and deleted_at is null
			limit 1
		`;
		if (!user) return gone(res, origin);
		[[counts], agents, avatars] = await Promise.all([
			sql`
				select
					(select count(*)::int from avatars
					  where owner_id = ${user.id} and visibility = 'public' and deleted_at is null) as avatars,
					(select count(*)::int from agent_identities
					  where user_id = ${user.id} and is_public = true and deleted_at is null) as agents,
					(select count(*)::int from widgets
					  where user_id = ${user.id} and is_public = true and deleted_at is null) as widgets
			`,
			sql`
				select id, name from agent_identities
				where user_id = ${user.id} and is_public = true and deleted_at is null
				order by created_at desc
				limit 12
			`,
			sql`
				select id, name from avatars
				where owner_id = ${user.id} and visibility = 'public' and deleted_at is null
				order by created_at desc
				limit 12
			`,
		]);
	} catch {
		return unavailable(res, origin);
	}

	const meta = profileMeta(user, counts || {});
	const pageUrl = `${origin}/u/${encodeURIComponent(user.username)}`;
	const ogImage = `${origin}/api/u-og?username=${encodeURIComponent(user.username)}`;
	const website = /^https?:\/\//i.test(String(user.website || '')) ? user.website : null;

	const facts = [];
	if (user.location) facts.push({ term: 'Location', detail: esc(user.location) });
	if (website) {
		const h = esc(website);
		facts.push({ term: 'Website', detail: `<a href="${h}" rel="nofollow noopener">${h}</a>` });
	}
	if (agents.length) facts.push({ term: 'Agents', detail: entityLinks(agents, '/agents') });
	if (avatars.length) facts.push({ term: 'Avatars', detail: entityLinks(avatars, '/avatars') });
	if (user.created_at) facts.push({ term: 'Joined', detail: isoDay(user.created_at) });

	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600');
	res.end(
		renderCrawlerPage({
			title: meta.title,
			desc: meta.description,
			pageUrl,
			ogImage,
			origin,
			ogType: 'profile',
			frameButton: `Open ${meta.name}`,
			redirect,
			// Seed-cron service accounts are kept out of profiles.xml for the
			// same reason: their content is listed through the agents they own.
			noindex: Boolean(user.service_account),
			trail: [
				{ name: 'Home', path: '/' },
				{ name: meta.name, path: `/u/${user.username}` },
			],
			facts,
			actions: [
				{ label: 'Open profile', href: `/u/${user.username}`, primary: true },
				{ label: 'Avatar gallery', href: '/gallery' },
				{ label: 'Agent directory', href: '/agents' },
			],
			related: [
				{ label: 'Agent directory', href: '/agents' },
				{ label: 'Avatar gallery', href: '/gallery' },
				{ label: 'Leaderboard', href: '/leaderboard' },
				{ label: 'Create an avatar', href: '/create' },
			],
			jsonLd: {
				'@type': 'ProfilePage',
				'@id': `${pageUrl}#profile`,
				url: pageUrl,
				name: meta.title,
				description: meta.description,
				...(user.created_at ? { dateCreated: new Date(user.created_at).toISOString() } : {}),
				...(user.updated_at ? { dateModified: new Date(user.updated_at).toISOString() } : {}),
				mainEntity: {
					'@type': 'Person',
					name: meta.name,
					alternateName: `@${user.username}`,
					identifier: user.username,
					url: pageUrl,
					...(user.bio ? { description: String(user.bio).trim() } : {}),
					...(/^https:\/\//i.test(String(user.avatar_url || '')) ? { image: user.avatar_url } : {}),
					...(website ? { sameAs: [website] } : {}),
				},
			},
		}),
	);
});

/**
 * Title and description for a profile. The username is unique, so a title
 * that carries it is too; the bio leads the description when there is one.
 */
export function profileMeta(user, counts) {
	const name = String(user.display_name || '').trim() || `@${user.username}`;
	const plain = name.replace(/^@/, '').toLowerCase() === String(user.username).toLowerCase();
	const title = plain ? name : `${name} (@${user.username})`;
	const parts = [];
	const n = (k, one) => {
		const v = Number(counts?.[k] || 0);
		if (v) parts.push(`${v} ${one}${v === 1 ? '' : 's'}`);
	};
	n('avatars', 'avatar');
	n('agents', 'agent');
	n('widgets', 'widget');
	const joined = user.created_at ? new Date(user.created_at) : null;
	const since = joined && !Number.isNaN(joined.getTime())
		? ` Joined ${joined.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}.`
		: '';
	const bio = String(user.bio || '').trim().replace(/\s+/g, ' ');
	const lead = bio ? `${bio.length > 120 ? `${bio.slice(0, 120).replace(/\s+\S*$/, '')}…` : bio}${/[.!?…]$/.test(bio) ? '' : '.'} ` : '';
	const summary = parts.length ? `: ${parts.join(', ')}.` : ', a creator on three.ws.';
	return { name, title, description: `${lead}${title} on three.ws${summary}${since}` };
}

function entityLinks(rows, base) {
	return rows
		.map((r) => `<a href="${base}/${esc(r.id)}">${esc(String(r.name || '').trim() || 'Untitled')}</a>`)
		.join(', ');
}

/** No public profile holds this username. 404 so the URL leaves the index. */
function gone(res, origin) {
	res.statusCode = 404;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'public, max-age=300');
	res.end(
		renderCrawlerNotFound({
			heading: 'No profile here',
			message: 'Nobody on three.ws holds this username, or the account was closed.',
			origin,
			actions: [
				{ label: 'Avatar gallery', href: '/gallery' },
				{ label: 'Agent directory', href: '/agents' },
			],
		}),
	);
}

/** Our read failed. Ask the crawler to retry rather than losing the page. */
function unavailable(res, origin) {
	res.statusCode = 503;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('retry-after', '120');
	res.setHeader('cache-control', 'no-store');
	res.end(
		renderCrawlerNotFound({
			heading: 'Profile temporarily unavailable',
			message: 'three.ws could not load this profile just now. Please try again in a moment.',
			origin,
			actions: [{ label: 'Avatar gallery', href: '/gallery' }],
		}),
	);
}

/** YYYY-MM-DD, the only precision a crawler page needs. */
function isoDay(v) {
	const t = v instanceof Date ? v : new Date(v);
	return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}
