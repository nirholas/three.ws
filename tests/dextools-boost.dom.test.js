// @vitest-environment jsdom
//
// DEXTools links and the "Rally on DEXTools" Social Boost card.
//
// What is pinned:
//   1. dextoolsUrl() emits DEXTools' canonical pair-explorer form (the /app/en/
//      form 301s to it) and refuses an address that is malformed for the chain,
//      so no surface renders a dead DEXTools link.
//   2. The rally post ends with the DEXTools link, so X renders its card.
//   3. The card prefers the pair page over the mint (Social Boost credits a
//      specific pair), honors a caller's counted `href` on every outbound link,
//      takes the host page's own button classes, and renders nothing for an
//      address it cannot link.

import { describe, it, expect } from 'vitest';
import { dextoolsUrl, socialBoostRallyText, socialBoostRallyIntent, SOCIAL_BOOST_URL } from '../src/shared/dextools.js';
import { socialBoostCard } from '../src/shared/dextools-boost.js';
import { SOCIAL_BOOST_WINS, SOCIAL_BOOST_STORY_PATH } from '../src/pump/dextools-social-boost.js';

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const PAIR = 'CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa';
const EVM = '0x' + 'ab'.repeat(20);

describe('dextoolsUrl', () => {
	it('builds the canonical Solana pair-explorer URL for a pair or a mint', () => {
		expect(dextoolsUrl(PAIR)).toBe(`https://www.dextools.io/app/solana/pair-explorer/${PAIR}`);
		expect(dextoolsUrl(MINT)).toBe(`https://www.dextools.io/app/solana/pair-explorer/${MINT}`);
	});

	it('maps three.ws chain ids to DEXTools slugs', () => {
		expect(dextoolsUrl(EVM, 'ethereum')).toBe(`https://www.dextools.io/app/ether/pair-explorer/${EVM}`);
		expect(dextoolsUrl(EVM, 'binance-smart-chain')).toContain('/app/bnb/');
		expect(dextoolsUrl(EVM, 'base')).toContain('/app/base/');
	});

	it('refuses malformed, cross-chain and unknown-chain input', () => {
		expect(dextoolsUrl('')).toBeNull();
		expect(dextoolsUrl(undefined)).toBeNull();
		expect(dextoolsUrl('not a mint')).toBeNull();
		expect(dextoolsUrl(EVM, 'solana')).toBeNull();
		expect(dextoolsUrl(MINT, 'ethereum')).toBeNull();
		expect(dextoolsUrl(MINT, 'dogechain')).toBeNull();
	});
});

describe('Social Boost rally post', () => {
	it('names the coin and ends with the DEXTools link', () => {
		const url = dextoolsUrl(PAIR);
		const text = socialBoostRallyText({ symbol: '$THREE', url });
		expect(text.startsWith('$THREE is on DEXTools.')).toBe(true);
		expect(text.endsWith(url)).toBe(true);
	});

	it('encodes the post into an X compose intent', () => {
		const url = dextoolsUrl(PAIR);
		const intent = new URL(socialBoostRallyIntent({ symbol: 'THREE', url }));
		expect(intent.origin + intent.pathname).toBe('https://x.com/intent/post');
		expect(intent.searchParams.get('text')).toBe(socialBoostRallyText({ symbol: 'THREE', url }));
	});
});

describe('socialBoostCard', () => {
	const hrefs = (card) => [...card.querySelectorAll('a')].map((a) => a.getAttribute('href'));

	it('links the pair page when the pair is known, and the leaderboard and story', () => {
		const card = socialBoostCard({ mint: MINT, pair: PAIR, symbol: 'three' });
		const links = hrefs(card);
		expect(links).toContain(dextoolsUrl(PAIR));
		expect(links).not.toContain(dextoolsUrl(MINT));
		expect(links).toContain(SOCIAL_BOOST_URL);
		expect(links).toContain(SOCIAL_BOOST_STORY_PATH);
		expect(card.querySelector('.dtb-title').textContent).toBe('Rally $three on DEXTools');
	});

	it('falls back to the mint when no pair is known', () => {
		expect(hrefs(socialBoostCard({ mint: MINT }))).toContain(dextoolsUrl(MINT));
	});

	it('sends the open link and the rally post through a caller-supplied counted href', () => {
		const counted = `https://three.ws/api/coin/dextools?address=${MINT}&network=solana&from=test`;
		const card = socialBoostCard({ mint: MINT, symbol: 'THREE', href: counted });
		const links = hrefs(card);
		expect(links).toContain(counted);
		expect(links).toContain(socialBoostRallyIntent({ symbol: 'THREE', url: counted }));
	});

	it('states the $THREE record from the one Social Boost source', () => {
		const card = socialBoostCard({ mint: MINT });
		expect(card.querySelector('.dtb-proof').textContent).toContain(`won it ${SOCIAL_BOOST_WINS.length} times`);
	});

	it('wears the host page button classes', () => {
		const card = socialBoostCard({ mint: MINT, buttonClass: 'host-btn', primaryClass: 'host-btn primary' });
		const [open, rally, copy] = card.querySelector('.dtb-actions').children;
		expect(open.className).toBe('host-btn primary');
		expect(rally.className).toBe('host-btn');
		expect(copy.className).toBe('host-btn');
		expect(copy.getAttribute('type')).toBe('button');
	});

	it('renders nothing for an address it cannot link', () => {
		expect(socialBoostCard({ mint: 'nope' })).toBeNull();
	});
});
