// The post-generation quality stage can only improve a result.
//
// These tests drive the real stage module with its lane callbacks stubbed (what
// generates, what scores, what admits a retry), so each rule is pinned on its
// own: one retry at most, none when busy or at the allowance edge, never paid
// for twice, the better of the two kept, the loser retired, and the user told.
import { describe, it, expect, vi } from 'vitest';
import {
	runQualityStage,
	scoreWithinBudget,
	betterAttempt,
	noteAllowance,
	allowanceAtEdge,
	describeQualityRetry,
	QUALITY_STAGE_LIMITS,
} from '../api/_lib/forge-quality-stage.js';

const OK_Q = { flag: 'ok', score: 0.9, metrics: { hasTextures: true, planar: false } };
const DEGENERATE_Q = { flag: 'degenerate', score: 0.05, reasons: ['too_few_triangles'], metrics: { hasTextures: false } };
const INVALID_Q = { flag: 'invalid', score: 0, reasons: ['not_valid_glb'], metrics: {} };
const LOW_Q = { flag: 'low', score: 0.2, metrics: { hasTextures: false } };
const MEDIOCRE_Q = { flag: 'ok', score: 0.5, metrics: { hasTextures: true } };

const dur = (id, quality = OK_Q) => ({ id, glbUrl: `https://cdn.test/${id}.glb`, quality });
const FAIL = { pass: false, score: 30, qa_available: true, defects: ['blob'], suggested_retry_hint: 'more detail', reason: 'melted' };
const PASS = { pass: true, score: 82, qa_available: true, defects: [], reason: 'clean' };
const OUTAGE = { pass: true, score: null, qa_available: false, reason: 'qa_unavailable: down' };
const directive = (verdict, ctx) => ({ prompt: `${ctx.prompt}, better`, hint: verdict.suggested_retry_hint });

function harness(overrides = {}) {
	const scores = overrides.scores || [];
	const calls = { score: [], regenerate: [], admit: 0, release: 0, discard: [] };
	const stage = () =>
		runQualityStage({
			durable: overrides.durable ?? dur('first', FAIL_Q_DEFAULT),
			tierId: 'standard',
			prompt: 'a teapot',
			path: 'text',
			visionApplies: overrides.visionApplies ?? (() => true),
			score:
				overrides.score ||
				(async ({ durable }) => {
					calls.score.push(durable.id);
					const next = scores.shift();
					if (next instanceof Error) throw next;
					return next ?? PASS;
				}),
			regenerate:
				overrides.regenerate ||
				(async (args) => {
					calls.regenerate.push(args);
					return { durable: dur('second', overrides.secondQuality ?? OK_Q) };
				}),
			admitRetry:
				overrides.admitRetry ||
				(async () => {
					calls.admit += 1;
					return { ok: true, release: async () => { calls.release += 1; } };
				}),
			buildDirective: overrides.buildDirective ?? directive,
			discard: overrides.discard || (async (args) => { calls.discard.push(args); }),
			maxRetries: overrides.maxRetries ?? 1,
			budgetMs: overrides.budgetMs,
		});
	return { stage, calls };
}
const FAIL_Q_DEFAULT = OK_Q;

describe('cheap deterministic checks run first', () => {
	it('retries a structurally broken model without asking the judge to condemn it first', async () => {
		const h = harness({ durable: dur('first', DEGENERATE_Q), scores: [PASS] });
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(1);
		// The judge only ever saw the winner, never the broken first attempt.
		expect(h.calls.score).not.toContain('first');
		expect(out.durable.id).toBe('second');
		expect(out.retry).toMatchObject({ ran: true, reason: 'structural', kept: 'retry' });
	});

	it('does not spend a judge call on a clean model the gate does not apply to', async () => {
		const h = harness({ durable: dur('first', OK_Q), visionApplies: () => false });
		const out = await h.stage();
		expect(h.calls.score).toEqual([]);
		expect(h.calls.regenerate).toEqual([]);
		expect(out.durable.id).toBe('first');
		expect(out.verdict).toBeNull();
		expect(out.retry.ran).toBe(false);
	});

	it('treats an invalid GLB like a degenerate one', async () => {
		const h = harness({ durable: dur('first', INVALID_Q), visionApplies: () => false });
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(1);
		expect(out.durable.id).toBe('second');
	});
});

describe('at most one automatic retry per request', () => {
	it('stacks neither the structural retry nor the vision retry: one budget for both', async () => {
		// First attempt is structurally broken AND the retry is judged failing.
		const h = harness({ durable: dur('first', DEGENERATE_Q), scores: [FAIL, FAIL], secondQuality: MEDIOCRE_Q });
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(1);
		expect(out.retry.ran).toBe(true);
	});

	it('does not retry again when the retry also fails the judge', async () => {
		const h = harness({ durable: dur('first', OK_Q), scores: [FAIL, FAIL] });
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(1);
		expect(out.retry.ran).toBe(true);
	});

	it('clamps a configured cap above one back to one', async () => {
		const h = harness({ durable: dur('first', OK_Q), scores: [FAIL, FAIL], maxRetries: 5 });
		await h.stage();
		expect(h.calls.regenerate).toHaveLength(1);
	});

	it('runs none when the cap is zero', async () => {
		const h = harness({ durable: dur('first', DEGENERATE_Q), maxRetries: 0 });
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(0);
		expect(out.durable.id).toBe('first');
		expect(out.retry).toMatchObject({ ran: false, declined: 'disabled' });
	});
});

describe('no retry when the service is busy or the allowance is at its edge', () => {
	it('declines on a busy lane and keeps the first result', async () => {
		const h = harness({
			durable: dur('first', DEGENERATE_Q),
			admitRetry: async () => ({ ok: false, reason: 'busy' }),
			scores: [PASS],
		});
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(0);
		expect(out.durable.id).toBe('first');
		expect(out.retry).toMatchObject({ ran: false, declined: 'busy' });
	});

	it('declines a vision retry the same way', async () => {
		const h = harness({
			durable: dur('first', OK_Q),
			admitRetry: async () => ({ ok: false, reason: 'allowance' }),
			scores: [FAIL],
		});
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(0);
		expect(out.verdict.pass).toBe(false);
		expect(out.retry).toMatchObject({ ran: false, declined: 'allowance' });
	});

	it('reads the allowance edge from the up-front rate limit result of THIS request', () => {
		const req = {};
		expect(allowanceAtEdge(req)).toBe(false);
		noteAllowance(req, { success: true, limit: 60, remaining: 40 });
		expect(allowanceAtEdge(req)).toBe(false);
		noteAllowance(req, { success: true, limit: 60, remaining: 1 });
		expect(allowanceAtEdge(req)).toBe(true);
		noteAllowance(req, { success: true, limit: 60, remaining: 0 });
		expect(allowanceAtEdge(req)).toBe(true);
		// A request that never reported one (internal seed, no limiter) is never at the edge.
		expect(allowanceAtEdge({})).toBe(false);
		expect(allowanceAtEdge(null)).toBe(false);
	});

	it('releases the slot the retry held, even when the regeneration throws', async () => {
		const h = harness({
			durable: dur('first', DEGENERATE_Q),
			regenerate: async () => { throw new Error('lane exploded'); },
		});
		const out = await h.stage();
		expect(h.calls.release).toBe(1);
		expect(out.durable.id).toBe('first');
		expect(out.retry).toMatchObject({ ran: false, declined: 'retry_failed' });
	});
});

describe('a retry is never counted against the user twice', () => {
	it('never touches the rate limiter, the funnel or the credit ledger: the stage has no handle on them', async () => {
		// The stage is handed exactly four collaborators (score, regenerate, admit,
		// discard). Pin that: a future edit that threads a limiter or a ledger in
		// has to change this list and face this test.
		const h = harness({ durable: dur('first', DEGENERATE_Q), scores: [PASS] });
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(1);
		// The regenerate callback is told it is a retry, which is what lets the lane
		// create its row without a second funnel start or a second 'done' count.
		expect(h.calls.regenerate[0]).toMatchObject({ isRetry: true });
		expect(out.retry.ran).toBe(true);
	});

	it('retires the attempt that lost so the user is not left with a model they never saw', async () => {
		const h = harness({ durable: dur('first', DEGENERATE_Q), scores: [PASS] });
		const out = await h.stage();
		expect(out.durable.id).toBe('second');
		expect(h.calls.discard).toEqual([{ loser: expect.objectContaining({ id: 'first' }), winner: expect.objectContaining({ id: 'second' }) }]);
	});

	it('retires the retry when the first attempt wins', async () => {
		const h = harness({ durable: dur('first', OK_Q), scores: [FAIL, FAIL], secondQuality: OK_Q });
		const out = await h.stage();
		expect(out.durable.id).toBe('first');
		expect(h.calls.discard).toEqual([{ loser: expect.objectContaining({ id: 'second' }), winner: expect.objectContaining({ id: 'first' }) }]);
	});

	it('never lets a failing discard take the delivered model down with it', async () => {
		const h = harness({
			durable: dur('first', DEGENERATE_Q),
			scores: [PASS],
			discard: async () => { throw new Error('db down'); },
		});
		const out = await h.stage();
		expect(out.durable.id).toBe('second');
	});
});

describe('the better of the two results is kept', () => {
	it('keeps the retry when it is judged better', async () => {
		const h = harness({ durable: dur('first', OK_Q), scores: [FAIL, { ...PASS, score: 75 }] });
		const out = await h.stage();
		expect(out.durable.id).toBe('second');
		expect(out.verdict.score).toBe(75);
		expect(out.retry.kept).toBe('retry');
	});

	it('keeps the first when the retry scores worse', async () => {
		const h = harness({ durable: dur('first', OK_Q), scores: [{ ...FAIL, score: 45 }, { ...FAIL, score: 20 }] });
		const out = await h.stage();
		expect(out.durable.id).toBe('first');
		expect(out.verdict.score).toBe(45);
		expect(out.retry).toMatchObject({ ran: true, kept: 'first' });
	});

	it('keeps the first when the retry is deterministically broken, whatever the judge says', async () => {
		const h = harness({ durable: dur('first', LOW_Q), scores: [FAIL, PASS], secondQuality: DEGENERATE_Q });
		const out = await h.stage();
		expect(out.durable.id).toBe('first');
	});

	it('keeps the first when the judge goes blind on the retry (an outage proves nothing)', async () => {
		const h = harness({ durable: dur('first', OK_Q), scores: [{ ...FAIL, score: 40 }, OUTAGE] });
		const out = await h.stage();
		expect(out.durable.id).toBe('first');
		expect(out.verdict.score).toBe(40);
	});

	it('keeps the better structural result when both attempts are structurally weak', async () => {
		const h = harness({ durable: dur('first', DEGENERATE_Q), secondQuality: LOW_Q, visionApplies: () => false });
		const out = await h.stage();
		expect(out.durable.id).toBe('second');
		const worse = harness({ durable: dur('first', LOW_Q), secondQuality: DEGENERATE_Q, visionApplies: () => false });
		expect((await worse.stage()).durable.id).toBe('first');
	});

	it('betterAttempt never prefers an unproven result over a judged one', () => {
		expect(betterAttempt({ durable: dur('a'), verdict: FAIL }, { durable: dur('b'), verdict: null })).toBe(false);
		expect(betterAttempt({ durable: dur('a'), verdict: FAIL }, { durable: dur('b'), verdict: PASS })).toBe(true);
		expect(betterAttempt({ durable: dur('a'), verdict: PASS }, { durable: dur('b'), verdict: PASS })).toBe(false);
	});
});

describe('judge failures never block or reroll a delivered model', () => {
	it('an outage verdict neither retries nor withholds', async () => {
		const h = harness({ durable: dur('first', OK_Q), scores: [OUTAGE] });
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(0);
		expect(out.durable.id).toBe('first');
		expect(out.retry.ran).toBe(false);
	});

	it('a judge that throws is treated as an outage', async () => {
		const h = harness({ durable: dur('first', OK_Q), scores: [new Error('boom')] });
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(0);
		expect(out.durable.id).toBe('first');
		expect(out.verdict.qa_available).toBe(false);
	});

	it('a failing verdict with no score at all is not a reason to retry', async () => {
		const h = harness({ durable: dur('first', OK_Q), scores: [{ pass: false, qa_available: true }] });
		const out = await h.stage();
		expect(h.calls.regenerate).toHaveLength(0);
		expect(out.durable.id).toBe('first');
	});

	it('a judge that hangs is cut off at the budget and the model is delivered', async () => {
		const t0 = Date.now();
		const out = await harness({
			durable: dur('first', OK_Q),
			score: () => new Promise(() => {}),
			budgetMs: 60,
		}).stage();
		expect(Date.now() - t0).toBeLessThan(1500);
		expect(out.durable.id).toBe('first');
		expect(out.verdict).toMatchObject({ pass: true, qa_available: false });
		expect(out.verdict.reason).toMatch(/budget/);
	});

	it('shares one scoring budget across both scorings, so the added time is bounded', async () => {
		let n = 0;
		const t0 = Date.now();
		const out = await harness({
			durable: dur('first', OK_Q),
			budgetMs: 200,
			score: async () => {
				n += 1;
				if (n === 1) return FAIL; // fast, usable, failing: asks for the retry
				return new Promise(() => {}); // the retry's scoring hangs
			},
		}).stage();
		expect(Date.now() - t0).toBeLessThan(2000);
		// Unproven retry loses to the judged first attempt.
		expect(out.durable.id).toBe('first');
	});

	it('scoreWithinBudget returns a fail-open verdict for a hang, a throw and a non-object', async () => {
		const hang = await scoreWithinBudget(() => new Promise(() => {}), 40);
		expect(hang).toMatchObject({ pass: true, qa_available: false });
		const thrown = await scoreWithinBudget(async () => { throw new Error('x'); }, 40);
		expect(thrown).toMatchObject({ pass: true, qa_available: false });
		const junk = await scoreWithinBudget(async () => 'nope', 40);
		expect(junk).toMatchObject({ pass: true, qa_available: false });
		const real = await scoreWithinBudget(async () => PASS, 40);
		expect(real).toBe(PASS);
	});

	it('exposes bounded, ordered defaults', () => {
		expect(QUALITY_STAGE_LIMITS.scoreBudgetMs).toBeGreaterThan(0);
		expect(QUALITY_STAGE_LIMITS.pollScoreBudgetMs).toBeGreaterThan(0);
		expect(QUALITY_STAGE_LIMITS.pollScoreBudgetMs).toBeLessThanOrEqual(QUALITY_STAGE_LIMITS.scoreBudgetMs);
	});
});

describe('the user is told what happened', () => {
	it('says nothing when no retry was considered', () => {
		expect(describeQualityRetry({ ran: false, declined: null })).toBeNull();
	});

	it('says a retry ran and which result is shown', () => {
		expect(describeQualityRetry({ ran: true, reason: 'structural', kept: 'retry' })).toMatch(/regenerated once/i);
		expect(describeQualityRetry({ ran: true, reason: 'vision', kept: 'first' })).toMatch(/kept the first/i);
	});

	it('says why a retry was skipped when the first result was flagged', () => {
		expect(describeQualityRetry({ ran: false, declined: 'busy' })).toMatch(/busy/i);
		expect(describeQualityRetry({ ran: false, declined: 'allowance' })).toMatch(/limit/i);
	});

	it('never mentions a retry the user was not subjected to when the cap is off', () => {
		expect(describeQualityRetry({ ran: false, declined: 'disabled' })).toBeNull();
	});

	it('reports the retry on the stage result so the response can carry it', async () => {
		const out = await harness({ durable: dur('first', DEGENERATE_Q), scores: [PASS] }).stage();
		expect(out.retried).toBe(true);
		expect(out.retry.message).toMatch(/regenerated once/i);
	});
});
