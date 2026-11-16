// The /audio2face digital human is push-to-talk: the page must be allowed to
// open the microphone (the site-wide policy denies it) and to go fullscreen in
// kiosk mode, while every other page keeps the microphone denied.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadRouteTable, resolvePhase1 } from '../server/route-resolve.mjs';

const { phase1Routes } = loadRouteTable(fileURLToPath(new URL('../vercel.json', import.meta.url)));

function headersFor(pathname) {
	const url = new URL(`https://three.ws${pathname}`);
	const req = { method: 'GET', headers: { host: 'three.ws' } };
	return resolvePhase1(phase1Routes, req, url).headers;
}

describe('digital human page headers', () => {
	it.each(['/audio2face', '/audio2face/', '/demos/audio2face.html'])(
		'lets %s use the microphone and fullscreen',
		(p) => {
			const policy = headersFor(p)['permissions-policy'];
			expect(policy).toMatch(/microphone=\(self\)/);
			expect(policy).toMatch(/fullscreen=\(self\)/);
			expect(policy).toMatch(/camera=\(\)/);
		},
	);

	it('keeps the microphone denied elsewhere', () => {
		expect(headersFor('/lipsync')['permissions-policy']).toMatch(/microphone=\(\)/);
	});
});
