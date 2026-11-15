// Posts mined from what three.ws has already written and already posted.
//
// The announcement ledger (backlog.js) finds surfaces nobody has announced.
// Three more sources hold posts the account has not made yet:
//
//   blogBacklog       blog posts no queue item has shared, newest first; a long
//                     one is offered as an X Article, a short one as a post,
//                     each with the `import` command that drafts it
//   changelogBacklog  what changed on each page since the last post that linked
//                     it, from data/changelog.json: a page with new features is
//                     worth a "what is new on /forge" post with a fresh capture
//   recutCandidates   the account's best posts from three weeks to three months
//                     ago, with heads in a format they have not had, so a post
//                     that worked is cut again for readers who scrolled past
//                     the first format, never sent again as it was
//
// A re-cut is a new item with new copy: the queue check rejects copy that
// repeats an earlier post, and the new item records `recutOf` so the same post
// is not offered twice.
//
// Pure: callers pass the blog HTML, the changelog, the outcomes rows, the
// publish ledger and the queue items.

import { coveredKeys, itemsByLanding } from './backlog.js';
import { formatOf } from './formats.js';
import { isMature, leadPostId, outcomeOf } from './outcomes.js';

const DAY = 86_400_000;

// A post this long reads better as an Article than as a link under a post.
export const ARTICLE_WORDS = 900;

const decode = (value) =>
	String(value || '')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.trim();

const metaContent = (html, attr, name) => decode(html.match(new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1]);

// The title, date, summary and length of one blog post. Only the article is
// counted, so the nav, footer and inline scripts do not inflate it.
export function blogPostMeta(html, slug) {
	const source = String(html || '');
	const title = metaContent(source, 'property', 'og:title') || decode(source.match(/<title>([^<]*)<\/title>/i)?.[1]).replace(/\s*\|\s*three\.ws$/i, '') || slug;
	const description = metaContent(source, 'name', 'description') || metaContent(source, 'property', 'og:description');
	const published = source.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1] || metaContent(source, 'property', 'article:published_time').slice(0, 10) || null;
	const body = source.match(/<article[\s\S]*?<\/article>/i)?.[0] || source.match(/<body[\s\S]*<\/body>/i)?.[0] || '';
	const text = body
		.replace(/<(script|style|nav|footer)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&[a-z#0-9]+;/gi, ' ');
	const words = text.split(/\s+/).filter(Boolean).length;
	return { slug, title, description, published, words, path: `/blog/${slug}` };
}

// Blog posts no queue item has shared: none links them and none was imported
// from them (`import` uses the slug as the id unless told otherwise, and records
// the post in `covers`).
export function blogBacklog(posts, items, { limit = 12 } = {}) {
	const covered = coveredKeys(items);
	const ids = new Set((items || []).map((item) => item.id));
	for (const item of items || []) {
		const path = pathOf(item.source?.url);
		if (path) covered.add(path);
	}
	return (posts || [])
		.filter((post) => post?.slug && !covered.has(post.path) && !ids.has(post.slug))
		.sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')) || a.slug.localeCompare(b.slug))
		.slice(0, limit)
		.map((post) => {
			const as = post.words >= ARTICLE_WORDS ? 'article' : 'post';
			return { slug: post.slug, title: post.title, published: post.published, words: post.words, url: `https://three.ws${post.path}`, as, command: `npm run x:content -- import ${post.slug} --as ${as} --id ${post.slug}` };
		});
}

// What a changelog tag says about whether a change is worth a post. Fixes,
// security, infrastructure and docs alone are not news to a reader of the feed.
const TAG_WEIGHT = { feature: 2, improvement: 1, sdk: 1, desktop: 1 };
const changeWeight = (entry) => Math.max(0, ...(entry.tags || []).map((tag) => TAG_WEIGHT[tag] || 0));

const pathOf = (link) => {
	const raw = String(link || '').trim();
	if (!raw) return null;
	const match = raw.match(/^(?:https?:\/\/(?:www\.)?three\.ws)?(\/[^?#\s]*)/);
	return match ? match[1].replace(/\/+$/, '') || '/' : null;
};

// Pages with news since the account last linked them. A queued item that has
// not gone out yet already covers its pages; a posted item covers the changes
// made before it went out, by the date the publish ledger records.
export function changelogBacklog(entries, items, { now = Date.now(), days = 30, limit = 10, published = [] } = {}) {
	const from = new Date(now - days * DAY).toISOString().slice(0, 10);
	const byId = new Map((items || []).map((item) => [item.id, item]));
	const postedAt = new Map((published || []).filter((row) => row?.publishedAt).map((row) => [row.id, String(row.publishedAt).slice(0, 10)]));
	const landing = itemsByLanding(items);

	const pages = new Map();
	for (const entry of entries || []) {
		const path = pathOf(entry.link);
		if (!path || !entry.date || entry.date < from || !changeWeight(entry)) continue;
		if (!pages.has(path)) pages.set(path, []);
		pages.get(path).push(entry);
	}

	const rows = [];
	for (const [path, changes] of pages) {
		const linking = [...(landing.get(path) || [])].map((id) => byId.get(id)).filter(Boolean);
		if (linking.some((item) => item.status !== 'posted')) continue;
		const since = linking.map((item) => postedAt.get(item.id)).filter(Boolean).sort().pop() || null;
		const fresh = changes.filter((entry) => !since || entry.date > since).sort((a, b) => b.date.localeCompare(a.date) || changeWeight(b) - changeWeight(a));
		if (!fresh.length) continue;
		rows.push({
			path,
			url: `https://three.ws${path === '/' ? '' : path}`,
			head: 'shot',
			since,
			score: fresh.reduce((sum, entry) => sum + changeWeight(entry), 0),
			latest: fresh[0].date,
			changes: fresh.map((entry) => ({ date: entry.date, title: entry.title, tags: entry.tags || [] })),
		});
	}
	return rows.sort((a, b) => b.score - a.score || b.latest.localeCompare(a.latest) || a.path.localeCompare(b.path)).slice(0, limit);
}

// Heads that change what the reader sees first, for a post that led with
// each format. The card and the live capture work for anything; a GIF needs a
// reel to cut from, and an Article needs the depth to fill one.
const RECUT_HEADS = {
	video: ['card', 'shot', 'gif'],
	gif: ['card', 'shot', 'article'],
	photo: ['gif', 'shot', 'article'],
	text: ['card', 'shot', 'code'],
	article: ['card', 'gif', 'shot'],
};

export const recutHeads = (format) => RECUT_HEADS[format] || RECUT_HEADS.text;

// The account's best posts from `minDays` to `maxDays` ago that did better
// than its average, joined to the queue items they published, that no item
// has re-cut yet.
export function recutCandidates(rows, published, items, { now = Date.now(), minDays = 21, maxDays = 90, limit = 6 } = {}) {
	const matured = (rows || []).filter((row) => row?.at && isMature(row, now));
	if (!matured.length) return [];
	const mean = matured.reduce((sum, row) => sum + outcomeOf(row), 0) / matured.length;

	const ledgerByPost = new Map();
	for (const row of published || []) for (const id of [leadPostId(row), ...(row.postIds || [])]) if (id) ledgerByPost.set(String(id), row);
	const byId = new Map((items || []).map((item) => [item.id, item]));
	const recut = new Set((items || []).map((item) => item.recutOf).filter(Boolean));

	const seen = new Set();
	const out = [];
	for (const row of [...matured].sort((a, b) => outcomeOf(b) - outcomeOf(a))) {
		const age = (now - Date.parse(row.at)) / DAY;
		if (age < minDays || age > maxDays || outcomeOf(row) <= mean) continue;
		const ledger = ledgerByPost.get(String(row.id));
		const item = ledger && byId.get(ledger.id);
		if (!item || recut.has(item.id) || seen.has(item.id)) continue;
		seen.add(item.id);
		const format = formatOf(item);
		out.push({ id: item.id, posted: row.at.slice(0, 10), likes: row.likes || 0, bookmarks: row.bookmarks || 0, reposts: row.reposts || 0, views: row.impressions || 0, format, lane: item.lane || null, heads: recutHeads(format) });
		if (out.length >= limit) break;
	}
	return out;
}
