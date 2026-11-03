// Regression: /play downloaded /animations/manifest.json twice on every load.
//
// loadManifest() in src/game/avatar-rig.js guarded on its cached result, which
// is only set once the fetch resolves. The local player's rig and the ambient
// crowd both call it during boot, so the second caller saw an empty cache while
// the first request was still in flight and started a duplicate download. The
// event audit (scripts/audit-event-client.mjs) flagged it on production as
// "downloaded 2x by page code". Concurrent callers must share one request.

import { describe, it, expect, vi } from 'vitest';

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
	GLTFLoader: class { setDRACOLoader() {} setMeshoptDecoder() {} register() {} },
}));
vi.mock('three/addons/loaders/DRACOLoader.js', () => ({
	DRACOLoader: class { setDecoderPath() {} },
}));
vi.mock('../src/viewer/internal.js', () => ({ getMeshoptDecoder: async () => null }));
vi.mock('../src/game/vrm-loader.js', () => ({
	setVrmPluginFactory: () => {},
	installVrmPlugin: () => false,
	prepareVrmModel: () => ({ vrm: false }),
}));
vi.mock('../src/game/play-handoff.js', () => ({
	GUEST_SENTINEL: '__guest__',
	resolveGuestAvatar: async () => '',
}));

const manifest = [
	{ name: 'idle', url: '/animations/clips/idle.json' },
	{ name: 'walk', url: '/animations/clips/walk.json' },
	{ name: 'wave', url: '/animations/clips/wave.json' },
];
let release;
const gate = new Promise((r) => { release = r; });
const fetchMock = vi.fn(async (url) => {
	if (String(url).includes('/animations/manifest.json')) await gate;
	return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } });
});
vi.stubGlobal('fetch', fetchMock);

const { loadManifest, getAllEmoteDefs } = await import('../src/game/avatar-rig.js');

describe('loadManifest', () => {
	it('shares one in-flight request between concurrent callers', async () => {
		const a = loadManifest();
		const b = loadManifest();
		release();
		await Promise.all([a, b]);
		const calls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/animations/manifest.json'));
		expect(calls).toHaveLength(1);
		expect(getAllEmoteDefs().map((d) => d.name)).toContain('wave');
	});

	it('does not fetch again once the manifest is cached', async () => {
		const before = fetchMock.mock.calls.length;
		await loadManifest();
		expect(fetchMock.mock.calls.length).toBe(before);
	});
});
