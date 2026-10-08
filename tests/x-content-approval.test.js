import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_APPROVAL, approvalPolicy, policyBlockers, releaseDigest, vetoUntil } from '../api/_lib/x-content/approval.js';
import { proofPath, reelPath, scenarioHash } from '../api/_lib/x-content/reel.js';
import { validateItem } from '../api/_lib/x-content/queue.js';
import { takenIds } from '../api/_lib/announce/ledger.js';
import { slugFor } from '../api/_lib/announce/plan.js';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-29T12:00:00Z');
const REEL = Buffer.from('a filmed reel');
const SCENARIO = { steps: [{ goto: 'https://three.ws/wardrobe' }, { click: 'Forge it', awaits: '/api/wardrobe' }, { hold: 3000 }] };
const PROBE = { durationSec: 9, width: 1080, height: 1080, fps: 30, videoCodec: 'h264', pixFmt: 'yuv420p' };
const AUTO = { mode: 'auto', tiers: [2, 3], vetoHours: 24 };
const PASSED = { passed: true, editor: { verdict: 'publish' } };

function item(overrides = {}) {
	return {
		id: 'wardrobe',
		status: 'review',
		kind: 'post',
		tier: 2,
		lane: 'community',
		pattern: 'walkthrough',
		notBefore: '2026-09-29T00:00:00Z',
		scenario: SCENARIO,
		probes: [{ type: 'scenario' }],
		posts: [{ text: 'Describe a jacket in a sentence and the wardrobe makes it, fitted to your avatar, ready to wear. three.ws/wardrobe', media: [{ path: reelPath('wardrobe'), probe: PROBE, reel: true }] }],
		claims: [],
		mentions: {},
		...overrides,
	};
}

function sandbox({ passed = true } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'x-approval-'));
	mkdirSync(join(dir, 'public/x-media/wardrobe'), { recursive: true });
	mkdirSync(join(dir, 'data/x-content/proofs'), { recursive: true });
	writeFileSync(join(dir, reelPath('wardrobe')), REEL);
	writeFileSync(join(dir, 'data/x-content/queue.json'), JSON.stringify({ quality: {}, items: [] }));
	const proof = {
		id: 'wardrobe',
		scenarioHash: scenarioHash(SCENARIO),
		ranAt: new Date(NOW - HOUR).toISOString(),
		passed,
		steps: passed ? [] : [{ index: 2, kind: 'click', target: 'Forge it', ok: false, detail: 'POST /api/wardrobe answered HTTP 503' }],
		facts: {},
		saw: [],
		responses: [],
		cuts: [],
		video: passed ? { path: reelPath('wardrobe'), sha256: createHash('sha256').update(REEL).digest('hex'), frames: 270, motion: 0.9, ...PROBE } : null,
	};
	writeFileSync(join(dir, proofPath('wardrobe')), JSON.stringify(proof));
	return dir;
}

describe('approval policy', () => {
	it('leaves approval with the owner unless the queue says otherwise', () => {
		expect(approvalPolicy({})).toEqual(DEFAULT_APPROVAL);
		expect(approvalPolicy({ approval: { mode: 'automatic' } }).mode).toBe('owner');
		expect(approvalPolicy({ approval: { mode: 'auto', tiers: [1, 2, 9, 'x'], vetoHours: 6 } })).toEqual({ mode: 'auto', tiers: [1, 2], vetoHours: 6, articles: false });
		expect(approvalPolicy({ approval: { mode: 'auto', articles: 'yes' } }).articles).toBe(false);
		expect(approvalPolicy({ approval: { mode: 'auto', articles: true } }).articles).toBe(true);
	});

	it('never shortens the veto window to nothing', () => {
		expect(approvalPolicy({ approval: { mode: 'auto', vetoHours: 0 } }).vetoHours).toBe(DEFAULT_APPROVAL.vetoHours);
		expect(approvalPolicy({ approval: { mode: 'auto', vetoHours: 'soon' } }).vetoHours).toBe(DEFAULT_APPROVAL.vetoHours);
	});

	it('releases a filmed post that tags no one and passed on the editor verdict', () => {
		expect(policyBlockers(item(), PASSED, AUTO, sandbox(), NOW)).toEqual([]);
	});

	it('keeps every post with the owner when the mode is owner', () => {
		expect(policyBlockers(item(), PASSED, DEFAULT_APPROVAL, sandbox(), NOW)).toEqual(['the queue leaves approval to the owner']);
	});

	it('keeps flagship posts with the owner unless tier 1 is listed', () => {
		expect(policyBlockers(item({ tier: 1 }), PASSED, AUTO, sandbox(), NOW)).toEqual(['tier 1 posts are approved by the owner']);
		expect(policyBlockers(item({ tier: 1 }), PASSED, { ...AUTO, tiers: [1, 2, 3] }, sandbox(), NOW)).toEqual([]);
	});

	it('never releases a post that was not filmed', () => {
		expect(policyBlockers(item({ scenario: undefined }), PASSED, AUTO, sandbox(), NOW)).toEqual(['it was never filmed against the product']);
	});

	it('never releases a post whose feature failed its scenario', () => {
		expect(policyBlockers(item(), PASSED, AUTO, sandbox({ passed: false }), NOW).join('\n')).toMatch(/proof: the last run failed at step 2/);
	});

	it('leaves a tag to a person', () => {
		const tagged = item({ posts: [{ ...item().posts[0], text: 'Garments are generated on @nvidia hardware and fitted to your avatar. three.ws/wardrobe' }] });
		expect(policyBlockers(tagged, PASSED, AUTO, sandbox(), NOW)).toEqual(['it tags @nvidia']);
	});

	it('does not count an override as a pass', () => {
		expect(policyBlockers(item(), { passed: true, editor: { verdict: 'revise' } }, AUTO, sandbox(), NOW)).toEqual(["the editor's verdict was revise"]);
		expect(policyBlockers(item(), { passed: false, editor: { verdict: 'revise' } }, AUTO, sandbox(), NOW)).toEqual(['its review did not pass']);
		expect(policyBlockers(item(), null, AUTO, sandbox(), NOW)).toEqual(['its review did not pass']);
	});

	it('releases an Article that passed review when the queue lets articles go by policy', () => {
		const dir = sandbox();
		mkdirSync(join(dir, 'data/x-content/articles'), { recursive: true });
		writeFileSync(join(dir, 'data/x-content/articles/rig.md'), '## How it works\n\nThe retargeter maps every bone.\n');
		const article = item({ kind: 'article', tier: 1, scenario: undefined, probes: [{ type: 'api', url: 'https://three.ws/api/healthz' }], article: { title: 'How three.ws retargets motion', body: 'data/x-content/articles/rig.md' }, posts: [{ text: 'The long version of how one clip library drives any humanoid skeleton.' }] });
		const ARTICLES = { ...AUTO, articles: true };
		expect(policyBlockers(article, PASSED, ARTICLES, dir, NOW)).toEqual([]);
		// Without the switch an Article is a tier 1 item nobody filmed.
		expect(policyBlockers(article, PASSED, AUTO, dir, NOW)).toEqual(['tier 1 posts are approved by the owner', 'it was never filmed against the product']);
		// Every other condition still holds, including a tag deep in the body.
		expect(policyBlockers(article, { passed: true, editor: { verdict: 'revise' } }, ARTICLES, dir, NOW)).toEqual(["the editor's verdict was revise"]);
		writeFileSync(join(dir, 'data/x-content/articles/rig.md'), '## Credits\n\nThanks to @nvidia for the GPUs.\n');
		expect(policyBlockers(article, PASSED, ARTICLES, dir, NOW)).toEqual(['it tags @nvidia']);
		// A post is not an Article: the switch does not release it unfilmed.
		expect(policyBlockers(item({ scenario: undefined }), PASSED, ARTICLES, dir, NOW)).toEqual(['it was never filmed against the product']);
	});

	it('embargoes a release for the veto window, or longer if the post already waited for more', () => {
		expect(vetoUntil(item(), AUTO, NOW)).toBe('2026-09-30T12:00:00.000Z');
		expect(vetoUntil(item({ notBefore: '2026-10-05T09:00:00Z' }), AUTO, NOW)).toBe('2026-10-05T09:00:00.000Z');
	});

	it('tells the owner what was released, when, and how to take it back', () => {
		const digest = releaseDigest([
			{ id: 'wardrobe', tier: 2, notBefore: '2026-09-30T12:00:00.000Z', head: 'Describe a jacket\nin a sentence' },
			{ id: 'tty', tier: 3, notBefore: '2026-09-30T09:00:00.000Z', head: 'curl three.ws/tty' },
		]);
		expect(digest.title).toBe('x-content: 2 post(s) approved by policy');
		expect(digest.detail).toMatch(/Nothing goes out before 2026-09-30T09:00Z/);
		expect(digest.detail).toMatch(/npm run x:content -- pause <id>/);
		expect(digest.detail).toMatch(/wardrobe \(T2, from 2026-09-30T12:00Z\): Describe a jacket in a sentence/);
	});
});

describe('a story covers backlog surfaces', () => {
	it('takes every surface it names off the backlog', () => {
		const queue = { items: [item({ covers: ['/wardrobe', '@three-ws/scene-mcp', 'workers/garment-forge'] })] };
		const taken = takenIds(mkdtempSync(join(tmpdir(), 'x-covers-')), queue);
		for (const key of ['/wardrobe', '@three-ws/scene-mcp', 'workers/garment-forge']) expect(taken.has(slugFor(key))).toBe(true);
		expect(taken.has('wardrobe')).toBe(true);
		expect(taken.has(slugFor('/galaxy'))).toBe(false);
	});

	it('refuses a covers list that is not a list of keys', () => {
		expect(validateItem(item({ covers: ['/wardrobe', 'workers/garment-forge'] }), sandbox())).toEqual([]);
		expect(validateItem(item({ covers: '/wardrobe' }), sandbox()).join('\n')).toMatch(/covers must list backlog keys/);
		expect(validateItem(item({ covers: [42] }), sandbox()).join('\n')).toMatch(/covers must list backlog keys/);
	});
});

describe('three a day is a quota', () => {
	const cadence = { slots: [{ tier: 3, at: '04:00' }, { tier: 2, at: '12:00' }, { tier: 1, at: '20:00' }], windowMinutes: 0, minimumMinutesApart: 1, dailyCap: 3, quietHoursUtc: null };
	const at = (iso) => Date.parse(iso);
	const post = (id, overrides = {}) => ({ id, status: 'approved', kind: 'post', tier: 2, lane: 'community', pattern: 'walkthrough', notBefore: '2026-09-29T00:00:00Z', posts: [{ text: `${id} post about a feature: three.ws/${id}`, media: [{ path: `public/x-media/${id}/reel.mp4` }] }], ...overrides });

	it('lets a policy embargo yield when the slot would otherwise go empty', async () => {
		const { pickDue } = await import('../api/_lib/x-content/schedule.js');
		const now = at('2026-09-30T12:30:00Z');
		const embargoed = post('later', { approvedBy: 'policy', notBefore: '2026-09-30T14:00:00Z' });
		const state = { published: [], inflight: {} };
		expect(pickDue({ items: [embargoed], state, now, cadence }).item).toBe(null);
		const decision = pickDue({ items: [embargoed], state, now, cadence, quota: true });
		expect(decision.item?.id).toBe('later');
		expect(decision.vetoYielded).toBe(true);
	});

	it('never shortens an embargo the owner set, and prefers a ready post to a yielded one', async () => {
		const { pickDue } = await import('../api/_lib/x-content/schedule.js');
		const now = at('2026-09-30T12:30:00Z');
		const owner = post('owner-held', { notBefore: '2026-10-02T00:00:00Z' });
		expect(pickDue({ items: [owner], state: { published: [], inflight: {} }, now, cadence, quota: true }).item).toBe(null);
		const ready = post('ready');
		const embargoed = post('later', { approvedBy: 'policy', notBefore: '2026-09-30T14:00:00Z' });
		const decision = pickDue({ items: [embargoed, ready], state: { published: [], inflight: {} }, now, cadence, quota: true });
		expect(decision.item.id).toBe('ready');
		expect(decision.vetoYielded).toBe(false);
	});

	it('fills an empty slot with a higher tier last ready post before it yields any embargo', async () => {
		const { pickDue, everyTier } = await import('../api/_lib/x-content/schedule.js');
		expect(everyTier(3)).toEqual([3, 2, 1]);
		expect(everyTier(2)).toEqual([2, 3, 1]);
		expect(everyTier(1)).toEqual([1, 2, 3]);
		const morning = at('2026-09-30T04:30:00Z');
		const feature = post('feature', { tier: 2 });
		const embargoed = post('later', { tier: 3, approvedBy: 'policy', notBefore: '2026-09-30T06:00:00Z' });
		const state = { published: [], inflight: {} };
		expect(pickDue({ items: [feature], state, now: morning, cadence }).item).toBe(null);
		const up = pickDue({ items: [feature, embargoed], state, now: morning, cadence, quota: true });
		expect([up.item.id, up.filledUp, up.vetoYielded]).toEqual(['feature', true, false]);
		const veto = pickDue({ items: [embargoed], state, now: morning, cadence, quota: true });
		expect([veto.item.id, veto.vetoYielded]).toEqual(['later', true]);
	});

	it('names every slot of the last day that closed with no post, once', async () => {
		const { missedSlots } = await import('../api/_lib/x-content/runner.js');
		const now = at('2026-09-30T11:00:00Z');
		const state = { published: [{ id: 'a', slot: '2026-09-30#0', publishedAt: '2026-09-30T04:10:00Z' }], missedSlots: { '2026-09-29#2': '2026-09-30T00:00:00Z' } };
		const missed = missedSlots(state, cadence, null, now).map((slot) => slot.key);
		expect(missed).toContain('2026-09-29#1');
		expect(missed).not.toContain('2026-09-29#2');
		expect(missed).not.toContain('2026-09-30#0');
		expect(missed).not.toContain('2026-09-30#1');
	});
});
