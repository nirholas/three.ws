// Chart Companion input: a pasted DEXTools link, pair, or mint becomes a query.

import { describe, it, expect } from 'vitest';
import { parseTarget } from '../src/chart-companion/target.js';

const PAIR = 'CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa';

describe('parseTarget', () => {
	it('reads the pair out of a DEXTools pair-explorer link, with or without a locale', () => {
		expect(parseTarget(`https://www.dextools.io/app/solana/pair-explorer/${PAIR}`)).toEqual({ pair: PAIR });
		expect(parseTarget(`https://www.dextools.io/app/en/solana/pair-explorer/${PAIR}?t=123`)).toEqual({ pair: PAIR });
	});

	it('reads the pair out of a DEXTools widget-chart link', () => {
		expect(parseTarget(`https://www.dextools.io/widget-chart/en/solana/pe-light/${PAIR}?theme=dark`)).toEqual({ pair: PAIR });
	});

	it('refuses a DEXTools link on another chain with a reason', () => {
		const r = parseTarget('https://www.dextools.io/app/en/ether/pair-explorer/0xa43fe16908251ee70ef74718545e4fe6c5ccec9f');
		expect(r.error).toMatch(/Solana/);
	});

	it('passes a bare Solana address through for the page to classify', () => {
		expect(parseTarget(`  ${PAIR} `)).toEqual({ address: PAIR });
	});

	it('explains empty and malformed input', () => {
		expect(parseTarget('').error).toMatch(/Paste/);
		expect(parseTarget('https://example.com/coin').error).toMatch(/does not look like/);
	});
});
