// Measured 2026-11-06: 20 of about 30 paid forge calls answered 503 after 60 to 90s.
// The paid route knew only NVIDIA NIM (504ing) and HuggingFace (Spaces erroring),
// then told the buyer generation was not configured, while the self-hosted TRELLIS
// worker finished 81 jobs for the regular Forge in the same window.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const gcp = vi.hoisted(() => ({ submit: vi.fn() }));
const hf = vi.hoisted(() => ({ submit: vi.fn(), status: vi.fn() }));
const lane = vi.hoisted(() => ({ configured: true, status: 'healthy' }));

vi.mock('../api/_providers/nvidia.js', () => ({
	createNvidiaProvider: () => ({ textTo3d: async () => { throw new Error('NVIDIA returned 504'); } }),
}));
vi.mock('../api/_providers/gcp.js', () => ({ createRegenProvider: () => gcp }));
vi.mock('../api/_providers/huggingface.js', () => ({ createRegenProvider: () => hf }));
vi.mock('../api/_mcp3d/text-to-image.js', () => ({
	textToImage: async () => ({ imageUrl: 'https://three.ws/ref.png' }),
}));
vi.mock('../api/_lib/forge-lane-health.js', async (orig) => ({
	...(await orig()),
	laneHealthSnapshot: async () => ({ byId: { trellis_selfhost: { status: lane.status } } }),
	markLaneUnhealthy: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/forge-tiers.js', async (orig) => ({
	...(await orig()),
	backendIsConfigured: (id) => id === 'trellis_selfhost' && lane.configured,
}));

const { submitGeneration } = await import('../api/x402/forge.js');
const { decodeJobToken } = await import('../api/_lib/forge-job-token.js');

const textCall = { prompt: 'a brass lantern', imageUrls: [], isImageMode: false, aspect: '1:1', tier: 'standard' };

describe('paid forge reaches the self-hosted lane', () => {
	beforeEach(() => {
		process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret';
		lane.configured = true;
		lane.status = 'healthy';
		gcp.submit.mockReset().mockResolvedValue({ extJobId: 'job-1' });
		hf.submit.mockReset().mockRejectedValue(new Error('Space error'));
	});

	it('hands a text prompt to self-host TRELLIS when NIM fails, pollable through the gcp route', async () => {
		const out = await submitGeneration(textCall);
		expect(out).toMatchObject({ status: 'queued', backend: 'trellis_selfhost', mode: 'text_to_3d' });
		expect(gcp.submit.mock.calls[0][0]).toMatchObject({ mode: 'trellis', sourceUrl: 'https://three.ws/ref.png' });
		expect(decodeJobToken(out.job_id)).toMatchObject({ provider: 'gcp', taskId: 'job-1' });
		expect(out.poll_url).toContain('/api/forge?job=');
		expect(hf.submit).not.toHaveBeenCalled();
	});

	it('moves on to the next lane when the worker refuses the job', async () => {
		gcp.submit.mockRejectedValue(Object.assign(new Error('503'), { code: 'provider_unreachable' }));
		await expect(submitGeneration(textCall)).rejects.toThrow();
		expect(hf.submit).toHaveBeenCalled();
	});

	it('skips the worker while the lane is down', async () => {
		lane.status = 'down';
		await expect(submitGeneration(textCall)).rejects.toThrow();
		expect(gcp.submit).not.toHaveBeenCalled();
	});
});
