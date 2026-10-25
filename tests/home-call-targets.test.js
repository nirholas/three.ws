import { beforeEach, describe, expect, it, vi } from 'vitest';

const wsMock = vi.hoisted(() => ({ calls: [], states: {} }));

vi.mock('home-assistant-js-websocket', () => ({
	callService: vi.fn(async (_conn, domain, service, data) => {
		wsMock.calls.push({ domain, service, data });
		return [];
	}),
	createConnection: vi.fn(async () => ({
		connected: true,
		addEventListener() {},
		subscribeMessage: async () => () => {},
		subscribeEvents: async () => () => {},
		sendMessagePromise: async () => [],
		ping: async () => {},
		close() {},
	})),
	createLongLivedTokenAuth: vi.fn(() => ({})),
	subscribeEntities: vi.fn((_conn, cb) => {
		cb(wsMock.states);
		return () => {};
	}),
	ERR_CANNOT_CONNECT: 1,
	ERR_CONNECTION_LOST: 3,
	ERR_INVALID_AUTH: 2,
	ERR_INVALID_HTTPS_TO_HTTP: 4,
}));

import { ERR, HomeBridge } from '../packages/home-bridge/src/index.js';
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

describe('gate input normalisation (Home Assistant lowercases ids)', () => {
	it('lowercases and trims every id', () => {
		expect(entityIdsOfData({ entity_id: [' COVER.Garage_Door ', 'ALL'] })).toEqual(['cover.garage_door', 'all']);
	});

	it('guards a mixed-case cover id that has no state record under that spelling', () => {
		const v = classifyCallTargets({
			domain: 'cover', service: 'open_cover', data: { entity_id: 'COVER.Garage' }, states,
		});
		expect(v.guarded).toBe(true);
		expect(v.entityIds).toEqual(['cover.garage']);
	});

	it('fails closed on a cover id the house has no state for', () => {
		const v = classifyCallTargets({
			domain: 'cover', service: 'open_cover', data: { entity_id: 'cover.unknown_door' }, states,
		});
		expect(v.guarded).toBe(true);
	});

	it('treats ALL as the unresolved selector it is', () => {
		const v = classifyCallTargets({ domain: 'cover', service: 'open_cover', data: { entity_id: 'ALL' }, states });
		expect(v.guarded).toBe(true);
		expect(v.unresolved).toBe(true);
	});
});

describe('a named guarded entity does not launder a selector', () => {
	it('stays unresolved when an area rides along with one named lock', () => {
		const v = classifyCallTargets({
			domain: 'lock', service: 'unlock',
			data: { entity_id: 'lock.office_door', area_id: 'upstairs' }, states,
		});
		expect(v.guarded).toBe(true);
		expect(v.unresolved).toBe(true);
	});

	it('stays unresolved when all rides along with one named cover', () => {
		const v = classifyCallTargets({
			domain: 'cover', service: 'open_cover', data: { entity_id: ['cover.garage', 'all'] }, states,
		});
		expect(v.unresolved).toBe(true);
	});
});

describe('scene, script and automation indirection', () => {
	const macroStates = {
		...states,
		'scene.movie': { attributes: { entity_id: ['light.tv', 'media_player.tv'] } },
		'scene.goodbye_unlock': { attributes: { entity_id: ['light.tv', 'lock.front'] } },
		'scene.open_up': { attributes: { entity_id: ['cover.garage'] } },
		'script.bedtime': { attributes: {} },
		'automation.arrive': { attributes: {} },
	};

	it('leaves a scene made only of lights alone', () => {
		expect(classifyCallTargets({ domain: 'scene', service: 'turn_on', data: { entity_id: 'scene.movie' }, states: macroStates }).guarded).toBe(false);
	});

	it('guards a scene whose members include a lock or a gate-class cover', () => {
		const lockScene = classifyCallTargets({ domain: 'scene', service: 'turn_on', data: { entity_id: 'scene.goodbye_unlock' }, states: macroStates });
		expect(lockScene.guarded).toBe(true);
		expect(lockScene.entityIds).toEqual(['scene.goodbye_unlock']);
		expect(classifyCallTargets({ domain: 'scene', service: 'turn_on', data: { entity_id: 'scene.open_up' }, states: macroStates }).guarded).toBe(true);
	});

	it('guards scene.apply that names a lock in data.entities', () => {
		const v = classifyCallTargets({
			domain: 'scene', service: 'apply', data: { entities: { 'lock.front_door': 'unlocked' } }, states: macroStates,
		});
		expect(v.guarded).toBe(true);
	});

	it('guards an opaque script run, as script.turn_on and as script.<name>', () => {
		expect(classifyCallTargets({ domain: 'script', service: 'turn_on', data: { entity_id: 'script.bedtime' }, states: macroStates }).entityIds).toEqual(['script.bedtime']);
		expect(classifyCallTargets({ domain: 'script', service: 'bedtime', data: {}, states: macroStates }).entityIds).toEqual(['script.bedtime']);
	});

	it('guards automation.trigger but not automation.turn_off or script.turn_off', () => {
		expect(classifyCallTargets({ domain: 'automation', service: 'trigger', data: { entity_id: 'automation.arrive' }, states: macroStates }).guarded).toBe(true);
		expect(classifyCallTargets({ domain: 'automation', service: 'turn_off', data: { entity_id: 'automation.arrive' }, states: macroStates }).guarded).toBe(false);
		expect(classifyCallTargets({ domain: 'script', service: 'turn_off', data: { entity_id: 'script.bedtime' }, states: macroStates }).guarded).toBe(false);
	});
});

describe('HomeBridge.call enforces the gate on what it forwards', () => {
	let bridge;
	beforeEach(async () => {
		wsMock.calls.length = 0;
		wsMock.states = {
			'cover.garage': { entity_id: 'cover.garage', state: 'closed', attributes: { device_class: 'garage' } },
			'lock.front': { entity_id: 'lock.front', state: 'locked', attributes: {} },
			'light.hall': { entity_id: 'light.hall', state: 'off', attributes: {} },
		};
		bridge = new HomeBridge({ baseUrl: 'https://home.example.com', token: 'x', livenessIntervalMs: 0 });
		await bridge.connect();
	});

	it('refuses COVER.Garage open_cover without a confirmation and forwards nothing', async () => {
		await expect(bridge.call('cover', 'open_cover', { entity_id: 'COVER.Garage' })).rejects.toMatchObject({ code: ERR.NEEDS_CONFIRMATION });
		expect(wsMock.calls).toEqual([]);
	});

	it('refuses cover ALL open_cover', async () => {
		await expect(bridge.call('cover', 'open_cover', { entity_id: 'ALL' })).rejects.toMatchObject({ code: ERR.NEEDS_CONFIRMATION });
		expect(wsMock.calls).toEqual([]);
	});

	it('a standing allowance for one lock does not cover an area selector sent with it', async () => {
		bridge.allowList.add('lock.front');
		await expect(
			bridge.call('lock', 'unlock', { entity_id: 'lock.front', area_id: 'upstairs' }),
		).rejects.toMatchObject({ code: ERR.NEEDS_CONFIRMATION });
		expect(wsMock.calls).toEqual([]);
		await bridge.call('lock', 'unlock', { entity_id: 'lock.front' });
		expect(wsMock.calls).toHaveLength(1);
	});

	it('forwards the normalised entity ids when a confirmed call goes through', async () => {
		await bridge.call('cover', 'open_cover', { entity_id: ' COVER.Garage ' }, { confirmed: true });
		expect(wsMock.calls[0].data.entity_id).toEqual(['cover.garage']);
	});

	it('refuses scene.apply naming a lock, and a script run, without a confirmation', async () => {
		await expect(bridge.call('scene', 'apply', { entities: { 'lock.front': 'unlocked' } })).rejects.toMatchObject({ code: ERR.NEEDS_CONFIRMATION });
		await expect(bridge.call('script', 'bedtime', {})).rejects.toMatchObject({ code: ERR.NEEDS_CONFIRMATION });
		expect(wsMock.calls).toEqual([]);
	});

	it('refuses host-administration services even when confirmed', async () => {
		for (const [domain, service] of [['shell_command', 'anything'], ['python_script', 'run'], ['homeassistant', 'restart'], ['HASSIO', 'host_reboot']]) {
			await expect(bridge.call(domain, service, {}, { confirmed: true })).rejects.toMatchObject({ code: ERR.SERVICE_DENIED });
		}
		expect(wsMock.calls).toEqual([]);
	});

	it('still lets an ordinary light through', async () => {
		await bridge.call('light', 'turn_on', { entity_id: 'light.hall' });
		expect(wsMock.calls).toHaveLength(1);
	});
});
