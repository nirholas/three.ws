// Bidirectional ENS / DNS name claims for the agent resolver.
// The resolvers are injected so no network is touched; the CAIP refs are real
// ERC-8004 Identity Registry refs in the format the resolver serves.

import { describe, it, expect } from 'vitest';
import {
	verifyClaims,
	parseRefList,
	parseDnsRecord,
	MAX_CLAIMS,
} from '../api/_lib/agent-name-claims.js';

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const OTHER_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const ctx = { chainId: 8453, registry: REGISTRY, agentId: '42' };
const REF = `eip155:8453:${REGISTRY}/42`;

const noCache = () => ({ cache: null });
const ens = (map) => ({
	...noCache(),
	ensText: async (name) => (name in map ? map[name] : null),
	dnsTxt: async () => [],
});
const dns = (map) => ({
	...noCache(),
	ensText: async () => null,
	dnsTxt: async (name) => map[name] ?? [],
});
const card = (...claims) => ({ claims });

describe('parseRefList', () => {
	it('parses a comma list and keeps order', () => {
		const refs = parseRefList(`${REF}, eip155:1:${OTHER_REGISTRY}/7`);
		expect(refs).toHaveLength(2);
		expect(refs[0]).toEqual({ chainId: 8453, registry: REGISTRY.toLowerCase(), agentId: '42' });
		expect(refs[1].agentId).toBe('7');
	});
	it('drops malformed entries and non-strings', () => {
		expect(parseRefList('not-a-ref, eip155:8453:0xabc/1')).toEqual([]);
		expect(parseRefList(null)).toEqual([]);
	});
});

describe('parseDnsRecord', () => {
	it('reads v=agent1 with a ref', () => {
		expect(parseDnsRecord(`v=agent1; ref=${REF}`)).toHaveLength(1);
	});
	it('rejects a record with another version, no ref, or garbage', () => {
		expect(parseDnsRecord(`v=agent2; ref=${REF}`)).toBeNull();
		expect(parseDnsRecord('v=agent1')).toBeNull();
		expect(parseDnsRecord('hello world')).toBeNull();
		expect(parseDnsRecord('v=agent1; ref=garbage')).toBeNull();
	});
});

describe('verifyClaims ENS', () => {
	it('is verified when the name points at the agent and the card lists the name', async () => {
		const out = await verifyClaims(card({ type: 'ens', name: 'coachleo.eth' }), ctx, ens({ 'coachleo.eth': REF }));
		expect(out).toEqual([
			expect.objectContaining({ type: 'ens', name: 'coachleo.eth', verified: true, state: 'verified', canonical: true }),
		]);
	});

	it('is half_from_agent when the card lists a name that does not point back', async () => {
		const out = await verifyClaims(card({ type: 'ens', name: 'coachleo.eth' }), ctx, ens({ 'coachleo.eth': null }));
		expect(out[0]).toMatchObject({ verified: false, state: 'half_from_agent' });
		expect(out[0].reason).toMatch(/does not point/i);
	});

	it('is half_from_agent when the name points at a different agent', async () => {
		const other = `eip155:8453:${REGISTRY}/43`;
		const out = await verifyClaims(card({ type: 'ens', name: 'coachleo.eth' }), ctx, ens({ 'coachleo.eth': other }));
		expect(out[0]).toMatchObject({ verified: false, state: 'half_from_agent' });
	});

	it('is half_from_name when a queried name points at the agent but the card does not list it', async () => {
		const out = await verifyClaims(card(), { ...ctx, names: ['coachleo.eth'] }, ens({ 'coachleo.eth': REF }));
		expect(out[0]).toMatchObject({ type: 'ens', name: 'coachleo.eth', verified: false, state: 'half_from_name' });
	});

	it('is unverified for a queried name that points nowhere and is not listed', async () => {
		const out = await verifyClaims(card(), { ...ctx, names: ['nobody.eth'] }, ens({}));
		expect(out[0]).toMatchObject({ verified: false, state: 'unverified' });
	});

	it('compares the registry address case-insensitively', async () => {
		const lower = `eip155:8453:${REGISTRY.toLowerCase()}/42`;
		const out = await verifyClaims(card({ type: 'ens', name: 'coachleo.eth' }), ctx, ens({ 'coachleo.eth': lower }));
		expect(out[0].state).toBe('verified');
	});

	it('accepts the agent anywhere in a comma list and marks whether it is canonical', async () => {
		const list = `eip155:1:${OTHER_REGISTRY}/7, ${REF}`;
		const out = await verifyClaims(card({ type: 'ens', name: 'multi.eth' }), ctx, ens({ 'multi.eth': list }));
		expect(out[0]).toMatchObject({ state: 'verified', canonical: false });
	});

	it('normalizes the name before lookup', async () => {
		const seen = [];
		const deps = { ...noCache(), ensText: async (n) => (seen.push(n), REF), dnsTxt: async () => [] };
		const out = await verifyClaims(card({ type: 'ens', name: 'CoachLeo.ETH' }), ctx, deps);
		expect(seen).toEqual(['coachleo.eth']);
		expect(out[0].name).toBe('coachleo.eth');
	});
});

describe('verifyClaims DNS', () => {
	it('is verified through the _agent TXT record', async () => {
		const out = await verifyClaims(
			card({ type: 'dns', name: 'example.com' }),
			ctx,
			dns({ '_agent.example.com': [`v=agent1; ref=${REF}`] }),
		);
		expect(out[0]).toMatchObject({ type: 'dns', name: 'example.com', verified: true, state: 'verified' });
	});

	it('the first valid v=agent1 record wins and later ones are ignored', async () => {
		const other = `eip155:8453:${REGISTRY}/99`;
		const out = await verifyClaims(
			card({ type: 'dns', name: 'example.com' }),
			ctx,
			dns({ '_agent.example.com': ['unrelated txt', `v=agent1; ref=${other}`, `v=agent1; ref=${REF}`] }),
		);
		expect(out[0]).toMatchObject({ verified: false, state: 'half_from_agent' });
	});

	it('skips malformed TXT records and uses the next valid one', async () => {
		const out = await verifyClaims(
			card({ type: 'dns', name: 'example.com' }),
			ctx,
			dns({ '_agent.example.com': ['v=agent1; ref=oops', `v=agent1; ref=${REF}`] }),
		);
		expect(out[0].state).toBe('verified');
	});

	it('reports half_from_agent when the TXT record is malformed throughout', async () => {
		const out = await verifyClaims(card({ type: 'dns', name: 'example.com' }), ctx, dns({ '_agent.example.com': ['v=agent1; ref=oops'] }));
		expect(out[0]).toMatchObject({ verified: false, state: 'half_from_agent' });
	});
});

describe('verifyClaims safety and limits', () => {
	it('reports a resolver timeout as unverified with a reason, never throwing', async () => {
		const deps = { ...noCache(), timeoutMs: 20, ensText: () => new Promise(() => {}), dnsTxt: async () => [] };
		const out = await verifyClaims(card({ type: 'ens', name: 'slow.eth' }), ctx, deps);
		expect(out[0]).toMatchObject({ verified: false, state: 'unverified' });
		expect(out[0].reason).toMatch(/timed out/i);
	});

	it('reports a resolver error as unverified with a reason', async () => {
		const deps = { ...noCache(), ensText: async () => { throw new Error('rpc down'); }, dnsTxt: async () => [] };
		const out = await verifyClaims(card({ type: 'ens', name: 'x.eth' }), ctx, deps);
		expect(out[0]).toMatchObject({ verified: false, state: 'unverified' });
		expect(out[0].reason).toMatch(/rpc down/);
	});

	it('rejects invalid claim types and names without calling a resolver', async () => {
		let calls = 0;
		const deps = { ...noCache(), ensText: async () => (calls++, REF), dnsTxt: async () => (calls++, []) };
		const out = await verifyClaims(
			card({ type: 'twitter', name: 'x' }, { type: 'dns', name: 'localhost' }, { type: 'dns', name: 'a b.com' }, null, { type: 'ens' }),
			ctx,
			deps,
		);
		expect(calls).toBe(0);
		expect(out.every((c) => c.verified === false && c.state === 'unverified' && c.reason)).toBe(true);
	});

	it('verifies at most MAX_CLAIMS and marks the rest as not checked', async () => {
		let calls = 0;
		const deps = { ...noCache(), ensText: async () => (calls++, REF), dnsTxt: async () => [] };
		const claims = Array.from({ length: 6 }, (_, i) => ({ type: 'ens', name: `agent${i}.eth` }));
		const out = await verifyClaims(card(...claims), ctx, deps);
		expect(MAX_CLAIMS).toBe(4);
		expect(out).toHaveLength(6);
		expect(calls).toBe(4);
		expect(out.slice(0, 4).every((c) => c.state === 'verified')).toBe(true);
		expect(out.slice(4).every((c) => c.verified === false && /only the first 4/i.test(c.reason))).toBe(true);
	});

	it('returns an empty array for a card with no claims and no queried names', async () => {
		expect(await verifyClaims({}, ctx, noCache())).toEqual([]);
		expect(await verifyClaims(null, ctx, noCache())).toEqual([]);
		expect(await verifyClaims({ claims: 'nope' }, ctx, noCache())).toEqual([]);
	});

	it('caches a successful lookup per (name, ref) and not an error', async () => {
		const cache = new Map();
		let calls = 0;
		const deps = { cache, ensText: async () => (calls++, REF), dnsTxt: async () => [] };
		await verifyClaims(card({ type: 'ens', name: 'coachleo.eth' }), ctx, deps);
		await verifyClaims(card({ type: 'ens', name: 'coachleo.eth' }), ctx, deps);
		expect(calls).toBe(1);

		const errCache = new Map();
		let errCalls = 0;
		const bad = { cache: errCache, ensText: async () => { errCalls++; throw new Error('boom'); }, dnsTxt: async () => [] };
		await verifyClaims(card({ type: 'ens', name: 'x.eth' }), ctx, bad);
		await verifyClaims(card({ type: 'ens', name: 'x.eth' }), ctx, bad);
		expect(errCalls).toBe(2);
	});

	it('expires cached entries after the 5 minute window', async () => {
		const cache = new Map();
		let calls = 0;
		let now = 1_000_000;
		const deps = { cache, now: () => now, ensText: async () => (calls++, REF), dnsTxt: async () => [] };
		await verifyClaims(card({ type: 'ens', name: 'a.eth' }), ctx, deps);
		now += 299_000;
		await verifyClaims(card({ type: 'ens', name: 'a.eth' }), ctx, deps);
		expect(calls).toBe(1);
		now += 2_000;
		await verifyClaims(card({ type: 'ens', name: 'a.eth' }), ctx, deps);
		expect(calls).toBe(2);
	});
});
