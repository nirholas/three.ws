// The committed X content queue must stay releasable. As of 2026-11-03 nine
// items at `review` or `approved` carried errors nobody saw until the queue
// stalled: claims that no longer quoted their copy, a proof run that failed
// on a production defect, and drafts with broken media and claims. Each one
// was found at publish time instead of by `npm test`.
//
// This runs the queue's own validator over every item the owner could approve
// or the tick could send. The two freshness rules (a proof or a review older
// than 14 days) are excluded on purpose: they are a function of the calendar,
// not of the code, so asserting on them would turn this suite red every two
// weeks with no change in the repository. `npm run x:content -- check` reports
// them, and docs/x-content-pipeline.md ("Refreshing a stale item") has the
// recipe. Everything else (claims, media, scenario hashes, a failed proof run,
// a review bound to different bytes) is a property of the committed files and
// must hold.

import { describe, it, expect } from 'vitest';
import { loadQueue, validateItem } from '../api/_lib/x-content/queue.js';

const root = process.cwd();
const FRESHNESS = [/the reel was filmed \d+ days ago/, /the review is \d+ days old/];
const isFreshness = (problem) => FRESHNESS.some((pattern) => pattern.test(problem));

describe('committed X content queue', () => {
	const queue = loadQueue(root);
	const live = queue.items.filter((item) => ['review', 'approved'].includes(item.status));

	it('has items the owner can act on', () => {
		expect(live.length).toBeGreaterThan(0);
	});

	it('has no review or approved item with a problem other than its age', () => {
		const broken = live
			.map((item) => ({ id: item.id, problems: validateItem(item, root, { quality: queue.quality || {} }).filter((problem) => !isFreshness(problem)) }))
			.filter((row) => row.problems.length);
		expect(broken).toEqual([]);
	});

	it('keeps every draft that cannot ship explained', () => {
		const silent = queue.items
			.filter((item) => item.status === 'draft')
			.filter((item) => validateItem({ ...item, status: 'review' }, root, { quality: queue.quality || {} }).some((problem) => !isFreshness(problem)))
			.filter((item) => !String(item.note || '').trim())
			.map((item) => item.id);
		expect(silent).toEqual([]);
	});
});
