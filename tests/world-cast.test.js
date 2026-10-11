import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLACES, SPAWN, CAMPUS_RADIUS, PLACE_TRIGGER, DESK_OBJECTS, placeById, nearestInteractable, standPointFor, dist2 } from '../src/desktop/world/places.js';
import {
	AGENT_TRIGGER,
	APPROACH_DISTANCE,
	GREET_RANGE,
	arrivalMessage,
	castSpots,
	embedSnippet,
	groundingPrompt,
	isCastable,
	nearestAgent,
	parseSse,
	pickCast,
	pickGreeter,
	toCastMember,
} from '../src/desktop/world/cast.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const agent = (o = {}) => ({
	id: '11111111-1111-4111-8111-111111111111',
	name: 'AxisXV',
	description: 'Evidence-first Signal Cards for tokens, wallets, repos, projects, and AI agents.',
	skills: ['greet', 'quick-signal-card'],
	avatar_thumbnail: 'https://cdn.example/thumb/a.png',
	avatar_model_url: 'https://cdn.example/u/a.glb',
	home_url: '/agents/11111111-1111-4111-8111-111111111111',
	chat_count: 90,
	is_registered: false,
	onchain: null,
	...o,
});

describe('cast selection', () => {
	it('keeps only agents with a real name and a public body', () => {
		expect(isCastable(agent())).toBe(true);
		expect(isCastable(agent({ avatar_model_url: null }))).toBe(false);
		expect(isCastable(agent({ name: '' }))).toBe(false);
		expect(isCastable(agent({ name: 'Avatar #e6f105' }))).toBe(false);
		expect(isCastable(agent({ name: 'model (11)' }))).toBe(false);
		expect(isCastable(agent({ name: 'x'.repeat(41) }))).toBe(false);
		expect(isCastable(agent({ name: 'Agent Ada' }))).toBe(true);
		expect(isCastable(null)).toBe(false);
	});
	it('rejects every onboarding placeholder name the server also hides, case-insensitively', () => {
		const src = readFileSync(resolve(root, 'api/agents/public.js'), 'utf8');
		const list = src.match(/const PLACEHOLDER_NAMES = \[([^\]]+)\]/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
		expect(list.length).toBeGreaterThan(3);
		for (const name of list) {
			expect(isCastable(agent({ name })), name).toBe(false);
			expect(isCastable(agent({ name: name.toUpperCase() })), name).toBe(false);
		}
	});
	it('maps a public agent record to a cast member with only the fields the world needs', () => {
		const m = toCastMember(agent({ onchain: { network: 'mainnet', asset: 'THREEsynthetic1111' }, is_registered: true }));
		expect(m).toMatchObject({ id: agent().id, name: 'AxisXV', glb: 'https://cdn.example/u/a.glb', chats: 90, registered: true, home: '/agents/11111111-1111-4111-8111-111111111111' });
		expect(m.description).toMatch(/Signal Cards/);
		expect(m.skills).toEqual(['greet', 'quick-signal-card']);
		expect(m.thumb).toBe('https://cdn.example/thumb/a.png');
		expect(toCastMember(agent({ description: '   ', skills: null, home_url: null })).description).toBe('');
		expect(toCastMember(agent({ home_url: null })).home).toBe(`/agents/${agent().id}`);
		// The onboarding bio says nothing about the agent, so it counts as no description.
		expect(toCastMember(agent({ description: 'A friendly starter agent. Edit the personality to make it yours.' })).description).toBe('');
	});
	it('picks the most talked-to real agents, prefers distinct bodies, and caps the cast', () => {
		const list = [
			agent({ id: 'a', name: 'One', chat_count: 5, avatar_model_url: 'https://x/1.glb' }),
			agent({ id: 'b', name: 'Two', chat_count: 50, avatar_model_url: 'https://x/2.glb' }),
			agent({ id: 'c', name: 'My First Agent', chat_count: 500 }),
			agent({ id: 'd', name: 'Three', chat_count: 20, avatar_model_url: null }),
			agent({ id: 'e', name: 'Four', chat_count: 40, avatar_model_url: 'https://x/2.glb' }),
			agent({ id: 'f', name: 'Five', chat_count: 1, avatar_model_url: 'https://x/5.glb' }),
		];
		const cast = pickCast(list, { max: 3 });
		expect(cast.map((m) => m.id)).toEqual(['b', 'a', 'f']);
		expect(pickCast(list, { max: 10 }).map((m) => m.id)).toEqual(['b', 'a', 'f', 'e']);
		expect(pickCast([], { max: 3 })).toEqual([]);
		expect(pickCast(null, { max: 3 })).toEqual([]);
	});
	it('names the greeter: the most talked-to member who has something to say about itself', () => {
		const cast = pickCast([
			agent({ id: 'a', name: 'Quiet', chat_count: 900, description: '' }),
			agent({ id: 'b', name: 'Host', chat_count: 30 }),
			agent({ id: 'c', name: 'Also', chat_count: 10 }),
		], { max: 5 });
		expect(pickGreeter(cast)?.id).toBe('b');
		expect(pickGreeter([toCastMember(agent({ description: null }))])?.id).toBe(agent().id);
		expect(pickGreeter([])).toBeNull();
	});
});

describe('cast placement', () => {
	it('puts the greeter on the gate path and everybody else at a distinct, deterministic spot', () => {
		const spots = castSpots(9, PLACES);
		expect(spots).toHaveLength(9);
		expect(castSpots(9, PLACES)).toEqual(spots);
		const seen = new Set(spots.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`));
		expect(seen.size).toBe(9);
		// Greeter: beside the path between the gate and the desk, within sight of the spawn.
		expect(spots[0].role).toBe('greeter');
		expect(Math.sqrt(dist2(spots[0].x, spots[0].z, SPAWN.x, SPAWN.z))).toBeLessThan(GREET_RANGE * 2);
		expect(Math.abs(spots[0].x)).toBeGreaterThan(1.2);
		for (const s of spots) {
			expect(Number.isFinite(s.yaw)).toBe(true);
			expect(Math.hypot(s.x, s.z)).toBeLessThan(CAMPUS_RADIUS - 2);
			// Never inside a building's keep-out, and never on the desk.
			for (const p of PLACES) expect(Math.sqrt(dist2(s.x, s.z, p.x, p.z)), `${s.role} vs ${p.id}`).toBeGreaterThan(p.keepout + 0.9);
			const office = placeById('office');
			expect(Math.sqrt(dist2(s.x, s.z, office.x, office.z))).toBeGreaterThan(3);
		}
		// Most of the cast gathers at Agent Plaza.
		const plaza = placeById('agents');
		expect(spots.filter((s) => Math.sqrt(dist2(s.x, s.z, plaza.x, plaza.z)) < plaza.keepout + 4).length).toBeGreaterThanOrEqual(3);
	});
	it('runs out of spots gracefully and asks for none', () => {
		expect(castSpots(0, PLACES)).toEqual([]);
		expect(castSpots(40, PLACES).length).toBeGreaterThanOrEqual(12);
	});
	it('finds the agent in reach and names the prompt after them', () => {
		const agents = [
			{ id: 'a', name: 'AxisXV', sub: 'Signal cards', x: 0, z: 0 },
			{ id: 'b', name: 'Vera', sub: 'Concierge', x: 1.5, z: 0 },
		];
		expect(nearestAgent(1.2, 0, agents)).toMatchObject({ type: 'agent', id: 'b', title: 'Talk to Vera', x: 1.5, z: 0 });
		expect(nearestAgent(-1, 0, agents)).toMatchObject({ id: 'a', sub: 'Signal cards' });
		expect(nearestAgent(0, AGENT_TRIGGER + 0.1, [agents[0]])).toBeNull();
		expect(nearestAgent(0, 0, [])).toBeNull();
		// Tapping an agent walks the visitor to within talking range.
		expect(APPROACH_DISTANCE).toBeLessThan(AGENT_TRIGGER);
		expect(APPROACH_DISTANCE).toBeGreaterThan(1);
	});
	it('lets an agent take the prompt from a place when they are closer, but never from the desk', () => {
		const ex = placeById('exchange');
		const s = standPointFor(ex);
		const agents = [{ id: 'a', name: 'AxisXV', sub: '', x: s.x + 1, z: s.z }];
		expect(nearestInteractable(s.x, s.z, { agents })).toMatchObject({ type: 'agent', id: 'a' });
		expect(nearestInteractable(s.x, s.z)).toMatchObject({ type: 'place', id: 'exchange' });
		const office = placeById('office');
		const monitor = DESK_OBJECTS.find((o) => o.id === 'monitor');
		const px = office.x + monitor.dx;
		const pz = office.z + monitor.dz + 0.5;
		expect(nearestInteractable(px, pz, { agents: [{ id: 'a', name: 'A', sub: '', x: px + 0.2, z: pz }] })).toMatchObject({ type: 'object', id: 'monitor' });
		// A place well inside its trigger still wins over an agent out of reach.
		expect(nearestInteractable(s.x, s.z, { agents: [{ id: 'a', name: 'A', sub: '', x: s.x + AGENT_TRIGGER + PLACE_TRIGGER, z: s.z }] })).toMatchObject({ type: 'place' });
	});
});

describe('talking', () => {
	it('splits SSE frames and keeps the unfinished tail', () => {
		const r = parseSse('data: {"type":"chunk","text":"Hey"}\n\ndata: {"type":"chunk","text":" there"}\n\ndata: {"type":"do');
		expect(r.events).toEqual([{ type: 'chunk', text: 'Hey' }, { type: 'chunk', text: ' there' }]);
		expect(r.rest).toBe('data: {"type":"do');
		const r2 = parseSse(r.rest + 'ne","reply":"Hey there"}\n\n: comment\n\nevent: x\ndata: not json\n\n');
		expect(r2.events).toEqual([{ type: 'done', reply: 'Hey there' }]);
		expect(r2.rest).toBe('');
		expect(parseSse('')).toEqual({ events: [], rest: '' });
	});
	it('writes the one-tag embed for a specific agent against the pinned library build', () => {
		const m = toCastMember(agent());
		const snip = embedSnippet(m);
		expect(snip).toContain('<script type="module" src="https://three.ws/agent-3d/');
		expect(snip).toContain(`<agent-3d agent-id="${m.id}"`);
		expect(snip).not.toMatch(/\u2014|\u2013/);
	});
	it('grounds an agent in its own public record and nothing invented', () => {
		const m = toCastMember(agent());
		const p = groundingPrompt(m, { place: 'Agent Plaza' });
		expect(p).toContain('AxisXV');
		expect(p).toContain(m.description);
		expect(p).toContain('quick-signal-card');
		expect(p).toContain('Agent Plaza');
		expect(p).toContain('$THREE');
		expect(p.length).toBeLessThanOrEqual(2000);
		const long = groundingPrompt(toCastMember(agent({ description: 'x'.repeat(5000), skills: Array.from({ length: 80 }, (_, i) => `skill-${i}`) })), {});
		expect(long.length).toBeLessThanOrEqual(2000);
		expect(groundingPrompt(toCastMember(agent({ description: '', skills: [] })), {})).not.toMatch(/undefined|null/);
	});
	it('asks the greeter for a spoken welcome that points at the desk', () => {
		const msg = arrivalMessage('Nir');
		expect(msg).toMatch(/Nir/);
		expect(msg).toMatch(/desk/i);
		expect(arrivalMessage('')).not.toMatch(/undefined/);
		expect(arrivalMessage('')).not.toMatch(/\u2014|\u2013/);
	});
});
