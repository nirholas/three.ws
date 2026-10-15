// Pure phase → render-payload mapping + cap math for the live a2a-hire visualizer.
//
// These are the load-bearing pure functions behind /api/agents/a2a-hire's screen
// frames and the /agent-screen hire panel: get the cap math or the phase payload
// wrong and the viewer sees a wrong price, a dead explorer link, or a coin that
// fires before settlement. No I/O here — exactly what the unit tests pin.

import { describe, it, expect } from 'vitest';
import {
	HIRE_PHASES,
	HIRE_PHASE_INDEX,
	HIRE_ERROR_PHASES,
	explorerTxUrl,
	fmtUsd,
	hireCapMath,
	hirePhaseFrame,
	isAmbiguousPaymentError,
	classifyHireOutcome,
	buildHireAttestationPayload,
	sortedStringify,
} from '../api/_lib/a2a-hire-phases.js';

describe('hireCapMath', () => {
	it('is uncapped when no limits are set', () => {
		const m = hireCapMath({ usd: 0.04 });
		expect(m.overCap).toBe(false);
		expect(m.perCallCap).toBe(null);
		expect(m.dailyUsd).toBe(null);
		expect(m.dailyRemainingBefore).toBe(null);
		expect(m.dailyRemainingAfter).toBe(null);
		expect(m.price).toBe(0.04);
	});

	it('flags over-cap when price exceeds the owner maxUsd', () => {
		const m = hireCapMath({ usd: 0.12, maxUsd: 0.1 });
		expect(m.overMax).toBe(true);
		expect(m.overCap).toBe(true);
		expect(m.perCallCap).toBe(0.1);
	});

	it('does not flag over-cap at exactly the cap (epsilon tolerant)', () => {
		const m = hireCapMath({ usd: 0.1, maxUsd: 0.1 });
		expect(m.overMax).toBe(false);
		expect(m.overCap).toBe(false);
	});

	it('flags over per-tx limit independently of maxUsd', () => {
		const m = hireCapMath({ usd: 0.5, perTxUsd: 0.25 });
		expect(m.overPerTx).toBe(true);
		expect(m.overCap).toBe(true);
		expect(m.perCallCap).toBe(0.25);
	});

	it('uses the tighter of maxUsd and per-tx as the per-call cap', () => {
		expect(hireCapMath({ usd: 0.01, maxUsd: 0.1, perTxUsd: 0.25 }).perCallCap).toBe(0.1);
		expect(hireCapMath({ usd: 0.01, maxUsd: 0.5, perTxUsd: 0.25 }).perCallCap).toBe(0.25);
	});

	it('computes remaining daily headroom before and after the hire', () => {
		const m = hireCapMath({ usd: 0.04, dailyUsd: 1.0, dailySpentUsd: 0.6 });
		expect(m.dailyRemainingBefore).toBeCloseTo(0.4, 9);
		expect(m.dailyRemainingAfter).toBeCloseTo(0.36, 9);
		expect(m.overDaily).toBe(false);
	});

	it('flags over-daily when the hire would breach the rolling cap', () => {
		const m = hireCapMath({ usd: 0.5, dailyUsd: 1.0, dailySpentUsd: 0.8 });
		expect(m.overDaily).toBe(true);
		expect(m.overCap).toBe(true);
		// remaining never goes negative
		expect(m.dailyRemainingAfter).toBe(0);
	});

	it('treats a non-finite price as zero rather than NaN', () => {
		const m = hireCapMath({ usd: undefined, maxUsd: 0.1 });
		expect(m.price).toBe(0);
		expect(m.overCap).toBe(false);
	});
});

describe('explorerTxUrl', () => {
	it('builds a mainnet solscan link by default', () => {
		expect(explorerTxUrl('SiG123')).toBe('https://solscan.io/tx/SiG123');
	});
	it('appends the devnet cluster when asked', () => {
		expect(explorerTxUrl('SiG123', 'devnet')).toBe('https://solscan.io/tx/SiG123?cluster=devnet');
	});
	it('returns null for a missing signature so the UI shows pending', () => {
		expect(explorerTxUrl(null)).toBe(null);
		expect(explorerTxUrl('')).toBe(null);
		expect(explorerTxUrl(undefined)).toBe(null);
	});
});

describe('fmtUsd', () => {
	it('renders whole-cent prices with two decimals', () => {
		expect(fmtUsd(0.04)).toBe('0.04');
		expect(fmtUsd(1)).toBe('1.00');
	});
	it('keeps sub-cent micro-prices from collapsing to 0.00', () => {
		expect(fmtUsd(0.0004)).not.toBe('0.00');
	});
	it('is safe on non-finite input', () => {
		expect(fmtUsd(undefined)).toBe('0.00');
		expect(fmtUsd(NaN)).toBe('0.00');
	});
});

describe('HIRE_PHASES ordering', () => {
	it('orders running before settled (verify-then-settle: coin fires only on settle)', () => {
		expect(HIRE_PHASE_INDEX.running).toBeLessThan(HIRE_PHASE_INDEX.settled);
	});
	it('ends at the on-chain receipt', () => {
		expect(HIRE_PHASES[HIRE_PHASES.length - 1]).toBe('recorded');
	});
	it('keeps the client step list in sync (7 happy-path phases)', () => {
		expect(HIRE_PHASES).toEqual(['discover', 'quote', 'reserved', 'running', 'settled', 'delivered', 'recorded']);
	});
});

describe('hirePhaseFrame', () => {
	const base = {
		hireId: 'h1',
		slug: 'forge_logo',
		skill: 'Forge Logo',
		providerName: 'AGENT-B',
		providerId: 'p1',
		hirerId: 'a1',
		usd: 0.04,
		maxUsd: 0.1,
		network: 'mainnet',
	};

	it('tags every frame as an analysis frame carrying the a2a_hire sidecar', () => {
		const f = hirePhaseFrame('quote', base);
		expect(f.type).toBe('analysis');
		expect(f.meta.kind).toBe('a2a_hire');
		expect(f.meta.phase).toBe('quote');
		expect(f.meta.phaseIndex).toBe(HIRE_PHASE_INDEX.quote);
		expect(f.meta.ok).toBe(true);
		expect(f.meta.usd).toBe(0.04);
		expect(f.meta.maxUsd).toBe(0.1);
	});

	it('renders the quote line with provider, slug, price and cap', () => {
		const f = hirePhaseFrame('quote', { ...base, cap: { perCallCap: 0.1 } });
		expect(f.activity).toContain('AGENT-B');
		expect(f.activity).toContain('forge_logo');
		expect(f.activity).toContain('$0.04');
		expect(f.activity).toContain('cap $0.10');
	});

	it('derives explorer links from real signatures only', () => {
		const settled = hirePhaseFrame('settled', { ...base, txSig: 'PAYSIG' });
		expect(settled.meta.txSig).toBe('PAYSIG');
		expect(settled.meta.paymentExplorer).toBe('https://solscan.io/tx/PAYSIG');
		// no invocation yet → no link
		expect(settled.meta.invocationSig).toBe(null);
		expect(settled.meta.invocationExplorer).toBe(null);

		const recorded = hirePhaseFrame('recorded', { ...base, txSig: 'PAYSIG', invocationSig: 'INVSIG' });
		expect(recorded.meta.invocationExplorer).toBe('https://solscan.io/tx/INVSIG');
		expect(recorded.meta.paymentExplorer).toBe('https://solscan.io/tx/PAYSIG');
	});

	it('marks error phases not-ok and out of the happy-path index', () => {
		expect(HIRE_ERROR_PHASES).toContain('over_cap');
		const over = hirePhaseFrame('over_cap', { ...base, usd: 0.2, cap: { perCallCap: 0.1 } });
		expect(over.meta.ok).toBe(false);
		expect(over.meta.phaseIndex).toBe(-1);
		expect(over.activity).toContain('exceed the cap');

		const failed = hirePhaseFrame('failed', { ...base, error: 'upstream 500' });
		expect(failed.meta.ok).toBe(false);
		expect(failed.activity).toContain('no charge');
		expect(failed.activity).toContain('upstream 500');
	});

	it('never charges narration on a settled coin without a real signature being present in meta', () => {
		// The settled frame may be emitted before the sig propagates; meta keeps it
		// null (renders "pending"), never a fabricated link.
		const f = hirePhaseFrame('settled', { ...base, txSig: null });
		expect(f.meta.paymentExplorer).toBe(null);
	});

	it('passes the cap object through to the badge payload', () => {
		const cap = { perCallCap: 0.1, dailyUsd: 1, dailyRemaining: 0.6 };
		const f = hirePhaseFrame('reserved', { ...base, cap });
		expect(f.meta.cap).toEqual(cap);
	});
});

describe('fulfillment attestation (pure core)', () => {
	it('recognises axios timeout/abort shapes as ambiguous', () => {
		expect(isAmbiguousPaymentError({ code: 'ECONNABORTED', message: 'timeout of 60000ms exceeded' })).toBe(true);
		expect(isAmbiguousPaymentError({ code: 'ETIMEDOUT' })).toBe(true);
		expect(isAmbiguousPaymentError({ name: 'CanceledError' })).toBe(true);
		expect(isAmbiguousPaymentError({ message: 'request timed out' })).toBe(true);
	});

	it('does not call a clean, non-timeout failure ambiguous', () => {
		expect(isAmbiguousPaymentError({ code: 'no_wallet', message: 'no Solana wallet provisioned' })).toBe(false);
		expect(isAmbiguousPaymentError({ code: 'spend_disabled' })).toBe(false);
		expect(isAmbiguousPaymentError(null)).toBe(false);
	});

	it('classifies a completed hire as delivered, never from an ambiguous error', () => {
		expect(classifyHireOutcome('recorded')).toBe('delivered');
		expect(classifyHireOutcome('recorded', { code: 'ECONNABORTED' })).toBe('delivered');
	});

	it('classifies a clean payment failure as failed (verify-then-settle: no funds moved)', () => {
		expect(classifyHireOutcome('failed', { code: 'no_wallet', message: 'no wallet' })).toBe('failed');
		expect(classifyHireOutcome('failed', null)).toBe('failed');
	});

	it('never infers delivered from an ambiguous failure: records disputed instead', () => {
		expect(classifyHireOutcome('failed', { code: 'ECONNABORTED', message: 'timeout of 60000ms exceeded' })).toBe(
			'disputed',
		);
	});

	it('builds the canonical attestation payload shape', () => {
		const payload = buildHireAttestationPayload({
			hireId: 'h1',
			paymentSignature: 'SIG1',
			outcome: 'delivered',
			evidenceHash: 'deadbeef',
			signedBy: 'PUBKEY1',
		});
		expect(payload).toEqual({
			hire_id: 'h1',
			payment_signature: 'SIG1',
			outcome: 'delivered',
			evidence_hash: 'deadbeef',
			signed_by: 'PUBKEY1',
		});
	});

	it('defaults payment_signature to null rather than undefined', () => {
		const payload = buildHireAttestationPayload({
			hireId: 'h1',
			paymentSignature: null,
			outcome: 'failed',
			evidenceHash: 'deadbeef',
			signedBy: 'PUBKEY1',
		});
		expect(payload.payment_signature).toBe(null);
	});

	it('sortedStringify is independent of key insertion order', () => {
		const a = sortedStringify({ b: 2, a: 1, c: { y: 2, x: 1 } });
		const b = sortedStringify({ a: 1, c: { x: 1, y: 2 }, b: 2 });
		expect(a).toBe(b);
	});

	it('sortedStringify round-trips primitives, arrays, and null', () => {
		expect(sortedStringify(null)).toBe('null');
		expect(sortedStringify(42)).toBe('42');
		expect(sortedStringify('x')).toBe('"x"');
		expect(sortedStringify([3, 1, { b: 1, a: 2 }])).toBe('[3,1,{"a":2,"b":1}]');
	});
});
