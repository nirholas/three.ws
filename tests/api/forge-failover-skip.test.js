// A lane with no env is skipped without any network call, a refusing lane is
// asked once, and a job visits each lane at most once.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const submit = vi.fn();
vi.mock('../../api/_providers/gcp.js', () => ({ createRegenProvider: () => ({ submit: (...a) => submit(...a) }) }));
vi.mock('../../api/_providers/replicate.js', () => ({ createRegenProvider: () => ({ submit: (...a) => submit(...a) }) }));
const markLaneUnhealthy = vi.fn(async () => {});
vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ byId: {} })),
	markLaneUnhealthy: (...a) => markLaneUnhealthy(...a),
}));

const { submitNextRedispatchLane, MAX_LAST_RESORT_SUBMITS } = await import('../../api/_lib/forge-failover.js');
const { BACKENDS } = await import('../../api/_lib/forge-tiers.js');

const ENV_KEYS = Object.values(BACKENDS).flatMap((b) => b.requiresEnv || []);
const args = { imageUrl: 'https://cdn.example/ref.png', prompt: 'a knight', tierId: 'standard', path: 'image', country: 'US' };

beforeEach(() => {
	submit.mockReset();
	markLaneUnhealthy.mockClear();
	for (const k of ENV_KEYS) delete process.env[k];
});

describe('poll-time redispatch lane selection', () => {
	it('makes no network call at all when no lane has its env', async () => {
		const out = await submitNextRedispatchLane({ ...args, attempted: ['trellis_selfhost'] });
		expect(out).toBeNull();
		expect(submit).not.toHaveBeenCalled();
	});

	it('asks each refusing lane once, cools it, and stops at the submit budget', async () => {
		process.env.MODEL_TRELLIS_URL = 'https://t.example.run.app';
		process.env.GCP_HUNYUAN3D_URL = 'https://h.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'k';
		process.env.REPLICATE_API_TOKEN = 'r';
		submit.mockRejectedValue(new Error('unreachable'));
		const out = await submitNextRedispatchLane({ ...args, attempted: [] });
		expect(out).toBeNull();
		const modes = submit.mock.calls.map((c) => c[0].mode);
		expect(new Set(modes).size).toBe(modes.length);
		expect(modes.length).toBeLessThanOrEqual(MAX_LAST_RESORT_SUBMITS);
		expect(markLaneUnhealthy).toHaveBeenCalledTimes(modes.length);
	});

	it('never re-asks a lane that already failed for this job', async () => {
		process.env.GCP_HUNYUAN3D_URL = 'https://h.example.run.app';
		process.env.GCP_RECONSTRUCTION_KEY = 'k';
		const out = await submitNextRedispatchLane({ ...args, attempted: ['hunyuan3d'] });
		expect(out).toBeNull();
		expect(submit).not.toHaveBeenCalled();
	});
});
