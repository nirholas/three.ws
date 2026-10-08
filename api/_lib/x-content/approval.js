// Who may release a reviewed post: the owner, or the queue's own policy.
//
// Approval used to be one decision made by hand for every post, which is what
// kept a backlog of 300 shipped surfaces at three posts a week. The policy
// hands the owner's attention back to the posts that need it. A post is
// released without the owner only when every one of these holds:
//
//   the queue says so    `approval.mode` is "auto" (anything else is the owner)
//   the tier is listed   flagship posts carry a partner's name or $THREE, so
//                        tier 1 stays with the owner unless the queue lists it
//   it was filmed        the post carries a scenario, and the reel on it is the
//                        one a passing run of that scenario filmed. A post that
//                        was never proven against the product is never released
//                        by policy
//   it tags no one       a tag puts a partner's name next to ours; a person
//                        decides that
//   the review passed    on the editor's own verdict, not on an override
//
// An X Article has its own rule, `approval.articles` (owner, 2026-10-08: one
// Article every two days, released without the owner). An Article is long-form
// writing about how something works, so there is rarely a reel to film; what
// stands in for the reel is the review itself, which re-ran every probe the
// Article declares against production, resolved every link in it, and held
// every sentence of its body to the claims ledger. With `articles` on, an
// Article is not held back by its tier or by having no scenario, and every
// other condition still applies, including a tag anywhere in the body. An
// Article that does carry a scenario must still have a current proof.
//
// A release by policy is never immediate. The post is embargoed for
// `vetoHours`, and the release is written to the ops alerts, so there is always
// a window in which `npm run x:content -- pause <id>` takes it back.

import { proofProblems } from './reel.js';
import { tierOf } from './schedule.js';
import { mentionsIn } from './editorial.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const HOUR = 3_600_000;
export const DEFAULT_APPROVAL = { mode: 'owner', tiers: [2, 3], vetoHours: 24, articles: false };
export const MIN_VETO_HOURS = 1;

export function approvalPolicy(queue) {
	const raw = queue?.approval || {};
	const tiers = Array.isArray(raw.tiers) ? raw.tiers.map(Number).filter((tier) => [1, 2, 3].includes(tier)) : DEFAULT_APPROVAL.tiers;
	const veto = Number(raw.vetoHours);
	return {
		mode: raw.mode === 'auto' ? 'auto' : 'owner',
		tiers,
		vetoHours: Number.isFinite(veto) && veto >= MIN_VETO_HOURS ? veto : DEFAULT_APPROVAL.vetoHours,
		articles: raw.articles === true,
	};
}

// Why this post must wait for the owner, or [] when the policy may release it.
export function policyBlockers(item, record, policy, root, now = Date.now()) {
	if (policy.mode !== 'auto') return ['the queue leaves approval to the owner'];
	const reasons = [];
	const article = item.kind === 'article' && policy.articles;
	if (!article && !policy.tiers.includes(tierOf(item))) reasons.push(`tier ${tierOf(item)} posts are approved by the owner`);
	if (item.scenario) reasons.push(...proofProblems(item, root, now).map((problem) => `proof: ${problem}`));
	else if (!article) reasons.push('it was never filmed against the product');
	const tagged = mentionsIn([...(item.posts || []).map((post) => post.text), ...(item.kind === 'article' ? [item.article?.title, articleBody(item, root)] : [])].filter(Boolean).join('\n'));
	if (tagged.length) reasons.push(`it tags ${tagged.join(', ')}`);
	if (!record?.passed) reasons.push('its review did not pass');
	else if (record.editor?.verdict !== 'publish') reasons.push(`the editor's verdict was ${record.editor?.verdict || 'never given'}`);
	return reasons;
}

function articleBody(item, root) {
	const path = item.article?.body && join(root, item.article.body);
	return path && existsSync(path) ? readFileSync(path, 'utf8') : '';
}

// The embargo a policy release carries: the later of the one the post already
// had and the end of the veto window.
export function vetoUntil(item, policy, now = Date.now()) {
	const existing = Date.parse(item.notBefore);
	const window = now + policy.vetoHours * HOUR;
	return new Date(Math.max(Number.isFinite(existing) ? existing : 0, window)).toISOString();
}

// What the ops alert says about a batch the policy released.
export function releaseDigest(released) {
	const first = released.map((row) => row.notBefore).sort()[0];
	const lines = released.map((row) => `${row.id} (T${row.tier}, from ${row.notBefore.slice(0, 16)}Z): ${row.head.replace(/\s+/g, ' ').slice(0, 120)}`);
	return {
		title: `x-content: ${released.length} post(s) approved by policy`,
		detail: `Nothing goes out before ${first.slice(0, 16)}Z. To take one back: npm run x:content -- pause <id>\n${lines.join('\n')}`,
	};
}
