// The drafter: evidence brief in, one publishable post out.
//
// This is the step that used to be a person. It is not a template, and the
// difference matters: 300 posts from one template converge on one shape, an
// audience learns the shape, and the announcements that matter get skipped with
// the rest (docs/announce-voice.md measures why). So the model writes each post
// from that surface's own facts, and everything a template would have
// guaranteed is enforced afterwards instead, by the same checks that gate the
// queue:
//
//   voice        api/_lib/x-content/quality.js   openers, hype, hashtags, length
//   editorial    api/_lib/x-content/editorial.js brand, compliance, claims, tags
//   evidence     the claims may only cite this brief's candidates, each of
//                which was harvested from the live page or a repo file, so
//                verification passes by construction rather than by luck
//   repetition   the account's own archive and the rest of the queue
//
// Failures are fed back to the model verbatim and it writes again, up to
// `attempts`. A draft that still fails is returned with its findings rather
// than written into the queue: this module never decides that something is good
// enough.

import { callModelChain } from '../x-content/llm.js';
import { copyProblems, copySimilarity, weightedLength } from '../x-content/quality.js';
import { claimProblems, languageProblems } from '../x-content/editorial.js';
import { loadHistory } from '../x-content/queue.js';
import { TIERS } from './plan.js';

export const TARGET_BAND = [100, 179];

const PATTERN_GUIDE = {
	mechanism: 'Lead with how the thing actually works. The reader should finish the first sentence knowing what happens when they use it.',
	clip: 'The media is a motion loop of the product running. Write the sentence the loop cannot say: what is happening, and why it is hard.',
	number: 'Lead with the measured number and what it is a number of. The number must come from a claim with evidence.',
	correction: 'Lead with the assumption a reader would reasonably hold, then the fact that replaces it. Never invent the assumption: it has to be the obvious one.',
	walkthrough: 'Lead with the first move a user makes and what they get back. One concrete path, not a feature list.',
};

const LANE_GUIDE = {
	community: 'Written for people who use three.ws and hold $THREE. Plain language, no API names unless they are the point.',
	developer: 'Written for engineers who will read the code. Name the real endpoint, format, or package.',
	token: 'Written for people who follow the agent economy and $THREE. Say what the mechanism does with money. Never say what anything will be worth.',
	labs: 'Written for people who like seeing something unfinished done well. Be specific about what is experimental.',
};

export const SYSTEM = `You write posts for @trythreews, the X account of three.ws, a platform for 3D AI agents: avatars, a web component, agent wallets on Solana, and the $THREE token. You are given an evidence brief for one product surface that has shipped and has never been posted about. Write the post that announces it.

The brief is the only source of facts you have. Do not add anything that is not in it, do not guess at numbers, and do not describe behaviour it does not record.

Hard rules, each enforced by a machine after you answer:
- 100 to 179 weighted characters is the target band, 280 is the hard wall. A URL always counts as 23 characters however long it is.
- Exactly one link, to the surface itself, and it must appear in the head post.
- No hashtags, no emoji, no em-dashes or en-dashes, no stacked exclamation marks, no more than one all-caps word.
- No launch-deck openers (Introducing, We are excited, Say hello to, Meet the new, Big news, Today we are launching), no rhetorical question as the first sentence, no one-word-sentence drumbeat, no teaser that withholds the point, no thread counter.
- No hype or filler vocabulary: game-changer, revolutionary, seamless, powerful, robust, innovative, cutting-edge, world-class, leverage, empower, unleash, elevate, harness, journey, supercharge, delve, very, really, simply, literally, actually, basically, truly, incredibly, amazing, awesome, groundbreaking.
- No crypto slang (gm, wagmi, lfg, ser, frens, degens, based, cooking, ngl, tbh) and no engagement asks (check this out, follow us, link in bio, tag a friend, drop a).
- Nothing that reads as investment advice or a price promise. Say what the product does, never what a token will be worth.
- Names are written exactly: three.ws, $THREE, X (never Twitter), GitHub, JavaScript, TypeScript, OpenAI, NVIDIA, Solana, glTF, GLB, API, MCP, AI.
- Every number, ordinal, and absolute word (first, only, every, never, fastest, instant, unlimited, zero) in your copy must sit inside a claim you declare, and every claim must quote your own copy word for word and cite evidence from the brief's evidenceCandidates list, unchanged. Copy the candidate's fields exactly; do not invent a new one, do not edit its text. If you cannot support a number, write the post without it.
- @mentions only for an account the surface genuinely runs on, at most two, each with the reason recorded. The brief's partner field is a suggestion, not a licence: drop it if the brief does not show the surface really runs on them.
- Alt text describes what is in the image for someone who cannot see it, at least 60 characters, and does not repeat the post or open with "image of".

Declare at least one feature probe in \`probes\`, and prove the feature works rather than that its page loads. An \`api\` probe is the cheap one and the only kind re-run seconds before publishing: {"type":"api","name":"what it proves","url":"https://three.ws/api/...","expect":{"json":{"path":"a.b","min":1}}}, drawn from the brief's \`endpoints\` list. A \`browser\` probe drives the live route: {"type":"browser","name":"what it proves","steps":[{"goto":"the brief's url"},{"click":"visible button text"},{"expect":"text that only appears once it worked"}]}. Use only routes and endpoints the brief names.

The same announcement also goes to the community Telegram channel, which has no character limit and a slightly longer register. Write that version too: two to four sentences, the same facts, no hashtags, no emoji, no dashes, and the same link.

Respond with a single JSON object and nothing else:
{"post":"...","thread":["optional reply","optional reply"],"telegram":"...","alt":"...","probes":[{"type":"api","name":"...","url":"..."}],"claims":[{"says":"exact words from your post","evidence":[{...one of the brief's evidenceCandidates, copied exactly...}]}],"mentions":{"@handle":"why the tag is true"},"why":"two sentences for the approver: what the post leads on and why that is the strongest true thing about this surface","headline":"a five to nine word title for the announcement pack"}`;

export function buildDraftRequest(brief, { voice = null, findings = [], previous = null } = {}) {
	const guidance = [
		`Pattern for this post: ${brief.pattern}. ${PATTERN_GUIDE[brief.pattern] || PATTERN_GUIDE.mechanism}`,
		`Lane: ${brief.lane}. ${LANE_GUIDE[brief.lane] || LANE_GUIDE.community}`,
		brief.media?.motion ? 'The attached media is an animated loop captured from the live route.' : 'The attached media is a still frame captured from the live route.',
	].join('\n');

	const retry = previous
		? [
			'## Your previous draft, and why it was rejected',
			JSON.stringify(previous, null, 2),
			findings.map((finding) => `- ${finding}`).join('\n'),
			'Write it again. Fix every point. Keep what was already true.',
		].join('\n\n')
		: null;

	const text = [
		`## Evidence brief\n${JSON.stringify(brief, null, 2)}`,
		`## How this one should read\n${guidance}`,
		voice ? `## House voice contract\n${voice}` : null,
		retry,
		'Write the post now. Respond with the JSON object only.',
	]
		.filter(Boolean)
		.join('\n\n');
	return { system: SYSTEM, parts: [{ type: 'text', text }] };
}

export function parseDraft(raw) {
	const text = String(raw || '');
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) throw new Error('drafter returned no JSON object');
	const draft = JSON.parse(text.slice(start, end + 1));
	if (!String(draft.post || '').trim()) throw new Error('drafter returned an empty post');
	if (!String(draft.alt || '').trim()) throw new Error('drafter returned no alt text');
	draft.thread = Array.isArray(draft.thread) ? draft.thread.filter((row) => String(row || '').trim()) : [];
	draft.telegram = String(draft.telegram || '').trim();
	draft.claims = Array.isArray(draft.claims) ? draft.claims : [];
	draft.probes = Array.isArray(draft.probes) ? draft.probes.filter((probe) => probe && probe.type) : [];
	draft.mentions = draft.mentions && typeof draft.mentions === 'object' ? draft.mentions : {};
	return draft;
}

// The queue item a draft becomes. Written here so the checks below judge exactly
// what would be published, not an approximation of it.
export function itemFor(brief, draft, { mediaPath, probe = null, status = 'draft' }) {
	const media = [{ path: mediaPath, alt: String(draft.alt || '').trim(), ...(probe ? { probe } : {}) }];
	return {
		id: brief.id,
		status,
		kind: 'post',
		// The queue refuses an item without a tier, and the publisher gives each
		// tier a slot of its own, so the plan's tier travels with the item
		// rather than being re-guessed here.
		tier: TIERS.includes(Number(brief.tier)) ? Number(brief.tier) : 2,
		lane: brief.lane,
		pattern: brief.pattern,
		notBefore: brief.notBefore,
		source: { path: `docs/announcements/${brief.id}.md`, url: brief.url || undefined },
		posts: [
			{ text: String(draft.post || '').trim(), textFrom: `docs/announcements/${brief.id}.post.txt`, media },
			...draft.thread.map((text) => ({ text: String(text).trim() })),
		],
		claims: draft.claims,
		mentions: draft.mentions,
		// The review bar refuses an item with no feature probe, so the drafter
		// declares one and it travels into the item. Without this every pack the
		// factory produced failed review for the same missing field.
		probes: Array.isArray(draft.probes) ? draft.probes : [],
	};
}

const candidateKey = (evidence) => JSON.stringify([evidence.type, evidence.url || evidence.path || '', evidence.contains || evidence.matches || '']);

// Everything wrong with a draft, in the words the model will be shown. Offline:
// no network, so a retry costs one model call and nothing else.
export function draftFindings(brief, draft, { root = null, otherHeads = [] } = {}) {
	const findings = [];
	const head = String(draft.post || '').trim();
	const weight = weightedLength(head);

	for (const problem of copyProblems(head, { minimum: TARGET_BAND[0] })) findings.push(`head: ${problem}`);
	if (weight > TARGET_BAND[1] && weight <= 280) findings.push(`head is ${weight} weighted characters; the measured band is ${TARGET_BAND[0]} to ${TARGET_BAND[1]}, so tighten it unless the mechanism needs the room`);
	for (const reply of draft.thread) for (const problem of copyProblems(reply, { minimum: 40, requireUrl: false })) findings.push(`reply: ${problem}`);

	const texts = [head, ...draft.thread];
	for (const text of texts) {
		for (const finding of languageProblems(text)) if (finding.severity !== 'minor') findings.push(`${finding.rule}: ${finding.message}`);
	}
	for (const finding of claimProblems({ posts: texts.map((text) => ({ text })), claims: draft.claims, mentions: draft.mentions })) {
		if (finding.severity === 'blocking') findings.push(`${finding.rule}: ${finding.message}`);
	}

	// Evidence has to come from the brief, unedited. A model that paraphrases a
	// candidate produces a claim the verifier will fail on the live page.
	const allowed = new Set((brief.evidenceCandidates || []).map(candidateKey));
	for (const claim of draft.claims) {
		for (const evidence of claim.evidence || []) {
			if (!allowed.has(candidateKey(evidence))) {
				findings.push(`claims: evidence ${JSON.stringify(evidence).slice(0, 120)} is not one of the brief's evidenceCandidates; copy a candidate exactly or drop the claim`);
			}
		}
	}

	// Telegram carries the same facts in a longer register. It is not posted by
	// this pipeline, so only the rules that are about truth and house style apply.
	if (draft.telegram) {
		for (const finding of languageProblems(draft.telegram)) {
			if (finding.severity === 'blocking' && finding.rule !== 'links') findings.push(`telegram: ${finding.message}`);
		}
		if (!/three\.ws/.test(draft.telegram)) findings.push('telegram: the longer version must link the surface too');
	}

	const alt = String(draft.alt || '').trim();
	if (alt.length < 60) findings.push(`alt text is ${alt.length} characters; describe what the frame shows`);
	if (/^(?:an? )?(?:image|picture|photo|screenshot) of\b/i.test(alt)) findings.push('alt text opens with "image of"; screen readers already say it is an image');
	if (alt.toLowerCase() === head.toLowerCase()) findings.push('alt text repeats the post');

	if (brief.url && !head.includes(brief.url.replace(/^https?:\/\//, '')) && !head.includes(brief.url)) {
		findings.push(`head must link ${brief.url}, the surface this post is about`);
	}

	const rivals = [...otherHeads, ...(root ? loadHistory(root) : [])];
	for (const rival of rivals) {
		const score = copySimilarity(head, rival);
		if (score >= 0.34) {
			findings.push(`head reads like an existing post (similarity ${score.toFixed(2)}): "${rival.slice(0, 110)}". Lead on a different fact from the brief.`);
			break;
		}
	}
	return findings;
}

export async function draftPost(brief, { root, env = process.env, voice = null, attempts = 3, otherHeads = [] } = {}) {
	const tries = [];
	let previous = null;
	let findings = [];
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const request = buildDraftRequest(brief, { voice, findings, previous });
		const { value, model, fallbacks } = await callModelChain(request, { env, parse: parseDraft });
		findings = draftFindings(brief, value, { root, otherHeads });
		tries.push({ attempt, model, fallbacks, findings, draft: value });
		if (!findings.length) return { draft: value, model, attempts: tries, ok: true };
		previous = value;
	}
	return { draft: tries[tries.length - 1].draft, model: tries[tries.length - 1].model, attempts: tries, ok: false, findings };
}
