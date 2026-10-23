// Escrow lifecycle with an independent evaluator (api/_lib/labor-evaluation.js):
// pass, fail, dispute (both rulings), timeouts, a double attestation, a late
// dispute, payout retry, moderator override, and the property that no sequence of
// actions leaves funds locked. The case ledger is an in-memory double with the
// real compare-and-set and hash-chain semantics; money moves through spies.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { Keypair } from '@solana/web3.js';

const h = vi.hoisted(() => ({
	cases: new Map(),
	events: [],
	bounty: null,
	job: null,
	owners: new Set(),
	wallets: {},
	notes: [],
	payFail: false,
	paid: [],
	verify: { pass: true, reason: 'ok', verifier: 'llm' },
	attester: null,
}));

vi.mock('../api/_lib/env.js', () => ({ env: { APP_ORIGIN: 'https://three.ws' } }));

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...v) => {
		const q = strings.join('?');
		if (/FROM agent_identities WHERE id = \? AND user_id/.test(q)) return h.owners.has(`${v[0]}:${v[1]}`) ? [{ ok: 1 }] : [];
		if (/SELECT meta FROM agent_identities/.test(q)) return h.wallets[v[0]] ? [{ meta: { solana_address: h.wallets[v[0]] } }] : [];
		if (/SELECT id FROM labor_escrow_cases/.test(q)) {
			// Mirrors the WHERE clause of dueCaseIds so a bad pre-filter fails the lifecycle tests.
			const now = Date.now();
			const t = (x) => Date.parse(x);
			return [...h.cases.values()].filter((c) =>
				(['released', 'refunded'].includes(c.state) && !c.paid_at)
				|| (['funded', 'working'].includes(c.state) && t(c.deadline_at) <= now + 86_400_000)
				|| (c.state === 'submitted' && (c.evaluator_kind === 'platform' || t(c.attest_by) <= now + 86_400_000))
				|| (c.state === 'attested' && t(c.release_at) <= now)
				|| (c.state === 'disputed' && (c.evaluator_kind !== 'platform' || t(c.arbiter_by) <= now + 86_400_000)),
			).map((c) => ({ id: c.id }));
		}
		if (/UPDATE agent_bounties SET status = 'refunding'/.test(q)) {
			if (!['open', 'working'].includes(h.bounty.status)) return [];
			h.bounty.status = 'refunding';
			return [{ status: 'refunding' }];
		}
		if (/UPDATE agent_bounties SET status = \?, updated_at/.test(q)) {
			if (h.bounty.status === 'refunding') h.bounty.status = v[0];
			return [];
		}
		return [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

vi.mock('../api/_lib/agent-labor.js', () => ({
	getBounty: vi.fn(async () => (h.bounty ? { ...h.bounty } : null)),
	getJobByBounty: vi.fn(async () => (h.job ? { ...h.job } : null)),
	markJobFailed: vi.fn(async (id, { status }) => { h.job.status = status; }),
	markJobDelivered: vi.fn(async (id, d) => { h.job.status = 'delivered'; h.job.deliverable = d; return { ...h.job }; }),
	setBountyStatus: vi.fn(async (id, status) => { h.bounty.status = status; }),
	atomicsToThree: (a) => String(Number(a) / 1e6),
	_toBig: (a) => BigInt(a),
}));

vi.mock('../api/_lib/labor-match.js', () => ({ verifyDeliverable: vi.fn(async () => ({ ...h.verify, score: h.verify.pass ? 1 : 0 })) }));

vi.mock('../api/_lib/labor-escrow.js', () => ({
	payFromEscrow: vi.fn(async ({ toAddress, amountAtomics }) => {
		if (h.payFail) throw new Error('transaction was not confirmed');
		h.paid.push({ to: toAddress, amount: amountAtomics });
		return `SIG${h.paid.length}`;
	}),
	ensureEscrowGas: vi.fn(async () => ({})),
}));

vi.mock('../api/_lib/labor-settle.js', () => ({
	runSettlement: vi.fn(async ({ job, bounty, verdict }) => {
		if (h.payFail) throw new Error('transaction was not confirmed');
		if (['settled', 'failed', 'refunded'].includes(h.job.status)) return { idempotent: true, status: h.job.status };
		const sig = `SET${h.paid.length + 1}`;
		h.paid.push({ to: verdict.pass ? 'worker' : 'poster', amount: BigInt(bounty.reward_atomics) });
		h.job.status = verdict.pass ? 'settled' : verdict.neutral ? 'refunded' : 'failed';
		return { settled: verdict.pass, status: h.job.status, settlement_sig: verdict.pass ? sig : null, refund_sig: verdict.pass ? null : sig };
	}),
}));

vi.mock('../api/_lib/attest-event.js', () => ({ loadAttesterKeypair: () => { if (!h.attester) throw new Error('no key'); return h.attester; } }));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn(async (userId, type, p) => { h.notes.push({ userId, type, kind: p.kind }); }) }));

vi.mock('../api/_lib/labor-escrow-ledger.js', async () => {
	const m = await import('../api/_lib/labor-escrow-machine.js');
	const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
	const copy = (c) => (c ? structuredClone(c) : null);
	let n = 0;
	const append = (c, { from, to, event, actor, reason = null, data = {} }) => {
		const seq = c.version;
		const prev = [...h.events].reverse().find((e) => e.case_id === c.id);
		const at = new Date().toISOString();
		const hash = m.chainHash(prev?.hash || null, { seq, from, to, event, actor, reason, data, at });
		h.events.push({ case_id: c.id, seq, from_state: from, to_state: to, event, actor, reason, data, at, prev_hash: prev?.hash || null, hash });
	};
	return {
		ensureEscrowTables: async () => true,
		getCase: async (id) => copy(h.cases.get(id)),
		getCaseByBounty: async (b) => copy([...h.cases.values()].find((c) => c.bounty_id === b)),
		openCase: async ({ bounty, evaluator, disputeWindowSeconds }) => {
			const ex = [...h.cases.values()].find((c) => c.bounty_id === bounty.id);
			if (ex) return copy(ex);
			const ev = m.normalizeEvaluator(evaluator, { posterAgentId: bounty.poster_agent_id });
			const c = {
				id: `case${++n}`, bounty_id: bounty.id, job_id: null, state: 'funded', evaluator_kind: ev.kind,
				evaluator_agent_id: ev.agentId, dispute_window_seconds: m.normalizeDisputeWindow(disputeWindowSeconds),
				deadline_at: bounty.deadline ? new Date(bounty.deadline).toISOString() : new Date(Date.now() + m.DEFAULT_JOB_TTL_SECONDS * 1000).toISOString(),
				version: 1, notified: {}, paid_at: null, outcome: null, attestation: null, dispute: null, resolution: null,
			};
			h.cases.set(c.id, c);
			append(c, { from: null, to: 'funded', event: 'fund', actor: 'poster' });
			return copy(c);
		},
		transition: async (caseRow, event, { actor, reason = null, data = {}, patch = {} } = {}) => {
			const to = m.applyEvent(caseRow.state, event);
			const cur = h.cases.get(caseRow.id);
			if (cur.state !== caseRow.state) throw new m.EscrowError('state_changed', `escrow is already ${cur.state}; this action came too late`);
			for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null) cur[snake(k)] = v;
			cur.state = to;
			cur.version += 1;
			append(cur, { from: caseRow.state, to, event, actor, reason, data });
			return copy(cur);
		},
		markPaid: async (caseRow, { sig = null, data = {}, actor = 'platform' } = {}) => {
			const cur = h.cases.get(caseRow.id);
			if (cur.paid_at || !['released', 'refunded'].includes(cur.state)) return null;
			cur.paid_at = new Date().toISOString();
			cur.settle_sig = sig;
			cur.version += 1;
			append(cur, { from: cur.state, to: cur.state, event: 'payout', actor, data: { sig, ...data } });
			return copy(cur);
		},
		markNotified: async (id, key) => {
			const cur = h.cases.get(id);
			if (cur.notified[key]) return false;
			cur.notified[key] = true;
			return true;
		},
		trailFor: async (id) => {
			const events = h.events.filter((e) => e.case_id === id);
			return { events, chain: m.verifyChain(events) };
		},
	};
});

const ev = await import('../api/_lib/labor-evaluation.js');
const { EscrowError, verifyAttestation, verifyChain, isTerminal } = await import('../api/_lib/labor-escrow-machine.js');

const T0 = new Date('2026-10-23T12:00:00.000Z');
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const advance = (ms) => vi.setSystemTime(new Date(Date.now() + ms));

function setup({ evaluator = 'platform', disputeWindowSeconds = 86400 } = {}) {
	h.cases.clear(); h.events.length = 0; h.notes.length = 0; h.paid.length = 0;
	h.payFail = false;
	h.verify = { pass: true, reason: 'meets the spec', verifier: 'llm' };
	h.attester = Keypair.generate();
	h.owners = new Set(['pa:up', 'wa:uw', 'ea:ue']);
	h.wallets = { pa: 'POSTERADDR', wa: 'WORKERADDR', ea: 'EVALADDR' };
	h.bounty = {
		id: 'b1', title: 'Summarize', poster_agent_id: 'pa', poster_user_id: 'up', reward_atomics: '1000000',
		escrow_fund_sig: 'FUND', status: 'open', deadline: null,
		meta: { escrow: { evaluator, dispute_window_seconds: disputeWindowSeconds } },
	};
	h.job = { id: 'j1', bounty_id: 'b1', worker_agent_id: 'wa', worker_user_id: 'uw', status: 'working', price_atomics: '800000', deliverable: null };
}

async function award() {
	h.bounty.status = 'working';
	return ev.recordAward({ ...h.bounty }, { ...h.job });
}
async function deliver(output = 'a real deliverable') {
	h.job.status = 'delivered';
	h.job.deliverable = { output };
	return ev.intakeDelivery({ bounty: { ...h.bounty }, job: { ...h.job } });
}
const state = async () => (await ev.caseView('b1')).state;
const sweep = () => ev.sweepCases();

/** The timestamped transition table for a case, as printed in docs/labor-market.md. */
async function table(label) {
	const v = await ev.caseView('b1');
	const rows = v.trail.map((t) => `${t.seq.toString().padStart(2)} ${t.at}  ${(t.from || 'start').padEnd(9)} -> ${t.to.padEnd(9)} ${t.event.padEnd(15)} ${t.actor}`);
	console.log(`\n[${label}]\n${rows.join('\n')}`);
	return v;
}

beforeEach(() => { vi.useFakeTimers({ now: T0 }); setup(); });
afterEach(() => vi.useRealTimers());

describe('pass: the platform checker approves, the window closes, funds release', () => {
	it('walks funded to released and pays the worker once', async () => {
		await award();
		expect(await state()).toBe('working');
		await deliver();
		let v = await ev.caseView('b1');
		expect(v.state).toBe('attested');
		expect(v.attestation.verdict).toBe('pass');
		expect(verifyAttestation({ payload: v.attestation.payload, signature: v.attestation.signature, signer: v.attestation.signer })).toBe(true);

		await sweep(); // inside the window: nothing moves
		expect(await state()).toBe('attested');
		expect(h.paid).toHaveLength(0);

		advance(DAY + 1000);
		const r = await sweep();
		expect(r).toMatchObject({ resolved: 1, paid: 1, failed: 0 });
		v = await table('pass');
		expect(v.state).toBe('released');
		expect(v.outcome).toBe('pass');
		expect(v.paid_at).toBeTruthy();
		expect(h.paid).toEqual([{ to: 'worker', amount: 1_000_000n }]);
		expect(v.chain.ok).toBe(true);
		expect(h.job.status).toBe('settled');

		await sweep(); // a second sweep pays nothing more
		expect(h.paid).toHaveLength(1);
	});

	it('notifies both parties once per milestone', async () => {
		await award(); await deliver();
		advance(DAY + 1000); await sweep(); await sweep();
		const delivered = h.notes.filter((n) => n.kind === 'delivered').map((n) => n.userId).sort();
		expect(delivered).toEqual(['up', 'uw']);
		expect(h.notes.filter((n) => n.kind === 'paid')).toHaveLength(2);
	});
});

describe('fail: the checker rejects, the window closes, the buyer is refunded', () => {
	it('refunds the poster and marks the job failed', async () => {
		h.verify = { pass: false, reason: 'off spec', verifier: 'llm' };
		await award(); await deliver('nonsense');
		expect((await ev.caseView('b1')).attestation.verdict).toBe('fail');
		advance(DAY + 1000); await sweep();
		const v = await table('fail');
		expect(v.state).toBe('refunded');
		expect(v.outcome).toBe('fail');
		expect(h.paid).toEqual([{ to: 'poster', amount: 1_000_000n }]);
		expect(h.job.status).toBe('failed');
	});
});

describe('dispute', () => {
	it('freezes funds when the buyer disputes a pass, and the arbiter can overturn it', async () => {
		await award(); await deliver();
		await ev.openDispute({ bountyId: 'b1', userId: 'up', reason: 'The summary misses the second section entirely.' });
		advance(10 * DAY); // far past the window: a dispute must freeze, not release
		await sweep();
		expect(await state()).toBe('refunded'); // arbiter_timeout after 7 days
		expect((await ev.caseView('b1')).outcome).toBe('arbiter_timeout');
		expect(h.paid).toEqual([{ to: 'poster', amount: 1_000_000n }]);
	});

	it('an arbiter ruling for the worker releases the funds', async () => {
		await award(); await deliver();
		await ev.openDispute({ bountyId: 'b1', userId: 'up', reason: 'I do not think this meets the spec at all.' });
		expect(await state()).toBe('disputed');
		await sweep();
		expect(h.paid).toHaveLength(0); // frozen
		await ev.arbitrate({ bountyId: 'b1', adminId: 'adm', input: { verdict: 'pass', reasonCode: 'meets_spec', reasonDetail: 'reviewed by hand' } });
		const v = await table('dispute ruled for worker');
		expect(v.state).toBe('released');
		expect(v.resolution.verdict).toBe('pass');
		expect(h.paid).toEqual([{ to: 'worker', amount: 1_000_000n }]);
	});

	it('an arbiter ruling for the buyer refunds', async () => {
		await award(); await deliver();
		await ev.openDispute({ bountyId: 'b1', userId: 'up', reason: 'I do not think this meets the spec at all.' });
		await ev.arbitrate({ bountyId: 'b1', adminId: 'adm', input: { verdict: 'fail', reasonCode: 'off_spec' } });
		expect(await state()).toBe('refunded');
		expect(h.paid).toEqual([{ to: 'poster', amount: 1_000_000n }]);
	});

	it('only the losing side may dispute', async () => {
		await award(); await deliver(); // verdict: pass, so the worker won
		await expect(ev.openDispute({ bountyId: 'b1', userId: 'uw', reason: 'I want to dispute my own win here.' }))
			.rejects.toMatchObject({ code: 'not_losing_side', status: 403 });
	});

	it('a stranger cannot dispute', async () => {
		await award(); await deliver();
		await expect(ev.openDispute({ bountyId: 'b1', userId: 'nobody', reason: 'I am not a party to this job.' }))
			.rejects.toMatchObject({ code: 'forbidden' });
	});

	it('a dispute after the window closes is rejected, even before the cron has run', async () => {
		await award(); await deliver();
		advance(DAY + 1000);
		await expect(ev.openDispute({ bountyId: 'b1', userId: 'up', reason: 'This arrived just a moment too late.' }))
			.rejects.toMatchObject({ code: 'dispute_window_closed', status: 409 });
		await sweep();
		expect(await state()).toBe('released');
	});

	it('a dispute needs a reason', async () => {
		await award(); await deliver();
		await expect(ev.openDispute({ bountyId: 'b1', userId: 'up', reason: 'bad' })).rejects.toMatchObject({ code: 'reason_required' });
	});

	it('a dispute cannot be arbitrated twice', async () => {
		await award(); await deliver();
		await ev.openDispute({ bountyId: 'b1', userId: 'up', reason: 'The summary misses the second section entirely.' });
		await ev.arbitrate({ bountyId: 'b1', adminId: 'adm', input: { verdict: 'pass', reasonCode: 'meets_spec' } });
		await expect(ev.arbitrate({ bountyId: 'b1', adminId: 'adm', input: { verdict: 'fail', reasonCode: 'off_spec' } }))
			.rejects.toMatchObject({ code: 'already_resolved' });
		expect(h.paid).toHaveLength(1);
	});
});

describe('hiring agent as evaluator', () => {
	beforeEach(() => setup({ evaluator: 'poster', disputeWindowSeconds: 3600 }));

	it('waits for the poster to attest, then counts the window from the attestation', async () => {
		await award(); await deliver();
		expect(await state()).toBe('submitted');
		const view = await ev.caseView('b1', 'up');
		expect(view.viewer.can_attest).toBe(true);
		expect((await ev.caseView('b1', 'uw')).viewer.can_attest).toBe(false);

		await ev.submitAttestation({ bountyId: 'b1', userId: 'up', input: { verdict: 'pass' } });
		expect(await state()).toBe('attested');
		advance(HOUR + 1000); await sweep();
		expect(await state()).toBe('released');
	});

	it('a second attestation is rejected with a typed 409 and changes nothing', async () => {
		await award(); await deliver();
		await ev.submitAttestation({ bountyId: 'b1', userId: 'up', input: { verdict: 'pass' } });
		const before = (await ev.caseView('b1')).attestation.signature;
		await expect(ev.submitAttestation({ bountyId: 'b1', userId: 'up', input: { verdict: 'fail', reasonCode: 'off_spec' } }))
			.rejects.toMatchObject({ code: 'already_attested', status: 409 });
		const after = await ev.caseView('b1');
		expect(after.attestation.verdict).toBe('pass');
		expect(after.attestation.signature).toBe(before);
	});

	it('a concurrent double attestation has exactly one winner', async () => {
		await award(); await deliver();
		const results = await Promise.allSettled([
			ev.submitAttestation({ bountyId: 'b1', userId: 'up', input: { verdict: 'pass' } }),
			ev.submitAttestation({ bountyId: 'b1', userId: 'up', input: { verdict: 'fail', reasonCode: 'other' } }),
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(h.events.filter((e) => e.event === 'attest')).toHaveLength(1);
	});

	it('only the evaluator can attest, and not once the case has moved on', async () => {
		await award(); await deliver();
		await expect(ev.submitAttestation({ bountyId: 'b1', userId: 'uw', input: { verdict: 'pass' } }))
			.rejects.toMatchObject({ code: 'not_evaluator', status: 403 });
		await ev.submitAttestation({ bountyId: 'b1', userId: 'up', input: { verdict: 'pass' } });
		advance(HOUR + 1000); await sweep();
		await expect(ev.submitAttestation({ bountyId: 'b1', userId: 'up', input: { verdict: 'fail', reasonCode: 'other' } }))
			.rejects.toMatchObject({ code: 'already_resolved' });
	});

	it('no attestation by the deadline refunds the buyer', async () => {
		await award(); await deliver();
		advance(14 * DAY + 1000); await sweep(); // attest_by is the later of the job deadline and delivery + 3d
		const v = await table('no attestation');
		expect(v.state).toBe('refunded');
		expect(v.outcome).toBe('attest_timeout');
		expect(h.paid).toEqual([{ to: 'poster', amount: 1_000_000n }]);
		expect(h.job.status).toBe('refunded'); // nobody's fault: not 'failed'
	});

	it('rejects a signature from the wrong signer', async () => {
		await award(); await deliver();
		await expect(ev.submitAttestation({
			bountyId: 'b1', userId: 'up', input: { verdict: 'pass' },
			signature: 'AAAA', signer: Keypair.generate().publicKey.toBase58(), issuedAt: new Date().toISOString(),
		})).rejects.toMatchObject({ code: 'bad_signer' });
	});

	it('a disputed poster verdict is re-checked by the platform checker', async () => {
		await award(); await deliver();
		await ev.submitAttestation({ bountyId: 'b1', userId: 'up', input: { verdict: 'fail', reasonCode: 'off_spec' } });
		await ev.openDispute({ bountyId: 'b1', userId: 'uw', reason: 'The deliverable matches every line of the spec.' });
		const v = await ev.caseView('b1');
		expect(v.state).toBe('released'); // the checker passes it (verify.pass = true)
		expect(v.resolution.verdict).toBe('pass');
		expect(h.paid).toEqual([{ to: 'worker', amount: 1_000_000n }]);
	});
});

describe('registry agent as evaluator', () => {
	beforeEach(() => setup({ evaluator: { kind: 'agent', agentId: 'ea' }, disputeWindowSeconds: 0 }));

	it('the registry agent attests and a zero window releases at the next sweep', async () => {
		await award(); await deliver();
		await ev.submitAttestation({ bountyId: 'b1', userId: 'ue', input: { verdict: 'pass' } });
		await sweep();
		expect(await state()).toBe('released');
	});

	it('refuses an evaluator who is also the worker', async () => {
		h.owners.add('wa:ue');
		h.cases.clear(); h.events.length = 0;
		h.bounty.meta.escrow.evaluator = { kind: 'agent', agentId: 'wa' };
		await award(); await deliver();
		h.owners.add('wa:uw');
		await expect(ev.submitAttestation({ bountyId: 'b1', userId: 'uw', input: { verdict: 'pass' } }))
			.rejects.toMatchObject({ code: 'conflict_of_interest' });
	});
});

describe('timeouts', () => {
	it('an award that never delivers refunds at the deadline', async () => {
		h.bounty.deadline = new Date(T0.getTime() + 2 * DAY).toISOString();
		await award();
		advance(2 * DAY + 1000); await sweep();
		const v = await table('worker never delivers');
		expect(v).toMatchObject({ state: 'refunded', outcome: 'deadline' });
		expect(h.paid).toEqual([{ to: 'POSTERADDR', amount: 1_000_000n }]);
	});

	it('a bounty nobody takes refunds at the deadline', async () => {
		h.bounty.deadline = new Date(T0.getTime() + DAY).toISOString();
		h.job = null;
		await ev.ensureCase({ ...h.bounty });
		advance(DAY + 1000); await sweep();
		expect(await state()).toBe('refunded');
		expect(h.paid).toEqual([{ to: 'POSTERADDR', amount: 1_000_000n }]);
		expect(h.bounty.status).toBe('refunded');
	});

	it('the poster can cancel before an award', async () => {
		h.job = null;
		await ev.ensureCase({ ...h.bounty });
		await expect(ev.cancelBounty({ bountyId: 'b1', userId: 'uw' })).rejects.toMatchObject({ code: 'forbidden' });
		await ev.cancelBounty({ bountyId: 'b1', userId: 'up' });
		expect(await state()).toBe('refunded');
		expect(h.paid).toHaveLength(1);
	});

	it('warns both parties once when a deadline is within a day', async () => {
		h.bounty.deadline = new Date(T0.getTime() + 12 * HOUR).toISOString();
		await award();
		await sweep(); await sweep();
		const soon = h.notes.filter((n) => n.kind === 'deadline_soon');
		expect(soon.map((n) => n.userId).sort()).toEqual(['up', 'uw']);
	});
});

describe('payout retry: the decision is durable even when the transfer fails', () => {
	it('keeps the decision, tells the parties once, and pays exactly once on retry', async () => {
		await award(); await deliver();
		h.payFail = true;
		advance(DAY + 1000);
		await sweep();
		let v = await ev.caseView('b1');
		expect(v.state).toBe('released');
		expect(v.paid_at).toBeNull();
		await sweep();
		expect(h.notes.filter((n) => n.kind === 'payout_delayed')).toHaveLength(2); // one per party, once
		h.payFail = false;
		await sweep();
		v = await table('payout retried');
		expect(v.paid_at).toBeTruthy();
		expect(h.paid).toHaveLength(1);
		expect(h.events.filter((e) => e.event === 'payout')).toHaveLength(1);
	});
});

describe('moderator override', () => {
	it('releases a disputed case to the worker', async () => {
		await award(); await deliver();
		await ev.openDispute({ bountyId: 'b1', userId: 'up', reason: 'The summary misses the second section entirely.' });
		await ev.moderatorOverride({ bountyId: 'b1', adminId: 'm1', action: 'release', reason: 'reviewed' });
		expect(await state()).toBe('released');
		expect(h.paid).toEqual([{ to: 'worker', amount: 1_000_000n }]);
		const last = (await ev.caseView('b1')).trail.find((t) => t.event === 'override_pass');
		expect(last.actor).toBe('moderator:m1');
	});

	it('refunds an unawarded bounty and cannot reopen a resolved case', async () => {
		h.job = null;
		await ev.ensureCase({ ...h.bounty });
		await ev.moderatorOverride({ bountyId: 'b1', adminId: 'm1', action: 'refund' });
		expect(await state()).toBe('refunded');
		await expect(ev.moderatorOverride({ bountyId: 'b1', adminId: 'm1', action: 'release' })).rejects.toBeInstanceOf(EscrowError);
		expect(h.paid).toHaveLength(1);
	});
});

describe('audit trail', () => {
	it('every transition is on the trail with a timestamp, in an unbroken chain', async () => {
		await award(); await deliver();
		advance(DAY + 1000); await sweep();
		const v = await ev.caseView('b1');
		expect(v.trail.map((t) => t.event)).toEqual(['fund', 'award', 'deliver', 'attest', 'cooldown_pass', 'payout']);
		expect(v.trail.every((t) => Number.isFinite(Date.parse(t.at)))).toBe(true);
		expect(v.chain.ok).toBe(true);
	});

	it('detects a tampered trail', async () => {
		await award(); await deliver();
		h.events[1].actor = 'someone_else';
		expect(verifyChain(h.events)).toMatchObject({ ok: false });
		expect((await ev.caseView('b1')).chain.ok).toBe(false);
	});
});

describe('property: no sequence of actions leaves funds locked forever', () => {
	const action = fc.oneof(
		fc.constant({ t: 'award' }),
		fc.constant({ t: 'deliver' }),
		fc.record({ t: fc.constant('attest'), pass: fc.boolean() }),
		fc.constant({ t: 'dispute' }),
		fc.constant({ t: 'cancel' }),
		fc.record({ t: fc.constant('wait'), hours: fc.integer({ min: 0, max: 96 }) }),
		fc.record({ t: fc.constant('payfail'), on: fc.boolean() }),
		fc.constant({ t: 'sweep' }),
	);

	it('always ends released or refunded, and paid exactly once', async () => {
		await fc.assert(fc.asyncProperty(
			fc.constantFrom('platform', 'poster'),
			fc.constantFrom(0, 3600, 86400),
			fc.array(action, { maxLength: 14 }),
			async (evaluator, windowS, actions) => {
				vi.setSystemTime(T0);
				setup({ evaluator, disputeWindowSeconds: windowS });
				await ev.ensureCase({ ...h.bounty });
				for (const a of actions) {
					try {
						if (a.t === 'award') await award();
						else if (a.t === 'deliver' && h.bounty.status === 'working') await deliver();
						else if (a.t === 'attest') await ev.submitAttestation({ bountyId: 'b1', userId: 'up', input: a.pass ? { verdict: 'pass' } : { verdict: 'fail', reasonCode: 'other' } });
						else if (a.t === 'dispute') await ev.openDispute({ bountyId: 'b1', userId: 'up', reason: 'I dispute this verdict for good reasons.' });
						else if (a.t === 'cancel') await ev.cancelBounty({ bountyId: 'b1', userId: 'up' });
						else if (a.t === 'wait') advance(a.hours * HOUR);
						else if (a.t === 'payfail') h.payFail = a.on;
						else if (a.t === 'sweep') await sweep();
					} catch (e) {
						if (!(e instanceof EscrowError)) throw e;
					}
				}
				// Leave the system alone for longer than every timer, with a healthy payout rail.
				h.payFail = false;
				for (let i = 0; i < 6; i++) { advance(20 * DAY); await sweep(); }
				const c = [...h.cases.values()][0];
				expect(isTerminal(c.state)).toBe(true);
				expect(c.paid_at).toBeTruthy();
				expect(h.paid).toHaveLength(1);
				expect(verifyChain(h.events.filter((e) => e.case_id === c.id)).ok).toBe(true);
			},
		), { numRuns: 120 });
	});
});
