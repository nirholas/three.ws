// The reviewed @trythreews content queue (data/x-content/queue.json) and its
// validator. The CLI and the Cloud Scheduler cron both call validateQueue, so
// "passes check locally" and "publishable in production" are the same rule.
//
// Problems are reported per item: one broken draft never blocks an approved
// item behind it.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { copyProblems, copySimilarity, hasUrl, maxLengthOf, weightedLength } from './quality.js';
import { attachmentProblems, mediaProblems, mediaType } from './media.js';
import { MARKDOWN_ENTITY_BUDGET, markdownToContentState } from './articles.js';
import { claimProblems, languageProblems } from './editorial.js';
import { approvalProblems } from './review.js';
import { proofProblems, scenarioProblems } from './reel.js';
import { headProblems } from './formats.js';

export const QUEUE_PATH = 'data/x-content/queue.json';
export const STATUSES = ['draft', 'review', 'approved', 'paused', 'posted'];
export const KINDS = ['post', 'article'];
export const MAX_ARTICLE_TITLE = 100;

// An Article is the long form, so it has to use the room X gives it (owner,
// 2026-10-11): a title that fills the title limit with the headline number in
// it, a body deep enough to explain the mechanism, code and tables that use
// the share X allows, four or more real images, and the partners section.
export const MIN_ARTICLE_TITLE = 80;
export const MIN_ARTICLE_WORDS = 2400;
export const MIN_ARTICLE_SECTIONS = 8;
export const MIN_ARTICLE_IMAGES = 4;
export const MIN_MARKDOWN_ENTITY = 3000;

// The partner names three.ws/partners lists, read from the page so the gate
// stays true when a programme is added.
export function partnerNames(root) {
	try {
		const html = readFileSync(resolve(root, 'pages/partners.html'), 'utf8');
		return [...html.matchAll(/class="partner-name"[^>]*>([^<]+)</g)].map((match) => match[1].trim()).filter(Boolean);
	} catch {
		return [];
	}
}

function articleDepthProblems(root, title, blocks, converted) {
	const problems = [];
	if (title.length < MIN_ARTICLE_TITLE) {
		problems.push(`article title is ${title.length} characters; use the title limit, ${MIN_ARTICLE_TITLE} to ${MAX_ARTICLE_TITLE}, and carry the headline number`);
	}
	const prose = blocks.filter((block) => block.type !== 'atomic').map((block) => block.text).join('\n');
	const words = prose.split(/\s+/).filter(Boolean).length;
	if (words < MIN_ARTICLE_WORDS) problems.push(`article body is ${words} words; an Article explains in depth, ${MIN_ARTICLE_WORDS} or more`);
	const sections = blocks.filter((block) => block.type === 'header-two');
	if (sections.length < MIN_ARTICLE_SECTIONS) problems.push(`article body has ${sections.length} sections; use ${MIN_ARTICLE_SECTIONS} or more, each named for what the reader learns`);
	if (converted.markdownWeight < MIN_MARKDOWN_ENTITY) {
		problems.push(`code blocks and tables total ${converted.markdownWeight} characters; X allows ${MARKDOWN_ENTITY_BUDGET}, so use at least ${MIN_MARKDOWN_ENTITY} on runnable code and real tables`);
	}
	if (converted.images.length < MIN_ARTICLE_IMAGES) problems.push(`article has ${converted.images.length} inline images; use ${MIN_ARTICLE_IMAGES} or more real captures`);

	const headings = sections.map((block) => block.text);
	const partners = headings.findIndex((heading) => /^the partners behind\b/i.test(heading));
	if (partners < 0) {
		problems.push('article needs a "The partners behind ..." section with thanks to each partner, stated as three.ws/partners states it');
	} else {
		const start = blocks.findIndex((block) => block.type === 'header-two' && block.text === headings[partners]);
		const end = blocks.findIndex((block, index) => index > start && block.type === 'header-two');
		const section = blocks.slice(start, end < 0 ? undefined : end).map((block) => block.text).join('\n');
		for (const name of partnerNames(root)) {
			if (!section.includes(name)) problems.push(`partners section does not cover ${name}; every partner on three.ws/partners gets a paragraph`);
		}
	}
	if (!headings.some((heading) => /^try it\b/i.test(heading))) problems.push('article needs a "Try it" section that links the live pages');
	return problems;
}

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

// The words an Article says, as a reader sees them: headings, paragraphs, list
// items and quotes. Code blocks and tables are left out because they are
// literal samples, not statements. Every number and absolute in it is held to
// the claims ledger and the language rules, the same as a post.
//
// `inlineCode: false` drops inline code spans too, for the spelling check: a
// bone name like `mixamorig:LeftArm` is an identifier quoted from a file, not
// a word the article spells.
export function articleProse(root, item, { inlineCode = true } = {}) {
	if (item?.kind !== 'article' || !item.article?.body) return '';
	if (!existsSync(resolve(root, item.article.body))) return '';
	const article = inlineCode ? item.article : null;
	const { blocks } = article
		? loadArticle(root, article).content_state
		: markdownToContentState(readFileSync(resolve(root, item.article.body), 'utf8').replace(/`[^`\n]+`/g, ' '), { articlePath: item.article.body }).content_state;
	return blocks.filter((block) => block.type !== 'atomic').map((block) => block.text).filter(Boolean).join('\n');
}

// Every link an Article body makes, so each is resolved like a link in a post.
export function articleLinks(root, item) {
	if (item?.kind !== 'article' || !item.article?.body) return [];
	if (!existsSync(resolve(root, item.article.body))) return [];
	return loadArticle(root, item.article).content_state.entities.filter((entity) => entity.value.type === 'link').map((entity) => entity.value.data.url).filter((url) => /^https?:/i.test(url));
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

function postProblems(item, root, { headMinimum, headNeedsUrl, maximum }) {
	const problems = [];
	const posts = item.posts || [];
	const itemLinks = posts.some((post) => hasUrl(post.text));
	if (headNeedsUrl && !itemLinks) problems.push('no post in this item links to its evidence or product surface');

	posts.forEach((post, index) => {
		const label = index === 0 ? 'head' : `reply ${index}`;
		problems.push(...textFromProblems(post, root).map((problem) => `${label}: ${problem}`));
		for (const problem of copyProblems(post.text, { minimum: index === 0 ? headMinimum : 1, maximum, requireUrl: false })) {
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
	if (['review', 'approved'].includes(item.status)) problems.push(...articleDepthProblems(root, title, blocks, converted));
	for (const warning of converted.warnings) problems.push(`article body: ${warning}`);
	for (const image of converted.images) {
		if (mediaType(image.path)?.kind !== 'image') problems.push(`article image ${image.path} must be a still image`);
		problems.push(...mediaProblems({ path: image.path, alt: image.caption || title }, root).map((problem) => `article image: ${problem}`));
	}
	return problems;
}

// The queue's own quality settings, for a caller that holds one item and not
// the queue it came from.
function qualityAt(root) {
	try {
		return loadQueue(root).quality || {};
	} catch {
		return {};
	}
}

// `now` is the moment the item is judged at. A tick passes its own, so a
// review's age and a proof's age are measured against the tick and not against
// whenever the code happens to run.
export function validateItem(item, root, { quality = qualityAt(root), now = Date.now() } = {}) {
	const problems = [];
	const maximum = maxLengthOf(quality);
	if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(String(item.id || ''))) problems.push('id must be a lowercase slug');
	if (!STATUSES.includes(item.status)) problems.push(`status must be one of ${STATUSES.join(', ')}`);
	if (!KINDS.includes(item.kind)) problems.push(`kind must be one of ${KINDS.join(', ')}`);
	if (!item.lane || !item.pattern) problems.push('lane and pattern are required (they drive rotation)');
	if (!Number.isFinite(Date.parse(item.notBefore))) problems.push('notBefore must be an ISO-8601 timestamp');
	if (![1, 2, 3].includes(Number(item.tier))) problems.push('tier must be 1 (flagship), 2 (feature), or 3 (proof of work)');
	if (item.expiresAt !== undefined && !Number.isFinite(Date.parse(item.expiresAt))) problems.push('expiresAt must be an ISO-8601 timestamp');
	// `quotes` is the numeric id of the post this one quotes. X takes the id, not
	// the URL, so a pasted status link is rejected here rather than at publish.
	if (item.quotes !== undefined) {
		if (item.kind !== 'post') problems.push('quotes is only for post items; an article already quotes itself');
		if (!/^[0-9]{5,25}$/.test(String(item.quotes))) problems.push('quotes must be a post id (digits only), not a URL');
	}
	if (item.priority !== undefined && !(Number(item.priority) >= -50 && Number(item.priority) <= 50)) problems.push('priority is an owner boost from -50 to 50');
	// The backlog surfaces a story speaks for, by their ledger keys.
	if (item.covers !== undefined && !(Array.isArray(item.covers) && item.covers.every((key) => typeof key === 'string' && /^(\/|@|workers\/|services\/|[a-z0-9])/.test(key)))) {
		problems.push('covers must list backlog keys such as "/galaxy", "@three-ws/scene-mcp" or "workers/rig"');
	}
	for (const probe of item.probes || []) {
		if (!['api', 'browser', 'command', 'scenario'].includes(probe.type)) problems.push(`probe type ${probe.type} must be api, browser, command, or scenario`);
		if (probe.type === 'scenario' && !item.scenario) problems.push('a scenario probe needs the item to carry a `scenario`');
		if (probe.type === 'api' && !/^https:\/\//.test(String(probe.url || ''))) problems.push('api probes need an https url');
		if (probe.type === 'command' && !Array.isArray(probe.argv)) problems.push('command probes need an argv array');
	}

	if (item.kind === 'post') {
		if (!item.posts?.length) problems.push('a post item needs at least one post');
		else {
			if (!item.textOnly && !item.posts[0].media?.length) {
				problems.push('head post has no media; attach an image, GIF, or video, or set "textOnly": true on purpose');
			}
			problems.push(...postProblems(item, root, { headMinimum: 100, headNeedsUrl: true, maximum }));
		}
	}
	if (item.kind === 'article') {
		problems.push(...articleProblems(item, root));
		// Follow-up posts quote the published Article, so the Article itself is
		// the link and the head may be short.
		if (item.posts?.length) problems.push(...postProblems(item, root, { headMinimum: 40, headNeedsUrl: false, maximum }));
	}

	// Editorial standards that can be judged offline block at every stage.
	const articleText = articleProse(root, item);
	const texts = [item.kind === 'article' ? item.article?.title : null, ...(item.posts || []).map((post) => post.text)].filter(Boolean);
	for (const text of texts) {
		for (const finding of languageProblems(text)) if (finding.severity === 'blocking') problems.push(`${finding.rule}: ${finding.message}`);
	}
	if (articleText) {
		for (const finding of languageProblems(articleText, { body: true })) if (finding.severity === 'blocking') problems.push(`article body ${finding.rule}: ${finding.message}`);
	}
	for (const finding of claimProblems(item, { articleText })) if (finding.severity === 'blocking') problems.push(`${finding.rule}: ${finding.message}`);

	// A scenario is the item's claim that the feature works. It has to be
	// runnable as written, it has to be the item's probe, and the reel on the
	// head post has to be the one a passing run of it filmed.
	if (item.scenario !== undefined) {
		problems.push(...scenarioProblems(item.scenario).map((problem) => `scenario: ${problem}`));
		if (!(item.probes || []).some((probe) => probe.type === 'scenario')) problems.push('scenario: declare { "type": "scenario" } in probes so every review runs it again');
		if (['review', 'approved'].includes(item.status)) problems.push(...proofProblems(item, root, now).map((problem) => `proof: ${problem}`));
	}
	// A card, GIF, or key art in front of the reel has to be built from it.
	problems.push(...headProblems(item, root).map((problem) => `head: ${problem}`));

	// Approval is only real while a passing review covers these exact bytes.
	if (item.status === 'approved') problems.push(...approvalProblems(item, root, now).map((problem) => `review: ${problem}`));
	return problems;
}

export function headText(item) {
	return item.kind === 'article' ? `${item.article?.title || ''}\n${item.posts?.[0]?.text || ''}` : item.posts?.[0]?.text || '';
}

export function validateQueue(queue, root, { state = null, now = Date.now() } = {}) {
	const problems = {};
	const notes = [];
	const ids = new Set();
	for (const item of queue.items || []) {
		const list = validateItem(item, root, { quality: queue.quality || {}, now });
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
