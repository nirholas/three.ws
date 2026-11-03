// Audit 2026-10-25, home-call-scope-ignores-area-device-targets. A member whose
// role is scoped (guest, ...) may act only on entities inside their scope. The
// MCP and chat path (runHomeTool -> performCall) must hold that for area_id,
// device_id and floor_id selectors and for a call with no named target ("every
// light"), exactly as the REST path does with scopedCallRefusal.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [], bridge: null }));

vi.mock('../api/_lib/home/members.js', async (importOriginal) => ({
	...(await importOriginal()),
	listMembershipHomes: vi.fn(async () => [{ home_id: 'h1', label: 'House' }]),
	listMembers: vi.fn(async () => [{ userId: 'owner-1', role: 'owner' }]),
	requireMembership: vi.fn(async () => ({
		ok: true,
		role: 'guest',
		scope: { mode: 'allow', entities: ['light.guest_lamp'], areas: ['guest_room'] },
		membership: { scoped: true },
	})),
}));
vi.mock('../api/_lib/home/runtime.js', async (importOriginal) => ({
	...(await importOriginal()),
	withHome: vi.fn(async (_h, _u, fn) => fn(h.bridge)),
}));
vi.mock('../api/_lib/home/store.js', async (importOriginal) => ({
	...(await importOriginal()),
	listGrants: vi.fn(async () => []),
	logHomeAction: vi.fn(),
}));
vi.mock('../api/_lib/home/confirm.js', async (importOriginal) => ({
	...(await importOriginal()),
	expireStaleConfirmations: vi.fn(async () => 0),
	mintConfirmation: vi.fn(async () => ({ id: 'c1', summary: 's', risk: 'physical', domain: 'x', service: 'y', entity_ids: [], expires_at: 'x', expires_in_seconds: 60 })),
}));

import { runHomeTool } from '../api/_lib/home/tools.js';

function makeBridge() {
	const entities = [
		{ entity_id: 'light.guest_lamp', area_id: 'guest_room', device_id: 'd1' },
		{ entity_id: 'light.master_lamp', area_id: 'master', device_id: 'd2' },
		{ entity_id: 'light.hall', area_id: 'hall', device_id: 'd3' },
	];
	const states = Object.fromEntries(entities.map((e) => [e.entity_id, { state: 'on', attributes: { friendly_name: e.entity_id } }]));
	return {
		registries: {
			floors: [],
			areas: [{ area_id: 'guest_room' }, { area_id: 'master' }, { area_id: 'hall' }],
			devices: [{ id: 'd1', area_id: 'guest_room' }, { id: 'd2', area_id: 'master' }, { id: 'd3', area_id: 'hall' }],
			entities,
		},
		states,
		graph: { floors: [], rooms: [], unassigned: [] },
		allowList: { list: () => [], add() {}, remove() {} },
		call: vi.fn(async (domain, service, data) => { h.calls.push({ domain, service, data }); }),
	};
}

const scoped = (data, domain = 'light', service = 'turn_off') =>
	runHomeTool('home_call', { home_id: 'h1', domain, service, data }, { userId: 'guest-1', source: 'mcp' });

describe('a scoped member cannot reach outside their scope through selectors', () => {
	beforeEach(() => { h.calls = []; h.bridge = makeBridge(); });

	it('allows an in-scope area', async () => {
		const r = await scoped({ area_id: 'guest_room' });
		expect(r.kind).toBe('result');
		expect(h.calls).toHaveLength(1);
	});

	it('refuses an out-of-scope area_id and forwards nothing', async () => {
		const r = await scoped({ area_id: 'master' });
		expect(r.code).toBe('out_of_scope');
		expect(h.calls).toHaveLength(0);
	});

	it('refuses an out-of-scope device_id', async () => {
		const r = await scoped({ device_id: 'd2' });
		expect(r.code).toBe('out_of_scope');
		expect(h.calls).toHaveLength(0);
	});

	it('refuses an in-scope area smuggled alongside an out-of-scope one', async () => {
		const r = await scoped({ area_id: 'guest_room,master' });
		expect(r.code).toBe('out_of_scope');
		expect(h.calls).toHaveLength(0);
	});

	it('refuses an area the registry cannot resolve, since Home Assistant may know it', async () => {
		const r = await scoped({ area_id: 'garage' });
		expect(r.ok).toBe(false);
		expect(h.calls).toHaveLength(0);
	});

	it('refuses a call with no named target, which would hit every light in the house', async () => {
		const r = await scoped({});
		expect(r.ok).toBe(false);
		expect(h.calls).toHaveLength(0);
	});

	it('refuses a domain whose services act beyond entity_id for a scoped member', async () => {
		const r = await scoped({ entity_id: 'light.guest_lamp' }, 'script', 'turn_on');
		expect(r.ok).toBe(false);
		expect(h.calls).toHaveLength(0);
	});
});
