// @ts-check
// GitHub launch use cases — attribution coins minted FOR real trending repos and
// the people who build them, with creator fees routed to the GitHub owner via the
// fee-sharing / social-fee system. Coin-agnostic: every subject is live GitHub
// data resolved at runtime, never a hardcoded project.
//
// All of these share two naming/reward strategies (repoUseCase / creatorUseCase)
// and differ only in their live query — that's the engine doing the wiring, so
// each entry is a real, complete recipe, not a stub.

import { deriveSymbol } from '../usecase-engine.js';

// A coin named for a repo: name from the repo, fees to the repo owner.
function repoUseCase({ id, title, description, tags = [], params = {} }) {
	return {
		id, title, description, category: 'github', mode: 'attribution',
		tags: ['github', 'attribution', 'rewards', ...tags],
		reward_label: 'Creator fees → the repo owner',
		source: { kind: 'github-repos', params },
		defaults: { devBuySol: 0, network: 'mainnet' },
		naming: (c) => ({
			name: c.title || c.raw?.name,
			symbol: deriveSymbol(c.raw?.name || c.title, { max: 9 }),
			description: c.description,
			image: c.image,
		}),
		rewards: (c) => ({ kind: 'github-owner', github_username: c.attribution?.github_username, github_user_id: c.attribution?.github_user_id }),
	};
}

// A coin named for a creator: name from the @handle, fees to that creator.
function creatorUseCase({ id, title, description, tags = [], params = {} }) {
	return {
		id, title, description, category: 'github', mode: 'attribution',
		tags: ['github', 'creator', 'attribution', 'rewards', ...tags],
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
		rewards: (c) => ({ kind: 'github-owner', github_username: c.attribution?.github_username, github_user_id: c.attribution?.github_user_id }),
	};
}

export const githubUseCases = [
	repoUseCase({
		id: 'github-trending-repos',
		title: 'Trending GitHub repos → reward coins',
		description: 'Mint a coin for each newly trending GitHub repository. Creator fees route to the repo owner — they claim by linking a Solana wallet on three.ws.',
		params: { window: 'new', sinceDays: 30, minStars: 100 },
	}),
	repoUseCase({
		id: 'github-fresh-breakouts',
		title: "This week's GitHub breakouts",
		description: 'The freshest repos to cross a star threshold in the last 7 days — catch a project the moment it breaks out, with fees routed to its owner.',
		tags: ['fresh'],
		params: { window: 'new', sinceDays: 7, minStars: 150 },
	}),
	repoUseCase({
		id: 'github-active-surge',
		title: 'Established repos surging now',
		description: 'Long-standing repositories seeing a fresh push of activity. Rides momentum on proven projects rather than brand-new ones.',
		tags: ['momentum'],
		params: { window: 'active', sinceDays: 7, minStars: 5000 },
	}),
	repoUseCase({
		id: 'github-rust-repos',
		title: 'Trending Rust projects',
		description: 'Reward coins for the Rust ecosystem — new trending crates, tools, and runtimes, with fees to their maintainers.',
		tags: ['language', 'rust'],
		params: { window: 'new', sinceDays: 45, minStars: 80, language: 'Rust' },
	}),
	repoUseCase({
		id: 'github-typescript-repos',
		title: 'Trending TypeScript projects',
		description: 'The TypeScript wave — frameworks, SDKs, and apps breaking out, each minted as a reward coin for its author.',
		tags: ['language', 'typescript'],
		params: { window: 'new', sinceDays: 45, minStars: 80, language: 'TypeScript' },
	}),
	repoUseCase({
		id: 'github-python-repos',
		title: 'Trending Python projects',
		description: 'Python’s trending edge — libraries, agents, and tools — with creator fees routed to the people shipping them.',
		tags: ['language', 'python'],
		params: { window: 'new', sinceDays: 45, minStars: 80, language: 'Python' },
	}),
	repoUseCase({
		id: 'github-ai-ml-repos',
		title: 'Trending AI / ML notebooks',
		description: 'The applied-AI surface: trending Jupyter Notebook repos — models, demos, and research — minted for their creators.',
		tags: ['ai', 'ml'],
		params: { window: 'new', sinceDays: 60, minStars: 60, language: 'Jupyter Notebook' },
	}),
	repoUseCase({
		id: 'github-go-repos',
		title: 'Trending Go projects',
		description: 'Infrastructure’s favourite language — trending Go repos for tooling, databases, and networking, with fees to maintainers.',
		tags: ['language', 'go'],
		params: { window: 'new', sinceDays: 45, minStars: 80, language: 'Go' },
	}),
	repoUseCase({
		id: 'github-solidity-repos',
		title: 'Trending Solidity / onchain repos',
		description: 'New smart-contract and onchain tooling repos trending on GitHub, minted as reward coins for their builders.',
		tags: ['language', 'solidity', 'onchain'],
		params: { window: 'new', sinceDays: 60, minStars: 40, language: 'Solidity' },
	}),
	creatorUseCase({
		id: 'github-trending-creators',
		title: 'Trending GitHub creators → reward coins',
		description: 'Mint a coin for each builder trending across GitHub right now. One coin per creator, fees routed to them — the $THREE → @nirholas pattern, automated.',
		params: { window: 'new', sinceDays: 60, minStars: 80 },
	}),
	creatorUseCase({
		id: 'github-top-builders',
		title: 'Top GitHub builders this quarter',
		description: 'The highest-signal creators by trending stars over the last 90 days — back the people, not just the projects.',
		tags: ['builders'],
		params: { window: 'new', sinceDays: 90, minStars: 150 },
	}),
	creatorUseCase({
		id: 'github-rust-builders',
		title: 'Trending Rust builders',
		description: 'The creators driving the Rust ecosystem’s trending repos, each minted a reward coin.',
		tags: ['language', 'rust', 'builders'],
		params: { window: 'new', sinceDays: 60, minStars: 80, language: 'Rust' },
	}),
];
