// @ts-check
// Onchain launch use cases — NARRATIVE coins minted from the venue's own live
// signal. Instead of pointing at a project, these recipes mine what's actually
// breaking out on pump.fun right now (high-quality coin categories/tags via
// coin_intel, and oracle conviction-scored hot sectors via trending) and turn
// each surfaced THEME into an original, brand-safe coin identity.
//
// $THREE brand-safety rule (mechanically enforced by the engine): narrative mode
// never mints an external ticker verbatim. We only ever read back a cultural /
// sector THEME term and INVENT a Title-Case coin name from it. No specific coin,
// token, mint, or project is referenced anywhere in this file — $THREE is the
// only coin three.ws promotes, and these recipes name none other.

import { deriveSymbol } from '../usecase-engine.js';

// Small, inlined Title-Case helper — capitalises each word of a theme term and
// collapses whitespace, so a raw narrative term becomes a clean coin name.
function titleCase(raw) {
	return String(raw || '')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

// Shared narrative recipe builder. Every onchain use case differs only in its
// live query (which providers, how many, which categories) and its framing —
// the naming + reward strategy is identical, so each entry is a complete recipe.
//
// `suffix` is an optional tasteful themed word appended to the invented name to
// give the coin its own identity rather than echoing the bare theme term.
function onchainUseCase({ id, title, description, tags = [], suffix = '', params }) {
	return {
		id,
		title,
		description,
		category: 'onchain',
		mode: 'narrative',
		tags: ['onchain', 'narrative', 'pumpfun', ...tags],
		reward_label: 'Creator fees',
		source: { kind: 'narratives', params },
		defaults: { devBuySol: 0, network: 'mainnet' },
		naming: (c) => {
			const base = titleCase(c.subject);
			const name = suffix && base ? `${base} ${suffix}` : base;
			return {
				name,
				symbol: deriveSymbol(c.subject),
				description: `A coin riding the ${c.subject} narrative.`,
				image: null,
			};
		},
		rewards: () => ({ kind: 'creator' }),
	};
}

export const onchainUseCases = [
	onchainUseCase({
		id: 'onchain-breakout-narratives',
		title: 'Pump.fun breakout narratives',
		description:
			'Reads the categories and tags of the highest-quality coins breaking out on the venue in the last 24 hours, then mints an original coin for each surfaced theme. Pure venue signal, no project named.',
		tags: ['breakout', 'coin-intel', '24h'],
		params: { sources: ['coin_intel'], limit: 10 },
	}),
	onchainUseCase({
		id: 'onchain-oracle-hot-sectors',
		title: 'Oracle hot sectors',
		description:
			'Rides the conviction-scored sectors the trending oracle ranks hottest right now. Each hot sector becomes a clean, invented coin — back the theme, not any one ticker.',
		tags: ['oracle', 'trending', 'sectors'],
		suffix: 'Sector',
		params: { sources: ['trending'], limit: 10 },
	}),
	onchainUseCase({
		id: 'onchain-blended-momentum',
		title: 'Blended onchain momentum',
		description:
			'Combines fresh coin-intel breakouts with oracle conviction into one momentum feed, surfacing the themes both signals agree on. Mints an original coin per blended narrative.',
		tags: ['blended', 'momentum'],
		params: { sources: ['coin_intel', 'trending'], limit: 12 },
	}),
	onchainUseCase({
		id: 'onchain-high-conviction-top',
		title: 'High-conviction top sectors',
		description:
			'A tight, high-conviction subset — only the five strongest oracle-ranked sectors of the moment — so each coin rides a theme with real weight behind it.',
		tags: ['high-conviction', 'oracle', 'top5'],
		suffix: 'Index',
		params: { sources: ['trending'], limit: 5 },
	}),
	onchainUseCase({
		id: 'onchain-fresh-tags',
		title: 'Fresh venue tags',
		description:
			'Mines the raw category tags attached to quality coins breaking out in the last day and turns the freshest tags into invented coins — catch a narrative as the venue starts labelling it.',
		tags: ['tags', 'coin-intel', 'fresh'],
		suffix: 'Tag',
		params: { sources: ['coin_intel'], limit: 12 },
	}),
	onchainUseCase({
		id: 'onchain-ai-agent-narratives',
		title: 'Onchain AI & agent narratives',
		description:
			'Focuses the venue signal on the AI and autonomous-agent themes surfacing across both feeds, minting an original coin for each. The sector three.ws lives in, read live.',
		tags: ['ai', 'agents', 'sector'],
		params: { sources: ['coin_intel', 'trending'], categories: ['ai', 'agents'], limit: 8 },
	}),
	onchainUseCase({
		id: 'onchain-degen-meta',
		title: 'Onchain degen meta',
		description:
			'The fast-moving meme and culture themes the oracle scores hottest, framed as a degen meta watchlist. Each surfaced theme becomes a brand-safe, invented coin.',
		tags: ['meme', 'culture', 'oracle', 'meta'],
		suffix: 'Meta',
		params: { sources: ['trending'], categories: ['meme', 'culture'], limit: 10 },
	}),
	onchainUseCase({
		id: 'onchain-wide-radar',
		title: 'Wide onchain radar',
		description:
			'A broad sweep across both venue providers with no category filter — the widest net of onchain narratives, surfacing emerging themes before they consolidate. One invented coin per theme.',
		tags: ['radar', 'blended', 'wide'],
		suffix: 'Wave',
		params: { sources: ['coin_intel', 'trending'], limit: 20 },
	}),
];
