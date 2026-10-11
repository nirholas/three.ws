// The AI editor: a senior editorial review of one queue item before a human
// approves it.
//
// Mechanical checks (quality.js, editorial.js, verify.js) catch what can be
// caught mechanically. What they cannot judge is whether the post is any good:
// whether the first line earns the second, whether the image shows what the
// copy claims, whether a sentence is technically true but misleading, whether
// a partner would be comfortable seeing their tag on it. That is this module.
//
// The editor sees what a reader sees (the copy, the images, the alt text), plus
// what a reader cannot: the claims ledger with its live verification results,
// the announcement pack the copy came from, the house voice contract, and the
// account's best-performing posts. It returns a verdict, scores, specific
// issues with fixes, and a rewrite. It never edits the queue: a human decides.
//
// The transport chain it runs on (Vertex, Groq, OpenRouter, OpenAI, NVIDIA NIM)
// is shared with the drafter and lives in llm.js.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mediaType } from './media.js';
import { EDITOR_MODEL, callModelChain } from './llm.js';
import { STANDARD_MAX_LENGTH } from './quality.js';
import { loadProof, reelFrames } from './reel.js';

export { EDITOR_MODEL };
const MAX_SOURCE_CHARS = 24_000;
const MAX_ARTICLE_CHARS = 40_000;

export const SCORE_KEYS = ['accuracy', 'clarity', 'specificity', 'voice', 'professionalism', 'visual'];

const SYSTEM = `You are the editor-in-chief for three.ws, reviewing a post before it goes out on the company's X account @trythreews. three.ws is a platform for 3D AI agents: avatars, a web component, agent wallets on Solana, and the $THREE token. The audience is developers, builders, partners (AWS, NVIDIA, IBM, GitHub), and token holders. Every post is read by enterprise partners as well as the community, so the bar is a top-tier technology company: correct, specific, confident, never hype.

Judge the post on:
- accuracy: every factual statement is supported by the verified evidence you are given. A claim whose verification failed is a blocking issue. A statement that is literally true but leaves a false impression is a blocking issue. Anything the image shows that contradicts the copy (a different number, an old UI) is a blocking issue. The live product is the source of truth: when a screenshot disagrees with the live page or the code, the screenshot is stale, and the fix is to recapture it and use the live number, never to match the copy to the old image. A promise about the future (an event, a merge, a launch) with no evidence is a blocking issue. Credentials and partnerships are stated exactly as the evidence states them: never upgrade "an AWS Partner" to "a verified AWS Partner".
- clarity: a reader who has never heard of three.ws understands what the thing is and does from this post alone.
- specificity: it states a mechanism or a checkable fact, not an adjective. The first line carries the strongest true statement.
- voice: matches the house voice contract exactly (no hashtags, no emoji, no hype openers, no dashes, no rhetorical questions, no teaser threads).
- professionalism: grammar, punctuation, capitalization of names, and tone a partner's comms team would be comfortable being tagged in. Nothing that reads as investment advice or a price promise about $THREE. Tags are only for accounts the feature genuinely runs on.
- visual: the image is sharp, shows the real product, supports the claim, and would not be cropped badly in the timeline; alt text describes what is in the image for someone who cannot see it. When the attachment is a reel you cannot watch it, so you are given still frames from it, the captions it shows in order, and the record of the run it filmed (what the run read off the screen, what the server answered, and how long any wait was cut). Judge whether those frames show the feature doing what the post says, whether each caption is true of the frame it sits under, and whether anything a frame shows contradicts the copy.

The house standard is the keeper X Article (data/x-content/articles/keeper-article.md), and every post is that standard compressed. Hold an Article to the depth the X Article limits allow: a title of 80 to 100 characters carrying the headline number, 2,400 or more words across 8 or more sections, 3,000 or more characters of real code and tables (X allows 10,000), 4 or more inline images, a "The partners behind ..." section thanking every partner on three.ws/partners with its designation stated exactly, and a "Try it" section; a shorter Article is a major issue. Hold an Article to its shape: it opens on one real run told plainly with its real numbers, follows that one job through every stage, explains each stage in plain words before the mechanism, credits the open models it builds on, carries a partners section stating each designation exactly, and ends on the live pages to try. Nothing negative is posted, in an Article or a post: an outage, loss, bug or "limitations" passage is a major issue, and the fix frames it truthfully as a design choice or what is next, or removes it. Positive framing never licenses an unsupported claim; accuracy still comes first.

Score each 1 to 5, where 5 means you would ship it unchanged at a top-tier company and 3 means a competent draft that needs work.

Rules for your output:
- Quote the exact words each issue is about.
- severity "blocking" means it must not be published as is; "major" should be fixed; "minor" is polish.
- Every fix is concrete: the replacement text, or exactly what to recapture.
- The rewrite must obey every rule above, stay within {MAX} weighted characters per post (URLs count as 23), keep the same link, and contain only facts that appear word for word in a passing verification result or in the live page text quoted by a passing check. Do not import facts from the announcement pack that no check verified. If nothing needs to change, return the original text.
- verdict is "publish" only when there are no blocking issues and every score is at least 4; "revise" when fixable; "reject" when the post should not exist (wrong premise, unverifiable core claim, or reputational risk).

Respond with a single JSON object and nothing else:
{"verdict":"publish|revise|reject","scores":{"accuracy":1-5,"clarity":1-5,"specificity":1-5,"voice":1-5,"professionalism":1-5,"visual":1-5},"issues":[{"severity":"blocking|major|minor","area":"accuracy|clarity|specificity|voice|professionalism|visual","quote":"...","problem":"...","fix":"..."}],"rewrite":{"posts":["..."],"altText":["..."]},"summary":"two sentences for the approver"}`;

function readIfExists(root, path, limit) {
	if (!path) return null;
	const absolute = resolve(root, path);
	if (!existsSync(absolute)) return null;
	const text = readFileSync(absolute, 'utf8');
	return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text;
}

function topPosts(root, count = 6) {
	const path = resolve(root, 'data/x-archive/analysis/trythreews-engagement.json');
	if (!existsSync(path)) return [];
	const rows = JSON.parse(readFileSync(path, 'utf8')).report?.top?.byEngagements || [];
	return rows
		.filter((row) => row.isOwn && !row.isRetweet)
		.slice(0, count)
		.map((row) => ({ text: String(row.text || '').replace(/\s+/g, ' ').trim(), likes: row.likes, reposts: row.retweets, views: row.views }));
}

// What a reel is, in words: the editor judges the frames against this.
function reelRecord(item, row, proof) {
	const captions = (item.scenario?.steps || []).map((step) => step.caption).filter(Boolean);
	return [
		`${row.role}: a ${row.probe?.durationSec ?? '?'} second reel, ${row.probe?.width}x${row.probe?.height}, filmed from the live product by running the item's scenario end to end.`,
		`Filmed ${proof?.ranAt || 'at an unknown time'} against ${proof?.target?.commit ? `production commit ${proof.target.commit}` : 'production'}; ${Math.round((proof?.video?.motion || 0) * 100)}% of its frames change.`,
		`Captions, in order: ${JSON.stringify(captions)}.`,
		`The run read off the screen: ${JSON.stringify(proof?.facts || {})}. It waited for and saw: ${JSON.stringify(proof?.saw || [])}. The server answered: ${JSON.stringify(proof?.responses || [])}.`,
		`Waits cut from the film, each labelled in the reel: ${JSON.stringify(proof?.cuts || [])}.`,
		'X accepts alt text on images and GIFs only, so a reel cannot carry one and its absence is not an issue. What a reader who cannot see the reel gets is the post: raise it as a clarity issue if the post alone does not say what the reel shows.',
	].join('\n');
}

// Images go to the model at a readable size. A reel goes as still frames and
// the record of its run; any other video is described by its probe, since the
// editor cannot watch it.
async function imageParts(item, root) {
	const { default: sharp } = await import('sharp');
	const parts = [];
	const media = [
		...(item.kind === 'article' && item.article?.cover ? [{ ...item.article.cover, role: 'Article cover' }] : []),
		...(item.posts || []).flatMap((post, index) => (post.media || []).map((row) => ({ ...row, role: `Post ${index + 1} attachment` }))),
	];
	for (const row of media) {
		const type = mediaType(row.path);
		if (!type || !existsSync(resolve(root, row.path))) continue;
		if (type.kind === 'video' && row.reel) {
			parts.push({ type: 'text', text: reelRecord(item, row, loadProof(root, item.id)) });
			for (const frame of reelFrames({ root, path: row.path })) {
				const buffer = await sharp(frame.buffer).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
				parts.push({ type: 'text', text: `Reel frame at ${frame.atSec} s` });
				parts.push({ type: 'image', data: buffer.toString('base64'), mime: 'image/jpeg' });
			}
			continue;
		}
		if (type.kind === 'video') {
			parts.push({ type: 'text', text: `${row.role}: video ${row.path}, probe ${JSON.stringify(row.probe || {})}. Captions burned in: ${row.captions ? 'yes' : 'unknown'}.` });
			continue;
		}
		const buffer = await sharp(resolve(root, row.path), { animated: false }).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
		// Say where a head came from, so the editor judges a GIF by more than its
		// first frame and knows key art is drawn, not captured.
		const origin = [
			type.kind === 'gif' ? `a looping GIF${row.derived ? ` cut from ${row.derived.from ?? 0} s to ${row.derived.to ?? '?'} s of the reel` : ''}; this is its first frame` : null,
			row.derived && type.kind !== 'gif' ? `a ${row.derived.as} built from a frame of the reel` : null,
			row.generated ? `AI-generated by ${row.generated.model}${row.generated.source ? ' from a real frame of the product' : ''} (prompt: ${JSON.stringify(row.generated.prompt || '')})` : null,
		].filter(Boolean);
		parts.push({ type: 'text', text: `${row.role}: ${row.path}${origin.length ? `, ${origin.join('; ')}` : ''}. Alt text: ${JSON.stringify(row.alt || '')}` });
		parts.push({ type: 'image', data: buffer.toString('base64'), mime: 'image/jpeg' });
	}
	return parts;
}

// `calibration` is the account's best posts as the X API measured them
// (outcomes.js). Without it the editor falls back to the archive report, which
// was scraped before X had loaded the like counts of the largest posts.
export async function buildReviewRequest(item, { root, verification, lint, maximum = STANDARD_MAX_LENGTH, calibration = null }) {
	const voice = readIfExists(root, 'docs/announce-voice.md', MAX_SOURCE_CHARS);
	const source = readIfExists(root, item.source?.path, MAX_SOURCE_CHARS);
	const article = item.kind === 'article' ? readIfExists(root, item.article?.body, MAX_ARTICLE_CHARS) : null;
	const brief = {
		kind: item.kind,
		lane: item.lane,
		pattern: item.pattern,
		posts: (item.posts || []).map((post, index) => ({ position: index + 1, text: post.text })),
		article: item.kind === 'article' ? { title: item.article?.title } : undefined,
		claims: item.claims || [],
		mentions: item.mentions || {},
		verification: verification?.checks || [],
		mechanicalFindings: lint || [],
		sourceUrl: item.source?.url,
	};
	const text = [
		`## Post under review\n${JSON.stringify(brief, null, 2)}`,
		article ? `## Article body (Markdown)\n${article}` : null,
		source ? `## Announcement pack this post came from\n${source}` : null,
		voice ? `## House voice contract\n${voice}` : null,
		`## The account's best-performing posts, for calibration\n${JSON.stringify(calibration?.length ? calibration : topPosts(root), null, 2)}`,
		'Review the post now. Respond with the JSON object only.',
	]
		.filter(Boolean)
		.join('\n\n');
	return { system: SYSTEM.replace('{MAX}', String(maximum)), parts: [{ type: 'text', text }, ...(await imageParts(item, root))] };
}

export function parseReview(raw) {
	const text = String(raw || '');
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) throw new Error('editor returned no JSON object');
	const review = JSON.parse(text.slice(start, end + 1));
	if (!['publish', 'revise', 'reject'].includes(review.verdict)) throw new Error(`editor returned verdict ${review.verdict}`);
	for (const key of SCORE_KEYS) {
		const score = Number(review.scores?.[key]);
		if (!(score >= 1 && score <= 5)) throw new Error(`editor returned no ${key} score`);
		review.scores[key] = score;
	}
	review.issues = Array.isArray(review.issues) ? review.issues : [];
	// The model does not get the last word on its own verdict: a blocking issue
	// or a low score always means revise.
	if (review.verdict === 'publish' && (review.issues.some((issue) => issue.severity === 'blocking') || SCORE_KEYS.some((key) => review.scores[key] < 4))) {
		review.verdict = 'revise';
	}
	return review;
}

export async function reviewWithEditor(request, env = process.env) {
	const { value, model, fallbacks } = await callModelChain(request, { env, parse: parseReview });
	return { ...value, model, fallbacks };
}
