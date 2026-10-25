import { describe, expect, it } from 'vitest';

import {
	classifyCallTargets,
	entityIdsOfData,
	hasSelectorTargets,
} from '../packages/home-bridge/src/safety.js';

const states = {
	'cover.garage': { attributes: { device_class: 'garage' } },
	'cover.blind': { attributes: { device_class: 'blind' } },
	'lock.front': { attributes: {} },
};

describe('physical-action gate sees every target', () => {
	it('guards when the garage is not the first entity', () => {
		const v = classifyCallTargets({
			domain: 'cover', service: 'open_cover',
			data: { entity_id: ['cover.blind', 'cover.garage'] }, states,
		});
		expect(v.guarded).toBe(true);
		expect(v.entityIds).toEqual(['cover.garage']);
	});

	it('guards a comma-separated entity_id', () => {
		const v = classifyCallTargets({
			domain: 'cover', service: 'open_cover',
			data: { entity_id: 'cover.blind, cover.garage' }, states,
		});
		expect(v.guarded).toBe(true);
	});

	it('guards an unresolvable area target on a cover and refuses any allowance', () => {
		const v = classifyCallTargets({ domain: 'cover', service: 'open_cover', data: { area_id: 'garage' }, states });
		expect(v.guarded).toBe(true);
		expect(v.unresolved).toBe(true);
	});

	it('guards cover entity_id "all"', () => {
		const v = classifyCallTargets({ domain: 'cover', service: 'open_cover', data: { entity_id: 'all' }, states });
		expect(v.guarded).toBe(true);
	});

	it('leaves safe directions and unrelated domains alone', () => {
		expect(classifyCallTargets({ domain: 'cover', service: 'close_cover', data: { area_id: 'garage' }, states }).guarded).toBe(false);
		expect(classifyCallTargets({ domain: 'light', service: 'turn_on', data: { area_id: 'hall' }, states }).guarded).toBe(false);
		expect(classifyCallTargets({ domain: 'cover', service: 'open_cover', data: { entity_id: 'cover.blind' }, states }).guarded).toBe(false);
	});
});

describe('target extraction for the scope check', () => {
	it('splits comma lists and arrays', () => {
		expect(entityIdsOfData({ entity_id: 'light.a, light.b' })).toEqual(['light.a', 'light.b']);
		expect(entityIdsOfData({ entity_id: ['light.a'] })).toEqual(['light.a']);
	});
	it('detects selector targets', () => {
		expect(hasSelectorTargets({ area_id: 'bedroom' })).toBe(true);
		expect(hasSelectorTargets({ device_id: ['d1'] })).toBe(true);
		expect(hasSelectorTargets({ entity_id: 'light.a' })).toBe(false);
	});
});
