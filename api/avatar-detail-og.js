/**
 * Crawler page for avatar detail (/avatars/:id)
 * ---------------------------------------------
 * GET /api/avatar-detail-og?id=<avatarId>
 *
 * Wired via vercel.json: when a crawler User-Agent hits /avatars/<uuid>, a
 * "has" condition rewrites to this endpoint. Real browsers never reach it, so
 * this is the only version of the page a search engine or a link unfurler ever
 * sees. It therefore has to carry the avatar's real content, not just meta
 * tags: see the header of api/_lib/crawler-page.js for why a spinner plus a
 * <noscript> block collapsed 45k avatar URLs into a single duplicate cluster.
 *
 * Mirrors api/agent-detail-og.js.
 */

import { sql } from './_lib/db.js';
import { cors, method, wrap } from './_lib/http.js';
import { env } from './_lib/env.js';
import { isUuid } from './_lib/validate.js';
import { esc, isSearchCrawler, renderCrawlerPage, renderCrawlerNotFound } from './_lib/crawler-page.js';
import { isIndexableAvatar } from './_lib/indexable-entity.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	// Crawler-only SSR read. Without this, a POST answered with a page instead
	// of the 405 the advertised Allow set promises.
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const avatarId = url.searchParams.get('id');
	const origin = env.APP_ORIGIN || 'https://three.ws';
	const ua = req.headers?.['user-agent'];
	// Only a non-indexing scraper gets bounced to the app. An indexing crawler
	// runs that script, lands back on this same URL behind the same UA branch,
	// and loops on an identical response.
	const redirect = !isSearchCrawler(ua);

	// Demo and legacy ids are not uuids. They still resolve in the app, so keep
	// the bounce and a valid unfurl, but keep them out of the index rather than
	// inventing a page for an entity we cannot read.
	if (!avatarId || !isUuid(avatarId)) {
		return generic(res, origin, avatarId, redirect);
	}

	let avatar;
	try {
		[avatar] = await sql`
			SELECT a.id, a.name, a.description, a.alt_text, a.tags, a.model_category,
			       a.view_count, a.fork_count, a.parent_avatar_id,
			       a.created_at, a.updated_at,
			       u.username AS owner_username
			FROM avatars a
			LEFT JOIN users u ON u.id = a.owner_id AND u.deleted_at IS NULL
			WHERE a.id = ${avatarId} AND a.deleted_at IS NULL AND a.visibility = 'public'
			LIMIT 1
		`;
	} catch {
		// A read failure is ours, not the URL's. 503 asks the crawler to come
		// back; a 404 or a redirect here would drop a live page from the index.
		return unavailable(res, origin);
	}

	if (!avatar) {
		// Agents and avatars have separate uuid spaces and links cross over
		// (see resolveEntity in src/avatar-page.js). Send the crawler to the
		// path that actually holds the entity instead of reporting nothing.
		let agent = null;
		try {
			[agent] = await sql`
				SELECT id FROM agent_identities
				WHERE id = ${avatarId} AND deleted_at IS NULL LIMIT 1
			`;
		} catch {
			return unavailable(res, origin);
		}
		if (agent) {
			res.statusCode = 301;
			res.setHeader('location', `${origin}/agents/${avatarId}`);
			res.setHeader('cache-control', 'public, max-age=300');
			res.end();
			return;
		}
		return gone(res, origin);
	}

	const title = avatar.name || 'Avatar';
	const baseDesc =
		avatar.description ||
		avatar.alt_text ||
		'A 3D avatar on three.ws - rigged, animated, and ready to become an agent.';
	const tags = Array.isArray(avatar.tags) ? avatar.tags : [];
	const tagSuffix = tags.length
		? ` Tags: ${tags.slice(0, 4).join(', ')}${tags.length > 4 ? '…' : ''}.`
		: '';
	const byline = avatar.owner_username ? ` By @${avatar.owner_username}.` : '';
	const desc = baseDesc + byline + tagSuffix;

	// Unfurl with the rendered avatar card (api/avatar-og.js) - the avatar's own
	// turntable render with name plate, from real data. The card endpoint falls
	// back to the brand image if it can't render.
	const ogImage = `${origin}/api/avatars/${encodeURIComponent(avatarId)}/og`;
	const pageUrl = `${origin}/avatars/${avatarId}`;

	const facts = [];
	if (avatar.owner_username) {
		const u = esc(avatar.owner_username);
		facts.push({ term: 'Creator', detail: `<a href="/u/${u}" rel="author">@${u}</a>` });
	}
	if (avatar.model_category) facts.push({ term: 'Category', detail: esc(avatar.model_category) });
	if (avatar.parent_avatar_id) {
		const parent = esc(avatar.parent_avatar_id);
		facts.push({ term: 'Remixed from', detail: `<a href="/avatars/${parent}">the original avatar</a>` });
	}
	if (Number(avatar.fork_count) > 0) {
		facts.push({ term: 'Remixes', detail: `${Number(avatar.fork_count)} on three.ws` });
	}
	if (Number(avatar.view_count) > 0) {
		facts.push({ term: 'Views', detail: String(Number(avatar.view_count)) });
	}
	if (avatar.created_at) facts.push({ term: 'Published', detail: isoDay(avatar.created_at) });

	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600');
	res.end(
		renderCrawlerPage({
			title,
			desc,
			pageUrl,
			ogImage,
			origin,
			ogType: 'profile',
			frameButton: `Meet ${title}`,
			redirect,
			// An untouched onboarding row is identical to every other one, so it
			// unfurls and renders but never asks to be indexed.
			noindex: !isIndexableAvatar(avatar),
			trail: [
				{ name: 'Home', path: '/' },
				{ name: 'Gallery', path: '/gallery' },
				{ name: title, path: `/avatars/${avatarId}` },
			],
			facts,
			tags: tags.slice(0, 12).map((tag) => ({
				label: tag,
				href: `/gallery?tag=${encodeURIComponent(tag)}`,
			})),
			actions: [
				{ label: 'View in AR', href: `/avatars/${avatarId}/ar`, primary: true },
				{ label: 'Browse the gallery', href: '/gallery' },
				{ label: 'Create your own', href: '/create' },
			],
			related: [
				{ label: 'Avatar gallery', href: '/gallery' },
				{ label: 'Animation library', href: '/animations' },
				{ label: 'Build an embeddable widget', href: '/studio' },
				{ label: 'Agent directory', href: '/agents' },
			],
			jsonLd: {
				'@type': '3DModel',
				'@id': pageUrl,
				name: title,
				description: desc,
				url: pageUrl,
				image: ogImage,
				encodingFormat: 'model/gltf-binary',
				isFamilyFriendly: true,
				...(tags.length ? { keywords: tags.join(', ') } : {}),
				...(avatar.created_at ? { dateCreated: isoDay(avatar.created_at) } : {}),
				...(avatar.updated_at ? { dateModified: isoDay(avatar.updated_at) } : {}),
				...(avatar.owner_username
					? {
							creator: {
								'@type': 'Person',
								name: `@${avatar.owner_username}`,
								url: `${origin}/u/${avatar.owner_username}`,
							},
						}
					: {}),
				publisher: { '@type': 'Organization', name: 'three.ws', url: origin },
			},
		}),
	);
});

/** An id we cannot read: keep the unfurl useful, keep the URL out of the index. */
function generic(res, origin, avatarId, redirect) {
	const target = avatarId ? `/avatars/${encodeURIComponent(avatarId)}` : '/gallery';
	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=600');
	res.end(
		renderCrawlerNotFound({
			heading: 'Avatar on three.ws',
			message:
				'Open this avatar in the three.ws studio to view it in 3D, animate it, and embed it anywhere.',
			origin,
			actions: [
				{ label: 'Open the studio', href: target },
				{ label: 'Browse the gallery', href: '/gallery' },
			],
			redirect: redirect ? target : '',
		}),
	);
}

/** Nothing public lives at this id. 404 so the URL leaves the index cleanly. */
function gone(res, origin) {
	res.statusCode = 404;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'public, max-age=300');
	res.end(
		renderCrawlerNotFound({
			heading: 'This avatar is not public',
			message:
				'The avatar behind this link was removed, or its owner keeps it private. The gallery has thousands of others.',
			origin,
			actions: [
				{ label: 'Browse the gallery', href: '/gallery' },
				{ label: 'Create an avatar', href: '/create' },
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
			heading: 'Avatar temporarily unavailable',
			message: 'three.ws could not load this avatar just now. Please try again in a moment.',
			origin,
			actions: [{ label: 'Browse the gallery', href: '/gallery' }],
		}),
	);
}

/** YYYY-MM-DD, the only precision a crawler page needs. */
function isoDay(v) {
	const t = v instanceof Date ? v : new Date(v);
	return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}
