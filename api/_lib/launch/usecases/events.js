// @ts-check
// Events launch use cases — narrative coins that ride what the world is paying
// attention to RIGHT NOW. The live surface here is current-moment attention:
// Wikipedia's top pageviews (the people, films, sports, and events everyone is
// looking up) and Google's real-time trending searches (search spikes with
// traffic). Each entry invents an original, brand-safe coin identity from the
// trending subject — it never mints an external project verbatim, never routes
// fees anywhere but the launching agent (creator fees), and stays celebratory.
//
// $THREE is the only coin this platform promotes. These recipes only ever read
// real-world attention (sports, releases, launches, cultural moments) and the
// engine already filters sensitive terms — the framing below stays neutral and
// upbeat so a launched coin reads as a moment, never a tragedy.

import { deriveSymbol } from '../usecase-engine.js';

/** Title-Case a free-form trending term: each word capitalised, whitespace collapsed. */
function titleCase(raw) {
	return String(raw || '')
		.replace(/[_/]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

// One shared narrative strategy: invent a Title-Case name from the subject (an
// optional tasteful suffix gives the coin a distinct identity instead of the
// bare term), derive a ticker via the engine helper, and keep fees with the
// creator. Each use case differs only in its live source mix, limit, and framing.
function eventsUseCase({ id, title, description, tags = [], sources, limit, suffix = '' }) {
	return {
		id,
		title,
		description,
		category: 'events',
		mode: 'narrative',
		tags: ['events', 'trending', 'narrative', ...tags],
		reward_label: 'Creator fees',
		source: { kind: 'narratives', params: limit ? { sources, limit } : { sources } },
		defaults: { devBuySol: 0, network: 'mainnet' },
		naming: (c) => {
			const base = titleCase(c.subject) || 'Moment';
			const name = suffix ? `${base} ${suffix}` : base;
			return {
				name,
				symbol: deriveSymbol(c.subject),
				description: `A coin riding the ${c.subject} moment.`,
				image: null,
			};
		},
		rewards: (c) => ({ kind: 'creator' }),
	};
}

export const eventsUseCases = [
	eventsUseCase({
		id: 'events-wikipedia-top-today',
		title: 'Top of Wikipedia today',
		description: 'The people, films, and events the world is reading about right now, ranked by today\'s Wikipedia pageviews. Each becomes an original, brand-safe coin riding the moment.',
		tags: ['wikipedia', 'attention', 'today'],
		sources: ['wikipedia'],
		limit: 12,
	}),
	eventsUseCase({
		id: 'events-search-spikes-now',
		title: 'Live Google search spikes',
		description: 'Real-time trending Google searches with traffic behind them — the queries spiking this minute. Mint a coin the moment a topic catches fire.',
		tags: ['googletrends', 'search', 'realtime'],
		sources: ['googletrends'],
		limit: 12,
		suffix: 'Wave',
	}),
	eventsUseCase({
		id: 'events-world-attention-blend',
		title: 'World attention, blended',
		description: 'Wikipedia\'s most-viewed pages and Google\'s top searches, fused into one feed of what the planet is collectively focused on. Broad coverage, the highest-signal moments first.',
		tags: ['wikipedia', 'googletrends', 'blend', 'global'],
		sources: ['wikipedia', 'googletrends'],
		limit: 16,
	}),
	eventsUseCase({
		id: 'events-tight-headliners',
		title: 'Today\'s headliners only',
		description: 'A tight shortlist of the single biggest moments across Wikipedia and Google right now — fewer picks, every one a genuine headliner worth a coin.',
		tags: ['wikipedia', 'googletrends', 'curated', 'top'],
		sources: ['wikipedia', 'googletrends'],
		limit: 5,
		suffix: 'Moment',
	}),
	eventsUseCase({
		id: 'events-encyclopedia-moments',
		title: 'Wikipedia moments, expanded',
		description: 'A wider sweep of Wikipedia\'s trending pages — beyond the obvious top few into the deep cut subjects quietly surging in readership. Each minted as its own celebratory coin.',
		tags: ['wikipedia', 'discovery', 'deep'],
		sources: ['wikipedia'],
		limit: 20,
		suffix: 'Day',
	}),
	eventsUseCase({
		id: 'events-breakout-searches',
		title: 'Breakout searches, search-first',
		description: 'Google\'s freshest breakout queries leading, reinforced by Wikipedia\'s most-read pages — the fastest-moving cultural moments of the day turned into original coins.',
		tags: ['googletrends', 'wikipedia', 'breakout', 'culture'],
		sources: ['googletrends', 'wikipedia'],
		limit: 14,
		suffix: 'Rush',
	}),
];
