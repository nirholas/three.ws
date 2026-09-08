// @ts-check
// News launch use cases — the CURRENT-ATTENTION surface. These are narrative-mode
// coins that ride what the world is reading, searching, and building RIGHT NOW.
// Every subject is a live theme pulled from real attention signals: Hacker News
// (tech/internet zeitgeist), Google Trends (broad real-time search surges), and
// Wikipedia (top pageviews — what people are looking up). No headline, term, or
// trend is ever hardcoded; the narrative engine supplies them at runtime.
//
// Narrative mode means the coin IDENTITY is INVENTED. We never mint an external
// term verbatim as a ticker, and we never reference any specific external crypto
// project, coin, token, or mint. The only promoted coin is $THREE. Here we work
// strictly with themes and headlines, turning a trending subject into an original,
// brand-safe coin name and letting the engine's $THREE hygiene gate (isSensitive /
// normTerm in usecase-engine.js) drop anything unsafe.

import { deriveSymbol } from '../usecase-engine.js';

/** Title-Case a free-form trending subject so it reads as a coin name, not a slug. */
function titleCase(raw) {
	return String(raw || '')
		.replace(/[_\-/]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(' ');
}

/**
 * Build a news/narrative use case. `suffix` lets each recipe invent a distinct,
 * original coin name from the same trending subject (e.g. "X Index", "X Wave") so
 * we never reuse a raw external term as the coin's identity verbatim.
 */
function newsUseCase({ id, title, description, tags = [], sources, limit = 12, suffix = '' }) {
	return {
		id,
		title,
		description,
		category: 'news',
		mode: 'narrative',
		tags: ['news', 'narrative', 'attention', ...tags],
		reward_label: 'Creator fees',
		source: { kind: 'narratives', params: { sources, limit } },
		defaults: { devBuySol: 0, network: 'mainnet' },
		naming: (c) => {
			const base = titleCase(c.subject || c.title);
			const name = suffix ? `${base} ${suffix}` : base;
			return {
				name,
				symbol: deriveSymbol(c.subject),
				description: `A coin riding the ${c.subject} story.`,
				image: null,
			};
		},
		rewards: (c) => ({ kind: 'creator' }),
	};
}

export const newsUseCases = [
	newsUseCase({
		id: 'news-hn-zeitgeist',
		title: 'Hacker News front-page zeitgeist',
		description:
			'The tech and internet conversation as it happens — invent an original coin for whatever is climbing the Hacker News front page right now. Themes only, never the source verbatim.',
		tags: ['hackernews', 'tech', 'zeitgeist'],
		sources: ['hackernews'],
		limit: 12,
	}),
	newsUseCase({
		id: 'news-google-search-surge',
		title: 'Google search surges',
		description:
			'Whatever the world is suddenly searching for, turned into a fresh coin name. Tracks broad real-time Google Trends spikes across news, culture, and sport.',
		tags: ['googletrends', 'search', 'breakout'],
		sources: ['googletrends'],
		limit: 12,
		suffix: 'Surge',
	}),
	newsUseCase({
		id: 'news-wikipedia-top-events',
		title: 'Wikipedia top events',
		description:
			'What the world is actually reading up on — coins invented from the most-viewed Wikipedia pages of the moment. The deepest, least-noisy signal of public attention.',
		tags: ['wikipedia', 'pageviews', 'events'],
		sources: ['wikipedia'],
		limit: 12,
		suffix: 'Index',
	}),
	newsUseCase({
		id: 'news-search-and-read',
		title: 'Search-and-read blend',
		description:
			'Where what people search meets what they read — a blend of Google Trends surges and Wikipedia top pageviews, distilled into original coin names with real staying power.',
		tags: ['googletrends', 'wikipedia', 'blend'],
		sources: ['googletrends', 'wikipedia'],
		limit: 16,
	}),
	newsUseCase({
		id: 'news-tech-meets-mainstream',
		title: 'Tech meets mainstream',
		description:
			'The crossover stories breaking out of the tech bubble into mass attention — Hacker News momentum blended with Google search surges, named as fresh coins.',
		tags: ['hackernews', 'googletrends', 'crossover'],
		sources: ['hackernews', 'googletrends'],
		limit: 16,
		suffix: 'Wave',
	}),
	newsUseCase({
		id: 'news-builder-attention',
		title: 'Builder attention radar',
		description:
			'What technical people are reading and looking up — Hacker News front-page themes paired with Wikipedia top pageviews to surface durable, builder-relevant narratives.',
		tags: ['hackernews', 'wikipedia', 'builders'],
		sources: ['hackernews', 'wikipedia'],
		limit: 14,
		suffix: 'Signal',
	}),
	newsUseCase({
		id: 'news-everything-trending',
		title: 'Everything trending right now',
		description:
			'The widest possible read on public attention — Hacker News, Google Trends, and Wikipedia fused into one ranked feed of invented coin names. The full pulse of the moment.',
		tags: ['hackernews', 'googletrends', 'wikipedia', 'firehose'],
		sources: ['hackernews', 'googletrends', 'wikipedia'],
		limit: 24,
	}),
	newsUseCase({
		id: 'news-front-page-picks',
		title: 'Front-page picks',
		description:
			'A tight, high-conviction shortlist from the broadest attention sources — the top handful of trending themes across HN, Google, and Wikipedia, each minted as an original coin.',
		tags: ['hackernews', 'googletrends', 'wikipedia', 'curated'],
		sources: ['hackernews', 'googletrends', 'wikipedia'],
		limit: 8,
		suffix: 'Daily',
	}),
];
