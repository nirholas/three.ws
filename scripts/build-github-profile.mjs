#!/usr/bin/env node
// Generate the owner's GitHub profile repository (github.com/<owner>/<owner>):
// a README that lists every public repo grouped by topic, plus the machine
// readable layer for AI agents (llms.txt, AGENTS.md, repos.json).
//
// The catalog is built from the live GitHub listing, so it never drifts from
// what is actually public. Repos about a third-party crypto project are left
// out of the generated text (committing them needs the owner's approval); pass
// --include-gated once that approval exists.
//
//   node scripts/build-github-profile.mjs --out /tmp/profile      # write files only
//   node scripts/build-github-profile.mjs --out /tmp/profile --publish
//                                  # create the repo if missing, commit, push
//
// Auth: gh must be authenticated as the owner.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OWNER, plain } from './lib/repo-growth-kit.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
	const i = args.indexOf(`--${n}`);
	return i === -1 ? null : args[i + 1];
};
const OUT = opt('out') || join(process.env.TMPDIR || '/tmp', 'profile-repo');
const GATED = /agenc|agora-mcp|binance|bnbchain|bitrefill|flock|lyra|memescope|metaplex|sherwood|techdollar|loxley|wisconsin|ucai|kol-quest|three-ws-intel/i;

const gh = (a, input) => execFileSync('gh', a, { encoding: 'utf8', input, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] });

const CATEGORIES = [
	['Robinhood Chain', 'SDKs, bots, alerts and tooling for Robinhood Chain.', (r) => /robinhood|hood-/i.test(r.name)],
	['x402 payments and agent commerce', 'Pay-per-call APIs and the clients, gates and facilitators that let agents buy.', (r) => /x402/i.test(r.name) || has(r, ['x402'])],
	['MCP servers for AI agents', 'Model Context Protocol servers that give any MCP client new abilities.', (r) => /mcp/i.test(r.name) || has(r, ['mcp-server', 'model-context-protocol'])],
	['three.ws platform and 3D agents', 'The platform for 3D AI agents with Solana wallets, its SDKs, CLIs and the avatar toolchain.', (r) => r.name === 'three.ws' || /^three-?ws|^threews|3d|avatar|glb|tty-|agent-(glance|vitals|guards?|memory|runtime)|guardian|witness|shipfeed|retarget|motion|sign-language|viewer/i.test(r.name) || has(r, ['3d', 'avatar', 'glb', 'vrm', 'gltf', 'rigging'])],
	['Solana and pump.fun tooling', 'Wallets, SDKs, claims, vanity addresses and launch tooling on Solana.', (r) => /pump|solana|spl|wallet|vanity|sniper|launch/i.test(r.name)],
	['DeFi mechanisms and Uniswap v4 hooks', 'Research-grade mechanism designs: hooks, curves, auctions and fee models.', (r) => has(r, ['uniswap-v4', 'amm', 'defi']) || /hook|swap|perp|curve|oracle|liquidity|fee/i.test(r.name)],
	['On-chain experiments and collectibles', 'Small, shippable ideas that live fully on-chain: receipts, postcards, mints and byte-level curiosities.', (r) => has(r, ['solana', 'onchain', 'on-chain', 'nft', 'calldata', 'evm', 'meme'])],
	['Developer tools and everything else', 'Utilities, data tools and side projects.', () => true],
];

function has(r, topics) {
	return (r.topics || []).some((t) => topics.includes(t));
}

const stars = (n) => (n ? ` ★${n}` : '');
const clip = (s = '', n = 140) => {
	const t = plain(s).replace(/\s+/g, ' ').trim();
	if (t.length <= n) return t;
	const cut = t.slice(0, n);
	return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).replace(/[\s,;:(-]+$/, '')}...`;
};
const line = (r) => `- [${r.name}](https://github.com/${OWNER}/${r.name})${stars(r.stargazerCount)}${r.description ? `: ${clip(r.description)}` : ''}`;

function load() {
	const rows = JSON.parse(gh(['repo', 'list', OWNER, '--limit', '1000', '--json', 'name,description,stargazerCount,isPrivate,isFork,isArchived,repositoryTopics,primaryLanguage,homepageUrl,pushedAt']));
	return rows
		.filter((r) => !r.isPrivate && !r.isFork && !r.isArchived && r.name !== OWNER)
		.map((r) => ({ ...r, topics: (r.repositoryTopics || []).map((t) => t.name), language: r.primaryLanguage?.name || null }))
		.sort((a, b) => b.stargazerCount - a.stargazerCount || a.name.localeCompare(b.name));
}

export function buildProfile(allRepos, { includeGated = false } = {}) {
	const repos = includeGated ? allRepos : allRepos.filter((r) => !GATED.test(r.name) && !GATED.test(r.description || ''));
	const totalStars = repos.reduce((n, r) => n + r.stargazerCount, 0);
	const featured = repos.slice(0, 6);
	const placed = new Set();
	const groups = CATEGORIES.map(([title, blurb, test]) => {
		const items = repos.filter((r) => !placed.has(r.name) && test(r));
		items.forEach((r) => placed.add(r.name));
		return { title, blurb, items };
	}).filter((g) => g.items.length);

	const readme = `<h1 align="center">nirholas</h1>

<p align="center"><b>Open-source tooling for 3D AI agents, agent payments and on-chain builders.</b><br/>${repos.length} public repositories, all documented for people and for AI agents.</p>

<p align="center">
<a href="https://three.ws"><img alt="three.ws" src="https://img.shields.io/badge/platform-three.ws-6d5dfc?style=for-the-badge"/></a>
<a href="https://github.com/${OWNER}?tab=followers"><img alt="Followers" src="https://img.shields.io/github/followers/${OWNER}?style=for-the-badge&logo=github"/></a>
<a href="https://github.com/${OWNER}/three.ws"><img alt="three.ws stars" src="https://img.shields.io/github/stars/${OWNER}/three.ws?style=for-the-badge&logo=github"/></a>
</p>

## Start here

${featured.map(line).join('\n')}

**Find your way:** use the repository topics on the left of any repo, or jump to a section below. Every repo ships a README, an [AGENTS.md](https://agents.md) and an [llms.txt](https://llmstxt.org) so a coding agent can pick it up cold. The full machine-readable list is [repos.json](./repos.json).

${groups.map((g) => `- [${g.title}](#${g.title.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-')}) (${g.items.length})`).join('\n')}

${groups
	.map(
		(g, i) => `## ${g.title}

${g.blurb}

<details${i < 2 ? ' open' : ''}>
<summary>${g.items.length} repositories</summary>

${g.items.map(line).join('\n')}

</details>`,
	)
	.join('\n\n')}

## Why star and follow

Stars are how developers and AI agents decide which repositories to trust. If something here helped you, a star takes one click and tells the next person it is worth their time. Follow [@${OWNER}](https://github.com/${OWNER}) to see new releases, and open a Discussion on any repo if you want to build with it.

- Platform: [three.ws](https://three.ws)
- Live site feeds: [changelog](https://three.ws/changelog) and [llms.txt](https://three.ws/llms.txt)
- Contact: [support@three.ws](mailto:support@three.ws)

<p align="center"><sub>Catalog generated from the live GitHub listing by <code>scripts/build-github-profile.mjs</code> in <a href="https://github.com/${OWNER}/three.ws">three.ws</a> (${repos.length} repositories, ${totalStars} stars across them).</sub></p>
`;

	const llms = `# ${OWNER}

> Open-source tooling for 3D AI agents, agent payments and on-chain builders. ${repos.length} public repositories by ${OWNER}, part of the three.ws ecosystem.

## Catalog

- [Full machine-readable list](https://github.com/${OWNER}/${OWNER}/blob/main/repos.json): name, description, topics, language and stars for every repo
- [Human catalog](https://github.com/${OWNER}/${OWNER}#readme): grouped by topic

## Sections

${groups.map((g) => `- ${g.title}: ${g.items.length} repositories`).join('\n')}

## Featured

${featured.map((r) => `- [${r.name}](https://github.com/${OWNER}/${r.name}): ${clip(r.description, 120)}`).join('\n')}

## Platform

- [three.ws](https://three.ws): the platform
- [three.ws llms.txt](https://three.ws/llms.txt)
`;

	const agents = `# AGENTS.md

This repository is the catalog for the public repositories of ${OWNER}. It holds no application code.

## How to use it

- Read [repos.json](repos.json) to find a repository by topic, language or description. Each entry has \`name\`, \`url\`, \`description\`, \`topics\`, \`language\` and \`stars\`.
- Every listed repository carries its own README, AGENTS.md and llms.txt. Open the repository, then read AGENTS.md for how to work in it.
- Do not guess at a repository that is not in repos.json. It may be private or retired.

## Regeneration

\`README.md\`, \`llms.txt\`, \`AGENTS.md\` and \`repos.json\` are generated by \`scripts/build-github-profile.mjs\` in https://github.com/${OWNER}/three.ws. Do not edit them by hand.
`;

	const json = repos.map((r) => ({
		name: r.name,
		url: `https://github.com/${OWNER}/${r.name}`,
		description: clip(r.description, 300),
		topics: r.topics,
		language: r.language,
		stars: r.stargazerCount,
		homepage: r.homepageUrl || null,
	}));
	return { readme, llms, agents, json: `${JSON.stringify(json, null, '\t')}\n`, count: repos.length, groups };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const all = load();
	const out = buildProfile(all, { includeGated: flag('include-gated') });
	rmSync(OUT, { recursive: true, force: true });
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(OUT, 'README.md'), out.readme);
	writeFileSync(join(OUT, 'llms.txt'), out.llms);
	writeFileSync(join(OUT, 'AGENTS.md'), out.agents);
	writeFileSync(join(OUT, 'repos.json'), out.json);
	console.log(`wrote ${out.count} repos in ${out.groups.length} sections to ${OUT}`);
	for (const g of out.groups) console.log(`  ${String(g.items.length).padStart(3)}  ${g.title}`);

	if (flag('publish')) {
		try {
			gh(['api', `repos/${OWNER}/${OWNER}`]);
		} catch {
			gh(['repo', 'create', `${OWNER}/${OWNER}`, '--public', '--description', 'Open-source tooling for 3D AI agents, agent payments and on-chain builders. Catalog of every public repository.']);
		}
		const clone = `${OUT}-clone`;
		rmSync(clone, { recursive: true, force: true });
		const run = (cwd, ...a) => {
			const r = spawnSync('git', ['-c', 'credential.helper=!gh auth git-credential', ...a], { cwd, encoding: 'utf8' });
			if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
			return r.stdout;
		};
		run(process.cwd(), 'clone', '--quiet', `https://github.com/${OWNER}/${OWNER}.git`, clone);
		for (const f of ['README.md', 'llms.txt', 'AGENTS.md', 'repos.json']) copyFileSync(join(OUT, f), join(clone, f));
		run(clone, 'add', '--', 'README.md', 'llms.txt', 'AGENTS.md', 'repos.json');
		if (!run(clone, 'status', '--porcelain').trim()) {
			console.log('profile repo already up to date');
			process.exit(0);
		}
		run(clone, 'commit', '--quiet', '-m', `docs: publish the profile catalog of ${out.count} public repositories with llms.txt and repos.json`, '-m', 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>');
		run(clone, 'push', '--quiet', 'origin', 'HEAD');
		console.log(`published https://github.com/${OWNER}/${OWNER}`);
	}
}
