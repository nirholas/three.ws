// Pure state machine for labor-market escrow (api/_lib/labor-escrow-machine.js):
// every transition, the dispute window edges, attestation signing, the audit
// chain, and the property that no case can wait on a human forever.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Keypair } from '@solana/web3.js';
import {
	ESCROW_STATES, ESCROW_EVENTS, TERMINAL_STATES, applyEvent, dueEvent, attestDeadline,
	assertCanDispute, losingSide, normalizeDisputeWindow, normalizeEvaluator,
	validateAttestationInput, buildAttestationPayload, signAttestation, verifyAttestation,
	chainHash, verifyChain, EscrowError, ARBITER_WINDOW_SECONDS, DEFAULT_DISPUTE_WINDOW_SECONDS,
	DEFAULT_JOB_TTL_SECONDS,
} from '../api/_lib/labor-escrow-machine.js';

const T0 = new Date('2026-10-23T12:00:00.000Z');
const at = (base, seconds) => new Date(base.getTime() + seconds * 1000);
const iso = (d) => d.toISOString();

describe('transition table', () => {
	const legal = [
		['funded', 'award', 'working'],
		['funded', 'deadline', 'refunded'],
		['funded', 'cancel', 'refunded'],
		['working', 'deliver', 'submitted'],
		['working', 'deadline', 'refunded'],
		['submitted', 'attest', 'attested'],
		['submitted', 'attest_timeout', 'refunded'],
		['attested', 'dispute', 'disputed'],
		['attested', 'cooldown_pass', 'released'],
		['attested', 'cooldown_fail', 'refunded'],
		['disputed', 'resolve_pass', 'released'],
		['disputed', 'resolve_fail', 'refunded'],
		['disputed', 'arbiter_timeout', 'refunded'],
	];
	it.each(legal)('%s --%s--> %s', (from, event, to) => {
		expect(applyEvent(from, event)).toBe(to);
	});

	it('every other (state, event) pair is rejected with a typed 409', () => {
		const ok = new Set(legal.map(([f, e]) => `${f}:${e}`));
		for (const s of ESCROW_STATES) {
			for (const e of ESCROW_EVENTS) {
				if (ok.has(`${s}:${e}`)) continue;
				let err;
				try { applyEvent(s, e); } catch (x) { err = x; }
				expect(err).toBeInstanceOf(EscrowError);
				expect(err.status).toBe(409);
				expect(err.code).toBe(TERMINAL_STATES.has(s) ? 'already_resolved' : 'illegal_transition');
			}
		}
	});

	it('a second attestation attempt is illegal once attested', () => {
		expect(() => applyEvent('attested', 'attest')).toThrow(/cannot attest/);
	});
});

describe('dispute window', () => {
	const attested = (verdict, windowS = 100) => ({
		state: 'attested',
		attestation: { verdict },
		release_at: iso(at(T0, windowS)),
	});

	it('the losing side is the buyer on a pass and the worker on a fail', () => {
		expect(losingSide({ verdict: 'pass' })).toBe('poster');
		expect(losingSide({ verdict: 'fail' })).toBe('worker');
	});

	it('allows the losing side inside the window', () => {
		expect(() => assertCanDispute(attested('pass'), 'poster', at(T0, 99))).not.toThrow();
		expect(() => assertCanDispute(attested('fail'), 'worker', at(T0, 0))).not.toThrow();
	});

	it('rejects the winning side', () => {
		expect(() => assertCanDispute(attested('pass'), 'worker', T0)).toThrow(/only the poster/);
		expect(() => assertCanDispute(attested('fail'), 'poster', T0)).toThrow(/only the worker/);
	});

	it('rejects a late dispute, exactly at the window edge and after', () => {
		for (const s of [100, 101, 99999]) {
			let err;
			try { assertCanDispute(attested('pass'), 'poster', at(T0, s)); } catch (x) { err = x; }
			expect(err?.code).toBe('dispute_window_closed');
		}
	});

	it('rejects disputes in every state but attested', () => {
		for (const state of ESCROW_STATES.filter((s) => s !== 'attested')) {
			expect(() => assertCanDispute({ state, attestation: null, release_at: null }, 'poster', T0)).toThrow(EscrowError);
		}
		expect(() => assertCanDispute({ state: 'disputed' }, 'poster', T0)).toThrow(/already in dispute/);
	});
});

describe('time-driven exits (the cron decision)', () => {
	it('funded and working expire at the deadline', () => {
		for (const state of ['funded', 'working']) {
			const c = { state, deadline_at: iso(at(T0, 60)) };
			expect(dueEvent(c, at(T0, 59))).toBeNull();
			expect(dueEvent(c, at(T0, 60))).toBe('deadline');
		}
	});

	it('submitted with no attestation refunds at attest_by', () => {
		const c = { state: 'submitted', attest_by: iso(at(T0, 60)) };
		expect(dueEvent(c, at(T0, 59))).toBeNull();
		expect(dueEvent(c, at(T0, 60))).toBe('attest_timeout');
	});

	it('attested releases on a pass and refunds on a fail when the cooldown ends', () => {
		const base = { state: 'attested', release_at: iso(at(T0, 60)) };
		expect(dueEvent({ ...base, attestation: { verdict: 'pass' } }, at(T0, 59))).toBeNull();
		expect(dueEvent({ ...base, attestation: { verdict: 'pass' } }, at(T0, 60))).toBe('cooldown_pass');
		expect(dueEvent({ ...base, attestation: { verdict: 'fail' } }, at(T0, 60))).toBe('cooldown_fail');
	});

	it('a dispute with no ruling refunds the buyer at arbiter_by', () => {
		const c = { state: 'disputed', arbiter_by: iso(at(T0, 60)) };
		expect(dueEvent(c, at(T0, 59))).toBeNull();
		expect(dueEvent(c, at(T0, 60))).toBe('arbiter_timeout');
	});

	it('terminal states are never due', () => {
		expect(dueEvent({ state: 'released' }, at(T0, 1e9))).toBeNull();
		expect(dueEvent({ state: 'refunded' }, at(T0, 1e9))).toBeNull();
	});

	it('late delivery keeps a grace window before the no-attestation refund', () => {
		const deadline = iso(at(T0, 100));
		const lateDelivery = iso(at(T0, 90));
		expect(new Date(attestDeadline({ deadlineAt: deadline, submittedAt: lateDelivery })).getTime())
			.toBeGreaterThan(at(T0, 100).getTime());
		const earlyDelivery = iso(at(T0, -10 * 86400));
		expect(attestDeadline({ deadlineAt: deadline, submittedAt: earlyDelivery })).toBe(deadline);
	});
});

describe('no path leaves funds locked forever (property)', () => {
	// A tiny interpreter over the pure machine: random human actions interleaved
	// with random clock jumps. Whatever happens, once the clock runs far enough
	// and only the cron acts, the case is terminal.
	const humanAction = fc.constantFrom('award', 'deliver', 'attest_pass', 'attest_fail', 'dispute', 'resolve_pass', 'resolve_fail', 'noop');

	it('every reachable case terminates under cron-only ticks', () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(humanAction, fc.integer({ min: 0, max: 5 * 86400 })), { maxLength: 12 }),
				fc.integer({ min: 0, max: 30 * 86400 }),
				(script, windowS) => {
					let now = T0;
					const c = {
						state: 'funded',
						deadline_at: iso(at(T0, DEFAULT_JOB_TTL_SECONDS)),
						attest_by: null, release_at: null, arbiter_by: null, attestation: null,
					};
					const step = (event) => { c.state = applyEvent(c.state, event); };
					for (const [action, jump] of script) {
						now = at(now, jump);
						const due = dueEvent(c, now);
						if (due) { step(due); continue; }
						try {
							if (action === 'award') step('award');
							else if (action === 'deliver') {
								step('deliver');
								c.attest_by = attestDeadline({ deadlineAt: c.deadline_at, submittedAt: iso(now) });
							} else if (action.startsWith('attest_')) {
								step('attest');
								c.attestation = { verdict: action.slice(7) };
								c.release_at = iso(at(now, windowS));
							} else if (action === 'dispute') {
								assertCanDispute(c, losingSide(c.attestation), now);
								step('dispute');
								c.arbiter_by = iso(at(now, ARBITER_WINDOW_SECONDS));
							} else if (action.startsWith('resolve_')) step(action);
						} catch (e) {
							if (!(e instanceof EscrowError) && !(e instanceof TypeError)) throw e;
						}
					}
					for (let i = 0; i < 6 && !TERMINAL_STATES.has(c.state); i++) {
						now = at(now, 40 * 86400);
						const due = dueEvent(c, now);
						if (due) c.state = applyEvent(c.state, due);
					}
					return TERMINAL_STATES.has(c.state);
				},
			),
			{ numRuns: 400 },
		);
	});

	it('every non-terminal state has at least one time-driven exit', () => {
		const farFuture = at(T0, 1e9);
		for (const state of ESCROW_STATES.filter((s) => !TERMINAL_STATES.has(s))) {
			const c = {
				state, deadline_at: iso(T0), attest_by: iso(T0), release_at: iso(T0), arbiter_by: iso(T0),
				attestation: { verdict: 'pass' },
			};
			const due = dueEvent(c, farFuture);
			expect(due, state).toBeTruthy();
			expect(TERMINAL_STATES.has(applyEvent(state, due)) || state === 'funded' || state === 'working').toBe(true);
		}
	});
});

describe('evaluator and window inputs', () => {
	it('defaults to the platform checker and the 24h window', () => {
		expect(normalizeEvaluator(undefined)).toEqual({ kind: 'platform', agentId: null });
		expect(normalizeDisputeWindow(undefined)).toBe(DEFAULT_DISPUTE_WINDOW_SECONDS);
	});
	it('accepts the hiring agent and a registry agent', () => {
		expect(normalizeEvaluator('poster', { posterAgentId: 'p1' })).toEqual({ kind: 'poster', agentId: 'p1' });
		expect(normalizeEvaluator({ kind: 'agent', agentId: 'a1' })).toEqual({ kind: 'agent', agentId: 'a1' });
	});
	it('rejects unknown kinds, a registry evaluator with no agent, and bad windows', () => {
		expect(() => normalizeEvaluator({ kind: 'oracle' })).toThrow(/evaluator must be/);
		expect(() => normalizeEvaluator({ kind: 'agent' })).toThrow(/needs an agentId/);
		expect(() => normalizeDisputeWindow(-1)).toThrow(/between 0/);
		expect(() => normalizeDisputeWindow(31 * 86400)).toThrow(/between 0/);
		expect(normalizeDisputeWindow(0)).toBe(0);
	});
});

describe('attestations', () => {
	it('validates verdict, reason code and evidence url', () => {
		expect(validateAttestationInput({ verdict: 'pass' })).toMatchObject({ reasonCode: 'meets_spec', evidenceUrl: null });
		expect(validateAttestationInput({ verdict: 'fail', reasonCode: 'off_spec', evidenceUrl: 'https://example.com/e' }).evidenceUrl)
			.toBe('https://example.com/e');
		expect(() => validateAttestationInput({ verdict: 'maybe' })).toThrow(/pass' or 'fail/);
		expect(() => validateAttestationInput({ verdict: 'fail' })).toThrow(/reasonCode/);
		expect(() => validateAttestationInput({ verdict: 'pass', reasonCode: 'off_spec' })).toThrow(/reasonCode/);
		expect(() => validateAttestationInput({ verdict: 'pass', evidenceUrl: 'http://example.com' })).toThrow(/https/);
		expect(() => validateAttestationInput({ verdict: 'pass', evidenceUrl: 'javascript:alert(1)' })).toThrow(/https/);
	});

	const base = (signer) => buildAttestationPayload({
		caseId: 'c', bountyId: 'b', jobId: 'j', deliverableHash: 'h', evaluatorKind: 'agent',
		evaluatorAgentId: 'a', signer, verdict: 'pass', reasonCode: 'meets_spec', issuedAt: iso(T0),
	});

	it('round-trips a signature and rejects tampering or a different signer', () => {
		const kp = Keypair.generate();
		const payload = base(kp.publicKey.toBase58());
		const sig = signAttestation(payload, kp);
		expect(verifyAttestation({ payload, signature: sig, signer: kp.publicKey.toBase58() })).toBe(true);
		expect(verifyAttestation({ payload: { ...payload, verdict: 'fail' }, signature: sig, signer: kp.publicKey.toBase58() })).toBe(false);
		const other = Keypair.generate();
		expect(verifyAttestation({ payload, signature: sig, signer: other.publicKey.toBase58() })).toBe(false);
		expect(verifyAttestation({ payload, signature: 'not-base64!!', signer: kp.publicKey.toBase58() })).toBe(false);
	});

	it('is independent of key order', () => {
		const kp = Keypair.generate();
		const payload = base(kp.publicKey.toBase58());
		const shuffled = Object.fromEntries(Object.entries(payload).reverse());
		expect(verifyAttestation({ payload: shuffled, signature: signAttestation(payload, kp), signer: kp.publicKey.toBase58() })).toBe(true);
	});
});

describe('audit chain', () => {
	const build = (n) => {
		const out = [];
		let prev = null;
		for (let seq = 1; seq <= n; seq++) {
			const e = { seq, from_state: 'a', to_state: 'b', event: 'x', actor: 'platform', reason: null, data: { n: seq }, at: iso(at(T0, seq)) };
			const hash = chainHash(prev, { seq, from: 'a', to: 'b', event: 'x', actor: 'platform', reason: null, data: { n: seq }, at: e.at });
			out.push({ ...e, prev_hash: prev, hash });
			prev = hash;
		}
		return out;
	};
	it('verifies an intact trail and pinpoints an edited entry', () => {
		const trail = build(4);
		expect(verifyChain(trail)).toEqual({ ok: true, brokenAt: null });
		trail[2] = { ...trail[2], data: { n: 999 } };
		expect(verifyChain(trail)).toEqual({ ok: false, brokenAt: 3 });
	});
	it('detects a removed entry', () => {
		const trail = build(4);
		trail.splice(1, 1);
		expect(verifyChain(trail).ok).toBe(false);
	});
});
