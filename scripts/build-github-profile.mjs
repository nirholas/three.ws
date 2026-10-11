#!/usr/bin/env node
// Generate the owner's GitHub profile repository (github.com/<owner>/<owner>):
// a personal README with animated 3D charts of the whole account (rendered by
// lib/profile-visuals.mjs into assets/) and every public repo grouped by topic,
// plus the machine readable layer for AI agents (llms.txt, AGENTS.md, repos.json).
// It is the owner's personal profile, so three.ws is one section among many,
// never the framing.
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
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderVisuals } from './lib/profile-visuals.mjs';
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
	['3D AI agents and avatars', 'Agents with 3D bodies, wallets and memory, plus the SDKs, CLIs and avatar toolchain around them.', (r) => r.name === 'three.ws' || /^three-?ws|^threews|3d|avatar|glb|tty-|agent-(glance|vitals|guards?|memory|runtime)|guardian|witness|shipfeed|retarget|motion|sign-language|viewer/i.test(r.name) || has(r, ['3d', 'avatar', 'glb', 'vrm', 'gltf', 'rigging'])],
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
	const rows = JSON.parse(gh(['repo', 'list', OWNER, '--limit', '1000', '--json', 'name,description,stargazerCount,isPrivate,isFork,isArchived,repositoryTopics,primaryLanguage,homepageUrl,pushedAt,createdAt,forkCount']));
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
	const groups = CATEGORIES.map(([title, blurb, test], slot) => {
		const items = repos.filter((r) => !placed.has(r.name) && test(r));
		items.forEach((r) => placed.add(r.name));
		return { title, blurb, items, slot };
	}).filter((g) => g.items.length);
	const assets = renderVisuals(repos, groups);
	const pic = (name, alt) =>
		`<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/${name}-dark.svg"/><source media="(prefers-color-scheme: light)" srcset="./assets/${name}-light.svg"/><img alt="${alt}" src="./assets/${name}-light.svg" width="100%"/></picture>`;
	const anchor = (t) => t.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');

	const readme = `<h1 align="center">${OWNER}</h1>

<p align="center"><b>I build open-source software: AI agents, MCP servers, 3D, on-chain tooling and developer tools.</b><br/>${repos.length} public repositories, each documented for people and for AI agents.</p>

<p align="center">
<a href="https://github.com/${OWNER}?tab=followers"><img alt="Followers" src="https://img.shields.io/github/followers/${OWNER}?style=for-the-badge&logo=github&label=followers"/></a>
<a href="https://github.com/${OWNER}?tab=repositories&sort=stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/${OWNER}?affiliations=OWNER&style=for-the-badge&logo=github&label=stars"/></a>
<a href="https://github.com/${OWNER}?tab=repositories"><img alt="Repositories" src="https://img.shields.io/badge/repositories-${repos.length}-6250d6?style=for-the-badge&logo=github"/></a>
</p>

<p align="center">${pic('stats', `${repos.length} repositories, ${totalStars} stars`)}</p>

<p align="center">${pic('planet', `A rotating 3D planet with one point per repository, sized by stars and colored by section`)}</p>

## Start here

${featured.map(line).join('\n')}

${pic('top-stars', 'The most-starred repositories on a log scale')}

## By the numbers

Every chart below is rendered from the live GitHub listing each time the catalog is rebuilt, so the numbers are always current.

${pic('city', 'An isometric city with one tower per repository, height by stars, one district per section')}

${pic('growth', 'Cumulative repositories over time, stacked by section')}

${pic('languages', 'A spinning 3D donut of primary languages')}

${pic('punchcard', 'Punchcard of when repositories were created, by weekday and hour')}

## Find your way

Use the repository topics on the left of any repo, or jump to a section below. Every repo ships a README, an [AGENTS.md](https://agents.md) and an [llms.txt](https://llmstxt.org) so a coding agent can pick it up cold. The full machine-readable list is [repos.json](./repos.json).

${groups.map((g) => `- [${g.title}](#${anchor(g.title)}) (${g.items.length})`).join('\n')}

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

## Say hi

If something here helped you, a star takes one click and tells the next person it is worth their time. [Follow @${OWNER}](https://github.com/${OWNER}) to see new releases, and open an issue or a Discussion on any repo if you want to build with it.

Coding agents and LLM tooling can read this profile directly: [AGENTS.md](./AGENTS.md), [llms.txt](./llms.txt) and [repos.json](./repos.json).

<p align="center"><sub>Catalog and charts regenerated from the live GitHub listing: ${repos.length} repositories, ${totalStars} stars.</sub></p>
`;

	const llms = `# ${OWNER}

> Open-source software by ${OWNER}: AI agents, MCP servers, 3D, on-chain tooling and developer tools. ${repos.length} public repositories.

## Catalog

- [Full machine-readable list](https://github.com/${OWNER}/${OWNER}/blob/main/repos.json): name, description, topics, language and stars for every repo
- [Human catalog](https://github.com/${OWNER}/${OWNER}#readme): grouped by topic

## Sections

${groups.map((g) => `- ${g.title}: ${g.items.length} repositories`).join('\n')}

## Featured

${featured.map((r) => `- [${r.name}](https://github.com/${OWNER}/${r.name}): ${clip(r.description, 120)}`).join('\n')}
`;

	const agents = `# AGENTS.md

This repository is the catalog for the public repositories of ${OWNER}. It holds no application code.

## How to use it

- Read [repos.json](repos.json) to find a repository by topic, language or description. Each entry has \`name\`, \`url\`, \`description\`, \`topics\`, \`language\` and \`stars\`.
- Every listed repository carries its own README, AGENTS.md and llms.txt. Open the repository, then read AGENTS.md for how to work in it.
- Do not guess at a repository that is not in repos.json. It may be private or retired.

## Regeneration

\`README.md\`, \`assets/\`, \`llms.txt\`, \`llms-full.txt\`, \`CITATION.cff\`, \`AGENTS.md\` and \`repos.json\` are generated by \`scripts/build-github-profile.mjs\` in https://github.com/${OWNER}/three.ws. Do not edit them by hand.
`;

	const llmsFull = `${llms}\n---\n\n${readme}`;
	const citation = `cff-version: 1.2.0
message: If you use this software, please cite it as below.
title: "${OWNER}"
abstract: "Open-source software by ${OWNER}: AI agents, MCP servers, 3D, on-chain tooling and developer tools. Catalog of every public repository."
repository-code: "https://github.com/${OWNER}/${OWNER}"
url: "https://github.com/${OWNER}"
authors:
  - alias: ${OWNER}
    website: "https://github.com/${OWNER}"
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
	return { readme, llms, llmsFull, citation, agents, assets, json: `${JSON.stringify(json, null, '\t')}\n`, count: repos.length, groups };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const all = load();
	const out = buildProfile(all, { includeGated: flag('include-gated') });
	rmSync(OUT, { recursive: true, force: true });
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(OUT, 'README.md'), out.readme);
	writeFileSync(join(OUT, 'llms.txt'), out.llms);
	writeFileSync(join(OUT, 'llms-full.txt'), out.llmsFull);
	writeFileSync(join(OUT, 'CITATION.cff'), out.citation);
	writeFileSync(join(OUT, 'AGENTS.md'), out.agents);
	writeFileSync(join(OUT, 'repos.json'), out.json);
	mkdirSync(join(OUT, 'assets'), { recursive: true });
	for (const [name, body] of Object.entries(out.assets)) writeFileSync(join(OUT, 'assets', name), body);
	console.log(`wrote ${out.count} repos in ${out.groups.length} sections to ${OUT}`);
	for (const g of out.groups) console.log(`  ${String(g.items.length).padStart(3)}  ${g.title}`);

	if (flag('publish')) {
		try {
			gh(['api', `repos/${OWNER}/${OWNER}`]);
		} catch {
			gh(['repo', 'create', `${OWNER}/${OWNER}`, '--public', '--description', 'Open-source software: AI agents, MCP servers, 3D, on-chain tooling and developer tools. Catalog of every public repository.']);
		}
		const clone = `${OUT}-clone`;
		rmSync(clone, { recursive: true, force: true });
		const run = (cwd, ...a) => {
			const r = spawnSync('git', ['-c', 'credential.helper=!gh auth git-credential', ...a], { cwd, encoding: 'utf8' });
			if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
			return r.stdout;
		};
		run(process.cwd(), 'clone', '--quiet', `https://github.com/${OWNER}/${OWNER}.git`, clone);
		const owned = ['README.md', 'llms.txt', 'llms-full.txt', 'CITATION.cff', 'AGENTS.md', 'repos.json'];
		for (const f of owned) copyFileSync(join(OUT, f), join(clone, f));
		const assetDir = join(clone, 'assets');
		if (existsSync(assetDir)) for (const f of readdirSync(assetDir)) if (f.endsWith('.svg') && !out.assets[f]) rmSync(join(assetDir, f));
		mkdirSync(assetDir, { recursive: true });
		for (const f of Object.keys(out.assets)) copyFileSync(join(OUT, 'assets', f), join(assetDir, f));
		run(clone, 'add', '-A', '--', ...owned, 'assets');
		if (!run(clone, 'status', '--porcelain').trim()) {
			console.log('profile repo already up to date');
			process.exit(0);
		}
		run(clone, 'commit', '--quiet', '-m', `docs: rebuild the profile with animated charts and the catalog of ${out.count} public repositories`, '-m', 'Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>');
		run(clone, 'push', '--quiet', 'origin', 'HEAD');
		console.log(`published https://github.com/${OWNER}/${OWNER}`);
	}
}
