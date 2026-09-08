// @ts-check
// Community launch use cases — the social surface of the launch catalog. Two
// flavours live here, both real and complete:
//
//   1. Attribution coins for the PEOPLE and PROJECTS a community is built around
//      — ecosystem contributors, language communities, and open-source builders.
//      The coin is named for a live GitHub subject and its creator fees route to
//      that subject (resolved at runtime via the fee-sharing system). Coin-
//      agnostic: every subject comes from live GitHub data, never hardcoded.
//
//   2. Cross-source narrative blends that capture community CULTURE — the vibes,
//      memes, and shared interests surfacing across multiple trend providers at
//      once. These ride a theme; the identity is INVENTED and held to the $THREE
//      rule (brand-safe, no external ticker minted verbatim, only $THREE is ever
//      the promoted coin).
//
// Each entry is a distinct, fully-wired recipe — the engine does the fetching,
// naming, and reward routing from these declarations.

import { deriveSymbol } from '../usecase-engine.js';

// ── helpers ────────────────────────────────────────────────────────────────────

// Turn a raw theme term into an original Title-Case coin name. Used only by the
// narrative recipes, which must invent a brand-safe identity rather than reuse a
// real ticker. Collapses separators, capitalises each word, caps the length.
function titleCase(raw) {
	const words = String(raw || '')
		.replace(/[\s\-_/.]+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean);
	if (!words.length) return 'Community';
	return words
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(' ')
		.slice(0, 32);
}

// A coin named for a GitHub CREATOR (a community's builders), fees → that creator.
function communityCreatorUseCase({ id, title, description, tags = [], params = {} }) {
	return {
		id,
		title,
		description,
		category: 'community',
		mode: 'attribution',
		tags: ['community', 'creator', 'attribution', 'rewards', ...tags],
		reward_label: 'Creator fees → the GitHub creator',
		source: { kind: 'github-creators', params },
		defaults: { devBuySol: 0, network: 'mainnet' },
		naming: (c) => {
			const login = c.raw?.login || String(c.subject || '').replace(/^@/, '');
			return {
				name: login,
				symbol: deriveSymbol(login, { max: 9 }),
				description: c.description,
				image: c.image,
			};
		},
		rewards: (c) => ({
			kind: 'github-owner',
			github_username: c.attribution?.github_username,
			github_user_id: c.attribution?.github_user_id,
		}),
	};
}

// A coin named for a GitHub REPO (a community's projects), fees → the repo owner.
function communityRepoUseCase({ id, title, description, tags = [], params = {} }) {
	return {
		id,
		title,
		description,
		category: 'community',
		mode: 'attribution',
		tags: ['community', 'repo', 'attribution', 'rewards', ...tags],
		reward_label: 'Creator fees → the repo owner',
		source: { kind: 'github-repos', params },
		defaults: { devBuySol: 0, network: 'mainnet' },
		naming: (c) => ({
			name: c.title || c.raw?.name,
			symbol: deriveSymbol(c.raw?.name || c.title, { max: 9 }),
			description: c.description,
			image: c.image,
		}),
		rewards: (c) => ({
			kind: 'github-owner',
			github_username: c.attribution?.github_username,
			github_user_id: c.attribution?.github_user_id,
		}),
	};
}

// A narrative coin riding cross-source community CULTURE. Identity invented from
// the theme; fees stay with the launching creator.
function communityNarrativeUseCase({ id, title, description, tags = [], params = {} }) {
	return {
		id,
		title,
		description,
		category: 'community',
		mode: 'narrative',
		tags: ['community', 'narrative', 'culture', ...tags],
		reward_label: 'Creator fees',
		source: { kind: 'narratives', params },
		defaults: { devBuySol: 0, network: 'mainnet' },
		naming: (c) => {
			const subject = c.subject || (Array.isArray(c.themes) ? c.themes[0] : '') || c.title;
			const name = titleCase(subject);
			return {
				name,
				symbol: deriveSymbol(subject, { max: 9 }),
				description: `A community coin riding the “${name}” vibe — minted on three.ws as the culture surfaces across the open web.`,
				image: null,
			};
		},
		rewards: () => ({ kind: 'creator' }),
	};
}

// ── catalog ──────────────────────────────────────────────────────────────────────

export const communityUseCases = [
	// (a) Attribution — the people and projects a community rallies behind.
	communityCreatorUseCase({
		id: 'community-ecosystem-contributors',
		title: 'Ecosystem contributors → reward coins',
		description:
			'Mint a coin for the builders carrying a whole ecosystem forward right now — the contributors whose repos are trending across GitHub. Creator fees route to each builder; they claim by linking a Solana wallet on three.ws.',
		tags: ['contributors', 'ecosystem'],
		params: { window: 'active', sinceDays: 30, minStars: 120 },
	}),
	communityRepoUseCase({
		id: 'community-language-projects',
		title: 'Language-community projects → reward coins',
		description:
			'Back the flagship projects of a programming-language community. Each trending repo in the language becomes a reward coin for its owner, so a community can fund the work it depends on.',
		tags: ['language', 'projects'],
		params: { window: 'new', sinceDays: 45, minStars: 90 },
	}),
	communityCreatorUseCase({
		id: 'community-open-source-builders',
		title: 'Open-source builders this month',
		description:
			'The highest-signal open-source builders by trending stars over the last 30 days — one reward coin per person, fees routed to them. Turn community appreciation into real, claimable creator fees.',
		tags: ['builders', 'open-source'],
		params: { window: 'new', sinceDays: 30, minStars: 100 },
	}),

	// (b) Narrative — cross-source community culture blends.
	communityNarrativeUseCase({
		id: 'community-culture-blend',
		title: 'Community culture, cross-sourced',
		description:
			'Blend what the internet’s communities are actually talking about — pulling shared themes from social, forums, search, and meme culture at once — into an original, brand-safe community coin. Identity is invented; only $THREE is ever the promoted coin.',
		tags: ['blend', 'social'],
		params: { sources: ['reddit', 'hackernews', 'knowyourmeme', 'x'], limit: 12 },
	}),
	communityNarrativeUseCase({
		id: 'community-meme-zeitgeist',
		title: 'The meme zeitgeist',
		description:
			'The shared jokes and references a community is rallying around, cross-checked across meme culture, search interest, and the broader knowledge web. An original Title-Case identity rides the vibe — never an external ticker.',
		tags: ['meme', 'zeitgeist'],
		params: { sources: ['knowyourmeme', 'googletrends', 'wikipedia', 'reddit'], limit: 12 },
	}),
	communityNarrativeUseCase({
		id: 'community-fandom-pulse',
		title: 'Fandom pulse',
		description:
			'Where fandoms and interest communities are converging right now — themes surfacing across forums, search trends, and the encyclopedic web, distilled into a fresh, brand-safe community coin.',
		tags: ['fandom', 'interest'],
		params: { sources: ['reddit', 'googletrends', 'wikipedia', 'trending'], limit: 12 },
	}),
];
