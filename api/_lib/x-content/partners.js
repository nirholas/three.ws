// The partner spotlight series: one post a day about one of the partners on
// three.ws/partners and one thing three.ws built on that partner, filmed live.
//
// Owner, 2026-10-11: "every day for our autonomous X pipeline we should make a
// post about our partners and the features we built ... make it really in depth
// and strong. once per day."
//
// The registry (data/x-content/partners/<id>.json) is the only source of facts.
// Each partner entry carries the designation exactly as docs/partners.md says to
// state it, the evidence that the designation is live, the phrases that would
// overstate the relationship, and a list of features. Each feature carries a
// scenario that films it working on production, and facts, each with evidence.
//
// This module is pure: it picks what runs next, writes the brief, judges a
// draft, and turns a draft into a queue item. The model call is injected, so
// the whole loop runs offline in tests. scripts/x-partners.mjs films, drafts,
// and hands the item to the queue's own review and approval.
//
// The series lint is what stands in for the owner's eye on a partner's name
// (approval.series in the queue lets these posts out without the owner):
//   designation  the thread states the designation word for word
//   forbidden    no phrase from the partner's forbidden list, in any case
//   tags         no @mention at all: the series names partners in plain text
//   neighbours   another partner is named only where this feature's facts do
//   evidence     every claim is built here from the registry's own evidence;
//                the model writes copy, never a claim

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { claimProblems, languageProblems, mentionsIn } from './editorial.js';
import { headSpecProblems } from './formats.js';
import { copyProblems, copySimilarity, maxLengthOf } from './quality.js';

export const SERIES = 'partners';
export const REGISTRY_DIR = 'data/x-content/partners';
export const HEAD_ROTATION = ['card', 'gif', 'reel', 'art'];
export const PATTERN_ROTATION = ['mechanism', 'walkthrough', 'clip', 'number'];
export const LANES = ['community', 'developer', 'token', 'labs'];
export const MIN_REPLIES = 3;
export const MAX_REPLIES = 5;
export const MIN_FACTS_QUOTED = 3;
export const SIMILARITY_LIMIT = 0.34;

const DAY = 86_400_000;
const slug = /^[a-z0-9][a-z0-9-]{1,40}$/;

// --- registry ----------------------------------------------------------------

export function partnerProblems(partner) {
	const problems = [];
	const where = partner?.id || '(no id)';
	if (!slug.test(String(partner?.id || ''))) problems.push(`${where}: id must be a lowercase slug`);
	if (!String(partner?.name || '').trim()) problems.push(`${where}: name is required`);
	if (!Number.isInteger(partner?.order)) problems.push(`${where}: order must be its position on /partners`);
	if (!String(partner?.designation || '').trim()) problems.push(`${where}: designation is required, as docs/partners.md states it`);
	if (!partner?.designationEvidence?.length) problems.push(`${where}: designationEvidence must show the designation where it is published`);
	if (!/^https:\/\/three\.ws\//.test(String(partner?.page || ''))) problems.push(`${where}: page must be a three.ws URL`);
	if (!Array.isArray(partner?.forbidden)) problems.push(`${where}: forbidden must list the phrases that overstate the relationship`);
	if (!partner?.features?.length) problems.push(`${where}: at least one feature is required`);
	const ids = new Set();
	for (const feature of partner?.features || []) {
		const at = `${where}/${feature?.id || '(no id)'}`;
		if (!slug.test(String(feature?.id || ''))) problems.push(`${at}: id must be a lowercase slug`);
		if (ids.has(feature?.id)) problems.push(`${at}: id is duplicated`);
		ids.add(feature?.id);
		if (!/^https:\/\//.test(String(feature?.surface || ''))) problems.push(`${at}: surface must be an https URL`);
		if (!LANES.includes(feature?.lane)) problems.push(`${at}: lane must be one of ${LANES.join(', ')}`);
		if (!String(feature?.summary || '').trim()) problems.push(`${at}: summary is required`);
		if (!feature?.scenario?.steps?.length) problems.push(`${at}: a scenario is required; every spotlight is filmed`);
		if (!(feature?.facts?.length >= MIN_FACTS_QUOTED)) problems.push(`${at}: needs at least ${MIN_FACTS_QUOTED} facts`);
		for (const fact of feature?.facts || []) {
			if (!String(fact?.says || '').trim() || !fact?.evidence?.length) problems.push(`${at}: every fact needs says and evidence`);
		}
	}
	return problems;
}

export function loadPartners(root, dir = REGISTRY_DIR) {
	const path = resolve(root, dir);
	if (!existsSync(path)) return [];
	return readdirSync(path)
		.filter((name) => name.endsWith('.json'))
		.map((name) => JSON.parse(readFileSync(resolve(path, name), 'utf8')))
		.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

// --- rotation ----------------------------------------------------------------

// Every spotlight the account has queued or sent, oldest first. An item names
// its partner and feature in `spotlight`, so the rotation never has to guess
// from copy.
export function spotlights(items) {
	return (items || [])
		.filter((item) => item?.series === SERIES && item.spotlight?.partner)
		.map((item) => ({ id: item.id, ...item.spotlight, day: String(item.notBefore || '').slice(0, 10), status: item.status }))
		.sort((left, right) => left.day.localeCompare(right.day) || left.id.localeCompare(right.id));
}

const lastIndex = (rows, match) => {
	for (let index = rows.length - 1; index >= 0; index--) if (match(rows[index])) return index;
	return -1;
};

// The least recently featured partner, in page order on a tie, then its least
// recently featured feature. A head format and a pattern that the last
// spotlights did not use, so a week of the series never looks like one post.
export function pickNext(partners, history, { exclude = [] } = {}) {
	const usable = partners.filter((partner) => !exclude.includes(partner.id) && partner.features?.length);
	if (!usable.length) return null;
	const partner = [...usable].sort((left, right) => lastIndex(history, (row) => row.partner === left.id) - lastIndex(history, (row) => row.partner === right.id) || left.order - right.order)[0];
	const feature = [...partner.features]
		.map((row, index) => ({ row, index, last: lastIndex(history, (spot) => spot.partner === partner.id && spot.feature === row.id) }))
		.sort((left, right) => left.last - right.last || left.index - right.index)[0].row;
	const recent = history.slice(-(HEAD_ROTATION.length - 1));
	const head = HEAD_ROTATION.map((as, index) => ({ as, index, last: lastIndex(recent, (row) => row.head === as) })).sort((left, right) => left.last - right.last || left.index - right.index)[0].as;
	const counted = (feature.facts || []).some((fact) => /\d/.test(fact.says));
	const patterns = PATTERN_ROTATION.filter((pattern) => pattern !== 'number' || counted);
	const pattern = patterns.map((name, index) => ({ name, index, last: lastIndex(recent, (row) => row.pattern === name) })).sort((left, right) => left.last - right.last || left.index - right.index)[0].name;
	return { partner, feature, head, pattern };
}

// The day the next spotlight runs: the first day from `now` that no spotlight
// already holds. The series slot takes one a day, and each spotlight waits for
// its own day, so the rotation goes out in the order it was written.
export function nextDay(history, now = Date.now()) {
	const taken = new Set(history.filter((row) => row.status !== 'paused').map((row) => row.day));
	for (let at = now; ; at += DAY) {
		const day = new Date(at).toISOString().slice(0, 10);
		if (!taken.has(day)) return day;
	}
}

export const spotlightId = (partner, feature, day) => `partner-${partner.id}-${feature.id}-${day.replace(/-/g, '')}`.slice(0, 80);

// --- brief and prompt ----------------------------------------------------------

const PATTERN_GUIDE = {
	mechanism: 'Lead with how it works: what the partner technology does inside the feature, in one plain sentence a newcomer follows.',
	walkthrough: 'Lead with the first thing a person does on the surface and what they get back, then follow that one path through the thread.',
	clip: 'The reel shows the feature running live. Write what the reel cannot say on its own: what is happening under the frame and why the partner makes it possible.',
	number: 'Lead with the strongest number among the facts, and what it is a number of. Use it exactly as the fact states it.',
};

const LANE_GUIDE = {
	community: 'For people who use three.ws and hold $THREE: plain words, no API names unless they are the point.',
	developer: 'For engineers who will open the code: name the real endpoint, package, format or model.',
	token: 'For people who follow the agent economy: say what the mechanism does, never what anything will be worth.',
	labs: 'For people who like early, well-made work: be specific about what is new.',
};

const HEAD_GUIDE = {
	reel: 'The head post carries the filmed reel itself.',
	gif: 'The head post carries a short looping GIF cut from the reel; the full reel rides on reply 1. Never mention this in the copy.',
	card: 'The head post carries a card: your headline (two short lines, under 60 characters, split with \\n) and body (one sentence, under 160 characters) beside a frame of the reel. The full reel rides on reply 1. Any number on the card must also appear in the thread. Never mention the card or the reel in the copy.',
	art: 'The head post carries AI-generated key art, labelled as such, from your art prompt (what the image shows, in one paragraph: subject, composition, light; never text, logos or brand marks), with your headline and body. The full reel rides on reply 1. Never mention the art or the reel in the copy.',
};

export function buildBrief({ partner, feature, head, pattern, day, proof = null, docs = {}, otherPartners = [] }) {
	return {
		series: SERIES,
		day,
		partner: {
			name: partner.name,
			designation: partner.designation,
			page: partner.page,
			guidance: partner.guidance,
			forbidden: partner.forbidden,
		},
		feature: {
			title: feature.title,
			surface: feature.surface,
			lane: feature.lane,
			summary: feature.summary,
			facts: feature.facts.map((fact) => fact.says),
			reel: (feature.scenario.steps || []).map((step) => step.caption).filter(Boolean),
			measured: proof?.facts || {},
		},
		head,
		pattern,
		docs,
		otherPartners: otherPartners.map((row) => row.name),
	};
}

export const SYSTEM = `You write the daily partner spotlight for @trythreews, the X account of three.ws, a platform for 3D AI agents: avatars, a web component, agent wallets on Solana, and the $THREE token. Each day the account features one partner listed on three.ws/partners and one thing three.ws built on that partner's technology. The feature was filmed working on production today; the reel is attached to the thread.

You are given a brief. It is the only source of facts you have. Do not add anything that is not in it, do not guess at numbers, and do not describe behaviour it does not record.

What the thread is:
- A head post and {MIN} to {MAX_REPLIES} replies. In depth: the reader should finish knowing what the feature does, how the partner's technology makes it work, what a person or an agent does with it, and where to try it.
- The head names the partner in plain words, says what three.ws built, and links the feature surface (the brief's feature.surface, written without https://). Open with the strongest true statement; the first 280 characters must stand on their own.
- One reply states the relationship using the designation exactly as the brief gives it, word for word, with the same capitals, and links the partner page (the brief's partner.page, without https://). Thank the partner warmly and specifically for what their technology makes possible.
- The other replies go deeper: the mechanism, one concrete path a user takes, what an agent can do with it, and what is new. Each reply carries one idea.
- Use at least {FACTS} of the brief's feature.facts word for word, exactly as written, because each is checked against its evidence. Weave each one into your own sentence as plain prose: never put a fact in quotation marks, and never present it as a quote. Every number, ordinal and absolute word (first, only, every, never, all, free, zero, instant) must appear inside a quoted fact, inside the designation, or inside a measured value from feature.measured. If you cannot support a number, leave it out.
- Positive framing only. Nothing about what is missing, late, broken, or limited.

Hard rules, each enforced by a machine after you answer:
- Each post is at most {MAX} weighted characters; a URL counts as 23. The head is at least 100.
- Each post carries at most one link, and X reads the bare name three.ws as a link. In a post that links, say "we" or "our" for the platform instead of writing three.ws a second time.
- No @mentions anywhere. Name partners in plain text.
- Never use any phrase in the brief's partner.forbidden list, in any form. Never say or imply that the partner endorses, sponsors, invests in, or recommends three.ws or $THREE, and never upgrade the designation into something bigger.
- Do not name any company in the brief's otherPartners list unless one of the feature facts names it.
- No hashtags, no emoji, no em-dashes or en-dashes, no stacked exclamation marks, no more than one all-caps word, no thread counters like 1/5.
- No launch-deck openers (Introducing, We are excited, Say hello to, Meet the new, Big news), no rhetorical question first, no teaser that withholds the point.
- No hype or filler: game-changer, revolutionary, seamless, powerful, robust, innovative, cutting-edge, world-class, leverage, empower, unleash, elevate, harness, journey, supercharge, delve, very, really, simply, literally, actually, basically, truly, incredibly, amazing, awesome, groundbreaking.
- No crypto slang, no engagement asks, nothing that reads as investment advice or a price promise.
- Names written exactly: three.ws, $THREE, X (never Twitter), GitHub, JavaScript, TypeScript, OpenAI, NVIDIA, Solana, glTF, GLB, API, MCP, AI.

- The brief's head field says what media sits where. It is for you, never for the reader: do not mention the reel, the card, the GIF, the image, or which post carries what.

Respond with a single JSON object and nothing else:
{"post":"the head post","thread":["reply 1","reply 2","reply 3"],"headline":"card or art headline, two short lines split with \\n","body":"one sentence for the card","prompt":"art prompt, only when the head is art, else empty","why":"two sentences for the editor: what the thread leads on and why it is the strongest true thing about this feature"}`;

export function buildDraftRequest(brief, { voice = null, exemplar = null, findings = [], previous = null, maximum = 1000 } = {}) {
	const guidance = [
		`Pattern: ${brief.pattern}. ${PATTERN_GUIDE[brief.pattern] || PATTERN_GUIDE.mechanism}`,
		`Lane: ${brief.feature.lane}. ${LANE_GUIDE[brief.feature.lane] || LANE_GUIDE.community}`,
		`Head: ${brief.head}. ${HEAD_GUIDE[brief.head]}`,
		`How to describe the relationship: ${brief.partner.guidance}`,
	].join('\n');
	const retry = previous
		? ['## Your previous draft, and why it was rejected', JSON.stringify(previous, null, 2), findings.map((finding) => `- ${finding}`).join('\n'), 'Write it again. Fix every point. Keep what was already true.'].join('\n\n')
		: null;
	const text = [
		`## Brief\n${JSON.stringify(brief, null, 2)}`,
		`## How this one should read\n${guidance}`,
		voice ? `## House voice contract\n${voice}` : null,
		exemplar ? `## The house exemplar (an Article; match its voice and its warmth toward partners, not its length)\n${exemplar}` : null,
		retry,
		'Write the thread now. Respond with the JSON object only.',
	]
		.filter(Boolean)
		.join('\n\n');
	const system = SYSTEM.replace('{MIN}', String(MIN_REPLIES)).replace('{MAX_REPLIES}', String(MAX_REPLIES)).replace('{FACTS}', String(MIN_FACTS_QUOTED)).replace('{MAX}', String(maximum));
	return { system, parts: [{ type: 'text', text }] };
}

export function parseDraft(raw) {
	const text = String(raw || '');
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) throw new Error('drafter returned no JSON object');
	const draft = JSON.parse(text.slice(start, end + 1));
	if (!String(draft.post || '').trim()) throw new Error('drafter returned an empty head post');
	return {
		post: String(draft.post).trim(),
		thread: (Array.isArray(draft.thread) ? draft.thread : []).map((row) => String(row || '').trim()).filter(Boolean),
		headline: String(draft.headline || '').trim(),
		body: String(draft.body || '').trim(),
		prompt: String(draft.prompt || '').trim(),
		why: String(draft.why || '').trim(),
	};
}

// --- claims --------------------------------------------------------------------

const lower = (value) => String(value || '').toLowerCase();

// The ledger, built from the registry and the run, never from the model: a
// fact the copy quotes brings its evidence, the designation brings the page
// that publishes it, and a value the run read brings the run.
export function claimsFor(partner, feature, texts, proof = null) {
	const corpus = lower(texts.join('\n'));
	const claims = [];
	const seen = new Set();
	const add = (says, evidence) => {
		if (!says || seen.has(lower(says)) || !corpus.includes(lower(says))) return;
		seen.add(lower(says));
		claims.push({ says, evidence });
	};
	add(partner.designation, partner.designationEvidence);
	for (const fact of feature.facts || []) add(fact.says, fact.evidence);
	for (const [name, value] of Object.entries(proof?.facts || {})) {
		const said = String(value || '').trim();
		if (said) add(said, [{ type: 'proof', fact: name, equals: said }]);
	}
	return claims;
}

// --- judging a draft ---------------------------------------------------------

const bare = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const linksTo = (text, url) => lower(text).includes(lower(bare(url)));

export function seriesFindings(partner, feature, draft, { partners = [] } = {}) {
	const findings = [];
	const texts = [draft.post, ...draft.thread];
	const corpus = texts.join('\n');
	if (!corpus.includes(partner.designation)) findings.push(`state the relationship as "${partner.designation}", word for word with the same capitals`);
	for (const phrase of partner.forbidden || []) {
		if (lower([corpus, draft.headline, draft.body].join('\n')).includes(lower(phrase))) findings.push(`"${phrase}" overstates the relationship with ${partner.name}; cut it`);
	}
	const tagged = mentionsIn([corpus, draft.headline, draft.body].join('\n'));
	if (tagged.length) findings.push(`${tagged.join(', ')}: the spotlight tags no one; name the partner in plain text`);
	if (!lower(draft.post).includes(lower(partner.name))) findings.push(`the head must name ${partner.name}`);
	if (!linksTo(draft.post, feature.surface)) findings.push(`the head must link ${bare(feature.surface)}`);
	if (!linksTo(corpus, partner.page)) findings.push(`one reply must link ${bare(partner.page)}`);
	if (draft.thread.length < MIN_REPLIES) findings.push(`the thread has ${draft.thread.length} replies; write ${MIN_REPLIES} to ${MAX_REPLIES}`);
	if (draft.thread.length > MAX_REPLIES) findings.push(`the thread has ${draft.thread.length} replies; keep it to ${MAX_REPLIES}`);
	const quoted = (feature.facts || []).filter((fact) => lower(corpus).includes(lower(fact.says)));
	if (quoted.length < MIN_FACTS_QUOTED) findings.push(`the thread quotes ${quoted.length} of the feature facts word for word; quote at least ${MIN_FACTS_QUOTED}`);
	for (const fact of quoted) {
		if (new RegExp(`["\u201c\u2018]\\s*${fact.says.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(corpus)) findings.push(`"${fact.says}" is set in quotation marks; write it as your own plain sentence`);
	}
	if (/\b(?:rides on|this reply|reply \d|the (?:card|gif) (?:above|below))\b/i.test(corpus)) findings.push('the copy talks about where the media sits; say what the feature does instead');
	const allowed = lower([feature.summary, ...(feature.facts || []).map((fact) => fact.says)].join('\n'));
	for (const other of partners.filter((row) => row.id !== partner.id)) {
		const named = new RegExp(`\\b${other.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
		if (named.test(corpus) && !named.test(allowed)) findings.push(`${other.name} is another partner, and this feature's facts do not name it; leave it for its own day`);
	}
	return findings;
}

// Everything wrong with a draft, in the words the model will be shown. Offline,
// so a retry costs one model call.
export function draftFindings({ partner, feature, head, draft, proof = null, partners = [], rivals = [], maximum = 1000 }) {
	const findings = [...seriesFindings(partner, feature, draft, { partners })];
	const texts = [draft.post, ...draft.thread];
	for (const problem of copyProblems(draft.post, { minimum: 100, maximum })) findings.push(`head: ${problem}`);
	draft.thread.forEach((reply, index) => {
		for (const problem of copyProblems(reply, { minimum: 40, maximum, requireUrl: false })) findings.push(`reply ${index + 1}: ${problem}`);
	});
	for (const text of [...texts, draft.headline, draft.body].filter(Boolean)) {
		for (const finding of languageProblems(text)) if (finding.severity !== 'minor') findings.push(`${finding.rule}: ${finding.message}`);
	}
	const claims = claimsFor(partner, feature, texts, proof);
	for (const finding of claimProblems({ posts: texts.map((text) => ({ text })), claims, mentions: {} })) {
		if (finding.severity === 'blocking') findings.push(`${finding.rule}: ${finding.message}. Quote a fact from the brief that contains it, or leave it out`);
	}
	if (head !== 'reel') {
		const spec = specFor(head, draft);
		for (const problem of headSpecProblems({ kind: 'post', scenario: feature.scenario, head: spec, posts: texts.map((text) => ({ text })) })) findings.push(problem);
	}
	for (const rival of rivals) {
		const score = copySimilarity(draft.post, rival);
		if (score >= SIMILARITY_LIMIT) {
			findings.push(`the head reads like an earlier post (similarity ${score.toFixed(2)}): "${rival.slice(0, 110)}". Lead on a different fact.`);
			break;
		}
	}
	return [...new Set(findings)];
}

export function specFor(head, draft) {
	if (head === 'reel') return { as: 'reel' };
	if (head === 'gif') return { as: 'gif' };
	const spec = { as: head, headline: draft.headline };
	if (draft.body) spec.body = draft.body;
	if (head === 'art') spec.prompt = draft.prompt;
	return spec;
}

// Drafts until the machine checks pass or the attempts run out. `call` is
// callModelChain or a stand-in with its signature.
export async function draftSpotlight(brief, context, { call, voice = null, exemplar = null, attempts = 3, maximum = 1000 } = {}) {
	const tries = [];
	let previous = null;
	let findings = [];
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const request = buildDraftRequest(brief, { voice, exemplar, findings, previous, maximum });
		const { value, model } = await call(request, { parse: parseDraft });
		findings = draftFindings({ ...context, head: brief.head, draft: value, maximum });
		tries.push({ attempt, model, findings });
		if (!findings.length) return { ok: true, draft: value, model, attempts: tries };
		previous = value;
	}
	return { ok: false, draft: previous, model: tries.at(-1)?.model, attempts: tries, findings };
}

// --- the queue item -----------------------------------------------------------

// The item a passing draft becomes. Tier 1 because it names a partner; the
// series slot and approval.series carry it from there.
export function itemFor({ partner, feature, head, pattern, day, draft, proof = null }) {
	const texts = [draft.post, ...draft.thread];
	const item = {
		id: spotlightId(partner, feature, day),
		status: 'draft',
		kind: 'post',
		tier: 1,
		series: SERIES,
		spotlight: { partner: partner.id, feature: feature.id, head, pattern },
		lane: feature.lane,
		pattern,
		notBefore: `${day}T00:00:00.000Z`,
		covers: feature.covers?.length ? feature.covers : undefined,
		scenario: feature.scenario,
		probes: [{ type: 'scenario' }, ...(feature.probes || [])],
		posts: texts.map((text) => ({ text })),
		claims: claimsFor(partner, feature, texts, proof),
		mentions: {},
	};
	if (head !== 'reel') item.head = specFor(head, draft);
	if (!item.covers) delete item.covers;
	return item;
}

export const maximumLength = (quality) => maxLengthOf(quality || {});
