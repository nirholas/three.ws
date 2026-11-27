/**
 * GET /api/avatars/library: character library manifest proxy.
 *
 * Adobe Mixamo characters must never be served as standalone downloads, so an
 * older manifest that still lists them is filtered at read time.
 */

import { describe, it, expect, vi } from 'vitest';

const readManifest = vi.fn();
vi.mock('../api/_lib/r2.js', () => ({ getPublicObjectBuffer: (...a) => readManifest(...a) }));

const { default: handler, isMixamoRow } = await import('../api/avatars/library.js');

function fakeRes() {
	const headers = {};
	return {
		statusCode: 0,
		body: undefined,
		setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return headers[String(k).toLowerCase()]; },
		end(b) { this.body = b; },
	};
}

const MIXAMO = {
	name: 'aj',
	label: 'Aj',
	url: 'https://cdn.example/avatars/mixamo/glb/aj.glb',
	source: 'mixamo',
	license: 'Mixamo',
};
const CC0 = {
	name: 'quaternius-base',
	label: 'Quaternius Base',
	url: 'https://cdn.example/avatars/quaternius/glb/quaternius-base.glb',
	source: 'quaternius',
	license: 'CC0',
};

describe('GET /api/avatars/library', () => {
	it('drops Mixamo rows and keeps the openly licensed ones', async () => {
		readManifest.mockResolvedValue(Buffer.from(JSON.stringify({ avatars: [MIXAMO, CC0] })));
		const res = fakeRes();
		await handler({ method: 'GET', url: '/api/avatars/library', headers: {} }, res);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body);
		expect(body.avatars.map((a) => a.name)).toEqual(['quaternius-base']);
		expect(body.total).toBe(1);
	});

	it('returns an empty library when the manifest only held Mixamo rows', async () => {
		readManifest.mockResolvedValue(Buffer.from(JSON.stringify([MIXAMO])));
		const res = fakeRes();
		await handler({ method: 'GET', url: '/api/avatars/library', headers: {} }, res);
		expect(JSON.parse(res.body).avatars).toEqual([]);
	});

	it('recognises a Mixamo row by source, license or CDN key alone', () => {
		expect(isMixamoRow({ name: 'x', source: 'Mixamo' })).toBe(true);
		expect(isMixamoRow({ name: 'x', license: 'Mixamo' })).toBe(true);
		expect(isMixamoRow({ name: 'x', url: 'https://c/avatars/mixamo/glb/x.glb' })).toBe(true);
		expect(isMixamoRow(CC0)).toBe(false);
	});
});
