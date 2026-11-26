// Submit-outcome counters: how generation requests ended, folded into the
// pre-job breakdown and the end-to-end success rate, and surfaced in the
// health payload without changing any key that was already there.
//
// The lane rate (jobs that reached a 3D lane) read 93% on 2026-11-26 while
// text prompts were failing at the reference image step. The end-to-end rate
// pinned here is the number that would have read low that day.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	submitOutcomeFields,
	summarizeSubmitOutcomes,
} from '../../api/_lib/forge-events.js';

describe('submitOutcomeFields', () => {
	it('counts a created job and a delivered cache hit as accepted', () => {
		expect(submitOutcomeFields({ outcome: 'job' })).toEqual({ 'rq:accepted': 1, 'rq:job': 1 });
		expect(submitOutcomeFields({ outcome: 'delivered' })).toEqual({ 'rq:accepted': 1, 'rq:delivered': 1 });
	});

	it('counts a pre-job failure by stage, cause, provider and stated wait', () => {
		expect(
			submitOutcomeFields({ outcome: 'failed', stage: 'reference', cause: 'rate_limited', provider: 'pollinations', retryAfterS: 45 }),
		).toEqual({
			'rq:accepted': 1,
			'rq:failed': 1,
			'pj:reference:rate_limited': 1,
			'pjp:pollinations': 1,
			'pjw:sum': 45,
			'pjw:n': 1,
		});
	});

	it('keeps a sign-in refusal out of accepted', () => {
		expect(submitOutcomeFields({ outcome: 'sign_in', stage: 'sign_in', cause: 'sign_in_required' })).toEqual({
			'rq:signin': 1,
			'pj:sign_in:sign_in_required': 1,
		});
	});

	it('sanitizes tokens so a hostile cause cannot forge a field', () => {
		const f = submitOutcomeFields({ outcome: 'failed', stage: 'input', cause: 'x:pj:evil field!' });
		expect(Object.keys(f)).toContain('pj:input:xpjevilfield');
	});

	it('ignores replays, duplicates and unknown outcomes', () => {
		for (const outcome of ['replay', 'duplicate', 'nonsense', undefined]) {
			expect(submitOutcomeFields({ outcome })).toBeNull();
		}
	});
});

describe('summarizeSubmitOutcomes', () => {
	it('reports a low end-to-end rate while the lane rate is high (the 2026-11-26 shape)', () => {
		// 100 accepted: 40 jobs (lane 93%), 60 died at the reference image.
		const s = summarizeSubmitOutcomes([
			{ ok: 37, fail: 3, 'rq:accepted': 60, 'rq:job': 20, 'rq:failed': 40, 'pj:reference:generation_unavailable': 40 },
			{ 'rq:accepted': 40, 'rq:job': 20, 'rq:failed': 20, 'pj:reference:rate_limited': 15, 'pj:submit:provider_busy': 5, 'pjp:pollinations': 15, 'pjw:sum': 450, 'pjw:n': 15 },
		]);
		expect(s.lane_success_rate).toBe(0.925);
		expect(s.accepted).toBe(100);
		expect(s.jobs_created).toBe(40);
		expect(s.failed_before_job).toBe(60);
		expect(s.pre_job_failure_rate).toBe(0.6);
		expect(s.end_to_end_success_rate).toBe(0.37); // 40 jobs x 0.925 / 100
		expect(s.by_stage).toEqual({ reference: 55, submit: 5 });
		expect(s.by_cause[0]).toEqual({ stage: 'reference', cause: 'generation_unavailable', count: 40 });
		expect(s.by_cause.map((c) => c.cause)).toEqual(['generation_unavailable', 'rate_limited', 'provider_busy']);
		expect(s.by_provider).toEqual({ pollinations: 15 });
		expect(s.avg_stated_wait_s).toBe(30);
	});

	it('credits cache hits as delivered', () => {
		const s = summarizeSubmitOutcomes([{ 'rq:accepted': 4, 'rq:delivered': 4 }]);
		expect(s.end_to_end_success_rate).toBe(1);
	});

	it('is null, not 0 or 100%, when there is nothing to divide', () => {
		const empty = summarizeSubmitOutcomes([null, {}]);
		expect(empty.accepted).toBe(0);
		expect(empty.end_to_end_success_rate).toBeNull();
		expect(empty.pre_job_failure_rate).toBeNull();
		expect(empty.lane_success_rate).toBeNull();
		expect(empty.avg_stated_wait_s).toBeNull();
		// Jobs were created but none finished yet: the lane rate is unknown, so the
		// end-to-end rate is too, rather than a guessed number.
		expect(summarizeSubmitOutcomes([{ 'rq:accepted': 3, 'rq:job': 3 }]).end_to_end_success_rate).toBeNull();
	});

	it('still reads 0% end to end when every accepted request died before a job', () => {
		const s = summarizeSubmitOutcomes([{ 'rq:accepted': 5, 'rq:failed': 5, 'pj:rate_limit:rate_limited': 5 }]);
		expect(s.end_to_end_success_rate).toBe(0);
	});
});

describe('readSubmitOutcomes and readGenerationMetrics over the store', () => {
	afterEach(() => {
		vi.doUnmock('../../api/_lib/redis.js');
		vi.resetModules();
	});

	async function withStore(buckets) {
		vi.resetModules();
		const hgetall = vi.fn(async (key) => buckets(key));
		vi.doMock('../../api/_lib/redis.js', () => ({ getRedis: () => ({ hgetall }) }));
		const mod = await import('../../api/_lib/forge-events.js');
		return { ...mod, hgetall };
	}

	it('reads twelve five-minute buckets for the last hour and 24 hourly buckets for the day', async () => {
		const { readSubmitOutcomes, hgetall } = await withStore((key) =>
			key.startsWith('fc:metrics:m5:')
				? { 'rq:accepted': 1, 'rq:failed': 1, 'pj:reference:rate_limited': 1 }
				: { ok: 1, 'rq:accepted': 2, 'rq:job': 1, 'rq:failed': 1, 'pj:submit:provider_busy': 1 },
		);
		const out = await readSubmitOutcomes();
		const keys = hgetall.mock.calls.map((c) => c[0]);
		expect(keys.filter((k) => k.startsWith('fc:metrics:m5:'))).toHaveLength(12);
		expect(keys.filter((k) => !k.startsWith('fc:metrics:m5:'))).toHaveLength(24);
		expect(out.last_hour.accepted).toBe(12);
		expect(out.last_hour.by_stage).toEqual({ reference: 12 });
		expect(out.last_hour.window_minutes).toBeGreaterThan(55);
		expect(out.last_hour.window_minutes).toBeLessThanOrEqual(60);
		expect(out.last_24h).toMatchObject({ window_hours: 24, accepted: 48, jobs_created: 24, failed_before_job: 24 });
		expect(out.last_24h.end_to_end_success_rate).toBe(0.5);
	});

	it('reads as unknown (null), not zeros, when every bucket read fails', async () => {
		const { readSubmitOutcomes } = await withStore(() => {
			throw new Error('redis command timed out after 5000ms');
		});
		expect(await readSubmitOutcomes()).toBeNull();
	});

	it('still counts what it could read when only some reads fail', async () => {
		let n = 0;
		const { readSubmitOutcomes } = await withStore((key) => {
			n += 1;
			if (n % 2) throw new Error('flaky');
			return key.startsWith('fc:metrics:m5:') ? null : { 'rq:accepted': 1, 'rq:failed': 1, 'pj:input:invalid_prompt': 1 };
		});
		const out = await readSubmitOutcomes();
		expect(out.last_24h.accepted).toBe(12);
		expect(out.last_24h.by_stage).toEqual({ input: 12 });
	});

	it('puts the end-to-end rate beside the lane rate in the metrics block', async () => {
		const { readGenerationMetrics } = await withStore((key) =>
			key.endsWith(String(Math.floor(Date.now() / 3_600_000)))
				? { total: 10, ok: 9, fail: 1, 'rq:accepted': 20, 'rq:job': 10, 'rq:failed': 10, 'pj:reference:rate_limited': 10 }
				: null,
		);
		const m = await readGenerationMetrics();
		expect(m.success_rate).toBe(0.9);
		expect(m.success_rate_scope).toBe('jobs that reached a 3D lane');
		expect(m.requests_accepted).toBe(20);
		expect(m.failed_before_job).toBe(10);
		expect(m.end_to_end_success_rate).toBe(0.45);
	});
});

describe('health payload', () => {
	afterEach(() => {
		vi.doUnmock('../../api/_lib/forge-events.js');
		vi.resetModules();
	});

	const PRE_JOB = {
		last_hour: summarizeSubmitOutcomes([{ 'rq:accepted': 2, 'rq:failed': 2, 'pj:reference:rate_limited': 2 }]),
		last_24h: summarizeSubmitOutcomes([{ ok: 10, 'rq:accepted': 40, 'rq:job': 10, 'rq:failed': 30, 'pj:reference:rate_limited': 30 }]),
	};

	async function healthWith({ metrics, preJob }) {
		vi.resetModules();
		vi.doMock('../../api/_lib/forge-events.js', async (importOriginal) => ({
			...(await importOriginal()),
			readGenerationMetrics: async () => metrics,
			readSubmitOutcomes: async () => preJob,
		}));
		const savedFetch = global.fetch;
		global.fetch = vi.fn(async () => new Response(JSON.stringify({ protected: true, blueprints: [] }), { status: 200 }));
		try {
			const { probeForgeHealth } = await import('../../api/_lib/forge-health.js');
			return await probeForgeHealth({ force: true });
		} finally {
			global.fetch = savedFetch;
		}
	}

	it('adds pre_job and keeps every key that was already there', async () => {
		const health = await healthWith({ metrics: { total: 10, ok: 10, fail: 0, success_rate: 1 }, preJob: PRE_JOB });
		for (const key of ['status', 'generated_at', 'backends', 'editing', 'limiter', 'llm', 'world', 'redis', 'metrics', 'cached']) {
			expect(health).toHaveProperty(key);
		}
		expect(health.pre_job.last_24h).toMatchObject({ accepted: 40, failed_before_job: 30 });
		expect(health.pre_job.last_hour.by_cause).toEqual([{ stage: 'reference', cause: 'rate_limited', count: 2 }]);
	});

	it('omits pre_job when the store is absent, rather than showing zeros', async () => {
		const health = await healthWith({ metrics: null, preJob: null });
		expect(health).not.toHaveProperty('pre_job');
		expect(health).not.toHaveProperty('metrics');
	});
});

describe('generationVerdict', () => {
	it('degrades on a low end-to-end rate even when the lane rate is green', async () => {
		const { generationVerdict } = await import('../../api/_lib/forge-health.js');
		const greenLanes = { total: 100, success_rate: 0.95 };
		const v = generationVerdict(greenLanes, { last_24h: { accepted: 40, end_to_end_success_rate: 0.4 } });
		expect(v).toEqual({ unhealthy: true, lane: false, end_to_end: true });
	});

	it('ignores a low end-to-end rate under the 20-request floor, and reads healthy when both are fine', async () => {
		const { generationVerdict } = await import('../../api/_lib/forge-health.js');
		expect(generationVerdict(null, { last_24h: { accepted: 19, end_to_end_success_rate: 0 } }).unhealthy).toBe(false);
		expect(generationVerdict({ total: 50, success_rate: 0.9 }, { last_24h: { accepted: 50, end_to_end_success_rate: 0.8 } }).unhealthy).toBe(false);
		expect(generationVerdict(null, null).unhealthy).toBe(false);
	});

	it('keeps the existing lane rule', async () => {
		const { generationVerdict } = await import('../../api/_lib/forge-health.js');
		expect(generationVerdict({ total: 20, success_rate: 0.5 }, null)).toEqual({ unhealthy: true, lane: true, end_to_end: false });
	});
});

describe('/api/nvidia/stats end-to-end block', () => {
	it('puts the end-to-end rate beside the job rate, counts only', async () => {
		const { endToEndBlock } = await import('../../api/_lib/nvidia-lanes.js');
		const block = endToEndBlock({
			last_24h: summarizeSubmitOutcomes([{ ok: 9, fail: 1, 'rq:accepted': 20, 'rq:job': 10, 'rq:failed': 10, 'pj:reference:rate_limited': 10 }]),
		});
		expect(block).toEqual({
			window: '24h',
			scope: 'every Forge generation request accepted past sign-in, all lanes',
			accepted: 20,
			jobs_created: 10,
			failed_before_job: 10,
			end_to_end_success_pct: 45,
			job_success_pct: 90,
		});
	});

	it('says so when the counters are unavailable', async () => {
		const { endToEndBlock } = await import('../../api/_lib/nvidia-lanes.js');
		expect(endToEndBlock(null)).toEqual({ window: '24h', note: 'end-to-end counters are not available on this deployment' });
	});
});
