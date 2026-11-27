// The territory gate is a licence control, so it has to hold when the edge is
// misconfigured and when the caller lies. These tests pin the two ways it used
// to leak: headers a client can forge unlocking the Tencent lanes, and codes
// that are inside a restricted territory but are not the 29 listed countries.

import { describe, expect, it } from 'vitest';
import {
	GEO_TRUSTED_HEADERS,
	isRestrictedTerritory,
	laneAllowedInTerritory,
	requestTerritory,
	territoryReport,
} from '../api/_lib/forge-territory.js';
import { clientCountry } from '../api/_lib/client-geo.js';

describe('the gate only trusts the load balancer headers', () => {
	it('names exactly the two GCLB headers', () => {
		expect(GEO_TRUSTED_HEADERS).toEqual(['x-client-geo-location', 'x-client-region']);
	});

	it('ignores a forged Cloudflare or Vercel country header', () => {
		for (const name of ['cf-ipcountry', 'x-vercel-ip-country']) {
			const req = { headers: { [name]: 'US' } };
			expect(requestTerritory(req)).toBeNull();
			expect(laneAllowedInTerritory('hunyuan3d', requestTerritory(req))).toBe(false);
			expect(laneAllowedInTerritory('huggingface', requestTerritory(req))).toBe(false);
			expect(territoryReport(req).country_resolved).toBe(false);
		}
	});

	it('still resolves the country from the load balancer headers', () => {
		expect(requestTerritory({ headers: { 'x-client-geo-location': 'US,California' } })).toBe('US');
		expect(requestTerritory({ headers: { 'x-client-region': 'JP' } })).toBe('JP');
		expect(laneAllowedInTerritory('hunyuan3d', 'JP')).toBe(true);
	});

	it('leaves analytics country resolution on its wider header list', () => {
		expect(clientCountry({ headers: { 'cf-ipcountry': 'US' } })).toBe('US');
		expect(clientCountry({ headers: { 'cf-ipcountry': 'US' } }, ['x-client-region'])).toBeNull();
	});
});

describe('codes inside a restricted territory are restricted', () => {
	// EU outermost regions and Aland carry their own ISO codes but are EU soil.
	const EU_SOIL = ['AX', 'GP', 'MQ', 'GF', 'RE', 'YT', 'MF'];
	// Pseudo codes geo databases emit for a region, a proxy or a satellite link.
	const PSEUDO = ['EU', 'UK', 'A1', 'A2', 'AP', 'O1'];

	it('restricts EU outermost regions', () => {
		for (const c of EU_SOIL) expect(isRestrictedTerritory(c)).toBe(true);
	});

	it('restricts region and proxy pseudo codes instead of treating them as a free country', () => {
		for (const c of PSEUDO) expect(isRestrictedTerritory(c)).toBe(true);
		expect(isRestrictedTerritory('uk')).toBe(true);
	});

	it('keeps neighbours that are not covered open', () => {
		for (const c of ['CH', 'NO', 'IS', 'LI', 'TR', 'UA', 'RS', 'US']) {
			expect(isRestrictedTerritory(c)).toBe(false);
		}
	});
});
