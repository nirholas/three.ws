// The open head unit (apps/head-unit) is a page on the car computer's own
// loopback, http://localhost:<port>, that lays a projected CarPlay or Android
// Auto screen beside /drive in an iframe. The site-wide policy only lets
// three.ws and two named partners frame a page, so without a /drive-scoped
// exception the agent half of the head unit is a blank frame. These tests pin
// both halves: /drive admits a loopback parent, and nothing else gains it.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadRouteTable, resolvePhase1 } from '../server/route-resolve.mjs';
import { parsePolicy } from '../scripts/lib/csp-headers.mjs';

const { phase1Routes } = loadRouteTable(fileURLToPath(new URL('../vercel.json', import.meta.url)));

function headersFor(pathname) {
	const url = new URL(pathname, 'https://three.ws');
	const req = { method: 'GET', headers: { host: 'three.ws' }, query: {} };
	return resolvePhase1(phase1Routes, req, url).headers;
}

const LOOPBACK = ['http://localhost:*', 'http://127.0.0.1:*'];

describe('/drive framing for the open head unit', () => {
	it('lets a loopback head unit page frame /drive', () => {
		for (const path of ['/drive', '/drive/']) {
			const policy = parsePolicy(headersFor(path)['content-security-policy']);
			const ancestors = [...(policy.get('frame-ancestors') || [])];
			expect(ancestors).toContain("'self'");
			for (const origin of LOOPBACK) expect(ancestors).toContain(origin);
		}
	});

	it('keeps every other directive of the site-wide policy on /drive', () => {
		const site = parsePolicy(headersFor('/pricing')['content-security-policy']);
		const drive = parsePolicy(headersFor('/drive')['content-security-policy']);
		for (const [directive, sources] of site) {
			if (directive === 'frame-ancestors') continue;
			expect([...(drive.get(directive) || [])], directive).toEqual([...sources]);
		}
	});

	it('still lets the framed agent use the microphone it needs for the voice loop', () => {
		expect(headersFor('/drive')['permissions-policy']).toMatch(/microphone=\(self\)/);
	});

	it('does not widen framing for any other page', () => {
		for (const path of ['/', '/pricing', '/wallet', '/drive-anything']) {
			const csp = headersFor(path)['content-security-policy'] || '';
			for (const origin of LOOPBACK) expect(csp, path).not.toContain(origin);
		}
	});
});
