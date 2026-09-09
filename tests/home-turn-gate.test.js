// The agent-turn gate: what a monthly quota may refuse in the chat lane, and
// the two things it may never refuse.
//
// The load-bearing assertions here are the ones that keep commitment 1 true in
// the lane where a person actually talks to their house: over quota, asking the
// agent to lock up, close a garage or a valve, or arm an alarm still runs, and
// asking it what the house is doing still answers.

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { assertHomeActionAllowed, HomeQuotaError, UNLIMITED } from '../api/_lib/home/entitlements.js';
import {
	homeCallShape,
	homeTurnGate,
	isGatedHomeTool,
	quotaRefusalResult,
	shouldRefuseHomeCall,
} from '../api/_lib/home/turn-gate.js';
import {
	acquireHomeInstance,
	liveHomeAvailable,
	pickEntity,
	readState,
	setState,
	waitForState,
} from './_helpers/home-instance.js';

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

// ── The same commitment, against a real house ────────────────────────────────
//
// Everything above classifies a call. Classifying it right is not the same as
// the deadbolt moving, and the line this order exists to keep is about the
// deadbolt. So this block puts a real account past a real ceiling, pauses its
// real home the way a downgrade does, and then asks a real Home Assistant to
// lock up. The assertion is the state read back out of the house.
//
// The account is put over quota through the override row rather than by
// burning a thousand turns: the override is the same code path a limit of any
// size takes, and a test that had to spend an hour of model calls to reach a
// ceiling is a test nobody runs.

// HOME_ALLOW_LOCAL_INSTANCE has to be exported BEFORE the run, not set from
// inside it: api/_lib/home-url-guard.js reads it into a module-level const when
// it is first imported, which happens above this line. Without it every call
// below is refused with "127.0.0.1 is a private address", which reads as a
// product bug and is a missing variable. The whole command is:
//
//   HOME_LIVE=1 HOME_LIVE_NAME=<lane> HOME_ALLOW_LOCAL_INSTANCE=1 \
//     node --env-file=.env.local node_modules/.bin/vitest run tests/home-turn-gate.test.js
const live = describe.skipIf(!liveHomeAvailable() || !process.env.DATABASE_URL);

live('over quota and paused, against a real Home Assistant', () => {
	/** @type {any} */ let sql;
	let instance;
	let owner;
	let home;
	let gate;
	let stubbedKey = false;
	const entity = {};

	const call = (domain, service, entityId, extra = {}) => ({
		name: 'home_call',
		input: { domain, service, data: { entity_id: entityId, ...extra } },
	});

	// A real alarm panel takes a code, and this house's does: the demo panel
	// reports code_arm_required and refuses an arm without one. It rides in the
	// call's data, which is where a user's panel code would ride too, and it
	// changes nothing about the classification: the exemption is decided from the
	// domain and the service alone.
	const ALARM_CODE = '1234';

	beforeAll(async () => {
		// The connection row's access token is encrypted at rest, so creating one
		// needs a key. Generated per run and thrown away with the process: it
		// encrypts only the rows this block creates and deletes, exactly as in
		// tests/home-security.test.js.
		if (!process.env.WALLET_ENCRYPTION_KEY && !process.env.JWT_SECRET) {
			vi.stubEnv('WALLET_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
			stubbedKey = true;
		}
		instance = await acquireHomeInstance();
		if (process.env.HOME_ALLOW_LOCAL_INSTANCE !== '1') {
			throw new Error(
				'Set HOME_ALLOW_LOCAL_INSTANCE=1 in the environment before this run: the URL guard '
				+ 'caches it at import time, so setting it here is too late and every call would be '
				+ 'refused as a private address.',
			);
		}
		({ sql } = await import('../api/_lib/db.js'));
		const { createConnection } = await import('../api/_lib/home/store.js');
		const { setAccountOverride } = await import('../api/_lib/home/entitlements.js');

		[owner] = await sql`
			insert into users (email) values (${`home-gate-${Date.now()}@qa.three.ws`}) returning id
		`;
		home = await createConnection({
			userId: owner.id,
			label: 'Over quota house',
			baseUrl: instance.baseUrl,
			token: instance.token,
			status: 'connected',
		});

		// Every dimension at zero: there is no allowance left anywhere on this
		// account, which is the harshest state the product can put a user in.
		await setAccountOverride({
			userId: owner.id,
			limits: { homes: 0, members: 0, streams: 0, voiceMinutes: 0, agentTurns: 0, relayConnections: 0 },
			note: 'tests/home-turn-gate.test.js: the safety exemption, proved against a real house',
		});
		// And the home paused, as a downgrade would leave it.
		await sql`
			update home_connections
			   set deactivated_at = now(), deactivated_reason = 'Paused by this test'
			 where id = ${home.id}
		`;
		[home] = await sql`select * from home_connections where id = ${home.id}`;

		gate = await homeTurnGate(owner.id);

		// A lock that is NOT the first one in the house.
		//
		// vitest runs test FILES in parallel and every live block in this lane
		// drives the SAME physical house, so two files both taking the first lock
		// end up asserting on each other's transitions: tests/home-tools.test.js
		// read 'locking' where it expected 'locked' the moment this block landed.
		// Taking a different deadbolt costs nothing and removes the whole class.
		const firstLock = await pickEntity(instance, 'lock');
		entity.lock = await pickEntity(instance, 'lock', (state) => state.entity_id !== firstLock);
		entity.cover = await pickEntity(instance, 'cover');
		entity.alarm = await pickEntity(instance, 'alarm_control_panel');
		entity.light = await pickEntity(instance, 'light');

		// Start each device in the state a safety action moves it OUT of, so a
		// pass cannot come from a device that was already where we want it.
		await setState(instance, 'lock', 'unlock', entity.lock);
		await setState(instance, 'cover', 'open_cover', entity.cover);
		await disarmAlarm();
		await waitForState(instance, entity.lock, 'unlocked');
	}, 600_000);

	afterAll(async () => {
		const { closeAll } = await import('../api/_lib/home/runtime.js');
		closeAll();
		if (instance && entity.lock) await setState(instance, 'lock', 'lock', entity.lock).catch(() => {});
		if (instance && entity.alarm) await disarmAlarm().catch(() => {});
		if (sql && owner) {
			await sql`delete from home_plan_overrides where user_id = ${owner.id}`.catch(() => {});
			await sql`delete from home_connections where user_id = ${owner.id}`.catch(() => {});
			await sql`delete from users where id = ${owner.id}`.catch(() => {});
		}
		if (stubbedKey) vi.unstubAllEnvs();
	});

	/** The demo panel refuses a bare disarm, so the code goes in the body. */
	async function disarmAlarm() {
		const res = await fetch(`${instance.baseUrl}/api/services/alarm_control_panel/alarm_disarm`, {
			method: 'POST',
			headers: { authorization: `Bearer ${instance.token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ entity_id: entity.alarm, code: ALARM_CODE }),
			signal: AbortSignal.timeout(15_000),
		});
		if (!res.ok) throw new Error(`alarm_disarm returned ${res.status}`);
	}

	it('the account really is over its agent-turn quota', () => {
		expect(gate.allowed).toBe(false);
		expect(gate.error).toBeInstanceOf(HomeQuotaError);
		expect(gate.error.dimension).toBe('agentTurns');
	});

	// The three transcripts this order is written around. Each one asserts the
	// device, read back from Home Assistant, and not the return value of our own
	// classifier.
	const transcripts = [
		{ key: 'lock', domain: 'lock', service: 'lock', from: 'unlocked', to: ['locked', 'locking'] },
		{ key: 'cover', domain: 'cover', service: 'close_cover', from: 'open', to: ['closed', 'closing'] },
		{
			key: 'alarm',
			domain: 'alarm_control_panel',
			service: 'alarm_arm_away',
			from: 'disarmed',
			to: ['armed_away', 'arming'],
			data: { code: ALARM_CODE },
		},
	];

	for (const t of transcripts) {
		it(`${t.domain}.${t.service} still runs, and the device moves`, async () => {
			const { runHomeTool } = await import('../api/_lib/home/tools.js');
			const entityId = entity[t.key];
			expect(await readState(instance, entityId)).toBe(t.from);

			// Both gates, in the order a real request meets them: the chat lane's
			// quota check, then the REST lane's paused-home check.
			expect(shouldRefuseHomeCall(gate, call(t.domain, t.service, entityId, t.data))).toBe(false);
			expect(() => assertHomeActionAllowed({ home, call: { domain: t.domain, service: t.service } }))
				.not.toThrow();

			const result = await runHomeTool(
				'home_call',
				{ home_id: home.id, domain: t.domain, service: t.service, data: { entity_id: entityId, ...t.data } },
				{ userId: owner.id, source: 'mcp' },
			);
			expect(result.ok, `${t.domain}.${t.service} was refused: ${result.text}`).toBe(true);

			await new Promise((resolve) => setTimeout(resolve, 1500));
			expect(t.to).toContain(await readState(instance, entityId));
		}, 120_000);
	}

	it('an ordinary action on the same account, in the same moment, IS refused', async () => {
		// Without this the block above would also pass on a gate that had simply
		// stopped working. The exemption has to be selective to mean anything.
		expect(shouldRefuseHomeCall(gate, call('light', 'turn_on', entity.light))).toBe(true);
		expect(() => assertHomeActionAllowed({ home, call: { domain: 'light', service: 'turn_on' } }))
			.toThrow();
	});

	it('and the unsafe direction of a safety domain is still refused', () => {
		expect(shouldRefuseHomeCall(gate, call('lock', 'unlock', entity.lock))).toBe(true);
		expect(() => assertHomeActionAllowed({ home, call: { domain: 'lock', service: 'unlock' } }))
			.toThrow();
	});
});
