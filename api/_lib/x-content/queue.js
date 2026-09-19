// The reviewed @trythreews content queue (data/x-content/queue.json) and its
// validator. The CLI and the Cloud Scheduler cron both call validateQueue, so
// "passes check locally" and "publishable in production" are the same rule.
//
// Problems are reported per item: one broken draft never blocks an approved
// item behind it.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { copyProblems, copySimilarity, hasUrl, weightedLength } from './quality.js';
import { attachmentProblems, mediaProblems, mediaType } from './media.js';
import { MARKDOWN_ENTITY_BUDGET, markdownToContentState } from './articles.js';
import { claimProblems, languageProblems } from './editorial.js';
import { approvalProblems } from './review.js';
import { trialProblems } from './trial.js';

export const QUEUE_PATH = 'data/x-content/queue.json';
export const STATUSES = ['draft', 'review', 'approved', 'paused', 'posted'];
export const KINDS = ['post', 'article'];
export const MAX_ARTICLE_TITLE = 100;

export function loadQueue(root, path = QUEUE_PATH) {
	return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

export const EXTERNAL_PATH = 'data/x-content/external.json';

// Every post @trythreews has published that we hold a copy of: the scraped
// archives, the posts made by hand since (EXTERNAL_PATH), and the texts this
// pipeline recorded when it published.
export function loadHistory(root, state = null) {
	const texts = [];
	const dir = resolve(root, 'data/archives');
	if (existsSync(dir)) {
		for (const name of readdirSync(dir).filter((file) => /^trythreews_tweets_.*\.json$/.test(file))) {
			const payload = JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
			const rows = Array.isArray(payload) ? payload : payload.tweets || payload.data || [];
			for (const row of rows) {
				const text = row.text || row.full_text || row.tweet?.full_text || row.tweet?.text;
				if (text) texts.push(String(text));
			}
		}
	}
	const external = resolve(root, EXTERNAL_PATH);
	if (existsSync(external)) for (const row of JSON.parse(readFileSync(external, 'utf8')).posts || []) if (row.text) texts.push(String(row.text));
	for (const row of state?.published || []) if (row.text) texts.push(row.text);
	return texts;
}

export function loadArticle(root, article) {
	const markdown = readFileSync(resolve(root, article.body), 'utf8');
	return markdownToContentState(markdown, { articlePath: article.body });
}

// A post may name the announcement-pack file its copy was reviewed in
// (docs/announcements/<slug>.post.txt). In a checkout the inline text must match
// that file byte for byte, so a pack edit cannot drift from what ships. The
// production image carries no docs/, so the check is skipped there.
function textFromProblems(post, root) {
	if (!post.textFrom) return [];
	const path = resolve(root, post.textFrom);
	if (!existsSync(path)) return root === process.cwd() && existsSync(resolve(root, 'docs')) ? [`textFrom ${post.textFrom} is missing`] : [];
	return readFileSync(path, 'utf8').trim() === String(post.text || '').trim() ? [] : [`text differs from ${post.textFrom}; copy the reviewed pack text into the queue`];
}

function postProblems(item, root, { headMinimum, headNeedsUrl }) {
	const problems = [];
	const posts = item.posts || [];
	const itemLinks = posts.some((post) => hasUrl(post.text));
	if (headNeedsUrl && !itemLinks) problems.push('no post in this item links to its evidence or product surface');

	posts.forEach((post, index) => {
		const label = index === 0 ? 'head' : `reply ${index}`;
		problems.push(...textFromProblems(post, root).map((problem) => `${label}: ${problem}`));
		for (const problem of copyProblems(post.text, { minimum: index === 0 ? headMinimum : 1, requireUrl: false })) {
			problems.push(`${label}: ${problem}`);
		}
		for (const problem of attachmentProblems(post.media)) problems.push(`${label}: ${problem}`);
		for (const media of post.media || []) for (const problem of mediaProblems(media, root)) problems.push(`${label}: ${problem}`);
	});
	return problems;
}

function articleProblems(item, root) {
	const problems = [];
	const article = item.article;
	if (!article) return ['article items need an `article` block with title, body, and cover'];
	const title = String(article.title || '').trim();
	if (!title) problems.push('article title is empty');
	if (title.length > MAX_ARTICLE_TITLE) problems.push(`article title is ${title.length} characters; keep it under ${MAX_ARTICLE_TITLE}`);
	if (/[\u2013\u2014]/.test(title)) problems.push('article title: en-dashes and em-dashes are banned');

	if (!article.cover?.path) problems.push('article needs a cover image; X shows it on the card in every feed');
	else {
		if (mediaType(article.cover.path)?.kind !== 'image') problems.push('article cover must be a still image');
		problems.push(...mediaProblems({ alt: title, ...article.cover }, root).map((problem) => `cover: ${problem}`));
	}

	const body = String(article.body || '');
	if (!body.startsWith('data/x-content/articles/') || !body.endsWith('.md')) {
		problems.push('article body must be a Markdown file under data/x-content/articles/');
		return problems;
	}
	if (!existsSync(resolve(root, body))) return [...problems, `article body ${body} is missing`];

	const converted = loadArticle(root, article);
	const { blocks } = converted.content_state;
	if (blocks.length < 3) problems.push(`article body has ${blocks.length} blocks; that is a post, not an Article`);
	if (/[\u2013\u2014]/.test(blocks.map((block) => block.text).join('\n'))) problems.push('article body: en-dashes and em-dashes are banned');
	if (converted.markdownWeight > MARKDOWN_ENTITY_BUDGET) {
		problems.push(`code blocks and tables total ${converted.markdownWeight} characters; X allows ${MARKDOWN_ENTITY_BUDGET} per Article`);
	}
	for (const warning of converted.warnings) problems.push(`article body: ${warning}`);
	for (const image of converted.images) {
		if (mediaType(image.path)?.kind !== 'image') problems.push(`article image ${image.path} must be a still image`);
		problems.push(...mediaProblems({ path: image.path, alt: image.caption || title }, root).map((problem) => `article image: ${problem}`));
	}
	return problems;
}

export function validateItem(item, root) {
	const problems = [];
	if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(String(item.id || ''))) problems.push('id must be a lowercase slug');
	if (!STATUSES.includes(item.status)) problems.push(`status must be one of ${STATUSES.join(', ')}`);
	if (!KINDS.includes(item.kind)) problems.push(`kind must be one of ${KINDS.join(', ')}`);
	if (!item.lane || !item.pattern) problems.push('lane and pattern are required (they drive rotation)');
	if (!Number.isFinite(Date.parse(item.notBefore))) problems.push('notBefore must be an ISO-8601 timestamp');
	if (![1, 2, 3].includes(Number(item.tier))) problems.push('tier must be 1 (flagship), 2 (feature), or 3 (proof of work)');
	if (item.expiresAt !== undefined && !Number.isFinite(Date.parse(item.expiresAt))) problems.push('expiresAt must be an ISO-8601 timestamp');
	if (item.priority !== undefined && !(Number(item.priority) >= -50 && Number(item.priority) <= 50)) problems.push('priority is an owner boost from -50 to 50');
	for (const probe of item.probes || []) {
		if (!['api', 'browser', 'command'].includes(probe.type)) problems.push(`probe type ${probe.type} must be api, browser, or command`);
		if (probe.type === 'api' && !/^https:\/\//.test(String(probe.url || ''))) problems.push('api probes need an https url');
		if (probe.type === 'command' && !Array.isArray(probe.argv)) problems.push('command probes need an argv array');
	}

	if (item.kind === 'post') {
		if (!item.posts?.length) problems.push('a post item needs at least one post');
		else {
			if (!item.textOnly && !item.posts[0].media?.length) {
				problems.push('head post has no media; attach an image, GIF, or video, or set "textOnly": true on purpose');
			}
			problems.push(...postProblems(item, root, { headMinimum: 100, headNeedsUrl: true }));
		}
	}
	if (item.kind === 'article') {
		problems.push(...articleProblems(item, root));
		// Follow-up posts quote the published Article, so the Article itself is
		// the link and the head may be short.
		if (item.posts?.length) problems.push(...postProblems(item, root, { headMinimum: 40, headNeedsUrl: false }));
	}

	// Editorial standards that can be judged offline block at every stage.
	const texts = [item.kind === 'article' ? item.article?.title : null, ...(item.posts || []).map((post) => post.text)].filter(Boolean);
	for (const text of texts) {
		for (const finding of languageProblems(text)) if (finding.severity === 'blocking') problems.push(`${finding.rule}: ${finding.message}`);
	}
	for (const finding of claimProblems(item)) if (finding.severity === 'blocking') problems.push(`${finding.rule}: ${finding.message}`);

	// Approval is only real while a passing review covers these exact bytes.
	// So is a feature trial: the product was run end to end, recently enough to
	// still be true, and every promise in the copy is proven.
	if (item.status === 'approved') {
		problems.push(...approvalProblems(item, root).map((problem) => `review: ${problem}`));
		problems.push(...trialProblems(item, root).map((problem) => `trial: ${problem}`));
	}
	return problems;
}

export function headText(item) {
	return item.kind === 'article' ? `${item.article?.title || ''}\n${item.posts?.[0]?.text || ''}` : item.posts?.[0]?.text || '';
}

export function validateQueue(queue, root, { state = null } = {}) {
	const problems = {};
	const notes = [];
	const ids = new Set();
	for (const item of queue.items || []) {
		const list = validateItem(item, root);
		if (ids.has(item.id)) list.push('id is duplicated');
		ids.add(item.id);
		problems[item.id] = list;
	}

	const live = (queue.items || []).filter((item) => item.status !== 'posted');
	const queueLimit = Number(queue.quality?.queueSimilarityLimit ?? 0.34);
	for (let left = 0; left < live.length; left++) {
		for (let right = left + 1; right < live.length; right++) {
			const score = copySimilarity(headText(live[left]), headText(live[right]));
			if (score >= queueLimit) problems[live[right].id].push(`reads like ${live[left].id} (similarity ${score.toFixed(2)} >= ${queueLimit})`);
		}
	}

	const history = loadHistory(root, state);
	const publishedIds = new Set((state?.published || []).map((row) => row.id));
	const archiveLimit = Number(queue.quality?.archiveSimilarityLimit ?? 0.42);
	for (const item of live.filter((row) => !publishedIds.has(row.id))) {
		const head = headText(item);
		const closest = history.reduce((best, prior) => Math.max(best, copySimilarity(head, prior)), 0);
		if (closest >= archiveLimit) problems[item.id].push(`repeats an earlier @trythreews post (similarity ${closest.toFixed(2)} >= ${archiveLimit})`);
		else notes.push(`${item.id}: ${item.kind}, head ${weightedLength(item.posts?.[0]?.text || '')} chars, closest earlier post ${closest.toFixed(2)}`);
	}
	return { problems, notes };
}
