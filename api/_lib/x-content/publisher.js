// Publishes one queue item to X: a post or thread with native media, or an X
// Article followed by posts that quote it.
//
// The client is a twitter-api-v2 `TwitterApi` authenticated as @trythreews with
// OAuth 1.0a user context (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN,
// X_ACCESS_SECRET). Only its v2 surface is used: chunked media upload, media
// metadata for alt text, POST /2/tweets, and POST /2/articles/draft plus
// /2/articles/:id/publish.
//
// `previewClient` records the exact calls a publish would make without touching
// X, which is what `--dry-run` and the cron's preview mode print.

import { loadArticle } from './queue.js';
import { readMedia } from './media.js';
import { attachArticleMedia } from './articles.js';

// X expires an uploaded media id after 24 hours; re-upload past this age.
const MEDIA_ID_TTL_MS = 23 * 60 * 60 * 1000;

export async function xClientFromEnv(env = process.env) {
	const creds = {
		appKey: env.X_API_KEY,
		appSecret: env.X_API_SECRET,
		accessToken: env.X_ACCESS_TOKEN,
		accessSecret: env.X_ACCESS_SECRET,
	};
	if (!(creds.appKey && creds.appSecret && creds.accessToken && creds.accessSecret)) return null;
	const { TwitterApi } = await import('twitter-api-v2');
	return new TwitterApi(creds).readWrite.v2;
}

export function previewClient() {
	const calls = [];
	let counter = 0;
	const id = (label) => `preview-${label}-${++counter}`;
	return {
		calls,
		async uploadMedia(buffer, options) {
			calls.push({ call: 'media.upload', bytes: buffer.length, ...options });
			return id('media');
		},
		async createMediaMetadata(mediaId, metadata) {
			calls.push({ call: 'media.metadata', mediaId, alt: metadata.alt_text?.text });
		},
		async tweet(payload) {
			calls.push({ call: 'tweets.create', ...payload });
			return { data: { id: id('post'), text: payload.text } };
		},
		async post(path, body) {
			calls.push({ call: `POST /2/${path}`, ...(body ? { body } : {}) });
			if (path === 'articles/draft') return { data: { id: id('article'), title: body.title } };
			return { data: { post_id: id('article-post') } };
		},
	};
}

async function uploadOnce({ client, root, media, progress, persist }) {
	const cached = progress.media[media.path];
	if (cached && Date.now() - cached.at < MEDIA_ID_TTL_MS) return cached.id;
	const { buffer, mime, kind, category } = readMedia(media, root);
	const mediaId = await client.uploadMedia(buffer, { media_type: mime, media_category: category });
	const alt = String(media.alt || '').trim();
	if (alt && kind !== 'video') await client.createMediaMetadata(mediaId, { alt_text: { text: alt } });
	progress.media[media.path] = { id: mediaId, at: Date.now() };
	await persist();
	return mediaId;
}

async function publishPosts({ client, root, posts, progress, persist, quoteId = null }) {
	for (let index = 0; index < posts.length; index++) {
		if (progress.postIds[index]) continue;
		const post = posts[index];
		const mediaIds = [];
		for (const media of post.media || []) mediaIds.push(await uploadOnce({ client, root, media, progress, persist }));
		const payload = { text: post.text.trim() };
		if (mediaIds.length) payload.media = { media_ids: mediaIds };
		const replyTo = index === 0 ? null : progress.postIds[index - 1];
		if (replyTo) payload.reply = { in_reply_to_tweet_id: replyTo };
		if (index === 0 && quoteId) payload.quote_tweet_id = quoteId;
		const { data } = await client.tweet(payload);
		progress.postIds[index] = data.id;
		await persist();
	}
}

async function publishArticle({ client, root, item, progress, persist }) {
	if (!progress.articlePostId) {
		if (!progress.articleDraftId) {
			const { content_state, images } = loadArticle(root, item.article);
			const coverId = await uploadOnce({ client, root, media: { alt: item.article.title, ...item.article.cover }, progress, persist });
			const imageIds = [];
			for (const image of images) {
				imageIds.push(await uploadOnce({ client, root, media: { path: image.path, alt: image.caption || item.article.title }, progress, persist }));
			}
			const { data } = await client.post('articles/draft', {
				title: item.article.title.trim(),
				content_state: attachArticleMedia(content_state, images, imageIds),
				cover_media: { media_category: 'tweet_image', media_id: coverId },
			});
			progress.articleDraftId = data.id;
			await persist();
		}
		const { data } = await client.post(`articles/${progress.articleDraftId}/publish`);
		progress.articlePostId = data.post_id;
		await persist();
	}
	if (item.posts?.length) await publishPosts({ client, root, posts: item.posts, progress, persist, quoteId: progress.articlePostId });
}

// Publishes `item`, resuming from state.inflight. Returns the ledger row.
// `meta` (the slot and tier the scheduler gave this post) is pinned on the
// first attempt, so a thread resumed after a crash is still credited to the
// slot it started in and that slot is never spent twice.
export async function publishItem({ item, client, root, state, store, account = 'trythreews', meta = {}, now = Date.now() }) {
	state.inflight ||= {};
	const progress = (state.inflight[item.id] ||= { media: {}, postIds: [] });
	progress.meta ||= meta;
	const persist = () => store.save(state);

	if (item.kind === 'article') await publishArticle({ client, root, item, progress, persist });
	// `quotes` makes the head post a quote tweet of an existing post, which is how
	// a follow-up adds the detail its original left out without repeating it.
	else await publishPosts({ client, root, posts: item.posts, progress, persist, quoteId: item.quotes || null });

	const leadId = progress.articlePostId || progress.postIds[0];
	const row = {
		id: item.id,
		kind: item.kind,
		lane: item.lane,
		pattern: item.pattern,
		publishedAt: new Date(now).toISOString(),
		text: item.kind === 'article' ? item.article.title : item.posts[0].text,
		postIds: progress.postIds,
		url: `https://x.com/${account}/status/${leadId}`,
		...progress.meta,
	};
	if (progress.articlePostId) row.articlePostId = progress.articlePostId;
	state.published = [...(state.published || []), row];
	delete state.inflight[item.id];
	await persist();
	return row;
}
