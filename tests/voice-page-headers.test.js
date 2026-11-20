// The three voice-first pages open the microphone the moment the visitor
// starts talking: /voice (Voice Lab records a sample for cloning,
// src/voice-lab.js), /voice/home (wake word and voice loop,
// src/voice/home-voice.js) and /voice/grok (Grok Voice realtime,
// src/voice/grok-realtime.js). The site-wide Permissions-Policy denies the
// microphone, so Chromium refused getUserMedia before any prompt
// ("Permissions policy violation: microphone is not allowed in this
// document") and every visitor landed on "The microphone is blocked for this
// site" (found driving /voice/grok in headless Chromium, 2026-11-20).

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadRouteTable, resolvePhase1 } from '../server/route-resolve.mjs';

const { phase1Routes } = loadRouteTable(fileURLToPath(new URL('../vercel.json', import.meta.url)));

function permissionsFor(pathname) {
	const url = new URL(pathname, 'https://three.ws');
	const req = { method: 'GET', headers: { host: 'three.ws' }, query: {} };
	return resolvePhase1(phase1Routes, req, url).headers['permissions-policy'] || '';
}

describe('voice page permissions policy', () => {
	it.each(['/voice', '/voice/', '/voice/home', '/voice/home/', '/voice/grok', '/voice/grok/'])(
		'lets %s open the microphone',
		(path) => {
			expect(permissionsFor(path)).toContain('microphone=(self)');
		},
	);

	it('keeps the camera, location and the other site-wide denials on the voice pages', () => {
		for (const path of ['/voice', '/voice/home', '/voice/grok']) {
			const policy = permissionsFor(path);
			for (const denied of ['camera=()', 'geolocation=()', 'display-capture=()', 'usb=()', 'serial=()', 'midi=()']) {
				expect(policy, `${path} ${denied}`).toContain(denied);
			}
		}
	});

	it('does not widen the grant to any other page', () => {
		for (const path of ['/', '/pricing', '/voices', '/voice/grokx', '/voice/home/extra', '/api/voice/grok/session']) {
			expect(permissionsFor(path), path).toContain('microphone=()');
		}
	});
});
