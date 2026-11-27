// The Tencent Hunyuan 3D licence excludes the EU, the UK and South Korea. This
// table walks every way a request can be routed to a Tencent lane (hunyuan3d,
// huggingface, modly_hunyuan) and proves that, for every excluded or
// unresolvable country, none of them returns a Tencent lane while each still
// returns a lane that can serve the request.
//
// The five routes: default selection, poll-time fallback, explicit selection,
// the paid public API (api/x402/forge.js) and the MCP studio tools. The
// pure-resolver routes are driven here. The routes that submit a job are driven
// end to end in tests/api/forge-hunyuan-hf-handler.test.js (default, fallback,
// explicit), tests/api/x402-forge.test.js (public API) and
// tests/api/mcp-studio-region.test.js (MCP), each with the same country table.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The redispatch picker asks the health snapshot, which probes each worker over
// the network. Report every lane unknown (the snapshot's own fail-open answer)
// so the picker's territory filter is what is under test.
vi.mock('../api/_lib/forge-lane-health.js', async (importActual) => ({
	...(await importActual()),
	laneHealthSnapshot: vi.fn(async () => ({ statusMap: {}, byId: {} })),
}));
import {
	BACKENDS,
	freeLaneCandidates,
	resolveBackendId,
	resolveBackendIdWithHealth,
	laneAfterHfFailure,
} from '../api/_lib/forge-tiers.js';
import { TENCENT_LANES, requestTerritory, laneAllowedInTerritory } from '../api/_lib/forge-territory.js';
import { pickRedispatchLane, retryBackendSuggestions } from '../api/_lib/forge-failover.js';

const LANE_VARS = [
	'MODEL_TRELLIS2_URL',
	'MODEL_TRELLIS_URL',
	'GCP_HUNYUAN3D_URL',
	'MODEL_MODLY_URL',
	'GCP_RECONSTRUCTION_KEY',
	'HF_TOKEN',
	'NVIDIA_API_KEY',
	'FORGE_SELFHOST_PRIMARY',
];
const saved = {};

beforeEach(() => {
	for (const k of LANE_VARS) saved[k] = process.env[k];
	// Every image lane wired, so a Tencent lane is always on offer and the only
	// thing keeping an excluded caller off it is the territory rule.
	Object.assign(process.env, {
		MODEL_TRELLIS2_URL: 'https://trellis2.example.run.app',
		MODEL_TRELLIS_URL: 'https://trellis.example.run.app',
		GCP_HUNYUAN3D_URL: 'https://hunyuan.example.run.app',
		MODEL_MODLY_URL: 'https://modly.example.run.app',
		GCP_RECONSTRUCTION_KEY: 'secret',
		HF_TOKEN: 'hf_test',
		NVIDIA_API_KEY: 'nvapi-test',
	});
});

afterEach(() => {
	for (const k of LANE_VARS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

// Country as the route sees it, after requestTerritory() read the headers.
const EXCLUDED = [
	['Germany', { 'x-client-region': 'DE' }],
	['France', { 'x-client-region': 'FR' }],
	['United Kingdom', { 'x-client-region': 'GB' }],
	['United Kingdom, legacy code', { 'x-client-region': 'UK' }],
	['South Korea', { 'x-client-geo-location': 'KR,Seoul' }],
	['Reunion (EU soil)', { 'x-client-region': 'RE' }],
	['Aland (EU soil)', { 'x-client-region': 'AX' }],
	['anonymous proxy', { 'x-client-region': 'A1' }],
	['no geo header at all', {}],
	['forged Cloudflare header only', { 'cf-ipcountry': 'US' }],
	['forged Vercel header only', { 'x-vercel-ip-country': 'US' }],
	['unparseable value', { 'x-client-region': 'ZZZZ' }],
];

const ALLOWED = [
	['United States', { 'x-client-region': 'US' }],
	['Japan', { 'x-client-geo-location': 'JP,Tokyo' }],
	['Switzerland (outside the EU)', { 'x-client-region': 'CH' }],
];

const countryOf = (headers) => requestTerritory({ headers });
const tencent = (id) => TENCENT_LANES.includes(id);

describe.each(EXCLUDED)('excluded or unresolved: %s', (_label, headers) => {
	const country = countryOf(headers);

	it('is treated as restricted by every Tencent lane', () => {
		for (const id of TENCENT_LANES) expect(laneAllowedInTerritory(id, country)).toBe(false);
	});

	it.each(['draft', 'standard', 'high'])('default route (%s tier) never picks a Tencent lane and still picks a lane', (tier) => {
		const candidates = freeLaneCandidates('image', tier, true, null, country);
		expect(candidates.length).toBeGreaterThan(0);
		expect(candidates.filter(tencent)).toEqual([]);
		const picked = resolveBackendId({ path: 'image', tier: { id: tier }, userImages: true, country });
		expect(tencent(picked)).toBe(false);
		expect(BACKENDS[picked]).toBeTruthy();
	});

	it('default route stays off Tencent when the first lanes are down', () => {
		const health = { trellis2: 'down', trellis_selfhost: 'down', trellis: 'down' };
		const picked = resolveBackendIdWithHealth({
			path: 'image',
			tier: { id: 'high' },
			userImages: true,
			health,
			country,
		});
		expect(tencent(picked)).toBe(false);
	});

	it('default route stays off Tencent even when every self-host lane is down', () => {
		const health = { trellis2: 'down', trellis_selfhost: 'down', modly: 'down', nvidia: 'down' };
		const picked = resolveBackendIdWithHealth({
			path: 'image',
			tier: { id: 'standard' },
			userImages: true,
			health,
			country,
		});
		expect(tencent(picked)).toBe(false);
	});

	it('the fallback after a Hugging Face failure is never Hunyuan3D', () => {
		expect(laneAfterHfFailure({ explicit: false, userImages: true, country })).not.toBe('hunyuan3d');
		expect(laneAfterHfFailure({ explicit: false, userImages: false, country })).not.toBe('hunyuan3d');
	});

	it('poll-time redispatch never picks a Tencent lane, even with every other lane tried but one', async () => {
		const picked = await pickRedispatchLane({ attempted: [], country });
		expect(picked).toBeTruthy();
		expect(tencent(picked)).toBe(false);
		// With the TRELLIS lanes spent and Modly tried, a Tencent lane is the only
		// one left, and the picker must report nothing rather than hand it over.
		const rest = await pickRedispatchLane({ attempted: ['trellis2', 'trellis_selfhost', 'trellis', 'modly'], country });
		expect(rest).toBeNull();
	});

	it('the retry suggestions offered with a refusal exclude every Tencent lane and are not empty', () => {
		for (const hasImage of [true, false]) {
			const list = retryBackendSuggestions({ hasImage, country });
			expect(list.filter(tencent)).toEqual([]);
			expect(list.length).toBeGreaterThan(0);
		}
	});
});

describe.each(ALLOWED)('licensed territory: %s', (_label, headers) => {
	const country = countryOf(headers);

	it('may use every Tencent lane', () => {
		for (const id of TENCENT_LANES) expect(laneAllowedInTerritory(id, country)).toBe(true);
	});

	it('is offered the Tencent lanes as fallbacks and in the retry suggestions', () => {
		expect(freeLaneCandidates('image', 'high', true, null, country)).toEqual(
			expect.arrayContaining(['hunyuan3d', 'huggingface']),
		);
		expect(retryBackendSuggestions({ hasImage: true, country })).toEqual(
			expect.arrayContaining(['hunyuan3d', 'huggingface', 'modly_hunyuan']),
		);
		expect(laneAfterHfFailure({ explicit: false, userImages: true, country })).toBe('hunyuan3d');
	});

	it('poll-time redispatch can reach Hunyuan3D once the TRELLIS lanes were tried', async () => {
		expect(await pickRedispatchLane({ attempted: ['trellis2', 'trellis_selfhost'], country })).toBe('hunyuan3d');
	});
});

describe('unknown country is the conservative case', () => {
	it('resolves to null, never to a permissive default', () => {
		expect(countryOf({})).toBeNull();
		expect(countryOf({ 'x-client-region': '' })).toBeNull();
		expect(countryOf({ 'x-client-region': 'not a country' })).toBeNull();
	});

	it('is refused by the Tencent lanes and served by every other lane', () => {
		for (const id of TENCENT_LANES) expect(laneAllowedInTerritory(id, null)).toBe(false);
		for (const id of ['trellis2', 'trellis_selfhost', 'modly', 'nvidia', 'trellis']) {
			expect(laneAllowedInTerritory(id, null)).toBe(true);
		}
	});

	it('an unspecified country argument is the unknown country, not an allowed one', () => {
		expect(freeLaneCandidates('image', 'high', true).filter(tencent)).toEqual([]);
		expect(retryBackendSuggestions({ hasImage: true }).filter(tencent)).toEqual([]);
	});
});

describe('explicit selection', () => {
	// resolveBackendId honours an explicit name by design: the handler, the x402
	// route and the MCP resolver own the territory refusal. This pins that
	// contract so nobody mistakes the resolver for the gate.
	it('the resolver returns a named Tencent lane unchanged, so the callers must gate it', () => {
		for (const id of TENCENT_LANES) {
			const named = resolveBackendId({ path: 'image', tier: { id: 'high' }, backend: id, userImages: true, country: 'DE' });
			if (BACKENDS[id].paths.includes('image')) expect(named).toBe(id);
			expect(laneAllowedInTerritory(id, 'DE')).toBe(false);
		}
	});
});
