// /embed/dextools-boost: the "Rally on DEXTools" card, framable on any site.
//
// A project that launched on three.ws (or any Solana token's team) drops one
// iframe on its own site and its visitors get a card that sends them to the
// token's DEXTools pair page, where every visit counts toward DEXTools Social
// Boost. The card itself is socialBoostCard() from src/shared/dextools-boost.js,
// the same component /launch and /launches/<mint> mount, so there is one
// implementation of it. This module adds what an embed needs around it: the
// token's identity, the visit count this coin has already received through
// three.ws, and links that leave the host's frame instead of navigating it.
//
// Every DEXTools link here goes through the counted /api/coin/dextools
// redirect with `from=embed-boost`, so visits from embeds are attributed.
//
//   ?mint=<solana mint>   the token (takes precedence)
//   ?pair=<solana pool>   or the pair address a DEXTools URL already carries
//   ?theme=light|dark     the host page's theme (default dark)

import { socialBoostCard } from './shared/dextools-boost.js';
import { dextoolsTokenUrl } from './shared/trading-terminals.js';

const ORIGIN = 'https://three.ws';
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SURFACE = 'embed-boost';

const params = new URLSearchParams(location.search);
const root = document.getElementById('bx');

function node(tag, attrs = {}, children = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null) continue;
		if (k === 'text') n.textContent = v;
		else n.setAttribute(k, v);
	}
	for (const c of children) if (c) n.append(c);
	return n;
}

const shortAddr = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function fmtUsd(n) {
	if (!Number.isFinite(n)) return null;
	if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
	if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
	if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
	if (n >= 1) return `$${n.toFixed(2)}`;
	return `$${n.toPrecision(3)}`;
}

function showState(title, message, action) {
	root.removeAttribute('aria-busy');
	root.replaceChildren(
		node('section', { class: 'bx-state', role: 'status' }, [
			node('h1', { text: title }),
			node('p', { text: message }),
			action || null,
		]),
	);
}

/** The pair a DEXTools URL names, resolved to the token it trades. */
async function mintForPair(pair) {
	const r = await fetch(`/api/coin/pair?address=${encodeURIComponent(pair)}&network=solana`, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(12_000),
	});
	if (r.status === 404) return null;
	if (!r.ok) throw new Error(`pair lookup ${r.status}`);
	return (await r.json())?.token?.address || null;
}

/**
 * Name, symbol, logo and price for the header, from DexScreener's keyless API.
 * Best-effort: the card works without it, so a miss renders the short address.
 */
async function tokenMeta(mint) {
	try {
		const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, {
			signal: AbortSignal.timeout(8_000),
		});
		if (!r.ok) return null;
		const pairs = ((await r.json())?.pairs || []).filter((p) => p.chainId === 'solana' && p.baseToken?.address === mint);
		if (!pairs.length) return null;
		pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
		const p = pairs[0];
		return {
			name: p.baseToken.name || null,
			symbol: p.baseToken.symbol || null,
			image: p.info?.imageUrl || null,
			priceUsd: Number(p.priceUsd),
			change24: Number(p.priceChange?.h24),
			pair: p.pairAddress || null,
		};
	} catch {
		return null;
	}
}

/** Visits three.ws has already sent to this token's pair page, last 30 days. */
async function visitsSent(mint) {
	try {
		const r = await fetch(`/api/coin/dextools-stats?token=${encodeURIComponent(mint)}&days=30`, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(8_000),
		});
		if (!r.ok) return null;
		return (await r.json())?.visits ?? null;
	} catch {
		return null;
	}
}

function tokenHeader(mint, meta) {
	const sym = meta?.symbol || '';
	const logo = meta?.image
		? node('img', { class: 'bx-logo', src: meta.image, alt: '', width: '44', height: '44', referrerpolicy: 'no-referrer' })
		: node('div', { class: 'bx-logo', 'aria-hidden': 'true', text: (sym || '?').charAt(0).toUpperCase() });
	if (meta?.image) logo.addEventListener('error', () => logo.replaceWith(node('div', { class: 'bx-logo', 'aria-hidden': 'true', text: (sym || '?').charAt(0).toUpperCase() })), { once: true });

	const mkt = node('p', { class: 'bx-mkt' });
	const price = fmtUsd(meta?.priceUsd);
	if (price) {
		mkt.append(price);
		if (Number.isFinite(meta.change24)) {
			const up = meta.change24 >= 0;
			mkt.append(' ', node('span', { class: up ? 'bx-up' : 'bx-down', text: `${up ? '+' : ''}${meta.change24.toFixed(1)}% 24h` }));
		}
	} else {
		mkt.textContent = shortAddr(mint);
	}

	return node('div', { class: 'bx-token' }, [
		logo,
		node('div', { class: 'bx-id' }, [
			node('p', { class: 'bx-name' }, [meta?.name || shortAddr(mint), sym ? node('span', { class: 'bx-sym', text: `$${sym}` }) : null]),
			mkt,
		]),
	]);
}

// The card is built for three.ws pages, where a relative link is fine. Inside
// someone else's frame every link must open a new tab on three.ws instead of
// navigating the host's panel.
function frameSafeLinks(scope) {
	for (const a of scope.querySelectorAll('a[href]')) {
		const href = a.getAttribute('href');
		if (href.startsWith('/')) a.setAttribute('href', ORIGIN + href);
		a.setAttribute('target', '_blank');
		a.setAttribute('rel', 'noopener');
	}
}

function announceReady(mint, meta) {
	if (window.parent === window) return;
	window.parent.postMessage(
		{ source: 'three.ws/dextools-boost', token: { mint, name: meta?.name || null, symbol: meta?.symbol || null } },
		'*',
	);
}

async function main() {
	const mintParam = (params.get('mint') || '').trim();
	const pairParam = (params.get('pair') || '').trim();

	if (!mintParam && !pairParam) {
		showState(
			'No token selected',
			'Add ?mint= with a Solana token address, or ?pair= with the pair address from its DEXTools URL.',
			node('a', { class: 'bx-btn', href: `${ORIGIN}/dextools#builder`, target: '_blank', rel: 'noopener', text: 'Build an embed ↗' }),
		);
		return;
	}
	const given = mintParam || pairParam;
	if (!SOL_RE.test(given)) {
		showState('That address is not a Solana address', `"${given.slice(0, 60)}" is not a base58 Solana address. Copy it straight from the DEXTools or pump.fun URL.`);
		return;
	}

	let mint = mintParam;
	if (!mint) {
		try {
			mint = await mintForPair(pairParam);
		} catch {
			const retry = node('button', { class: 'bx-btn', type: 'button', text: 'Try again' });
			retry.addEventListener('click', () => location.reload());
			showState('Could not look up this pair', 'The market index did not answer. This is usually brief.', retry);
			return;
		}
		if (!mint) {
			showState(
				'No market found for this pair yet',
				'No index knows this pair address. A brand-new pair shows up within a few minutes of its first trade.',
				node('a', { class: 'bx-btn', href: `https://www.dextools.io/app/solana/pair-explorer/${encodeURIComponent(pairParam)}`, target: '_blank', rel: 'noopener', text: 'Open on DEXTools ↗' }),
			);
			return;
		}
	}

	const [meta, sent] = await Promise.all([tokenMeta(mint), visitsSent(mint)]);
	const card = socialBoostCard({
		mint,
		pair: pairParam || meta?.pair || undefined,
		symbol: meta?.symbol || '',
		href: dextoolsTokenUrl(mint, { from: SURFACE }),
		buttonClass: 'bx-btn',
		primaryClass: 'bx-btn is-primary',
	});
	if (!card) {
		showState('This token cannot be linked to DEXTools', 'The address did not validate as a Solana token.');
		return;
	}

	const children = [tokenHeader(mint, meta), card];
	if (Number.isFinite(sent) && sent > 0) {
		children.push(
			node('p', { class: 'bx-sent' }, [
				node('b', { text: sent.toLocaleString('en-US') }),
				` visit${sent === 1 ? '' : 's'} sent to this DEXTools page through three.ws in the last 30 days.`,
			]),
		);
	}
	root.removeAttribute('aria-busy');
	root.replaceChildren(...children);
	frameSafeLinks(root);
	document.getElementById('bx-attr').href = `${ORIGIN}/dextools?mint=${encodeURIComponent(mint)}`;
	announceReady(mint, meta);
}

main();
