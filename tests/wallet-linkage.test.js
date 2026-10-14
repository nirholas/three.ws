// Unit tests for @three-ws/wallet-linkage: every fixture address below is a
// freshly generated Keypair with no real on-chain history (clearly synthetic,
// per CLAUDE.md), and the RPC client is an in-memory mock, never a live call.
import { describe, it, expect } from 'vitest';

import { analyzeLinkage, scorePair, bandFor, runSignals } from '../packages/wallet-linkage/src/index.js';

// Synthetic addresses (see header comment). Grouped by which scenario they feed.
const A = '4R2oiBtedGSybD1ydHJUuhR3f3xGhMDG1koKLvSoLkFE';
const B = 'AJWHsJ2Jf1uPCyRUWmLtMwKWPThTh6HqTtmhQSCbqHxz';
const C = 'E8wnGkdJ6Zhk685bsBszgBukDshyusgcfFnzWvfg6gLY';
const PAYER = '5Wi3E9FWx9xLFaBuyreTNo88KE3a9GLVTmVeQMFiA7uM';
const TOKENACC = 'Eikdxk12cSv37z8DNcmkVRNsW2s2guYcdZMT7eJZiyz8';
const XD = '39uzFU7hFMo4k5r18AsrGJYq69C7Ak8BRcj32QVCgjHf';
const XE = 'BrHXRgGn12G5kr2yUQy31BBVa6j473dfyU2xn1AkxKf6';
const FUNDER = '5xgS6r8RoHAVq7VdjdsPy2ewKHWhhweP8AiyiuJyy4Fy';
const XD_FIRST = 'G1VPwNMBYv7jGx78FuNsq9SiKYWiV7diPSfZKYGLkVca';
const XE_FIRST = '3wrkk9aQTVoW88pFVeKuRMbEMpzZzAnuhgttpBy6bAgm';
const P = '5m6YZJ1GnNQG9EYTQTZaLjQY5Bu4CHqvhLtjXjZQR8iH';
const Q = '8Un7Wo3GHpFBm5TbRx2T68PX3uqjNrrNF6jpLKZSrVYS';
const R = '2NjV3yypiWSxkLMmgTah9ffSw81atuxpXjY8FxeaYKW2';
const HUBX = 'BTkMFgjwubXkhq9RNtqAGbkho7bsyBnonqB2JKbHNw5W';
const S = 'CZz77skYYDfBL78CwKPZtsYuTBnQ4dXpYjFRceBDJGyd';
const T = 'F7TshAiAZfHBDTpDkVEPfRum1bybAY8yYSWzrZC6rjqG';
const U = '7K9CPT2uDrPkrR2CkETkdXz9L2MPwmEpbbBetNAjZd2s';
const V = 'E8wnGkdJ6Zhk685bsBszgBukDshyusgcfFnzWvfg6gLY'; // reuse C's key, unrelated to V's history in this file
const W = '3zxXkjgT9b57ZuZC1mE56xuoGAGk3vqnyqhEiywGyrB7';

function nativeIx(source, destination, sol) {
	return { program: 'system', programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: { source, destination, lamports: Math.round(sol * 1e9) } } };
}

function tx({ feePayer, otherKeys = [], blockTime, instructions }) {
	return {
		blockTime,
		transaction: { message: { accountKeys: [feePayer, ...otherKeys].map((k) => ({ pubkey: k })), instructions } },
		meta: { preTokenBalances: [], postTokenBalances: [] },
	};
}

/**
 * @param {Record<string,string[]>} signaturesByAddress
 * @param {Record<string, object>} txBySignature
 * @param {Record<string, object>} [accountInfoByAddress]
 */
function makeConnection(signaturesByAddress, txBySignature, accountInfoByAddress = {}) {
	return {
		async getSignaturesForAddress(pubkey) {
			const addr = pubkey.toBase58();
			return (signaturesByAddress[addr] || []).map((signature) => ({
				signature,
				blockTime: txBySignature[signature]?.blockTime ?? null,
				err: null,
			}));
		},
		async getParsedTransaction(signature) {
			return txBySignature[signature] ?? null;
		},
		async getAccountInfo(pubkey) {
			const addr = pubkey.toBase58();
			return accountInfoByAddress[addr] ?? null;
		},
	};
}

describe('score.js: noisy-OR combiner', () => {
	it('returns none/0 for no signals', () => {
		expect(scorePair([])).toEqual({ score: 0, band: 'none', topSignal: null, signals: [] });
	});

	it('combines two signals higher than either alone', () => {
		const solo = scorePair([{ id: 'x', weight: 0.6, evidence: [] }]);
		const combined = scorePair([
			{ id: 'x', weight: 0.6, evidence: [] },
			{ id: 'y', weight: 0.6, evidence: [] },
		]);
		expect(combined.score).toBeGreaterThan(solo.score);
		// 1 - (1-0.6)(1-0.6) = 0.84
		expect(combined.score).toBe(84);
	});

	it('bands the score at the documented thresholds', () => {
		expect(bandFor(90)).toBe('confirmed');
		expect(bandFor(70)).toBe('strong');
		expect(bandFor(50)).toBe('moderate');
		expect(bandFor(25)).toBe('weak');
		expect(bandFor(5)).toBe('none');
	});
});

describe('analyzeLinkage: peer-first-funding + shared fee payer', () => {
	const sigFundAFromB = tx({ feePayer: B, otherKeys: [A], blockTime: 1000, instructions: [nativeIx(B, A, 1)] });
	const sigPayerToA = tx({ feePayer: PAYER, otherKeys: [A], blockTime: 2000, instructions: [nativeIx(PAYER, A, 0.0001)] });
	const sigPayerToB = tx({ feePayer: PAYER, otherKeys: [B], blockTime: 2000, instructions: [nativeIx(PAYER, B, 0.0001)] });

	const connection = makeConnection(
		{
			[A]: ['sig_fund_A_from_B', 'sig_payer_to_A'],
			[B]: ['sig_fund_A_from_B', 'sig_payer_to_B'],
		},
		{
			sig_fund_A_from_B: sigFundAFromB,
			sig_payer_to_A: sigPayerToA,
			sig_payer_to_B: sigPayerToB,
		},
	);

	it('scores the pair strong/confirmed with both signals as evidence', async () => {
		const result = await analyzeLinkage(connection, [A, B]);
		expect(result.complete).toBe(true);
		expect(result.pairs).toHaveLength(1);
		const pair = result.pairs[0];
		expect(pair.signals).toContain('peer-first-funding');
		expect(pair.signals).toContain('solana-fee-payer');
		expect(pair.score).toBeGreaterThanOrEqual(65);
		expect(['strong', 'confirmed']).toContain(pair.band);
		const feePayerEvidence = pair.evidence.find((s) => s.id === 'solana-fee-payer');
		expect(feePayerEvidence.evidence.some((e) => e.account === PAYER)).toBe(true);
	});
});

describe('analyzeLinkage: shared fee payer survives the REAL @solana/web3.js shape', () => {
	// Real `getParsedTransaction` wraps every `accountKeys[].pubkey` in a
	// PublicKey instance, not a plain string (the `tx()` helper above uses
	// plain strings, which is why the other fee-payer test cannot catch a
	// collector that forgets to call `.toBase58()`). This fixture mimics the
	// real shape with a minimal `{ toBase58() }` stand-in.
	const asPubkey = (addr) => ({ toBase58: () => addr });
	function realShapeTx({ feePayer, otherKeys = [], blockTime, instructions }) {
		return {
			blockTime,
			transaction: { message: { accountKeys: [feePayer, ...otherKeys].map((k) => ({ pubkey: asPubkey(k) })), instructions } },
			meta: { preTokenBalances: [], postTokenBalances: [] },
		};
	}

	const sigPayerToP = realShapeTx({ feePayer: PAYER, otherKeys: [P], blockTime: 3000, instructions: [nativeIx(PAYER, P, 0.01)] });
	const sigPayerToQ = realShapeTx({ feePayer: PAYER, otherKeys: [Q], blockTime: 3000, instructions: [nativeIx(PAYER, Q, 0.01)] });

	const connection = makeConnection(
		{ [P]: ['sig_payer_to_p'], [Q]: ['sig_payer_to_q'] },
		{ sig_payer_to_p: sigPayerToP, sig_payer_to_q: sigPayerToQ },
	);

	it('still finds the shared fee payer when accountKeys[].pubkey is a PublicKey-shaped object', async () => {
		const result = await analyzeLinkage(connection, [P, Q]);
		const pair = result.pairs[0];
		expect(pair.signals).toContain('solana-fee-payer');
		const evidence = pair.evidence.find((s) => s.id === 'solana-fee-payer');
		expect(evidence.evidence.some((e) => e.account === PAYER)).toBe(true);
	});
});

describe('analyzeLinkage: unrelated addresses score none', () => {
	const sigFundCFromFunder = tx({ feePayer: FUNDER, otherKeys: [C], blockTime: 500, instructions: [nativeIx(FUNDER, C, 2)] });
	const connection = makeConnection(
		{ [A]: [], [C]: ['sig_fund_C'] },
		{ sig_fund_C: sigFundCFromFunder },
	);

	it('finds no evidence and scores 0 / none', async () => {
		const result = await analyzeLinkage(connection, [A, C]);
		expect(result.pairs[0]).toMatchObject({ score: 0, band: 'none', signals: [] });
	});
});

describe('analyzeLinkage: solana-account-control via SPL token-account ownership', () => {
	const connection = makeConnection(
		{ [TOKENACC]: [], [A]: [] },
		{},
		{ [TOKENACC]: { value: { data: { parsed: { type: 'account', info: { owner: A } } } } } },
	);

	it('flags the token account as controlled by its owner', async () => {
		const result = await analyzeLinkage(connection, [TOKENACC, A]);
		const pair = result.pairs[0];
		expect(pair.signals).toEqual(['solana-account-control']);
		expect(pair.score).toBe(100);
		expect(pair.band).toBe('confirmed');
	});
});

describe('analyzeLinkage: funding-burst', () => {
	const sigXdFirst = tx({ feePayer: XD_FIRST, otherKeys: [XD], blockTime: 100, instructions: [nativeIx(XD_FIRST, XD, 5)] });
	const sigFunderToXd = tx({ feePayer: FUNDER, otherKeys: [XD], blockTime: 5000, instructions: [nativeIx(FUNDER, XD, 1.0)] });
	const sigXeFirst = tx({ feePayer: XE_FIRST, otherKeys: [XE], blockTime: 200, instructions: [nativeIx(XE_FIRST, XE, 3)] });
	const sigFunderToXe = tx({ feePayer: FUNDER, otherKeys: [XE], blockTime: 5200, instructions: [nativeIx(FUNDER, XE, 1.05)] });

	const connection = makeConnection(
		{
			[XD]: ['sig_xd_first', 'sig_funder_xd'],
			[XE]: ['sig_xe_first', 'sig_funder_xe'],
		},
		{
			sig_xd_first: sigXdFirst,
			sig_funder_xd: sigFunderToXd,
			sig_xe_first: sigXeFirst,
			sig_funder_xe: sigFunderToXe,
		},
	);

	it('flags a shared funder sending similar amounts within a short window, without tripping common-first-funder', async () => {
		const result = await analyzeLinkage(connection, [XD, XE]);
		const pair = result.pairs[0];
		expect(pair.signals).toContain('funding-burst');
		expect(pair.signals).not.toContain('common-first-funder');
	});
});

describe('analyzeLinkage: hub exclusion suppresses common-first-funder', () => {
	const mk = (addr, blockTime) => tx({ feePayer: HUBX, otherKeys: [addr], blockTime, instructions: [nativeIx(HUBX, addr, 0.5)] });

	const connection = makeConnection(
		{ [P]: ['sig_p'], [Q]: ['sig_q'], [R]: ['sig_r'] },
		{ sig_p: mk(P, 10), sig_q: mk(Q, 20), sig_r: mk(R, 30) },
	);

	it('does not treat a funder of 3+ requested addresses as a controller link', async () => {
		const result = await analyzeLinkage(connection, [P, Q, R]);
		for (const pair of result.pairs) {
			expect(pair.signals).not.toContain('common-first-funder');
			expect(pair.score).toBe(0);
		}
	});
});

describe('analyzeLinkage: common-first-funder fires for a non-hub shared funder', () => {
	const mk = (addr, blockTime) => tx({ feePayer: U, otherKeys: [addr], blockTime, instructions: [nativeIx(U, addr, 0.5)] });

	const connection = makeConnection(
		{ [S]: ['sig_s'], [T]: ['sig_t'] },
		{ sig_s: mk(S, 10), sig_t: mk(T, 20) },
	);

	it('flags two addresses first funded by the same non-hub third party', async () => {
		const result = await analyzeLinkage(connection, [S, T]);
		const pair = result.pairs[0];
		expect(pair.signals).toContain('common-first-funder');
		const ev = pair.evidence.find((s) => s.id === 'common-first-funder');
		expect(ev.evidence[0].account).toBe(U);
	});
});

describe('analyzeLinkage: direct transfer between the pair', () => {
	const sigVFirst = tx({ feePayer: W, otherKeys: [V], blockTime: 50, instructions: [nativeIx(W, V, 4)] });
	const sigDirect = tx({ feePayer: V, otherKeys: [W], blockTime: 90, instructions: [nativeIx(V, W, 2)] });

	const connection = makeConnection(
		{ [V]: ['sig_v_first', 'sig_direct'], [W]: ['sig_direct'] },
		{ sig_v_first: sigVFirst, sig_direct: sigDirect },
	);

	it('flags value moved directly between the two addresses', async () => {
		const result = await analyzeLinkage(connection, [V, W]);
		const pair = result.pairs[0];
		expect(pair.signals).toContain('direct-transfer');
		const ev = pair.evidence.find((s) => s.id === 'direct-transfer');
		expect(ev.evidence[0].detail).toContain('2 SOL');
	});
});

describe('analyzeLinkage: input validation', () => {
	it('rejects fewer than 2 addresses', async () => {
		await expect(analyzeLinkage(makeConnection({}, {}), [A])).rejects.toThrow();
	});
});

describe('runSignals', () => {
	it('never throws even when a bundle is missing expected shape', () => {
		const broken = { address: A, transfers: [], payers: new Set(), firstInbound: null, facts: {}, rentPayer: null };
		expect(() => runSignals(broken, broken, { exclusions: new Set(), sharedBy: new Map() })).not.toThrow();
	});
});
