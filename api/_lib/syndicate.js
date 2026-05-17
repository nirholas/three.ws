// Multi-destination syndication for news items.
//
// Targets:
//   - WebSub (PubSubHubbub) push   — no credentials
//   - Dev.to /api/articles         — needs DEV_TO_API_KEY
//   - Medium /v1/users/{me}/posts  — needs MEDIUM_INTEGRATION_TOKEN
//                                    (MEDIUM_AUTHOR_ID is auto-discovered + cached)
//
// HackerNoon is not in this list because they auto-import from
// /rss/announcements.xml — see docs/syndication.md.
//
// CMC has no public publish API; the admin UI offers a "Copy for CMC"
// block that formats the post for manual paste.

import { env } from './env.js';
import { SITE_ORIGIN, NEWS_PATH_PREFIX } from './rss-feed.js';

const WEBSUB_HUB = 'https://pubsubhubbub.appspot.com';
const FEED_URL = `${SITE_ORIGIN}/rss/announcements.xml`;

const DEVTO_API = 'https://dev.to/api/articles';
const MEDIUM_API = 'https://api.medium.com/v1';

let _mediumAuthorIdCache = null;

function permalink(item) {
	return `${SITE_ORIGIN}${NEWS_PATH_PREFIX}/${item.slug}`;
}

// ────────────────────────────────────────────────────────────────────────
// WebSub — instant push to subscribers
// ────────────────────────────────────────────────────────────────────────
export async function notifyWebSub() {
	const body = new URLSearchParams({
		'hub.mode': 'publish',
		'hub.url': FEED_URL,
	}).toString();
	const r = await fetch(WEBSUB_HUB, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'three.ws-news-syndicator/1.0' },
		body,
	});
	if (!r.ok) {
		const text = await r.text().catch(() => '');
		throw new Error(`WebSub hub returned HTTP ${r.status}: ${text.slice(0, 200)}`);
	}
	return { hub: WEBSUB_HUB, feed: FEED_URL, pinged_at: new Date().toISOString() };
}

// ────────────────────────────────────────────────────────────────────────
// Dev.to — create or update an article
// ────────────────────────────────────────────────────────────────────────
function devToTags(tags) {
	// Dev.to accepts max 4 tags, lowercase alphanumeric (no hyphens in API tags)
	return (tags || [])
		.map((t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, ''))
		.filter(Boolean)
		.slice(0, 4);
}

function devToBody(item) {
	// Dev.to accepts HTML embedded inside markdown via body_markdown.
	// Prepend a small "Originally published" note for SEO + clarity.
	const note = `*Originally published on [three.ws](${permalink(item)}).*\n\n`;
	return note + item.bodyHtml;
}

export async function syndicateDevTo(item, { update = null } = {}) {
	const apiKey = env.DEV_TO_API_KEY;
	if (!apiKey) {
		return { target: 'devto', status: 'skipped', reason: 'DEV_TO_API_KEY not set' };
	}
	const article = {
		title: item.title,
		body_markdown: devToBody(item),
		published: item.published !== false,
		canonical_url: permalink(item),
		description: item.summary || undefined,
		main_image: item.image ? (item.image.startsWith('http') ? item.image : `${SITE_ORIGIN}${item.image}`) : undefined,
		tags: devToTags(item.tags),
	};
	const url = update ? `${DEVTO_API}/${update}` : DEVTO_API;
	const method = update ? 'PUT' : 'POST';
	const r = await fetch(url, {
		method,
		headers: { 'content-type': 'application/json', 'api-key': apiKey, accept: 'application/vnd.forem.api-v1+json' },
		body: JSON.stringify({ article }),
	});
	const data = await r.json().catch(() => ({}));
	if (!r.ok) {
		throw new Error(`Dev.to ${method} ${r.status}: ${data?.error || JSON.stringify(data).slice(0, 200)}`);
	}
	return {
		target: 'devto',
		status: update ? 'updated' : 'published',
		id: data.id,
		url: data.url || data.canonical_url || null,
		published_at: data.published_at || new Date().toISOString(),
	};
}

// ────────────────────────────────────────────────────────────────────────
// Medium — create a post (Medium API is create-only, no updates)
// ────────────────────────────────────────────────────────────────────────
async function mediumAuthorId(token) {
	if (_mediumAuthorIdCache) return _mediumAuthorIdCache;
	const r = await fetch(`${MEDIUM_API}/me`, { headers: { Authorization: `Bearer ${token}` } });
	const data = await r.json().catch(() => ({}));
	if (!r.ok || !data?.data?.id) {
		throw new Error(`Medium /me HTTP ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
	}
	_mediumAuthorIdCache = data.data.id;
	return _mediumAuthorIdCache;
}

function mediumBody(item) {
	// Medium contentFormat: 'html' accepts arbitrary HTML; prepend an h1
	// because Medium does not use the `title` field as a visible heading.
	const titleH1 = `<h1>${escapeXml(item.title)}</h1>\n`;
	const note = `<p><em>Originally published on <a href="${permalink(item)}">three.ws</a>.</em></p>\n`;
	return titleH1 + note + item.bodyHtml;
}

function escapeXml(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function syndicateMedium(item) {
	const token = env.MEDIUM_INTEGRATION_TOKEN;
	if (!token) {
		return { target: 'medium', status: 'skipped', reason: 'MEDIUM_INTEGRATION_TOKEN not set' };
	}
	if (item.published === false) {
		return { target: 'medium', status: 'skipped', reason: 'item is a draft (published=false)' };
	}
	const authorId = env.MEDIUM_AUTHOR_ID || await mediumAuthorId(token);
	const post = {
		title: item.title,
		contentFormat: 'html',
		content: mediumBody(item),
		canonicalUrl: permalink(item),
		tags: (item.tags || []).slice(0, 5),
		publishStatus: 'public',
	};
	const r = await fetch(`${MEDIUM_API}/users/${encodeURIComponent(authorId)}/posts`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, accept: 'application/json' },
		body: JSON.stringify(post),
	});
	const data = await r.json().catch(() => ({}));
	if (!r.ok || data?.errors) {
		throw new Error(`Medium HTTP ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
	}
	const out = data?.data || {};
	return {
		target: 'medium',
		status: 'published',
		id: out.id,
		url: out.url || null,
		published_at: out.publishedAt ? new Date(out.publishedAt).toISOString() : new Date().toISOString(),
	};
}

// ────────────────────────────────────────────────────────────────────────
// CMC manual handoff — generate markdown for copy-paste
// ────────────────────────────────────────────────────────────────────────
export function cmcCopyBlock(item) {
	const lines = [];
	lines.push(`# ${item.title}`);
	lines.push('');
	if (item.summary) { lines.push(`> ${item.summary}`); lines.push(''); }
	lines.push(htmlToPlainMarkdown(item.bodyHtml));
	lines.push('');
	lines.push(`---`);
	lines.push(`Originally published at [three.ws/news/${item.slug}](${permalink(item)}).`);
	return lines.join('\n');
}

function htmlToPlainMarkdown(html) {
	return String(html)
		.replace(/<\/?(strong|b)>/gi, '**')
		.replace(/<\/?(em|i)>/gi, '*')
		.replace(/<h2[^>]*>(.*?)<\/h2>/gis, '\n## $1\n')
		.replace(/<h3[^>]*>(.*?)<\/h3>/gis, '\n### $1\n')
		.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, '[$2]($1)')
		.replace(/<li[^>]*>(.*?)<\/li>/gis, '- $1\n')
		.replace(/<\/?(ul|ol)>/gi, '\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<p[^>]*>(.*?)<\/p>/gis, '$1\n\n')
		.replace(/<code[^>]*>(.*?)<\/code>/gis, '`$1`')
		.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

// ────────────────────────────────────────────────────────────────────────
// Run all syndication targets for a single item
// ────────────────────────────────────────────────────────────────────────
export async function syndicateAll(item, { existing = {}, skip = [] } = {}) {
	const results = [];
	const skipSet = new Set(skip);

	// WebSub: ping no matter what (any item save means the feed changed)
	if (!skipSet.has('websub')) {
		try {
			const r = await notifyWebSub();
			results.push({ target: 'websub', status: 'pinged', ...r });
		} catch (e) {
			results.push({ target: 'websub', status: 'error', error: String(e?.message || e) });
		}
	}

	// Dev.to: create or update based on existing syndication state
	if (!skipSet.has('devto')) {
		try {
			const r = await syndicateDevTo(item, { update: existing?.devto?.id || null });
			results.push(r);
		} catch (e) {
			results.push({ target: 'devto', status: 'error', error: String(e?.message || e) });
		}
	}

	// Medium: create only (no update endpoint)
	if (!skipSet.has('medium')) {
		try {
			if (existing?.medium?.id) {
				results.push({ target: 'medium', status: 'skipped', reason: 'Medium API has no update endpoint; first-publish only' });
			} else {
				const r = await syndicateMedium(item);
				results.push(r);
			}
		} catch (e) {
			results.push({ target: 'medium', status: 'error', error: String(e?.message || e) });
		}
	}

	return results;
}
