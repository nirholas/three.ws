// Tripo plays two roles in regen-provider.js: a BYOK 'reconstruct' provider
// (the user's own key, unchanged) and, new here, a platform 'rerig' lane that
// activates when TRIPO_API_KEY is set (house key, billed through our own
// credits). Both share the provider name 'tripo' on the job row, which makes
// getRegenProviderForJob's dispatch ambiguous at poll time unless the BYOK
// branch falls back to the house key when no user session key exists. These
// tests pin that fallback plus the rerig submit shape.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const rigMock = vi.fn(async () => ({ kind: 'task', taskId: 'task-rigged' }));
const imageTo3dMock = vi.fn(async () => ({ kind: 'task', taskId: 'task-recon' }));
const statusMock = vi.fn(async () => ({ status: 'done', resultGlbUrl: 'https://cdn/rigged.glb' }));

vi.mock('../api/_providers/tripo.js', () => ({
	createTripoProvider: (key) => ({
		rig: rigMock,
		imageTo3d: imageTo3dMock,
		status: statusMock,
		_key: key,
	}),
}));

let resolveProviderKeyMock;
vi.mock('../api/_lib/forge-provider-key.js', () => ({
	resolveProviderKey: (...args) => resolveProviderKeyMock(...args),
}));

let regen;
const priorKey = process.env.TRIPO_API_KEY;

beforeEach(async () => {
	vi.resetModules();
	rigMock.mockClear();
	imageTo3dMock.mockClear();
	resolveProviderKeyMock = vi.fn(async () => null);
	regen = await import('../api/_lib/regen-provider.js');
});

afterEach(() => {
	if (priorKey === undefined) delete process.env.TRIPO_API_KEY;
	else process.env.TRIPO_API_KEY = priorKey;
});

describe('tripo regen adapter: rerig mode', () => {
	it('supports both reconstruct and rerig', () => {
		const { instance } = regen.getRegenProviderByName('tripo', 'user-key');
		expect(instance.supportsMode('reconstruct')).toBe(true);
		expect(instance.supportsMode('rerig')).toBe(true);
		expect(instance.supportsMode('texture')).toBe(false);
	});

	it('rerig submit calls provider.rig with spec:mixamo and the source url as input', async () => {
		const { instance } = regen.getRegenProviderByName('tripo', 'user-key');
		const result = await instance.submit({ mode: 'rerig', sourceUrl: 'https://cdn/avatar.glb' });
		expect(rigMock).toHaveBeenCalledWith({ input: 'https://cdn/avatar.glb', spec: 'mixamo' });
		expect(result).toEqual({ extJobId: 'task-rigged', eta: 90, backend: 'tripo' });
	});

	it('rerig submit without a sourceUrl throws invalid_request', async () => {
		const { instance } = regen.getRegenProviderByName('tripo', 'user-key');
		await expect(instance.submit({ mode: 'rerig' })).rejects.toMatchObject({ code: 'invalid_request' });
	});
});

describe('getRegenProviderForJob("tripo") dispatch', () => {
	it('re-resolves the BYOK user key when a session key exists', async () => {
		resolveProviderKeyMock = vi.fn(async () => 'user-key');
		const { name, instance } = await regen.getRegenProviderForJob('tripo', {});
		expect(name).toBe('tripo');
		expect(instance).not.toBeNull();
		await instance.status('task-1');
		expect(statusMock).toHaveBeenCalledWith({ taskId: 'task-1' });
	});

	it('falls back to the house key when no user session key exists and TRIPO_API_KEY is set', async () => {
		process.env.TRIPO_API_KEY = 'house-key';
		resolveProviderKeyMock = vi.fn(async () => null);
		const { name, instance } = await regen.getRegenProviderForJob('tripo', {});
		expect(name).toBe('tripo');
		expect(instance).not.toBeNull();
		expect(instance.supportsMode('rerig')).toBe(true);
	});

	it('reports no instance when neither a user key nor a house key is available', async () => {
		delete process.env.TRIPO_API_KEY;
		resolveProviderKeyMock = vi.fn(async () => null);
		const { name, instance } = await regen.getRegenProviderForJob('tripo', {});
		expect(name).toBe('tripo');
		expect(instance).toBeNull();
	});
});

describe('platform provider candidates include tripo when TRIPO_API_KEY is set', () => {
	it('getRegenProviderForMode("rerig") picks up the house tripo lane when nothing else configured', async () => {
		const priorReplicate = process.env.REPLICATE_API_TOKEN;
		const priorGcpUrl = process.env.GCP_RECONSTRUCTION_URL;
		const priorGcpKey = process.env.GCP_RECONSTRUCTION_KEY;
		const priorHf = process.env.HF_TOKEN;
		delete process.env.REPLICATE_API_TOKEN;
		delete process.env.GCP_RECONSTRUCTION_URL;
		delete process.env.GCP_RECONSTRUCTION_KEY;
		delete process.env.HF_TOKEN;
		process.env.TRIPO_API_KEY = 'house-key';
		try {
			const { name, instance } = await regen.getRegenProviderForMode('rerig');
			expect(name).toBe('tripo');
			expect(instance).not.toBeNull();
		} finally {
			if (priorReplicate === undefined) delete process.env.REPLICATE_API_TOKEN; else process.env.REPLICATE_API_TOKEN = priorReplicate;
			if (priorGcpUrl === undefined) delete process.env.GCP_RECONSTRUCTION_URL; else process.env.GCP_RECONSTRUCTION_URL = priorGcpUrl;
			if (priorGcpKey === undefined) delete process.env.GCP_RECONSTRUCTION_KEY; else process.env.GCP_RECONSTRUCTION_KEY = priorGcpKey;
			if (priorHf === undefined) delete process.env.HF_TOKEN; else process.env.HF_TOKEN = priorHf;
		}
	});

	it('unset TRIPO_API_KEY keeps tripo out of the platform candidate list', async () => {
		delete process.env.TRIPO_API_KEY;
		const { name, instance } = await regen.getRegenProviderForMode('rerig');
		expect(instance === null || name !== 'tripo').toBe(true);
	});
});
