// @ts-check
// Culture / meme launch use cases — NARRATIVE coins that ride a live cultural
// theme. Unlike the GitHub surface, there is no real subject to reward and no
// external ticker to mint: the engine pulls a brand-safe meme/culture THEME from
// the narrative providers (knowyourmeme, reddit, x) and we INVENT an original
// coin identity from it. This is how the $THREE rule is honoured mechanically —
// the only coin three.ws promotes is $THREE; here we name no other coin, we coin
// a fresh name for a meme and route fees to the creator.
//
// Every entry shares one naming/reward strategy (cultureUseCase) and differs only
// in which providers it blends, how many candidates it pulls, and how it frames
// the meme energy. The engine does the wiring, so each is a real, complete recipe.

import { deriveSymbol } from '../usecase-engine.js';

// Title-Case a raw meme term: split on whitespace/separators, capitalise each
// word, drop empties. Inlined (per spec) — too small to warrant a dependency.
function titleCase(raw) {
	return String(raw || '')
		.split(/[\s\-_/.]+/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(' ');
}

// Tasteful coin-name suffixes. We rotate a suffix in by a stable hash of the
// term so the same meme always invents the same name, and so a raw term is never
// minted verbatim as a coin name. Empty string = no suffix (clean title-case).
const NAME_SUFFIXES = ['', 'Coin', 'Wave', 'Szn', 'Mania', 'Hour', 'Energy', 'Core'];

function inventName(subject) {
	const base = titleCase(subject) || 'Meme';
	let h = 0;
	for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
	const suffix = NAME_SUFFIXES[h % NAME_SUFFIXES.length];
	return suffix ? `${base} ${suffix}` : base;
}

// One narrative meme coin: invented name from the theme, fees to the creator.
function cultureUseCase({ id, title, description, tags = [], sources, limit }) {
	return {
		id, title, description, category: 'culture', mode: 'narrative',
		tags: ['culture', 'meme', 'narrative', ...tags],
		reward_label: 'Creator fees',
		source: { kind: 'narratives', params: { sources, ...(limit ? { limit } : {}) } },
		defaults: { devBuySol: 0, network: 'mainnet' },
		naming: (c) => ({
			name: inventName(c.subject),
			symbol: deriveSymbol(c.subject),
			description: `A coin riding the ${c.subject} meme.`,
			image: null,
		}),
		rewards: () => ({ kind: 'creator' }),
	};
}

export const cultureUseCases = [
	cultureUseCase({
		id: 'culture-fresh-memes',
		title: 'Freshest confirmed memes',
		description: 'Named memes just entering culture, straight from Know Your Meme. Mint an original coin the moment a meme gets a name.',
		tags: ['fresh', 'knowyourmeme'],
		sources: ['knowyourmeme'],
		limit: 12,
	}),
	cultureUseCase({
		id: 'culture-reddit-hot',
		title: 'Reddit hot culture',
		description: 'What the front page is laughing at right now — the community pulse, ranked. Ride the joke before it leaves the feed.',
		tags: ['reddit', 'community'],
		sources: ['reddit'],
		limit: 12,
	}),
	cultureUseCase({
		id: 'culture-x-chatter',
		title: 'X chatter, live',
		description: 'Hashtags and entities spiking across X this hour. Catch the meme while the timeline is still posting it.',
		tags: ['x', 'live', 'fast'],
		sources: ['x'],
		limit: 10,
	}),
	cultureUseCase({
		id: 'culture-kym-reddit-blend',
		title: 'Named memes meeting the front page',
		description: 'Memes confirmed on Know Your Meme cross-checked against what Reddit is actually upvoting — named energy with community heat behind it.',
		tags: ['knowyourmeme', 'reddit', 'blend'],
		sources: ['knowyourmeme', 'reddit'],
		limit: 12,
	}),
	cultureUseCase({
		id: 'culture-broad-meme-mix',
		title: 'The broad meme mix',
		description: 'Every culture source at once — Know Your Meme, Reddit, and X blended into one ranked feed of the strongest themes across the internet.',
		tags: ['knowyourmeme', 'reddit', 'x', 'broad'],
		sources: ['knowyourmeme', 'reddit', 'x'],
		limit: 16,
	}),
	cultureUseCase({
		id: 'culture-x-reddit-breakouts',
		title: 'Cross-platform breakouts',
		description: 'Themes spiking on both X and Reddit at the same time — the strongest signal a meme is genuinely breaking out, not just one corner of the web.',
		tags: ['x', 'reddit', 'breakout'],
		sources: ['x', 'reddit'],
		limit: 12,
	}),
	cultureUseCase({
		id: 'culture-kym-x-confirmed',
		title: 'Confirmed and still spiking',
		description: 'Memes that have a Know Your Meme entry and are still trending on X — proven format, live momentum. The sweet spot for a coin.',
		tags: ['knowyourmeme', 'x', 'confirmed'],
		sources: ['knowyourmeme', 'x'],
		limit: 12,
	}),
	cultureUseCase({
		id: 'culture-reddit-deep-cuts',
		title: 'Reddit deep cuts',
		description: 'A wider pull from Reddit for the niche jokes and emerging in-group memes that have not gone mainstream yet — early on the long tail.',
		tags: ['reddit', 'niche', 'early'],
		sources: ['reddit'],
		limit: 20,
	}),
	cultureUseCase({
		id: 'culture-x-rapid-fire',
		title: 'X rapid-fire',
		description: 'A tight, fast feed of the very top X spikes — the few entities the timeline cannot stop posting. Built for launching while a moment is peaking.',
		tags: ['x', 'fast', 'peak'],
		sources: ['x'],
		limit: 6,
	}),
	cultureUseCase({
		id: 'culture-everything-deep',
		title: 'Whole-internet deep scan',
		description: 'The widest possible culture pull — Know Your Meme, Reddit, and X with a deep limit — to surface emerging themes the tighter feeds miss.',
		tags: ['knowyourmeme', 'reddit', 'x', 'deep'],
		sources: ['knowyourmeme', 'reddit', 'x'],
		limit: 24,
	}),
];
