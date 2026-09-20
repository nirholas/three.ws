// Where the announcement machinery reads its state from, in one place, so the
// planner, the kit factory, and anything added later agree on what the backlog
// is and which slot a surface holds.
//
// Nothing here is generated on the fly that could be stale: the ledger is
// rebuilt by `npm run announce:rank -- --write`, and the plan, once written, is
// reused rather than recomputed, because a calendar that moves every time it is
// read is not a calendar.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildPlan, slugFor } from './plan.js';

export const LEDGER_PATH = 'data/announcements.json';
export const PLAN_DIR = 'data/announce-plan';
export const PLAN_PATH = `${PLAN_DIR}/plan.json`;

export class MissingLedgerError extends Error {
	constructor() {
		super('data/announcements.json is missing. Build it first:\n\n  npm run announce:rank -- --probe --write\n');
		this.name = 'MissingLedgerError';
	}
}

export function loadLedger(root) {
	const path = resolve(root, LEDGER_PATH);
	if (!existsSync(path)) throw new MissingLedgerError();
	return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadQueueFile(root) {
	return JSON.parse(readFileSync(resolve(root, 'data/x-content/queue.json'), 'utf8'));
}

// Surfaces under the `crypto` section render live third-party market data, so a
// frame of one carries the operating rules' coin gate. The section holds most
// of them but not all: /crypto and /crypto-api are filed under `learn` and
// render the same live launches, prices and pairs, so the path namespace gates
// too. Without that, admitting showcase pages from a content section would
// hand the factory two surfaces whose frames it must not commit unreviewed.
const CRYPTO_NAMESPACE = /^\/crypto(?:$|[/-])/;

export function cryptoPaths(root) {
	const pages = JSON.parse(readFileSync(resolve(root, 'data/pages.json'), 'utf8'));
	const paths = new Set();
	for (const section of pages.sections) {
		for (const page of section.pages) {
			if (section.id === 'crypto' || CRYPTO_NAMESPACE.test(page.path)) paths.add(page.path);
		}
	}
	return paths;
}

// Ids that are already spoken for: queued, or carrying a pack.
export function takenIds(root, queue) {
	const taken = new Set((queue.items || []).map((item) => item.id));
	const dir = resolve(root, 'docs/announcements');
	if (existsSync(dir)) {
		for (const file of readdirSync(dir)) {
			if (file.endsWith('.md') && file !== 'README.md') taken.add(file.replace(/\.md$/, ''));
		}
	}
	return taken;
}

// Surfaces the owner or an earlier capture took off the table, with the reason.
// Committed, unlike the ledger, because the reason is knowledge the regenerated
// ledger cannot re-derive: `/genome` and `/portfolio` were both deferred after
// their frames showed an empty market and an empty input.
export function deferrals(root) {
	const path = resolve(root, 'data/announce-deferred.json');
	if (!existsSync(path)) return new Map();
	const { deferred = {} } = JSON.parse(readFileSync(path, 'utf8'));
	return new Map(Object.entries(deferred));
}

// The mirror image of the deferrals: surfaces somebody asked for next. The
// ledger scores what it can measure from a description, a route and a
// directory, which is why a surface can be worth posting now and still sit 90
// slots down the calendar. A key here is sequenced ahead of the rest of the
// backlog, inside the slot its own tier owns, so a pin moves the order and
// never the cadence. Committed for the same reason the deferrals are: a
// regenerated ledger cannot re-derive a judgement a person made.
export function priorities(root) {
	const path = resolve(root, 'data/announce-priority.json');
	if (!existsSync(path)) return new Map();
	const { priority = {} } = JSON.parse(readFileSync(path, 'utf8'));
	return new Map(Object.entries(priority));
}

export function backlogOf(root, { ledger = null, queue = null } = {}) {
	const source = ledger || loadLedger(root);
	const taken = takenIds(root, queue || loadQueueFile(root));
	const deferred = deferrals(root);
	return (source.entries || [])
		.filter((entry) => entry.coverage === 'no')
		.filter((entry) => !entry.live || entry.live.ok)
		.filter((entry) => !taken.has(slugFor(entry.key)))
		.filter((entry) => !deferred.has(entry.key));
}

export function planFor(root, { start, ledger = null, holdGated = false } = {}) {
	const queue = loadQueueFile(root);
	const entries = backlogOf(root, { ledger, queue });
	const plan = buildPlan(entries, { cadence: queue.cadence, quality: queue.quality, start, cryptoPaths: cryptoPaths(root), holdGated, pinned: priorities(root) });
	plan.deferred = [...deferrals(root)].map(([key, why]) => ({ key, why }));
	return plan;
}

export function writePlan(root, plan, calendar) {
	const dir = resolve(root, PLAN_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'plan.json'), `${JSON.stringify(plan, null, '\t')}\n`);
	if (calendar) writeFileSync(join(dir, 'CALENDAR.md'), calendar);
}

// The written plan, so a batch drafted last week keeps its dates. Rebuilt only
// when there is none, or when the caller asks for a fresh start date.
export function loadOrBuildPlan(root, { start = null, refresh = false, holdGated = false } = {}) {
	const path = resolve(root, PLAN_PATH);
	if (!refresh && !start && existsSync(path)) {
		const cached = JSON.parse(readFileSync(path, 'utf8'));
		// A plan built with gated surfaces held out dates a different set of
		// surfaces than one built with them in, so a cached plan answers only
		// the question it was built for.
		if (Boolean(cached.holdGated) === Boolean(holdGated)) return cached;
	}
	const plan = planFor(root, { start: start || new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), holdGated });
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(plan, null, '\t')}\n`);
	return plan;
}

export function ledgerEntryFor(ledger, key) {
	return (ledger.entries || []).find((entry) => entry.key === key) || {};
}
