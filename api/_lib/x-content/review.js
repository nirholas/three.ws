// Review records: the proof that an item passed the editorial bar, bound to the
// exact bytes that were reviewed.
//
// `npm run x:content -- review <id>` runs the whole bar (voice lint, editorial
// lint, media quality, live verification, the AI editor) and writes
// data/x-content/reviews/<id>.json. An item can only be `approved` while a
// passing record exists whose content hash matches the item as it is now, so
// changing one word, swapping an image, or editing a claim after review voids
// the approval until it is reviewed again. Records ship in the image, and the
// production cron enforces the same rule.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { claimProblems, languageProblems, mediaQualityProblems } from './editorial.js';
import { copyProblems, maxLengthOf } from './quality.js';
import { buildReviewRequest, reviewWithEditor } from './editor.js';
import { itemTexts, verifyItem } from './verify.js';
import { bestPosts, outcomesStore } from './outcomes.js';
import { articleProse, loadArticle } from './queue.js';

export const REVIEW_MAX_AGE_DAYS = 14;
export const reviewPath = (id) => `data/x-content/reviews/${id}.json`;

const fileHash = (root, path) => {
	const absolute = resolve(root, String(path || ''));
	return path && existsSync(absolute) ? createHash('sha256').update(readFileSync(absolute)).digest('hex') : null;
};

// An Article's inline images, so replacing one makes its review stale even
// though the Markdown that names it did not change.
function articleImages(root, item) {
	if (!item.article?.body || !existsSync(resolve(root, item.article.body))) return [];
	return loadArticle(root, item.article).images.map((image) => ({ path: image.path, alt: image.caption || null }));
}

export function contentHash(item, root) {
	const media = (row) => ({ path: row.path, sha256: fileHash(root, row.path), alt: row.alt || null, probe: row.probe || null });
	const subject = {
		kind: item.kind,
		posts: (item.posts || []).map((post) => ({ text: String(post.text || '').trim(), media: (post.media || []).map(media) })),
		article: item.kind === 'article'
			? { title: item.article?.title, body: fileHash(root, item.article?.body), cover: item.article?.cover ? media(item.article.cover) : null, images: articleImages(root, item).map(media) }
			: null,
		claims: item.claims || [],
		mentions: item.mentions || {},
		probes: item.probes || [],
		// Absent on an item with no scenario, so the hash of every item reviewed
		// before scenarios existed is unchanged.
		scenario: item.scenario,
	};
	return createHash('sha256').update(JSON.stringify(subject)).digest('hex');
}

export function loadReview(root, id) {
	const path = resolve(root, reviewPath(id));
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

// Offline lint for every post in an item, as structured findings.
export function lintItem(item, { maximum, articleText = '' } = {}) {
	const findings = [];
	(item.posts || []).forEach((post, index) => {
		const where = index === 0 ? 'head' : `reply ${index}`;
		for (const problem of languageProblems(post.text)) findings.push({ where, ...problem });
		for (const message of copyProblems(post.text, { minimum: 1, maximum, requireUrl: false })) findings.push({ where, rule: 'voice', severity: 'blocking', message });
	});
	if (item.kind === 'article' && item.article?.title) {
		for (const problem of languageProblems(item.article.title)) findings.push({ where: 'article title', ...problem });
	}
	if (item.kind === 'article' && articleText) {
		for (const problem of languageProblems(articleText, { body: true })) findings.push({ where: 'article body', ...problem });
	}
	for (const problem of claimProblems(item, { articleText })) findings.push({ where: 'claims', ...problem });
	return findings;
}

// Why an approved item may not be published, or [] when it may.
export function approvalProblems(item, root, now = Date.now()) {
	const record = loadReview(root, item.id);
	if (!record) return [`no editorial review on record; run \`npm run x:content -- review ${item.id}\``];
	const problems = [];
	if (record.contentHash !== contentHash(item, root)) problems.push('the copy, media, or claims changed after the last review; review it again');
	const age = (now - Date.parse(record.reviewedAt)) / 86_400_000;
	if (age > REVIEW_MAX_AGE_DAYS) problems.push(`the review is ${Math.floor(age)} days old; facts drift, so review it again`);
	if (!record.passed) problems.push(`the last review did not pass: ${record.blockers.slice(0, 3).join('; ')}`);
	return problems;
}

// A review runs fine without the measured posts; it is only calibrated worse.
async function calibrationPosts(env) {
	if (!env.DATABASE_URL) return null;
	try {
		return bestPosts((await outcomesStore().load()).posts);
	} catch {
		return null;
	}
}

// The chain's error lists every rung on its own line. A blocker is one line,
// and it keeps them all, because which rung failed and why is the only thing
// the operator can act on.
export function editorFailure(message) {
	if (!message) return 'the AI editor did not run';
	return `the AI editor did not run: ${String(message).replace(/:?\s*\n\s*/g, (gap) => (gap.startsWith(':') ? ': ' : '; ')).trim()}`;
}

export async function reviewItem(item, { root, glossary = [], quality = {}, env = process.env, skipEditor = false }) {
	const maximum = maxLengthOf(quality);
	const lint = lintItem(item, { maximum, articleText: articleProse(root, item) });
	for (const [index, post] of (item.posts || []).entries()) {
		for (const problem of await mediaQualityProblems(post, root)) lint.push({ where: index === 0 ? 'head' : `reply ${index}`, ...problem });
	}
	if (item.kind === 'article' && item.article?.cover) {
		for (const problem of await mediaQualityProblems({ text: item.article.title, media: [{ alt: item.article.title, ...item.article.cover }] }, root)) {
			lint.push({ where: 'article cover', ...problem });
		}
	}
	const verification = await verifyItem(item, { root, glossary, env });
	// An unreachable editor is a blocker, not a crash. The lint and the live
	// verification are the expensive half of a review and they are already done
	// by this point; throwing them away leaves the operator with no record of
	// the problems a model was never needed to find.
	let editorError = null;
	let editor = null;
	if (!skipEditor) {
		try {
			editor = await reviewWithEditor(await buildReviewRequest(item, { root, verification, lint, maximum, calibration: await calibrationPosts(env) }), env);
		} catch (err) {
			editorError = err.message;
		}
	}

	const blockers = [
		...lint.filter((row) => row.severity === 'blocking').map((row) => `${row.where}: ${row.message}`),
		...verification.checks.filter((check) => !check.ok).map((check) => `${check.kind} ${check.target}: ${check.detail}`),
	];
	if (editor) {
		for (const issue of editor.issues.filter((row) => row.severity === 'blocking')) blockers.push(`editor (${issue.area}): ${issue.problem}`);
		const overridden = item.editorOverride?.reason && editor.verdict === 'revise' && !editor.issues.some((row) => row.severity === 'blocking');
		if (editor.verdict !== 'publish' && !overridden) blockers.push(`editor verdict is ${editor.verdict}`);
	} else {
		blockers.push(editorFailure(editorError));
	}

	// The editor's rewrite is a draft like any other: lint it, and list every
	// number or absolute it introduced that no claim covers.
	if (editor?.rewrite?.posts?.length) {
		const draft = { ...item, posts: editor.rewrite.posts.map((text) => ({ text })) };
		editor.rewriteFindings = [
			...lintItem(draft, { maximum }).filter((row) => row.severity === 'blocking').map((row) => `${row.where}: ${row.message}`),
		];
	}

	const record = {
		id: item.id,
		contentHash: contentHash(item, root),
		reviewedAt: new Date().toISOString(),
		passed: blockers.length === 0,
		blockers,
		texts: itemTexts(item),
		lint,
		verification,
		editor,
		editorError,
	};
	const path = resolve(root, reviewPath(item.id));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(record, null, '\t')}\n`);
	return record;
}
