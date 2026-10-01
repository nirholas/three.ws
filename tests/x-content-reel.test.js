import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FORMATS, MIN_MOTION, PROOF_MAX_AGE_DAYS, factCheck, formatCut, proofPath, proofProblems, reelPath, scenarioHash, scenarioProblems, stepKind } from '../api/_lib/x-content/reel.js';
import { SITE_CHROME, chromeStylesheet } from '../api/_lib/x-content/site-chrome.js';
import { PREMIUM_MAX_LENGTH, STANDARD_MAX_LENGTH, maxLengthOf } from '../api/_lib/x-content/quality.js';
import { validateItem } from '../api/_lib/x-content/queue.js';
import { contentHash } from '../api/_lib/x-content/review.js';
import { buildReviewRequest } from '../api/_lib/x-content/editor.js';
import { bestPosts } from '../api/_lib/x-content/outcomes.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-29T12:00:00Z');
const REEL_BYTES = Buffer.from('a filmed reel');
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const SCENARIO = {
	format: 'square',
	steps: [
		{ goto: 'https://three.ws/galaxy', settle: 6000, caption: 'Every published agent, placed by what it does' },
		{ hold: 2000 },
		{ read: 'agents', match: '([\\d,]+)\\s*agents' },
		{ type: 'trading bots', into: 'Search by meaning', caption: 'Describe what you want in plain words' },
		{ click: 'Search', awaits: '/api/galaxy' },
		{ expect: 'Closest to', caption: 'The map flies to the closest matches' },
		{ hold: 3000 },
	],
};

const PROBE = { durationSec: 9.1, width: 1080, height: 1080, fps: 30, videoCodec: 'h264', pixFmt: 'yuv420p' };

function item(overrides = {}) {
	return {
		id: 'galaxy-search',
		status: 'review',
		kind: 'post',
		tier: 2,
		lane: 'labs',
		pattern: 'walkthrough',
		notBefore: '2026-09-29T00:00:00Z',
		scenario: SCENARIO,
		probes: [{ type: 'scenario' }],
		posts: [
			{ text: 'Agent Galaxy places every published agent by what it does. Type what you want in plain words and the map flies to the closest matches.', media: [{ path: reelPath('galaxy-search'), probe: PROBE, reel: true }] },
			{ text: 'Try it on the live map: three.ws/galaxy' },
		],
		claims: [{ says: 'every published agent', evidence: [{ type: 'proof', fact: 'agents' }] }],
		mentions: {},
		...overrides,
	};
}

function proof(overrides = {}) {
	return {
		id: 'galaxy-search',
		scenarioHash: scenarioHash(SCENARIO),
		ranAt: new Date(NOW - DAY).toISOString(),
		target: { commit: 'f2081d946', revision: 'three-ws-api-00459-pxd' },
		passed: true,
		steps: [{ index: 1, kind: 'goto', target: 'https://three.ws/galaxy', ok: true, detail: 'loaded' }],
		facts: { agents: '600' },
		saw: ['Closest to'],
		responses: [{ method: 'POST', path: '/api/galaxy', status: 200, seconds: 6.1 }],
		cuts: [{ afterStep: 5, seconds: 6.1 }],
		video: { path: reelPath('galaxy-search'), sha256: sha256(REEL_BYTES), frames: 273, motion: 0.98, ...PROBE },
		...overrides,
	};
}

// A checkout with the reel on disk, a queue that allows long posts, and the
// proof given (or none).
function sandbox(record = proof(), { maximumLength = 1000 } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'x-reel-'));
	mkdirSync(join(dir, 'public/x-media/galaxy-search'), { recursive: true });
	mkdirSync(join(dir, 'data/x-content/proofs'), { recursive: true });
	writeFileSync(join(dir, reelPath('galaxy-search')), REEL_BYTES);
	writeFileSync(join(dir, 'data/x-content/queue.json'), JSON.stringify({ quality: { maximumLength }, items: [] }));
	if (record) writeFileSync(join(dir, proofPath('galaxy-search')), JSON.stringify(record));
	return dir;
}

describe('scenario', () => {
	it('accepts a runnable scenario', () => {
		expect(scenarioProblems(SCENARIO)).toEqual([]);
	});

	it('reads a step that carries a caption as its action, not as a caption', () => {
		expect(stepKind({ scroll: 500, caption: 'Every entry says why' })).toBe('scroll');
		expect(stepKind({ caption: 'Only words' })).toBe('caption');
		expect(stepKind({ nothing: true })).toBe(null);
	});

	it('refuses a scenario that proves nothing', () => {
		const problems = scenarioProblems({ steps: [{ goto: 'https://three.ws/galaxy' }, { hold: 2000 }] }).join('\n');
		expect(problems).toMatch(/proves nothing/);
	});

	it('counts an awaited response as proof', () => {
		expect(scenarioProblems({ steps: [{ goto: 'https://three.ws/galaxy' }, { click: 'Search', awaits: '/api/galaxy' }, { hold: 2000 }] })).toEqual([]);
	});

	it('names every malformed step', () => {
		const problems = scenarioProblems({
			format: 'cinema',
			fps: 240,
			steps: [
				{ click: 'Search' },
				{ goto: 'http://three.ws/galaxy' },
				{ hold: 60_000 },
				{ type: 'hello' },
				{ read: 'Agents Count', match: '(' },
				{ read: 'agents', match: '(\\d+)' },
				{ read: 'agents', match: '(\\d+)' },
				{ drag: [[0.2, 0.5], [1.4, 0.5]] },
				{ hold: 500, awaits: '/api/galaxy' },
				{ click: 'Go', awaits: 'api/galaxy' },
				{ caption: 'x'.repeat(91) },
				{ mystery: true },
			],
		}).join('\n');
		expect(problems).toMatch(/format must be one of/);
		expect(problems).toMatch(/fps must be between/);
		expect(problems).toMatch(/first step must be a goto/);
		expect(problems).toMatch(/step 2: goto needs an https url/);
		expect(problems).toMatch(/step 3: hold is/);
		expect(problems).toMatch(/step 4: type needs "into"/);
		expect(problems).toMatch(/step 5: read needs a fact name/);
		expect(problems).toMatch(/step 7: fact "agents" is read twice/);
		expect(problems).toMatch(/step 8: drag needs/);
		expect(problems).toMatch(/step 9: awaits belongs on the action/);
		expect(problems).toMatch(/step 10: awaits needs the path/);
		expect(problems).toMatch(/step 11: caption is 91 characters/);
		expect(problems).toMatch(/step 12: needs one of/);
	});

	it('films every format at even dimensions with room for the bar', () => {
		for (const format of Object.values(FORMATS)) {
			expect((format.width * format.scale) % 2).toBe(0);
			expect((format.height * format.scale) % 2).toBe(0);
			expect(format.bar).toBeLessThan(format.height / 4);
		}
	});

	it('says how long was cut the way a viewer would', () => {
		expect(formatCut(3.2)).toBe('3 s');
		expect(formatCut(106)).toBe('1 min 46 s');
		expect(formatCut(120)).toBe('2 min');
	});
});

describe('proof', () => {
	it('covers an item whose reel a passing run filmed', () => {
		expect(proofProblems(item(), sandbox(), NOW)).toEqual([]);
	});

	it('asks for nothing of an item with no scenario', () => {
		expect(proofProblems(item({ scenario: undefined }), sandbox(null), NOW)).toEqual([]);
	});

	it('reports a missing proof', () => {
		expect(proofProblems(item(), sandbox(null), NOW).join('\n')).toMatch(/no proof on record/);
	});

	it('reports the step a failed run stopped at', () => {
		const failed = proof({ passed: false, video: null, steps: [{ index: 5, kind: 'click', target: 'Search', ok: false, detail: 'POST /api/galaxy answered HTTP 503' }] });
		expect(proofProblems(item(), sandbox(failed), NOW)).toEqual(['the last run failed at step 5 (click Search): POST /api/galaxy answered HTTP 503']);
	});

	it('is void once the scenario changes', () => {
		const changed = item({ scenario: { ...SCENARIO, steps: [...SCENARIO.steps, { hold: 1000 }] } });
		expect(proofProblems(changed, sandbox(), NOW).join('\n')).toMatch(/scenario changed after it was filmed/);
	});

	it('expires, because the product moves', () => {
		const old = proof({ ranAt: new Date(NOW - (PROOF_MAX_AGE_DAYS + 2) * DAY).toISOString() });
		expect(proofProblems(item(), sandbox(old), NOW).join('\n')).toMatch(/filmed 16 days ago/);
	});

	it('requires the head post to carry the reel that was filmed', () => {
		const swapped = item({ posts: [{ text: item().posts[0].text, media: [{ path: 'public/x-media/galaxy-search/other.mp4', probe: PROBE }] }] });
		expect(proofProblems(swapped, sandbox(), NOW).join('\n')).toMatch(/does not carry the reel/);
	});

	it('notices a reel that was replaced after the run', () => {
		const dir = sandbox();
		writeFileSync(join(dir, reelPath('galaxy-search')), Buffer.from('a different file'));
		expect(proofProblems(item(), dir, NOW).join('\n')).toMatch(/is not the file the proof filmed/);
	});

	it('refuses a reel in which almost nothing moves', () => {
		const still = proof({ video: { ...proof().video, motion: MIN_MOTION - 0.05 } });
		expect(proofProblems(item(), sandbox(still), NOW).join('\n')).toMatch(/only 10% of the reel's frames change/);
	});
});

describe('proof as evidence', () => {
	it('checks a fact the run read', () => {
		expect(factCheck({ type: 'proof', fact: 'agents', equals: '600' }, proof()).ok).toBe(true);
		expect(factCheck({ type: 'proof', fact: 'agents', equals: '601' }, proof())).toEqual({ ok: false, detail: 'the run read agents = "600"; the claim needs "601"' });
		expect(factCheck({ type: 'proof', fact: 'agents', contains: '60' }, proof()).ok).toBe(true);
		expect(factCheck({ type: 'proof', fact: 'agents' }, proof()).ok).toBe(true);
		expect(factCheck({ type: 'proof', fact: 'stars' }, proof()).detail).toMatch(/read no fact named "stars"/);
	});

	it('checks a text the run waited for', () => {
		expect(factCheck({ type: 'proof', saw: 'closest to' }, proof()).ok).toBe(true);
		expect(factCheck({ type: 'proof', saw: 'No matches' }, proof()).ok).toBe(false);
	});

	it('checks what the server answered', () => {
		expect(factCheck({ type: 'proof', responded: '/api/galaxy' }, proof())).toEqual({ ok: true, detail: 'POST /api/galaxy answered 200 in 6.1 s' });
		expect(factCheck({ type: 'proof', responded: '/api/search' }, proof()).ok).toBe(false);
	});

	it('cites nothing from a failed or missing run', () => {
		expect(factCheck({ type: 'proof', fact: 'agents' }, proof({ passed: false })).ok).toBe(false);
		expect(factCheck({ type: 'proof', fact: 'agents' }, null).ok).toBe(false);
	});
});

describe('queue validation of a filmed item', () => {
	it('passes an item whose proof covers it', () => {
		expect(validateItem(item(), sandbox())).toEqual([]);
	});

	it('requires the scenario to be the item probe', () => {
		expect(validateItem(item({ probes: [{ type: 'api', url: 'https://three.ws/api/galaxy' }] }), sandbox()).join('\n')).toMatch(/declare \{ "type": "scenario" \} in probes/);
	});

	it('refuses a scenario probe on an item with no scenario', () => {
		const bare = item({ scenario: undefined, posts: [{ text: item().posts[0].text, media: [{ path: reelPath('galaxy-search'), probe: PROBE }] }, item().posts[1]], claims: [] });
		expect(validateItem(bare, sandbox()).join('\n')).toMatch(/a scenario probe needs the item to carry a `scenario`/);
	});

	it('holds a draft to the scenario but not yet to the proof', () => {
		expect(validateItem(item({ status: 'draft' }), sandbox(null))).toEqual([]);
		expect(validateItem(item({ status: 'review' }), sandbox(null)).join('\n')).toMatch(/proof: no proof on record/);
	});

	it('binds the review to the scenario without disturbing older hashes', () => {
		const dir = sandbox();
		const plain = item({ scenario: undefined });
		const { scenario, ...withoutField } = item();
		expect(scenario).toBe(SCENARIO);
		expect(contentHash(plain, dir)).toBe(contentHash(withoutField, dir));
		expect(contentHash(item(), dir)).not.toBe(contentHash(plain, dir));
		expect(contentHash(item({ scenario: { ...SCENARIO, format: 'landscape' } }), dir)).not.toBe(contentHash(item(), dir));
	});
});

describe('post length', () => {
	const long = `${'The map places every published agent by what it does, and a plain sentence is enough to find one. '.repeat(4)}three.ws/galaxy`;

	it('takes the wall from the queue, never below the one X enforces', () => {
		expect(maxLengthOf({})).toBe(STANDARD_MAX_LENGTH);
		expect(maxLengthOf({ maximumLength: 100 })).toBe(STANDARD_MAX_LENGTH);
		expect(maxLengthOf({ maximumLength: 1000 })).toBe(1000);
		expect(maxLengthOf({ maximumLength: 90_000 })).toBe(PREMIUM_MAX_LENGTH);
		expect(maxLengthOf({ maximumLength: 'long' })).toBe(STANDARD_MAX_LENGTH);
	});

	it('holds a long head to the standard wall unless the queue lifts it', () => {
		const post = item({ posts: [{ text: long, media: item().posts[0].media }] });
		expect(validateItem(post, sandbox(proof(), { maximumLength: 280 })).join('\n')).toMatch(/maximum is 280/);
		expect(validateItem(post, sandbox(proof(), { maximumLength: 1000 }))).toEqual([]);
	});

	it('reads the wall from the queue at root when a caller holds only the item', () => {
		const post = item({ posts: [{ text: long, media: item().posts[0].media }] });
		expect(validateItem(post, sandbox(proof(), { maximumLength: 1000 }), { quality: { maximumLength: 300 } }).join('\n')).toMatch(/maximum is 300/);
	});
});

describe('the editor and a reel', () => {
	it('is given the record of the run and the length it may write to', async () => {
		const request = await buildReviewRequest(item(), { root: sandbox(), verification: { checks: [] }, lint: [], maximum: 1000 });
		expect(request.system).toMatch(/stay within 1000 weighted characters/);
		const text = request.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
		expect(text).toMatch(/a 9.1 second reel, 1080x1080, filmed from the live product/);
		expect(text).toMatch(/production commit f2081d946/);
		expect(text).toMatch(/"agents":"600"/);
		expect(text).toMatch(/"path":"\/api\/galaxy"/);
		expect(text).toMatch(/Describe what you want in plain words/);
	});

	it('is calibrated against the measured posts when they are given', async () => {
		const calibration = [{ text: 'Your three.ws avatar speaks sign language now', likes: 222, reposts: 61, bookmarks: 5, views: 15609, media: 'video', posted: '2026-08-01' }];
		const request = await buildReviewRequest(item(), { root: sandbox(), verification: { checks: [] }, lint: [], calibration });
		expect(request.parts[0].text).toMatch(/speaks sign language now/);
		expect(request.system).toMatch(/stay within 280 weighted characters/);
	});
});

describe('measured posts for calibration', () => {
	const row = (overrides) => ({ id: '1', at: new Date(NOW - 10 * DAY).toISOString(), impressions: 1000, likes: 10, reposts: 1, replies: 0, bookmarks: 0, media: 'photo', text: 'a post', ...overrides });

	it('ranks matured posts by outcome and leaves out the rest', () => {
		const posts = bestPosts(
			[
				row({ id: 'a', likes: 40, text: 'forty likes' }),
				row({ id: 'b', likes: 220, bookmarks: 5, text: 'the   sign language\npost' }),
				row({ id: 'c', likes: 900, at: new Date(NOW - 3_600_000).toISOString(), text: 'an hour old' }),
				row({ id: 'd', likes: 500, text: '' }),
			],
			{ now: NOW, count: 2 },
		);
		expect(posts.map((post) => post.text)).toEqual(['the sign language post', 'forty likes']);
		expect(posts[0]).toMatchObject({ likes: 220, bookmarks: 5, views: 1000, media: 'photo' });
	});
});

describe('chrome that is the subject', () => {
	it('stays in frame when the scenario names it', () => {
		const sheet = chromeStylesheet([], ['.walk-companion']);
		expect(sheet).not.toMatch(/(^|,)\.walk-companion(,|\{)/);
		expect(sheet).toContain('.walk-trail-layer');
		expect(sheet).toContain('#cookie-banner');
	});

	it('is only ever site chrome', () => {
		const steps = SCENARIO.steps;
		expect(scenarioProblems({ steps, show: ['.walk-companion'], hide: ['.promo'] })).toEqual([]);
		expect(scenarioProblems({ steps, show: ['main'] }).join('\n')).toMatch(/show "main" is not site chrome/);
		expect(scenarioProblems({ steps, show: '.walk-companion' }).join('\n')).toMatch(/show must be a list of selectors/);
	});
});

describe('site chrome', () => {
	it('hides every floating layer, and whatever a scenario adds', () => {
		const sheet = chromeStylesheet(['.promo-banner']);
		for (const selector of [...SITE_CHROME, '.promo-banner']) expect(sheet).toContain(selector);
		expect(sheet).toMatch(/\{display:none !important\}$/);
	});
});

describe('facts that move', () => {
	it('reads a count however the page writes it', async () => {
		const { factNumber } = await import('../api/_lib/x-content/reel.js');
		expect(factNumber('2,549')).toBe(2549);
		expect(factNumber('2,549 agents')).toBe(2549);
		expect(factNumber('14000')).toBe(14000);
		expect(factNumber('none')).toBeNaN();
	});

	it('holds a floor claim to its floor, not to the exact number filmed', () => {
		const filmed = proof({ facts: { agents: '2,546' } });
		expect(factCheck({ type: 'proof', fact: 'agents', min: 2500 }, filmed)).toEqual({ ok: true, detail: 'the run read agents = "2,546", at least 2500' });
		expect(factCheck({ type: 'proof', fact: 'agents', min: 3000 }, filmed).ok).toBe(false);
	});

	it('lets a counted fact grow under a floor claim, and catches an exact one that moved', async () => {
		const { factDrift } = await import('../api/_lib/x-content/verify.js');
		const floor = item({ claims: [{ says: 'More than 2,500', evidence: [{ type: 'proof', fact: 'agents', min: 2500 }] }] });
		const exact = item({ claims: [{ says: '600', evidence: [{ type: 'proof', fact: 'agents', equals: '600' }] }] });
		const uncited = item({ claims: [] });
		const filmed = proof({ facts: { agents: '2,546' } });
		expect(factDrift(floor, filmed, { agents: '2,549' })).toEqual([]);
		expect(factDrift(floor, filmed, { agents: '2,499' })).toEqual(['agents is now "2,499", under the floor of 2500 the post claims']);
		expect(factDrift(exact, filmed, { agents: '2,549' })).toEqual(['agents is now "2,549", the reel shows "2,546"']);
		expect(factDrift(uncited, filmed, { agents: '9' })).toEqual([]);
	});
});
