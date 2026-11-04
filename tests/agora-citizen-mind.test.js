import { describe, it, expect, vi } from 'vitest';
import {
	MemoryStream,
	importanceOf,
	recency,
	REFLECTION_THRESHOLD,
	MAX_MEMORIES,
	RECENCY_HALF_LIFE_MS,
} from '../workers/agora-citizens/memory-stream.js';
import { parseInsights, reflect, MAX_INSIGHTS } from '../workers/agora-citizens/reflect.js';
import { parsePlan, makePlan, MAX_PLAN_STEPS, PLAN_STEP_MAX } from '../workers/agora-citizens/plan.js';
import { MindKeeper, MAX_STORED_REFLECTIONS } from '../workers/agora-citizens/mind.js';

describe('importanceOf', () => {
	it('ranks a slash above a move and stays in 1..10', () => {
		expect(importanceOf({ kind: 'slashed' })).toBeGreaterThan(importanceOf({ kind: 'moved' }));
		for (const kind of ['moved', 'slashed', 'earned', 'unknown']) {
			const v = importanceOf({ kind, amountAtomic: '99999999999', repBefore: 0, repAfter: 500 });
			expect(v).toBeGreaterThanOrEqual(1);
			expect(v).toBeLessThanOrEqual(10);
		}
	});
	it('is monotonic in reward size and reputation swing', () => {
		const a = importanceOf({ kind: 'earned', amountAtomic: '1000' });
		const b = importanceOf({ kind: 'earned', amountAtomic: '10000000' });
		const c = importanceOf({ kind: 'earned', amountAtomic: '100000000000' });
		expect(a).toBeLessThanOrEqual(b);
		expect(b).toBeLessThanOrEqual(c);
		const r1 = importanceOf({ kind: 'vouched', repBefore: 10, repAfter: 12 });
		const r2 = importanceOf({ kind: 'vouched', repBefore: 10, repAfter: 40 });
		expect(r1).toBeLessThanOrEqual(r2);
	});
});

describe('MemoryStream', () => {
	const now = 1_000_000_000;
	it('retrieves by relevance when recency and importance tie', () => {
		const s = new MemoryStream();
		s.observe({ kind: 'earned', text: 'Won the bounty for scraping the market feed' }, now);
		s.observe({ kind: 'earned', text: 'Rested near the fountain all afternoon' }, now);
		const top = s.retrieve('market feed bounty', { k: 1, now });
		expect(top[0].text).toMatch(/market feed/);
	});
	it('prefers recent memories over old ones of equal importance', () => {
		const s = new MemoryStream();
		s.observe({ kind: 'earned', text: 'old thing' }, now - 5 * RECENCY_HALF_LIFE_MS);
		s.observe({ kind: 'earned', text: 'new thing' }, now);
		expect(s.retrieve('', { k: 1, now })[0].text).toBe('new thing');
		expect(recency(0)).toBe(1);
		expect(recency(RECENCY_HALF_LIFE_MS)).toBeCloseTo(0.5);
	});
	it('triggers reflection on summed importance and resets after markReflected', () => {
		const s = new MemoryStream();
		expect(s.shouldReflect()).toBe(false);
		let n = 0;
		while (!s.shouldReflect() && n < 50) s.observe({ kind: 'slashed', text: `slash ${n++}` }, now);
		expect(s.pendingImportance).toBeGreaterThanOrEqual(REFLECTION_THRESHOLD);
		s.markReflected();
		expect(s.shouldReflect()).toBe(false);
	});
	it('does not count reflections toward the next trigger', () => {
		const s = new MemoryStream();
		s.observe({ kind: 'reflection', text: 'I am wise' }, now);
		expect(s.pendingImportance).toBe(0);
	});
	it('ignores empty text and evicts low-importance memories first', () => {
		const s = new MemoryStream({ max: 3 });
		expect(s.observe({ kind: 'moved', text: '  ' }, now)).toBeNull();
		s.observe({ kind: 'slashed', text: 'lost stake' }, now);
		s.observe({ kind: 'moved', text: 'walked a' }, now + 1);
		s.observe({ kind: 'moved', text: 'walked b' }, now + 2);
		s.observe({ kind: 'moved', text: 'walked c' }, now + 3);
		expect(s.memories).toHaveLength(3);
		expect(s.memories.some((m) => m.text === 'lost stake')).toBe(true);
		expect(MAX_MEMORIES).toBeGreaterThan(3);
	});
});

describe('reflect / plan parsing', () => {
	it('caps insights and drops non-strings', () => {
		const out = parseInsights('noise ["a", 5, "b", "c", "d"] trailing');
		expect(out).toEqual(['a', 'b', 'c']);
		expect(out.length).toBeLessThanOrEqual(MAX_INSIGHTS);
		expect(parseInsights('not json')).toEqual([]);
		expect(parseInsights('[broken')).toEqual([]);
	});
	it('bounds plan length and step length', () => {
		const steps = Array.from({ length: 12 }, (_, i) => 'x'.repeat(500) + i);
		const out = parsePlan(JSON.stringify(steps));
		expect(out).toHaveLength(MAX_PLAN_STEPS);
		for (const s of out) expect(s.length).toBeLessThanOrEqual(PLAN_STEP_MAX);
		expect(parsePlan('{"a":1}')).toEqual([]);
	});
	it('reflect stores insights as high-importance reflection memories', async () => {
		const s = new MemoryStream();
		s.observe({ kind: 'earned', text: 'Won a bounty' }, 10);
		const llm = vi.fn().mockResolvedValue({ text: '["I work best alone."]' });
		const r = await reflect({ name: 'Ada', profession: 'fetcher', stream: s, llm, now: 20 });
		expect(r.insights).toEqual(['I work best alone.']);
		expect(s.memories.at(-1).kind).toBe('reflection');
		expect(llm.mock.calls[0][0].user).toContain('Won a bounty');
	});
	it('reflect and plan return null on unusable model output', async () => {
		const s = new MemoryStream();
		s.observe({ kind: 'earned', text: 'Won a bounty' }, 10);
		const llm = async () => ({ text: 'sorry, cannot' });
		expect(await reflect({ name: 'Ada', stream: s, llm })).toBeNull();
		expect(await makePlan({ name: 'Ada', stream: s, llm })).toBeNull();
	});
});

describe('MindKeeper', () => {
	const mk = (llmText) => {
		const store = { appendActivity: vi.fn().mockResolvedValue(7), saveMind: vi.fn().mockResolvedValue() };
		const llm = vi.fn().mockResolvedValue({ text: llmText });
		const keeper = new MindKeeper({ store, llm, minGapMs: 0 });
		keeper.register({ id: 'c1', name: 'Ada', profession: 'fetcher' });
		return { store, llm, keeper, wrapped: keeper.wrapStore(store) };
	};
	const slash = (i) => ({ citizenId: 'c1', kind: 'slashed', narrative: `Ada lost stake ${i}` });

	it('observes through the wrapped store and ignores duplicates', async () => {
		const { store, keeper, wrapped } = mk('[]');
		await wrapped.appendActivity(slash(1));
		expect(keeper.citizens.get('c1').mind.observed).toBe(1);
		store.appendActivity.mockResolvedValueOnce(null);
		await wrapped.appendActivity(slash(2));
		expect(keeper.citizens.get('c1').mind.observed).toBe(1);
	});
	it('does not call the model until the importance threshold is crossed', async () => {
		const { llm, keeper, wrapped } = mk('["insight"]');
		await wrapped.appendActivity(slash(1));
		expect(await keeper.tick()).toBe(0);
		expect(llm).not.toHaveBeenCalled();
	});
	it('reflects, plans and persists once the threshold is crossed', async () => {
		const { store, llm, keeper, wrapped } = mk('["Stakes are risky.", "Trust few."]');
		for (let i = 0; i < 6; i++) await wrapped.appendActivity(slash(i));
		expect(await keeper.tick()).toBe(1);
		expect(llm).toHaveBeenCalledTimes(2);
		const saved = store.saveMind.mock.calls[0][1];
		expect(saved.reflections[0].text).toContain('Stakes are risky.');
		expect(saved.plan.steps.length).toBeGreaterThan(0);
		expect(saved.plan.steps.length).toBeLessThanOrEqual(MAX_PLAN_STEPS);
		// Reset: no second reflection until more happens.
		expect(await keeper.tick()).toBe(0);
	});
	it('keeps only the latest reflections and survives a model failure', async () => {
		const { store, llm, keeper, wrapped } = mk('["one"]');
		for (let round = 0; round < MAX_STORED_REFLECTIONS + 2; round++) {
			for (let i = 0; i < 6; i++) await wrapped.appendActivity(slash(i));
			await keeper.tick();
		}
		expect(keeper.citizens.get('c1').mind.reflections).toHaveLength(MAX_STORED_REFLECTIONS);
		llm.mockRejectedValue(new Error('vertex 403'));
		for (let i = 0; i < 6; i++) await wrapped.appendActivity(slash(i));
		await expect(keeper.tick()).resolves.toBe(0);
		expect(keeper.citizens.get('c1').busy).toBe(false);
		expect(store.saveMind).toHaveBeenCalled();
	});
});

describe('shapeMind (passport payload)', () => {
	it('bounds and cleans stored mind, and is null when empty', async () => {
		const { shapeMind } = await import('../api/agora/[action].js');
		expect(shapeMind(null)).toBeNull();
		expect(shapeMind({ mind: { reflections: [], plan: null } })).toBeNull();
		const m = shapeMind({
			mind: {
				reflections: Array.from({ length: 9 }, (_, i) => ({ text: 'r' + i, at: 1 })).concat([{ text: 5 }]),
				plan: { steps: Array.from({ length: 9 }, (_, i) => 's' + i), at: 2 },
				observed: 12,
			},
		});
		expect(m.reflections).toHaveLength(5);
		expect(m.plan.steps).toHaveLength(5);
		expect(m.observed).toBe(12);
	});
});
