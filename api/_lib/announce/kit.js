// The pack renderer: one Markdown file per announcement, holding everything a
// person needs to approve it and everything a machine needs to publish it.
//
// The format follows the packs written by hand in docs/announcements/ and the
// campaign kits in marketing/growth/kits/, because those are what the gate
// (scripts/check-announce.mjs) and the reviewers already read: the media table
// is parsed for shot ids, the alt text has to be stated, and the post itself
// lives in a sibling .post.txt so the bytes that are checked are the bytes that
// ship.
//
// Everything in a rendered pack is either a fact from the brief, a decision
// from the plan, or the drafter's own reasoning. Nothing is invented here.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { weightedLength } from '../x-content/quality.js';

// Project names the owner has put under the commit gate (see
// data/announce-gate-terms.json). A changelog title is repository text the pack
// quotes verbatim, so a title naming one of them would pull a gated name into
// a pack that is otherwise clear, and scripts/check-announce.mjs would then
// refuse the pack for a sentence nobody wrote. The quote is context, not a
// claim, so it is left out instead.
function gateTerms(root) {
	const path = resolve(root || process.cwd(), 'data/announce-gate-terms.json');
	if (!existsSync(path)) return [];
	try {
		return (JSON.parse(readFileSync(path, 'utf8')).terms || []).map(String).filter(Boolean);
	} catch {
		return [];
	}
}

export const gated = (text, terms) =>
	terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(String(text || '')));

const SITE = 'https://three.ws';

const SIGNALS = {
	reach: (value) => `sitemap priority ${(value / 20).toFixed(2)}, which is what we already decided this surface is worth`,
	visual: (value) => (value >= 25 ? 'a showcase surface, so its frame can be a motion loop' : 'renders something worth a frame'),
	token: () => 'touches $THREE or the agent economy, the topic band that measured highest in our own archive',
	partner: () => 'names a partner the surface genuinely runs on, so a tag is defensible',
	novelty: () => "on the coverage audit's hand-picked shortlist of strongest candidates",
	depth: () => 'documented in the tree, so there is enough to write a mechanism about and link proof for',
};

const LANE_AUDIENCE = {
	community: 'People who use three.ws and hold $THREE',
	developer: 'Engineers who will read the code',
	token: 'People who follow the agent economy and $THREE',
	labs: 'People who follow the experimental surfaces',
};

const KPI = {
	clip: 'loop completions and profile visits, then route sessions on the day',
	mechanism: 'route sessions and docs reads on the day of the post',
	number: 'replies that quote the number, and route sessions',
	correction: 'replies and quote posts, which is where a correction earns its reach',
	walkthrough: 'route sessions that reach the second step of the flow',
};

const utm = (url, source, medium, campaign, content) =>
	`${url}?utm_source=${source}&utm_medium=${medium}&utm_campaign=${campaign}&utm_content=${content}`;

function evidenceLabel(evidence) {
	if (evidence.type === 'page') return `live page shows "${evidence.contains}"`;
	if (evidence.type === 'file') return `\`${evidence.path}\` contains "${String(evidence.contains).slice(0, 90)}"`;
	if (evidence.type === 'module') return `\`${evidence.path}\` exports ${evidence.export}`;
	return JSON.stringify(evidence);
}

export function renderPostFile(draft) {
	return `${String(draft.post || '').trim()}\n`;
}

export function renderPack({ brief, draft, slot, ledgerEntry = {}, rank = null, total = null, model = null, verification = null, root = process.cwd() }) {
	const id = brief.id;
	const url = brief.url || SITE;
	const campaign = `announce-${id}`;
	const weight = weightedLength(draft.post || '');
	const signals = Object.entries(ledgerEntry.signals || {}).filter(([, value]) => value > 0);
	const shotFile = `/announce/img/${slot.shot}.webp`;

	const lines = [];
	const push = (...rows) => lines.push(...rows);

	push(
		`# Announcement pack: ${draft.headline || ledgerEntry.title || id}`,
		'',
		`**Surface:** [\`${brief.key}\`](${url}) · **Stage:** drafted · **Slot:** ${slot.notBefore.slice(0, 10)} · **Announced externally:** never`,
		'',
		`${rank && total ? `Ranked ${rank} of ${total} never-announced surfaces by \`npm run announce:rank\`` : 'From the announcement backlog'}${ledgerEntry.score ? ` (score ${ledgerEntry.score})` : ''}. ${model && !/^hand/i.test(model) ? `Drafted on ${model} and packed by \`npm run announce:kit\`` : 'Drafted by hand and packed by `npm run announce:kit`'}, from the evidence brief \`data/announce-plan/briefs/${id}.json\` (a local build artifact: \`data/announce-plan/\` is gitignored, so regenerate it with \`npm run announce:kit -- --id ${id} --brief-only\`), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.`,
		'',
		'---',
		'',
		'## At a glance',
		'',
		'| Field | Value |',
		'|---|---|',
		`| Pack id | \`${id}\` |`,
		`| Publish slot | ${slot.notBefore.slice(0, 10)}. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |`,
		`| Lane and pattern | ${brief.lane} / ${brief.pattern} |`,
		`| Audience | ${LANE_AUDIENCE[brief.lane] || LANE_AUDIENCE.community} |`,
		'| Primary channel | X, @trythreews, through the reviewed content queue |',
		'| Secondary channels | Telegram (@three_ws), the surface\'s own docs page |',
		`| Proof | ${url} |`,
		`| Tracked links | Telegram \`${utm(url, 'telegram', 'community', campaign, 'announcement')}\`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |`,
		`| The single CTA | Open ${brief.route || url} and use it |`,
		`| Media | \`${slot.shot}\`, ${slot.motion ? 'motion loop' : 'still frame'}${slot.mediaGate ? `, ${slot.mediaGate} required before committing the frame` : ''} |`,
		`| KPI | ${KPI[brief.pattern] || KPI.mechanism} |`,
		'',
		'## Why this one, and why now',
		'',
	);

	if (signals.length) {
		push(
			'The ranker scored it on signals measured against our own archive, not on taste:',
			'',
			...signals.map(([name, value]) => `- **${name} (${value})**: ${(SIGNALS[name] || (() => 'a scored signal'))(value)}`),
			'',
		);
	}
	if (ledgerEntry.curatedWhy) push(`The coverage audit's note on it: ${ledgerEntry.curatedWhy}`, '');
	if (brief.surface.shipped) push(`It shipped on ${brief.surface.shipped} and has never been posted about.`, '');
	const terms = gateTerms(root);
	const quotable = (brief.changelog || []).filter((entry) => !gated(entry.title, terms));
	if (quotable.length) {
		push(
			`The changelog has ${quotable.length} entr${quotable.length === 1 ? 'y' : 'ies'} about it, the most recent from ${quotable[0].date}: "${quotable[0].title}".`,
			'',
		);
	}

	push('## The claim, and where it is checked', '', '> ' + String(draft.post || '').trim().replace(/\n/g, '\n> '), '');
	if (draft.claims?.length) {
		push('Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:', '', '| Claim | Checked against |', '|---|---|');
		for (const claim of draft.claims) {
			push(`| ${claim.says} | ${(claim.evidence || []).map(evidenceLabel).join('; ')} |`);
		}
		push('');
	} else {
		push('The copy states no number and no absolute, so it declares no claims. The link check and the live page are what back it.', '');
	}
	if (verification) {
		const failed = verification.checks.filter((check) => !check.ok);
		push(
			failed.length
				? `Last verification run: ${failed.length} of ${verification.checks.length} checks failed (${failed.slice(0, 3).map((check) => `${check.target}: ${check.detail}`).join('; ')}).`
				: `Last verification run: all ${verification.checks.length} checks passed.`,
			'',
		);
	}
	if (Object.keys(draft.mentions || {}).length) {
		push('**Tags, and why each one is true:**', '', ...Object.entries(draft.mentions).map(([handle, why]) => `- \`${handle}\`: ${why}`), '');
	}

	push(
		'## Media',
		'',
		'Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).',
		'',
		'| Shot | File | Notes |',
		'|---|---|---|',
		`| \`${slot.shot}\` | \`${shotFile}\` | ${slot.motion ? 'Motion loop of the live route' : 'Still frame of the live route'}${slot.mediaGate ? '. This surface renders live third-party market data, so the frame is held out of the tree until the owner approves it (set `thirdPartyMarketDataApproved` on the shot).' : '.'} |`,
		'',
		'**Alt text, required on the post:**',
		'',
		`> ${String(draft.alt || '').trim()}`,
		'',
		'## The post',
		'',
		`Pattern: ${brief.pattern}. **${weight} weighted characters**${weight >= 100 && weight <= 179 ? ', inside the 100 to 179 band that measured a 3.0x lift' : weight <= 280 ? ', inside the hard limit of 280' : ''}. Postable file: [\`${id}.post.txt\`](./${id}.post.txt), which is the byte-for-byte source the queue item points at.`,
		'',
		'```text',
		String(draft.post || '').trim(),
		'```',
		'',
	);

	if (draft.why) push('### Why it is written that way', '', draft.why, '');
	if (draft.thread?.length) {
		push('### Thread', '');
		draft.thread.forEach((reply, index) => {
			push(`${index + 2}/ (${weightedLength(reply)})`, '', '```text', String(reply).trim(), '```', '');
		});
	}
	if (draft.telegram) {
		push(
			'## Telegram (@three_ws)',
			'',
			'The same facts in the channel\'s longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.',
			'',
			'```text',
			String(draft.telegram).trim(),
			'```',
			'',
		);
	}

	push(
		'## Ship it',
		'',
		'```bash',
		`npm run announce:media -- --only ${slot.shot}   # capture the frame from the live route`,
		`npm run x:content -- review ${id}               # lint, live fact checks, AI editor`,
		`npm run x:content -- run --dry-run --id ${id}   # exactly what would be sent to X`,
		'```',
		'',
		`The queue item is \`${id}\` in [\`data/x-content/queue.json\`](../../data/x-content/queue.json), at status \`draft\`. It becomes eligible to publish when a passing review record exists and the owner sets its status to \`approved\`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.`,
		'',
	);
	return `${lines.join('\n')}\n`;
}
