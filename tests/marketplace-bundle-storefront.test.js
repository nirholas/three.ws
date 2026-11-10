// Pure rendering and savings logic for the buyer-facing bundle storefront.
import { describe, expect, it } from 'vitest';
import {
	atomicToHuman,
	buildBundleView,
	renderBundleCard,
	renderBundleError,
	renderBundleOwnerEmpty,
	renderBundleSkeletons,
} from '../src/marketplace-bundles.js';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const AGENT = '00000000-0000-4000-8000-00000000a9e7';
const label = (m) => (m === THREE ? '$THREE' : 'USDC');

const prices = {
	research: { amount: 2_000_000, currency_mint: THREE, mint_decimals: 6 },
	summarize: { amount: '1000000', currency_mint: THREE, mint_decimals: 6 },
};
const bundle = {
	id: 'b1', name: 'Starter <pack>', description: 'Both, one payment.',
	price_amount: '2400000', currency_mint: THREE, skills: ['research', 'summarize'],
};
const view = (over = {}, owned = new Set()) =>
	buildBundleView({ ...bundle, ...over }, { agentId: AGENT, skillPrices: prices, owned, mintLabel: label });

describe('atomicToHuman', () => {
	it('scales without float error on a 9-decimal mint', () => {
		expect(atomicToHuman('9007199254740993000', 9)).toBe('9007199254.7409');
	});
	it('keeps two fraction digits minimum and trims trailing zeros', () => {
		expect(atomicToHuman('2400000', 6)).toBe('2.40');
		expect(atomicToHuman('2450000', 6)).toBe('2.45');
		expect(atomicToHuman('3000000', 6)).toBe('3.00');
	});
});

describe('buildBundleView savings', () => {
	it('computes savings from real per-skill prices', () => {
		const v = view();
		expect(v.priceText).toBe('2.40 $THREE');
		expect(v.listText).toBe('3.00 $THREE');
		expect(v.savingsText).toBe('0.60 $THREE');
		expect(v.savingsPercent).toBe(20);
	});
	it('shows no savings when the bundle costs as much as the parts', () => {
		expect(view({ price_amount: '3000000' }).savingsText).toBeNull();
		expect(view({ price_amount: '3500000' }).savingsText).toBeNull();
	});
	it('shows no savings when a skill is unpriced', () => {
		const v = buildBundleView({ ...bundle, skills: ['research', 'free-one'] }, { agentId: AGENT, skillPrices: prices, owned: new Set(), mintLabel: label });
		expect(v.listText).toBeNull();
		expect(v.savingsText).toBeNull();
	});
	it('shows no savings when a skill is priced in another mint', () => {
		const mixed = { ...prices, summarize: { amount: 1_000_000, currency_mint: 'OTHERMINT', mint_decimals: 6 } };
		const v = buildBundleView(bundle, { agentId: AGENT, skillPrices: mixed, owned: new Set(), mintLabel: label });
		expect(v.savingsText).toBeNull();
	});
});

describe('ownership', () => {
	it('is owned only when every priced skill is owned', () => {
		expect(view({}, new Set([`${AGENT}:research`])).owned).toBe(false);
		expect(view({}, new Set([`${AGENT}:research`])).ownedCount).toBe(1);
		expect(view({}, new Set([`${AGENT}:research`, `${AGENT}:summarize`])).owned).toBe(true);
	});
});

describe('markup', () => {
	it('escapes seller text and renders an enabled Buy button', () => {
		const html = renderBundleCard(view(), AGENT);
		expect(html).toContain('Starter &lt;pack&gt;');
		expect(html).not.toContain('<pack>');
		expect(html).toContain('data-bundle-id="b1"');
		expect(html).toContain('Save 0.60 $THREE (20%)');
		expect(html).not.toMatch(/disabled/);
	});
	it('renders an owned bundle with a disabled Owned button and no buy hook', () => {
		const html = renderBundleCard(view({}, new Set([`${AGENT}:research`, `${AGENT}:summarize`])), AGENT);
		expect(html).toMatch(/disabled/);
		expect(html).toContain('Owned');
		expect(html).not.toContain('data-bundle-id');
	});
	it('renders skeleton, error and owner-empty states', () => {
		expect(renderBundleSkeletons(3).match(/bundle-skeleton/g)).toHaveLength(3);
		expect(renderBundleError('boom <x>')).toContain('boom &lt;x&gt;');
		expect(renderBundleError()).toContain('bundle-retry-btn');
		expect(renderBundleOwnerEmpty()).toContain('href="/bundles"');
	});
});
