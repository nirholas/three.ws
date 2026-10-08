// "Rally on DEXTools": the Social Boost card any coin surface can mount.
//
// DEXTools Social Boost ranks tokens by daily and weekly visits to their
// DEXTools pair page and buys the winner on the open market. A coin launched on
// three.ws has a community that already lands on three.ws; this card turns that
// traffic into Social Boost visits by sending holders to the coin's DEXTools
// page and giving them a ready-made post to bring their own followers along.
//
// Mounted by the launch success screen (/launch) and every coin page
// (/launches/<mint>). Markup only: buttons take the host page's own classes,
// the way embedFallbackNode() does, so the card matches whatever it sits in.

import './dextools-boost.css';
import { dextoolsUrl, socialBoostRallyIntent, SOCIAL_BOOST_URL } from './dextools.js';
import { SOCIAL_BOOST_WINS, socialBoostSummary, SOCIAL_BOOST_STORY_PATH } from '../pump/dextools-social-boost.js';

const COPIED_MS = 1600;

function node(tag, attrs = {}, children = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null) continue;
		if (k === 'text') n.textContent = v;
		else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v);
	}
	for (const c of children) if (c) n.append(c);
	return n;
}

/**
 * Build the card. Returns null when the address is not a valid token or pair
 * for the chain, so a caller can mount it unconditionally.
 *
 * @param {object} p
 * @param {string} p.mint            token address
 * @param {string} [p.pair]          pool/pair address, when known (Social Boost credits a specific pair page)
 * @param {string} [p.symbol]
 * @param {string} [p.chain='solana']
 * @param {string} [p.href]          link to use instead of the direct pair page, e.g. the counted
 *                                   /api/coin/dextools redirect (dextoolsTokenUrl) so the visit is attributed
 * @param {string} [p.buttonClass]   host page's secondary button class
 * @param {string} [p.primaryClass]  host page's primary button class
 * @returns {HTMLElement|null}
 */
export function socialBoostCard({ mint, pair, symbol, chain = 'solana', href, buttonClass = '', primaryClass = '' }) {
	const direct = dextoolsUrl(pair || mint, chain) || dextoolsUrl(mint, chain);
	if (!direct) return null;
	const url = href || direct;
	const sym = String(symbol || '').replace(/^\$/, '').trim();
	const tag = sym ? `$${sym}` : 'this coin';
	const { count, totalUsd } = socialBoostSummary(SOCIAL_BOOST_WINS);
	const status = node('span', { class: 'dtb-status', role: 'status', 'aria-live': 'polite' });

	const copyBtn = node('button', {
		type: 'button',
		class: buttonClass,
		text: 'Copy DEXTools link',
		onclick: async (e) => {
			const btn = e.currentTarget;
			try {
				await navigator.clipboard.writeText(url);
				status.textContent = 'DEXTools link copied.';
			} catch {
				status.textContent = `Copy blocked by the browser. The link is ${url}`;
				return;
			}
			btn.disabled = true;
			setTimeout(() => {
				btn.disabled = false;
				status.textContent = '';
			}, COPIED_MS);
		},
	});

	return node('section', { class: 'dtb', 'aria-label': `Rally ${tag} on DEXTools` }, [
		node('div', { class: 'dtb-head' }, [
			node('h3', { class: 'dtb-title', text: `Rally ${tag} on DEXTools` }),
			node('a', { class: 'dtb-pill', href: SOCIAL_BOOST_URL, target: '_blank', rel: 'noopener', text: 'Social Boost ↗' }),
		]),
		node('p', {
			class: 'dtb-lead',
			text: `DEXTools Social Boost ranks coins by visits to their DEXTools pair page, daily and weekly, and buys the winner on the open market. Every holder you send there counts.`,
		}),
		node('p', { class: 'dtb-proof' }, [
			document.createTextNode(`$THREE has won it ${count} times, $${totalUsd.toLocaleString('en-US')} in buybacks. `),
			node('a', { href: SOCIAL_BOOST_STORY_PATH, text: 'How it worked' }),
		]),
		node('div', { class: 'dtb-actions' }, [
			node('a', { class: primaryClass, href: url, target: '_blank', rel: 'noopener', text: 'Open on DEXTools ↗' }),
			node('a', { class: buttonClass, href: socialBoostRallyIntent({ symbol: sym, url }), target: '_blank', rel: 'noopener', text: 'Rally on X ↗' }),
			copyBtn,
		]),
		status,
	]);
}
