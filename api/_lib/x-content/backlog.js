// What to draft next, from the announcement ledger.
//
// data/announcements.json (npm run announce:rank) scores every shipped surface
// (pages, packages, workers, services) by what the account's own posts measured,
// and records which were ever announced and whether each answers live. The
// queue records which surfaces its items cover (`covers`). This module joins the
// two: the highest-scoring live surfaces nothing has announced and no queue item
// covers yet, interleaved across readers so the next batch of drafts is not ten
// posts for one audience, each with the head format that suits it.
//
// Pure: callers pass the ledger entries and the queue items.

import { AUDIENCES } from './voice.js';

// Who a surface is for, from where it lives on the site. Account pages are
// settings and sign-in, not something to announce.
const SECTION_AUDIENCE = {
	package: 'developer',
	worker: 'developer',
	service: 'developer',
	'agent-tools': 'developer',
	learn: 'educator',
	labs: 'creator',
	build: 'creator',
	crypto: 'community',
	main: 'founder',
};

export function audienceForEntry(entry) {
	return SECTION_AUDIENCE[entry?.section] || SECTION_AUDIENCE[entry?.kind] || null;
}

// The head a draft should lead with: code for something a developer installs,
// a GIF for a page that moves, a framed live capture for any other page.
export function headForEntry(entry) {
	if (entry.kind !== 'page') return 'code';
	return entry.moves ? 'gif' : 'shot';
}

export function coveredKeys(items) {
	return new Set((items || []).flatMap((item) => item.covers || []));
}

export function draftBacklog(entries, items, { limit = 12, audience = null } = {}) {
	const covered = coveredKeys(items);
	const open = (entries || [])
		.filter((entry) => entry.coverage === 'no' && entry.live?.ok !== false && !covered.has(entry.key))
		.map((entry) => ({ key: entry.key, title: entry.title, url: entry.url ? `https://three.ws${entry.url}` : null, score: Number(entry.score) || 0, audience: audienceForEntry(entry), head: headForEntry(entry), partner: entry.partner || null }))
		.filter((row) => row.audience && (!audience || row.audience === audience))
		.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
	// Round-robin across readers, best first within each, so the batch spans
	// the feed's audiences instead of following the score into one section.
	const queues = AUDIENCES.map((name) => open.filter((row) => row.audience === name)).filter((rows) => rows.length);
	queues.sort((a, b) => b[0].score - a[0].score);
	const picked = [];
	while (picked.length < limit && queues.some((rows) => rows.length)) {
		for (const rows of queues) if (rows.length && picked.length < limit) picked.push(rows.shift());
	}
	return { open: open.length, rows: picked };
}
