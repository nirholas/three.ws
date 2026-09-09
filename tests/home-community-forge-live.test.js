// Regression guard: the homepage "live" chip must be earned by the data.
//
// The Community strip on the homepage is titled "Made with Forge. Right now."
// and carries a pulsing "live" chip. Both used to be unconditional on the Fresh
// tab: the chip was toggled straight off the selected sort, so it asserted
// liveness no matter how old the newest card was.
//
// On 2026-09-07 the object store began rejecting our credential, which stopped
// forge_creations rows ever reaching status='done' with a glb_url. The gallery
// query selects exactly those rows, so no new model could enter the feed and the
// strip froze on the last model stored before the outage. The chip kept pulsing
// "live" over a 48h-old strip for two days, and nothing on the page contradicted
// it. A stale feed is fine to show; claiming it is live is not.
//
// The freshness helper is authored inline in pages/home.html, so the test lifts
// it out of the page source and runs it. That keeps this a behavioural guard on
// the shipped code rather than a grep over it: if the page stops exporting a
// recognisable helper, the extraction fails and the test fails with it.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const HOME = 'pages/home.html';

const HOUR = 3600 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

describe('homepage community strip: the "live" chip tracks real freshness', () => {
	let source;
	let feedIsLive;

	beforeAll(() => {
		source = readFileSync(resolve(root, HOME), 'utf8');

		// Lift `var LIVE_MAX_AGE_MS = ...` and `function feedIsLive(list) {...}`
		// out of the inline module and evaluate just those two.
		const maxAge = source.match(/var LIVE_MAX_AGE_MS = [^;]+;/);
		const helper = source.match(/function feedIsLive\(list\) \{[\s\S]*?\n\t\}/);
		expect(maxAge, `${HOME} no longer declares LIVE_MAX_AGE_MS`).not.toBeNull();
		expect(helper, `${HOME} no longer declares feedIsLive()`).not.toBeNull();

		// eslint-disable-next-line no-new-func
		feedIsLive = new Function(`${maxAge[0]}\n${helper[0]}\nreturn feedIsLive;`)();
	});

	it('calls a feed with a model from minutes ago live', () => {
		expect(feedIsLive([{ created_at: iso(3 * 60 * 1000) }])).toBe(true);
	});

	it('does not call the two-day-old strip of the 2026-09-07 storage outage live', () => {
		const stalled = Array.from({ length: 12 }, (_, i) => ({ created_at: iso(48 * HOUR + i * 60000) }));
		expect(feedIsLive(stalled)).toBe(false);
	});

	it('reads the newest model in the list, not the first one it is handed', () => {
		// Ordering is the API's business, so the chip must not assume it.
		const outOfOrder = [{ created_at: iso(30 * HOUR) }, { created_at: iso(2 * 60 * 1000) }];
		expect(feedIsLive(outOfOrder)).toBe(true);
	});

	it('is not live with nothing to be live about', () => {
		expect(feedIsLive([])).toBe(false);
		expect(feedIsLive(null)).toBe(false);
		expect(feedIsLive(undefined)).toBe(false);
	});

	it('survives a row with a missing or unparseable timestamp', () => {
		expect(feedIsLive([{}, { created_at: null }, { created_at: 'not a date' }])).toBe(false);
		expect(feedIsLive([{ created_at: 'not a date' }, { created_at: iso(60 * 1000) }])).toBe(true);
	});

	it('never toggles the chip from the selected sort alone', () => {
		// The exact bug: `liveChip.hidden = (s !== 'fresh')` made the Fresh tab
		// self-certifying. Every write to the chip now goes through syncLiveChip().
		const writes = source.match(/liveChip\.hidden\s*=\s*[^;]+;/g) || [];
		expect(writes.length).toBeGreaterThan(0);
		for (const write of writes) {
			const honest = /feedIsLive\(/.test(write) || /=\s*true\s*;/.test(write);
			expect(honest, `chip written without a freshness check: ${write}`).toBe(true);
		}
		expect(source).toMatch(/syncLiveChip\(\);/);
	});
});
