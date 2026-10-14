import { describe, it, expect } from 'vitest';

import { evaluateCreatorLinkagePairs } from '../api/_lib/trade-firewall.js';

// Synthetic addresses only, no real wallets. These are plain strings, not
// signed keys: the function under test is pure band/score arithmetic over an
// `analyzeLinkage()`-shaped `pairs` array, it never touches the network.
const CREATOR = 'Creator11111111111111111111111111111111111';
const BUYER_LINKED = 'BuyerLinked111111111111111111111111111111';
const BUYER_CLEAN = 'BuyerClean1111111111111111111111111111111';
const BUYER_WEAK = 'BuyerWeak11111111111111111111111111111111';

describe('evaluateCreatorLinkagePairs (early buyers linked to the creator)', () => {
	it('warns when an early buyer shares control with the creator at the strong band or above', () => {
		const pairs = [
			{ a: CREATOR, b: BUYER_LINKED, score: 90, band: 'confirmed', topSignal: 'solana-fee-payer', evidence: [] },
			{ a: CREATOR, b: BUYER_CLEAN, score: 0, band: 'none', topSignal: null, evidence: [] },
		];
		const res = evaluateCreatorLinkagePairs(CREATOR, pairs);
		expect(res.status).toBe('warn');
		expect(res.reason).toBe('early_buyer_linked_to_creator');
		expect(res.detail.linked_wallets).toEqual([BUYER_LINKED]);
		expect(res.detail.top_match.score).toBe(90);
	});

	it('passes clean when no pair involving the creator reaches the warn band', () => {
		const pairs = [
			{ a: CREATOR, b: BUYER_CLEAN, score: 5, band: 'none', topSignal: null, evidence: [] },
			{ a: CREATOR, b: BUYER_WEAK, score: 30, band: 'weak', topSignal: 'direct-transfer', evidence: [] },
			// A strong link between two buyers that does NOT involve the creator is irrelevant here.
			{ a: BUYER_CLEAN, b: BUYER_WEAK, score: 95, band: 'confirmed', topSignal: 'solana-fee-payer', evidence: [] },
		];
		const res = evaluateCreatorLinkagePairs(CREATOR, pairs);
		expect(res.status).toBe('pass');
		expect(res.reason).toBe('creator_linkage_clean');
	});

	it('picks the highest-scoring linked buyer as the top match when several are linked', () => {
		const pairs = [
			{ a: CREATOR, b: BUYER_LINKED, score: 70, band: 'strong', topSignal: 'peer-first-funding', evidence: [] },
			{ a: BUYER_WEAK, b: CREATOR, score: 95, band: 'confirmed', topSignal: 'solana-fee-payer', evidence: [] },
		];
		const res = evaluateCreatorLinkagePairs(CREATOR, pairs);
		expect(res.status).toBe('warn');
		expect(res.detail.linked_wallets).toEqual(expect.arrayContaining([BUYER_LINKED, BUYER_WEAK]));
		expect(res.detail.top_match.wallet).toBe(BUYER_WEAK);
	});

	it('honors a custom band threshold', () => {
		const pairs = [{ a: CREATOR, b: BUYER_WEAK, score: 30, band: 'weak', topSignal: 'direct-transfer', evidence: [] }];
		expect(evaluateCreatorLinkagePairs(CREATOR, pairs).status).toBe('pass');
		expect(evaluateCreatorLinkagePairs(CREATOR, pairs, { band: 'weak' }).status).toBe('warn');
	});

	it('treats an empty or missing pairs array as clean, never throws', () => {
		expect(evaluateCreatorLinkagePairs(CREATOR, []).status).toBe('pass');
		expect(evaluateCreatorLinkagePairs(CREATOR, undefined).status).toBe('pass');
	});
});
