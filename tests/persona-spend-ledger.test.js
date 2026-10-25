import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate the fs-backend store per test run so parallel test files (and repeat
// runs) never see each other's spend history.
const tmpDir = path.join(os.tmpdir(), `threews-persona-spend-test-${process.pid}-${Date.now()}`);
process.env.PERSONA_SPEND_STORE_DIR = tmpDir;

const {
	checkPersonaSpend,
	recordPersonaSpend,
	sessionSpentUsdc,
	defaultSessionId,
	PERSONA_SPEND_CAPS,
} = await import('../api/_lib/persona-spend-ledger.js');

beforeEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	await fs.mkdir(tmpDir, { recursive: true });
});

describe('persona spend ledger — per-call cap', () => {
	it('allows a call within the per-call cap', async () => {
		const gate = await checkPersonaSpend({ personaId: 'persona_percall0000001', sessionId: 's1', usdc: PERSONA_SPEND_CAPS.maxPerCallUsdc });
		expect(gate.ok).toBe(true);
	});

	it('blocks a call over the per-call cap', async () => {
		const gate = await checkPersonaSpend({ personaId: 'persona_percall0000002', sessionId: 's1', usdc: PERSONA_SPEND_CAPS.maxPerCallUsdc + 0.01 });
		expect(gate.ok).toBe(false);
		expect(gate.code).toBe('over_call_cap');
	});

	it('rejects a non-positive amount', async () => {
		const gate = await checkPersonaSpend({ personaId: 'persona_percall0000003', sessionId: 's1', usdc: 0 });
		expect(gate.ok).toBe(false);
		expect(gate.code).toBe('invalid_amount');
	});
});

describe('persona spend ledger — cumulative per-session cap', () => {
	it('a second call in the same session that would exceed the session cap is blocked', async () => {
		const personaId = 'persona_sessioncap00001';
		const sessionId = 'session-a';
		// Spend right up to (but not over) the per-call cap, repeatedly, until the
		// session cap is nearly exhausted, recording each as SETTLED (mirrors what
		// the handler does only after a real transfer confirms).
		const perCall = Math.min(PERSONA_SPEND_CAPS.maxPerCallUsdc, PERSONA_SPEND_CAPS.maxPerSessionUsdc / 2);
		let spent = 0;
		while (spent + perCall <= PERSONA_SPEND_CAPS.maxPerSessionUsdc) {
			const gate = await checkPersonaSpend({ personaId, sessionId, usdc: perCall });
			expect(gate.ok).toBe(true);
			await recordPersonaSpend({ personaId, sessionId, usdc: perCall, tool: 'persona_tip', toAddress: 'DestAddr111', signature: `sig-${spent}` });
			spent += perCall;
		}
		// One more call of any positive size should now be blocked by the session cap.
		const over = await checkPersonaSpend({ personaId, sessionId, usdc: Math.max(0.001, PERSONA_SPEND_CAPS.maxPerSessionUsdc - spent + 0.001) });
		expect(over.ok).toBe(false);
		expect(over.code).toBe('over_session_cap');
	});

	it('a DIFFERENT persona has its own independent cap', async () => {
		const personaId = 'persona_sessionisolate01';
		await recordPersonaSpend({ personaId, sessionId: 'session-x', usdc: PERSONA_SPEND_CAPS.maxPerSessionUsdc, tool: 'persona_send', toAddress: 'A', signature: 'sig-x' });
		const exhausted = await checkPersonaSpend({ personaId, sessionId: 'session-x', usdc: 0.01 });
		expect(exhausted.ok).toBe(false);

		const otherPersona = await checkPersonaSpend({ personaId: 'persona_sessionisolate02', sessionId: 'session-x', usdc: 0.01 });
		expect(otherPersona.ok).toBe(true);
	});

	it('sessionSpentUsdc sums exactly what was recorded', async () => {
		const personaId = 'persona_sumcheck0000001';
		const sessionId = 'sum-session';
		await recordPersonaSpend({ personaId, sessionId, usdc: 0.1, tool: 'persona_tip', toAddress: 'A', signature: 's1' });
		await recordPersonaSpend({ personaId, sessionId, usdc: 0.25, tool: 'persona_tip', toAddress: 'A', signature: 's2' });
		expect(await sessionSpentUsdc(personaId, sessionId)).toBeCloseTo(0.35, 6);
	});
});

describe('persona spend ledger — default session bucketing', () => {
	it('defaultSessionId groups by persona + UTC day', () => {
		const id = defaultSessionId('persona_defaultbucket01');
		expect(id).toMatch(/^persona_defaultbucket01:\d{4}-\d{2}-\d{2}$/);
	});
});

describe('persona spend ledger - cap cannot be reset with a fresh session_id', () => {
	it('spend recorded under one session counts against another session of the same persona', async () => {
		const personaId = 'persona_freshsession001';
		const cap = PERSONA_SPEND_CAPS.maxPerSessionUsdc;
		const perCall = PERSONA_SPEND_CAPS.maxPerCallUsdc;
		let spent = 0;
		while (spent + perCall <= cap + 1e-9) {
			await recordPersonaSpend({ personaId, sessionId: 'session-a', usdc: perCall, tool: 'persona_send' });
			spent += perCall;
		}
		const gate = await checkPersonaSpend({ personaId, sessionId: 'session-b', usdc: perCall });
		expect(gate.ok).toBe(false);
		expect(gate.code).toBe('over_session_cap');
	});
});
