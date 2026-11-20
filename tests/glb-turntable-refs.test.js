// Multi-angle reference renders for hero clips (api/_lib/glb-turntable-refs.js).
//
// Real CPU-lane renders of a small asymmetric GLB: if an angle never reaches
// the rasterizer, two renders come out identical and these fail.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { buildAsymmetricGlb } from './_helpers/asymmetric-glb.js';

let glbBytes = null;

vi.mock('../api/_lib/fetch-model.js', () => ({
	fetchModel: vi.fn(async () => ({ bytes: glbBytes, contentType: 'model/gltf-binary' })),
}));

beforeEach(async () => {
	if (!glbBytes) glbBytes = await buildAsymmetricGlb();
	const { clearModelCache } = await import('../api/_lib/render-cpu.js');
	clearModelCache();
	delete process.env.RENDER_CPU_LANE;
});

describe('planAngles', () => {
	it('spaces six angles evenly on one low ring, starting dead front', async () => {
		const { planAngles } = await import('../api/_lib/glb-turntable-refs.js');
		expect(planAngles()).toEqual([
			{ azimuth: 0, elevation: 10 },
			{ azimuth: 60, elevation: 10 },
			{ azimuth: 120, elevation: 10 },
			{ azimuth: 180, elevation: 10 },
			{ azimuth: -120, elevation: 10 },
			{ azimuth: -60, elevation: 10 },
		]);
	});

	it('adds a higher, offset ring past eight angles so no view repeats', async () => {
		const { planAngles, MAX_ANGLE_COUNT } = await import('../api/_lib/glb-turntable-refs.js');
		const angles = planAngles(MAX_ANGLE_COUNT);
		expect(angles).toHaveLength(14);
		expect(angles[0]).toEqual({ azimuth: 0, elevation: 10 });
		expect(angles.filter((a) => a.elevation === 10)).toHaveLength(7);
		expect(angles.filter((a) => a.elevation === 32)).toHaveLength(7);
		const keys = new Set(angles.map((a) => `${a.azimuth}/${a.elevation}`));
		expect(keys.size).toBe(14);
	});

	it('refuses counts outside 1 to 14', async () => {
		const { planAngles } = await import('../api/_lib/glb-turntable-refs.js');
		expect(() => planAngles(0)).toThrow(/1 to 14/);
		expect(() => planAngles(15)).toThrow(/1 to 14/);
		expect(() => planAngles(2.5)).toThrow(/1 to 14/);
		expect(planAngles(1)).toEqual([{ azimuth: 0, elevation: 10 }]);
	});
});

describe('renderTurntableRefs', () => {
	it('returns one distinct PNG per angle, with its angle and timing', async () => {
		const { renderTurntableRefs } = await import('../api/_lib/glb-turntable-refs.js');
		const out = await renderTurntableRefs({ glbUrl: 'https://example.com/l.glb', size: 96 });
		expect(out.refs).toHaveLength(6);
		const hashes = new Set();
		for (const ref of out.refs) {
			expect(ref.png.subarray(0, 4).toString('hex')).toBe('89504e47');
			expect(ref.width).toBe(96);
			expect(ref.height).toBe(96);
			expect(ref.ms).toBeGreaterThanOrEqual(0);
			hashes.add(createHash('sha256').update(ref.png).digest('hex'));
		}
		expect(hashes.size).toBe(6);
		expect(out.refs.map((r) => r.azimuth)).toEqual([0, 60, 120, 180, -120, -60]);
		expect(out.msPerAngle).toBeGreaterThanOrEqual(0);
	});

	it('renders the maximum of fourteen angles', async () => {
		const { renderTurntableRefs } = await import('../api/_lib/glb-turntable-refs.js');
		const out = await renderTurntableRefs({ glbUrl: 'https://example.com/l.glb', size: 64, count: 14 });
		expect(out.refs).toHaveLength(14);
		expect(new Set(out.refs.map((r) => createHash('sha256').update(r.png).digest('hex'))).size).toBe(14);
	});

	it('needs a GLB URL', async () => {
		const { renderTurntableRefs } = await import('../api/_lib/glb-turntable-refs.js');
		await expect(renderTurntableRefs({})).rejects.toThrow(/glbUrl/);
	});
});

describe('helpers', () => {
	it('encodes a PNG as a data URI and builds the public per-angle render URL', async () => {
		const { pngDataUri, refRenderUrl } = await import('../api/_lib/glb-turntable-refs.js');
		expect(pngDataUri(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('data:image/png;base64,iVBORw==');
		const url = refRenderUrl({ glbUrl: 'https://three.ws/avatars/fox.glb', azimuth: -60, elevation: 10, size: 256 });
		const q = new URL(url, 'https://three.ws').searchParams;
		expect(url.startsWith('/api/render/glb?')).toBe(true);
		expect(q.get('glbUrl')).toBe('https://three.ws/avatars/fox.glb');
		expect(q.get('azimuth')).toBe('-60');
		expect(q.get('elevation')).toBe('10');
		expect(q.get('width')).toBe('256');
		expect(q.get('background')).toBe('#0f1115');
	});
});
