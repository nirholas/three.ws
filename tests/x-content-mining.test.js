import { describe, it, expect } from 'vitest';

import { blogPostMeta, blogBacklog, changelogBacklog, recutCandidates, recutHeads } from '../api/_lib/x-content/mining.js';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const DAY = 86_400_000;

const html = ({ title = 'A post', date = '2026-11-01T12:00:00.000Z', words = 300 } = {}) => `<!DOCTYPE html><html><head>
<title>${title} | three.ws</title>
<meta property="og:title" content="${title}">
<meta name="description" content="What the post says.">
<script type="application/ld+json">{"@type":"BlogPosting","datePublished":"${date}"}</script>
<style>.x{color:red}</style></head><body><nav>Home Blog</nav><article><h1>${title}</h1><p>${'word '.repeat(words)}</p></article><script>var a = 1;</script></body></html>`;

describe('blog posts', () => {
	it('reads the title, date and length of a post, counting only the article', () => {
		const meta = blogPostMeta(html({ title: 'Rig in the browser', words: 1200 }), 'rig');
		expect(meta).toMatchObject({ slug: 'rig', title: 'Rig in the browser', published: '2026-11-01', path: '/blog/rig', description: 'What the post says.' });
		expect(meta.words).toBeGreaterThanOrEqual(1200);
		expect(meta.words).toBeLessThan(1210);
	});

	it('offers every post nothing has shared, newest first, long ones as an Article', () => {
		const posts = [
			blogPostMeta(html({ title: 'Old', date: '2026-06-01T00:00:00Z' }), 'old'),
			blogPostMeta(html({ title: 'Long', words: 1500 }), 'long'),
			blogPostMeta(html({ title: 'Linked' }), 'linked'),
			blogPostMeta(html({ title: 'Imported' }), 'imported'),
			blogPostMeta(html({ title: 'Renamed' }), 'old-name'),
		];
		const items = [
			{ id: 'something', posts: [{ text: 'Read it: https://three.ws/blog/linked' }] },
			{ id: 'imported', posts: [{ text: 'An import.' }] },
			{ id: 'renamed', source: { url: 'https://three.ws/blog/old-name' }, posts: [{ text: 'An import under another id.' }] },
		];
		const rows = blogBacklog(posts, items);
		expect(rows.map((row) => row.slug)).toEqual(['long', 'old']);
		expect(rows[0]).toMatchObject({ as: 'article', command: 'npm run x:content -- import long --as article --id long' });
		expect(rows[1].as).toBe('post');
	});
});

describe('changelog', () => {
	const entry = (date, title, link, tags = ['feature']) => ({ date, title, summary: `${title}.`, tags, link });

	it('groups what changed on each page since the last post that linked it', () => {
		const entries = [
			entry('2026-11-14', 'Forge exports USDZ', '/forge'),
			entry('2026-11-10', 'Forge remembers the last prompt', '/forge', ['improvement']),
			entry('2026-11-12', 'Discover filters by rig', '/discover'),
			entry('2026-11-13', 'Fix a crash on Discover', '/discover', ['fix']),
			entry('2026-11-11', 'Viewer loads faster', '/viewer', ['improvement']),
			entry('2026-11-09', 'Docs for the SDK', '/docs/sdk', ['docs']),
			entry('2026-11-14', 'No page', null),
			entry('2026-09-01', 'Too old', '/rig'),
		];
		const items = [
			// Posted after the viewer change, so the viewer has nothing new to say.
			{ id: 'viewer-post', status: 'posted', posts: [{ text: 'https://three.ws/viewer' }] },
			// Posted before the Forge changes, so they are still news.
			{ id: 'forge-post', status: 'posted', posts: [{ text: 'https://three.ws/forge' }] },
		];
		const published = [
			{ id: 'viewer-post', publishedAt: '2026-11-12T10:00:00Z' },
			{ id: 'forge-post', publishedAt: '2026-11-01T10:00:00Z' },
		];
		const rows = changelogBacklog(entries, items, { now: NOW, published });
		expect(rows.map((row) => row.path)).toEqual(['/forge', '/discover']);
		expect(rows[0]).toMatchObject({ url: 'https://three.ws/forge', head: 'shot', since: '2026-11-01' });
		expect(rows[0].changes.map((change) => change.title)).toEqual(['Forge exports USDZ', 'Forge remembers the last prompt']);
		// A fix on its own is not news, and it is not counted as a change to post.
		expect(rows[1].changes.map((change) => change.title)).toEqual(['Discover filters by rig']);
	});

	it('treats a queued item that is not yet posted as covering the page', () => {
		const entries = [entry('2026-11-14', 'Forge exports USDZ', '/forge')];
		const items = [{ id: 'forge-next', status: 'approved', posts: [{ text: 'https://three.ws/forge' }] }];
		expect(changelogBacklog(entries, items, { now: NOW })).toEqual([]);
	});
});

describe('re-cuts', () => {
	const published = [
		{ id: 'big-video', url: 'https://x.com/trythreews/status/101', postIds: ['101'] },
		{ id: 'big-photo', url: 'https://x.com/trythreews/status/102', postIds: ['102'] },
		{ id: 'flop', url: 'https://x.com/trythreews/status/103', postIds: ['103'] },
		{ id: 'fresh-hit', url: 'https://x.com/trythreews/status/104', postIds: ['104'] },
		{ id: 'redone', url: 'https://x.com/trythreews/status/105', postIds: ['105'] },
	];
	const row = (id, daysAgo, likes, bookmarks = 0) => ({ id, at: new Date(NOW - daysAgo * DAY).toISOString(), likes, bookmarks, reposts: 0, impressions: likes * 100 });
	const rows = [row('101', 30, 80, 20), row('102', 40, 60, 10), row('103', 30, 1), row('104', 5, 200, 50), row('105', 35, 90, 30), row('999', 30, 300)];
	const items = [
		{ id: 'big-video', kind: 'thread', lane: 'creation', posts: [{ text: 'a', media: [{ path: 'public/x-media/a/reel.mp4' }] }, { text: 'b' }] },
		{ id: 'big-photo', kind: 'post', lane: 'creation', posts: [{ text: 'a', media: [{ path: 'public/x-media/a/card.png' }] }] },
		{ id: 'flop', kind: 'post', posts: [{ text: 'a' }] },
		{ id: 'fresh-hit', kind: 'post', posts: [{ text: 'a' }] },
		{ id: 'redone', kind: 'post', posts: [{ text: 'a' }] },
		{ id: 'redone-gif', kind: 'post', recutOf: 'redone', posts: [{ text: 'b' }] },
	];

	it('offers the account\'s best posts from weeks ago in a format they have not had', () => {
		const out = recutCandidates(rows, published, items, { now: NOW });
		expect(out.map((candidate) => candidate.id)).toEqual(['big-video', 'big-photo']);
		expect(out[0]).toMatchObject({ format: 'video', likes: 80, bookmarks: 20, posted: '2026-10-16' });
		expect(out[0].heads).not.toContain('reel');
		expect(out[1].heads).not.toContain('card');
	});

	it('suggests heads that change what the reader sees first', () => {
		expect(recutHeads('video')).toEqual(['card', 'shot', 'gif']);
		expect(recutHeads('photo')).toEqual(['gif', 'shot', 'article']);
		expect(recutHeads('text')).toEqual(['card', 'shot', 'code']);
		expect(recutHeads('article')).toEqual(['card', 'gif', 'shot']);
	});

	it('offers nothing when no post is old enough or none has numbers', () => {
		expect(recutCandidates([], published, items, { now: NOW })).toEqual([]);
		expect(recutCandidates([row('104', 5, 200)], published, items, { now: NOW })).toEqual([]);
	});
});
