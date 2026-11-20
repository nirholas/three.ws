// /glass is the three.ws lens for smart glasses: it reads the wearer's position
// (src/glass/presence.js), their heading from device orientation
// (src/glass/compass.js) and one spoken reply through SpeechRecognition
// (src/glass/caps.js). The site-wide Permissions-Policy denies all three, so
// without a /glass-scoped grant every visitor landed on "Location needed" and
// the lens never left its first screen (production, found 2026-11-20).

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadRouteTable, resolvePhase1 } from '../server/route-resolve.mjs';

const { phase1Routes } = loadRouteTable(fileURLToPath(new URL('../vercel.json', import.meta.url)));

function permissionsFor(pathname) {
	const url = new URL(pathname, 'https://three.ws');
	const req = { method: 'GET', headers: { host: 'three.ws' }, query: {} };
	return resolvePhase1(phase1Routes, req, url).headers['permissions-policy'] || '';
}

describe('/glass permissions policy', () => {
	it('lets the lens read location, heading sensors and the microphone', () => {
		for (const path of ['/glass', '/glass/']) {
			const policy = permissionsFor(path);
			for (const feature of ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer', 'microphone']) {
				expect(policy, `${path} ${feature}`).toContain(`${feature}=(self)`);
			}
		}
	});

	it('keeps the camera and the other site-wide denials on /glass', () => {
		const policy = permissionsFor('/glass');
		for (const denied of ['camera=()', 'display-capture=()', 'usb=()', 'serial=()', 'midi=()']) {
			expect(policy).toContain(denied);
		}
	});

	it('does not widen the grant to any other page', () => {
		for (const path of ['/', '/pricing', '/glassware', '/glass/extra']) {
			expect(permissionsFor(path), path).toContain('geolocation=()');
		}
	});
});
