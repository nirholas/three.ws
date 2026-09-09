// The agent-turn gate: what a monthly quota may refuse in the chat lane, and
// the two things it may never refuse.
//
// The load-bearing assertions here are the ones that keep commitment 1 true in
// the lane where a person actually talks to their house: over quota, asking the
// agent to lock up, close a garage or a valve, or arm an alarm still runs, and
// asking it what the house is doing still answers.

import { describe, expect, it, vi } from 'vitest';

import { HomeQuotaError, UNLIMITED } from '../api/_lib/home/entitlements.js';
import {
	homeCallShape,
	homeTurnGate,
	isGatedHomeTool,
	quotaRefusalResult,
	shouldRefuseHomeCall,
} from '../api/_lib/home/turn-gate.js';

const OVER = { allowed: false, error: new HomeQuotaError({ dimension: 'agentTurns', limit: 1000, used: 1000, resetAt: '2026-10-01T00:00:00.000Z' }) };
const UNDER = { allowed: true, error: null };

const callOf = (domain, service, data = {}) => ({ name: 'home_call', input: { domain, service, data } });

describe('over quota, a safety action is still run', () => {
	const safe = [
		['lock', 'lock'],
		['cover', 'close_cover'],
		['alarm_control_panel', 'alarm_arm_away'],
		['valve', 'close_valve'],
	];

	for (const [domain, service] of safe) {
		it(`${domain}.${service} is never refused`, () => {
			expect(shouldRefuseHomeCall(OVER, callOf(domain, service))).toBe(false);
		});
	}

	it('the unsafe direction of the same domain IS refused', () => {
		expect(shouldRefuseHomeCall(OVER, callOf('lock', 'unlock'))).toBe(true);
		expect(shouldRefuseHomeCall(OVER, callOf('cover', 'open_cover'))).toBe(true);
		expect(shouldRefuseHomeCall(OVER, callOf('alarm_control_panel', 'alarm_disarm'))).toBe(true);
	});

	it('a safety action needs no live entity list, which is what makes it work when degraded', () => {
		// Classified from the domain and service alone: no socket, no state, no
		// registry read. That is the property that matters, because the states in
		// which somebody most needs to lock up are the degraded ones.
		expect(homeCallShape(callOf('lock', 'lock'))).toEqual({ domain: 'lock', service: 'lock', attributes: {} });
		expect(shouldRefuseHomeCall(OVER, callOf('lock', 'lock'))).toBe(false);
	});
});

describe('reading the house is never gated', () => {
	it('the read-only tools stay open over quota', () => {
		for (const name of ['home_status', 'home_list_macros', 'home_grants']) {
			expect(isGatedHomeTool(name)).toBe(false);
			expect(shouldRefuseHomeCall(OVER, { name, input: {} })).toBe(false);
		}
	});

	it('the acting tools are gated', () => {
		expect(isGatedHomeTool('home_call')).toBe(true);
		expect(isGatedHomeTool('home_activate')).toBe(true);
		expect(shouldRefuseHomeCall(OVER, { name: 'home_activate', input: { macro: 'movie night' } })).toBe(true);
	});

	it('an unknown tool is treated as gated rather than waved through', () => {
		expect(isGatedHomeTool('home_not_a_tool')).toBe(true);
	});
});

describe('under quota nothing is refused at all', () => {
	it('every tool runs', () => {
		for (const name of ['home_status', 'home_call', 'home_activate']) {
			expect(shouldRefuseHomeCall(UNDER, { name, input: { domain: 'light', service: 'turn_on' } })).toBe(false);
		}
	});
});

describe('the gate resolves a verdict', () => {
	const entitlements = (agentTurns) => ({
		tier: { id: 'user', label: 'User' },
		limits: { agentTurns },
		sources: { agentTurns: 'plan' },
	});

	it('allows an account inside its limit', async () => {
		const gate = await homeTurnGate('u1', {
			resolveHomeEntitlementsFloor: async () => entitlements(1000),
			resolveHomeEntitlementsForUser: async () => entitlements(1000),
			readUsage: async () => 999,
		});
		expect(gate).toEqual({ allowed: true, error: null });
	});

	it('never reads the chain for a turn the floor already allows', async () => {
		// The floor pass is holder-free. Putting a Solana balance read on the chat
		// critical path for a turn that is obviously inside the limit would be a
		// latency regression for every user who talks to their house.
		const full = vi.fn(async () => entitlements(1000));
		const gate = await homeTurnGate('u1', {
			resolveHomeEntitlementsFloor: async () => entitlements(1000),
			resolveHomeEntitlementsForUser: full,
			readUsage: async () => 10,
		});
		expect(gate.allowed).toBe(true);
		expect(full).not.toHaveBeenCalled();
	});

	it('falls through to the full read when the floor is not enough, and a holder is saved by it', async () => {
		// Past the free floor, but this account holds $THREE and the ladder's
		// multiplier raises the ceiling. The floor pass must not refuse them.
		const full = vi.fn(async () => entitlements(4000));
		const gate = await homeTurnGate('u1', {
			resolveHomeEntitlementsFloor: async () => entitlements(1000),
			resolveHomeEntitlementsForUser: full,
			readUsage: async () => 1500,
		});
		expect(gate.allowed).toBe(true);
		expect(full).toHaveBeenCalledOnce();
	});

	it('refuses the turn that would cross the limit, and says how to fix it', async () => {
		const gate = await homeTurnGate('u1', {
			resolveHomeEntitlementsFloor: async () => entitlements(1000),
			resolveHomeEntitlementsForUser: async () => entitlements(1000),
			readUsage: async () => 1000,
		});
		expect(gate.allowed).toBe(false);
		expect(gate.error).toBeInstanceOf(HomeQuotaError);
		expect(gate.error.status).toBe(402);
		expect(gate.error.upgradePath).toBe('/pricing');
		// It tells the user the one thing a quota message must never omit here.
		expect(gate.error.message).toContain('Locking up');
	});

	it('never refuses an unlimited plan', async () => {
		const gate = await homeTurnGate('u1', {
			resolveHomeEntitlementsFloor: async () => entitlements(UNLIMITED),
			resolveHomeEntitlementsForUser: async () => entitlements(UNLIMITED),
			readUsage: async () => 10_000_000,
		});
		expect(gate.allowed).toBe(true);
	});

	it('FAILS OPEN when the entitlement read throws', async () => {
		const onError = vi.fn();
		const gate = await homeTurnGate('u1', {
			resolveHomeEntitlementsFloor: async () => { throw new Error('neon is down'); },
			resolveHomeEntitlementsForUser: async () => { throw new Error('neon is down'); },
			readUsage: async () => 0,
			onError,
		});
		expect(gate.allowed).toBe(true);
		expect(onError).toHaveBeenCalledOnce();
	});

	it('FAILS OPEN when the usage counter is unreachable', async () => {
		const gate = await homeTurnGate('u1', {
			resolveHomeEntitlementsFloor: async () => entitlements(10),
			resolveHomeEntitlementsForUser: async () => entitlements(10),
			readUsage: async () => { throw new Error('redis and postgres both refused'); },
			onError: () => {},
		});
		expect(gate.allowed).toBe(true);
	});
});

describe('the refusal the model speaks', () => {
	it('is a tool result the agent can turn into a sentence, not a bare error', () => {
		const r = quotaRefusalResult(OVER.error);
		expect(r.ok).toBe(false);
		expect(r.kind).toBe('error');
		expect(r.code).toBe('quota_exceeded');
		expect(r.text).toContain('three.ws/pricing');
		expect(r.structured).toMatchObject({
			error: 'quota_exceeded',
			dimension: 'agentTurns',
			limit: 1000,
			used: 1000,
			upgrade: '/pricing',
		});
		expect(r.structured.resets_at).toBe('2026-10-01T00:00:00.000Z');
	});
});
