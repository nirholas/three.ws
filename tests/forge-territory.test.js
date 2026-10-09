import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	RESTRICTED_COUNTRIES,
	TENCENT_LANES,
	filterLanesForTerritory,
	isRestrictedTerritory,
	laneAllowedInTerritory,
	requestTerritory,
} from '../api/_lib/forge-territory.js';
import {
	BACKENDS,
	freeLaneCandidates,
	laneAfterHfFailure,
	resolveBackendId,
	resolveBackendIdWithHealth,
} from '../api/_lib/forge-tiers.js';
import { pickRedispatchLane, retryBackendSuggestions } from '../api/_lib/forge-failover.js';
import { normalizeForgeOptions } from '../api/_lib/forge-options.js';

const ENV_KEYS = [
	'MODEL_TRELLIS2_URL',
	'MODEL_TRELLIS_URL',
	'GCP_HUNYUAN3D_URL',
	'GCP_RECONSTRUCTION_KEY',
	'HF_TOKEN',
	'NVIDIA_API_KEY',
];
let saved;

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	process.env.MODEL_TRELLIS2_URL = 'https://trellis2.test';
	process.env.MODEL_TRELLIS_URL = 'https://trellis.test';
	process.env.GCP_HUNYUAN3D_URL = 'https://hunyuan.test';
	process.env.GCP_RECONSTRUCTION_KEY = 'k';
	process.env.HF_TOKEN = 'hf';
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

const EU_UK_KR = ['DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'IE', 'PL', 'GB', 'KR'];

describe('territory classification', () => {
	it('restricts every EU member state, the UK and South Korea', () => {
		expect(RESTRICTED_COUNTRIES).toHaveLength(29);
		for (const c of EU_UK_KR) expect(isRestrictedTerritory(c)).toBe(true);
		expect(isRestrictedTerritory('gb')).toBe(true);
	});

	it('fails closed on an unknown or malformed country', () => {
		for (const c of [null, undefined, '', 'XX1', 42]) expect(isRestrictedTerritory(c)).toBe(true);
	});

	it('does not restrict other countries', () => {
		for (const c of ['US', 'CA', 'JP', 'BR', 'IN', 'AU', 'CH', 'NO']) {
			expect(isRestrictedTerritory(c)).toBe(false);
		}
	});

	it('reads the country from the edge header only', () => {
		expect(requestTerritory({ headers: { 'x-client-geo-location': 'DE,Berlin' } })).toBe('DE');
		expect(requestTerritory({ headers: {} })).toBeNull();
	});
});

describe('lane filter', () => {
	it('closes both Tencent lanes to restricted territories and opens them elsewhere', () => {
		for (const lane of TENCENT_LANES) {
			for (const c of [...EU_UK_KR, null]) expect(laneAllowedInTerritory(lane, c)).toBe(false);
			expect(laneAllowedInTerritory(lane, 'US')).toBe(true);
		}
		expect(laneAllowedInTerritory('trellis2', 'DE')).toBe(true);
		expect(filterLanesForTerritory(['trellis2', 'hunyuan3d', 'huggingface'], 'KR')).toEqual(['trellis2']);
	});
});

describe('Forge routing never selects a Tencent lane for EU, UK or KR', () => {
	for (const country of [...EU_UK_KR, null]) {
		for (const tier of ['draft', 'standard', 'high']) {
			it(`${country ?? 'unknown'} / ${tier}: candidates and default exclude Tencent lanes`, () => {
				const candidates = freeLaneCandidates('image', tier, true, null, country);
				for (const lane of TENCENT_LANES) expect(candidates).not.toContain(lane);
				expect(resolveBackendId({ path: 'image', tier, userImages: true, country })).toBe('trellis2');
			});
		}

		it(`${country ?? 'unknown'}: still excludes Tencent lanes when TRELLIS.2 and TRELLIS v1 are down`, () => {
			const health = { trellis2: 'down', trellis_selfhost: 'down' };
			const chosen = resolveBackendIdWithHealth({
				path: 'image',
				tier: 'high',
				userImages: true,
				health,
				country,
			});
			expect(TENCENT_LANES).not.toContain(chosen);
		});

		it(`${country ?? 'unknown'}: HuggingFace failover does not hop to Hunyuan3D`, () => {
			expect(laneAfterHfFailure({ userImages: true, country })).not.toBe('hunyuan3d');
		});

		it(`${country ?? 'unknown'}: poll-time redispatch and retry suggestions skip Tencent lanes`, async () => {
			const attempted = ['trellis2', 'trellis_selfhost'];
			const next = await pickRedispatchLane({ attempted, country });
			expect(TENCENT_LANES).not.toContain(next);
			const suggestions = retryBackendSuggestions({ attempted: [], hasImage: true, country });
			for (const lane of TENCENT_LANES) expect(suggestions).not.toContain(lane);
		});
	}

	it('keeps Hunyuan3D reachable for an allowed country as a fallback behind TRELLIS.2', () => {
		const candidates = freeLaneCandidates('image', 'high', true, null, 'US');
		expect(candidates[0]).toBe('trellis2');
		expect(candidates).toContain('trellis_selfhost');
		expect(candidates).toContain('hunyuan3d');
		expect(candidates).toContain('huggingface');
		expect(laneAfterHfFailure({ userImages: true, country: 'US' })).toBe('hunyuan3d');
	});

	it('serves from the next configured lane when TRELLIS.2 is unconfigured', () => {
		delete process.env.MODEL_TRELLIS2_URL;
		expect(resolveBackendId({ path: 'image', tier: 'standard', userImages: true, country: 'DE' })).toBe(
			'trellis_selfhost',
		);
	});
});

describe('TRELLIS.2 lane registration', () => {
	it('is a free, self-host, image-accepting lane', () => {
		const b = BACKENDS.trellis2;
		expect(b).toMatchObject({ free: true, provider: 'gcp', userImages: true });
		expect(b.paths).toContain('image');
		expect(b.requiresEnv).toContain('MODEL_TRELLIS2_URL');
	});

	it('accepts only the supported resolutions as a request option', () => {
		for (const r of [512, 1024, 1536, '1024']) {
			expect(normalizeForgeOptions({ resolution: r }).errors).toEqual([]);
		}
		expect(normalizeForgeOptions({ resolution: 2048 }).errors[0].field).toBe('resolution');
		expect(normalizeForgeOptions({}).resolution).toBeNull();
		expect(normalizeForgeOptions({ resolution: 1536 }).hasOptions).toBe(true);
	});
});
