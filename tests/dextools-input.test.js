import { describe, it, expect } from 'vitest';
import { parseTokenInput, embedSnippets } from '../src/dextools-input.js';

const PAIR = 'CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa';
const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

describe('parseTokenInput', () => {
	it('reads the pair out of a DEXTools pair page, with or without a language segment', () => {
		expect(parseTokenInput(`https://www.dextools.io/app/solana/pair-explorer/${PAIR}`)).toEqual({ address: PAIR, kind: 'pair', source: 'DEXTools' });
		expect(parseTokenInput(`https://www.dextools.io/app/en/solana/pair-explorer/${PAIR}?t=123`)).toMatchObject({ address: PAIR, kind: 'pair' });
		expect(parseTokenInput(`dextools.io/app/solana/pair-explorer/${PAIR}`)).toMatchObject({ address: PAIR, kind: 'pair' });
	});

	it('refuses a DEXTools pair on another chain with a reason', () => {
		const r = parseTokenInput('https://www.dextools.io/app/ether/pair-explorer/0x0d4a11d5eeaac28ec3f61d100daf4d40471f1852');
		expect(r.error).toMatch(/not on Solana/);
	});

	it('knows which links carry a mint and which carry a pair', () => {
		expect(parseTokenInput(`https://pump.fun/coin/${MINT}`)).toMatchObject({ address: MINT, kind: 'mint' });
		expect(parseTokenInput(`https://pump.fun/${MINT}`)).toMatchObject({ address: MINT, kind: 'mint' });
		expect(parseTokenInput(`https://birdeye.so/token/${MINT}?chain=solana`)).toMatchObject({ address: MINT, kind: 'mint' });
		expect(parseTokenInput(`https://www.geckoterminal.com/solana/pools/${PAIR}`)).toMatchObject({ address: PAIR, kind: 'pair' });
		expect(parseTokenInput(`https://three.ws/coin3d?pair=${PAIR}&embed=1`)).toMatchObject({ address: PAIR, kind: 'pair' });
		expect(parseTokenInput(`https://three.ws/launches/${MINT}`)).toMatchObject({ address: MINT, kind: 'mint' });
	});

	it('leaves ambiguous addresses for the resolver to decide', () => {
		expect(parseTokenInput(`  ${PAIR}  `)).toEqual({ address: PAIR, kind: 'unknown', source: 'address' });
		expect(parseTokenInput(`https://dexscreener.com/solana/${PAIR}`)).toMatchObject({ address: PAIR, kind: 'unknown' });
	});

	it('explains empty and unrecognised input instead of guessing', () => {
		expect(parseTokenInput('').error).toBeTruthy();
		expect(parseTokenInput('not an address').error).toBeTruthy();
		expect(parseTokenInput('https://example.com/token/abc').error).toBeTruthy();
		expect(parseTokenInput('https://www.dextools.io/app/solana').error).toMatch(/pair-explorer/);
	});
});

describe('embedSnippets', () => {
	it('keys the 3D scene by pair when one is known and the boost card by mint', () => {
		const s = embedSnippets({ mint: MINT, pair: PAIR });
		expect(s.scene).toBe(`https://three.ws/coin3d?pair=${PAIR}&embed=1`);
		expect(s.boost).toBe(`https://three.ws/embed/dextools-boost?mint=${MINT}`);
		expect(s.sceneHtml).toContain(`pair=${PAIR}&amp;embed=1`);
	});

	it('falls back to the mint and carries a light theme through', () => {
		const s = embedSnippets({ mint: MINT, theme: 'light' });
		expect(s.scene).toBe(`https://three.ws/coin3d?mint=${MINT}&embed=1`);
		expect(s.boost).toBe(`https://three.ws/embed/dextools-boost?mint=${MINT}&theme=light`);
	});
});
