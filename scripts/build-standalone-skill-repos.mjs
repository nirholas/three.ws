#!/usr/bin/env node
// Assembles the standalone, publishable Claude skill repos from the canonical
// packs in this monorepo, so an external user can install three.ws skills with
// one `/plugin marketplace add` against a small repo instead of cloning this one.
//
// Nothing is duplicated in git: every repo is generated into .data/ (gitignored)
// from .agents/skills/ on demand, which is the only way the copies cannot drift
// from the originals. Each output directory is a complete Claude Code plugin
// marketplace of one plugin: .claude-plugin/{marketplace,plugin}.json, skills/,
// README.md, LICENSE, .gitignore.
//
// Usage:
//   node scripts/build-standalone-skill-repos.mjs            # build all
//   node scripts/build-standalone-skill-repos.mjs --check     # validate, write nothing
//   node scripts/build-standalone-skill-repos.mjs --only three-ws-3d-skills
//   node scripts/build-standalone-skill-repos.mjs --out <dir> # override output root
//   node scripts/build-standalone-skill-repos.mjs --owner <gh login>
//
// Publishing is owner-gated and deliberately NOT automated here: the script
// prints the exact `gh repo create` command per repo when it finishes.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectSkills } from './build-skills-pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The GitHub account the repos live under, and the one every generated install
// line and repository URL points at. Override with --owner when publishing from
// a different account than the canonical one.
const DEFAULT_OWNER = 'nirholas';
const SKILL_FILES_SKIP = new Set(['.DS_Store']);

// Every repo selects skills from the canonical pack by predicate. Only
// three.ws-origin skills ship: vendored partner drops belong to their publishers,
// and the ops/production skill is for maintainers of this repo, not its users.
export const REPO_SPECS = [
	{
		repo: 'three-ws-skills',
		plugin: 'three-ws',
		displayName: 'three.ws Skills',
		description:
			'Every three.ws skill for Claude: generate and rig 3D models and avatars, build and monetize agents, and run a wallet in the x402 agent economy.',
		keywords: ['3d', 'avatar', 'agent', 'skills', 'x402', 'solana', 'mcp'],
		category: 'productivity',
		tagline:
			'One install gives Claude the whole platform: 3D creation, agent building, the marketplace, and the wallet.',
		select: (s) => s.origin === 'three.ws' && s.category !== 'ops/production',
	},
	{
		repo: 'three-ws-3d-skills',
		plugin: 'three-ws-3d',
		displayName: 'three.ws 3D Skills',
		description:
			'Text and images to 3D: generate textured GLB models, rigged animation-ready avatars, auto-rig an existing model, search 3D assets, and embed a live avatar on any site. Free lanes, no account, no key.',
		keywords: ['3d', 'glb', 'text-to-3d', 'avatar', 'rigging', 'threejs'],
		category: 'creative',
		tagline:
			'The crypto-free subset: no wallet, no payments, nothing to fund. Works on any Claude surface.',
		select: (s) => s.category === '3d/creative' && s.crossPlatformSafe,
	},
	{
		repo: 'three-ws-agent-economy-skills',
		plugin: 'three-ws-agent-economy',
		displayName: 'three.ws Agent Economy Skills',
		description:
			'The money half of three.ws for Claude: run a wallet, pay x402 endpoints, publish and price agent skills in $THREE, hire other agents, and monetize your own API.',
		keywords: ['x402', 'usdc', 'solana', 'wallet', 'payments', 'agent-economy', 'three'],
		category: 'payments',
		tagline: 'Agents that earn and spend, on real rails, with real receipts.',
		select: (s) =>
			s.origin === 'three.ws' &&
			(s.category === 'wallet/payments' || s.category === 'platform/agents'),
	},
];

// Importable as a library (the tests read REPO_SPECS): only build when this file
// is the entry point.
const invokedDirectly =
	process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();

function main() {
	const argv = process.argv.slice(2);
	const CHECK = argv.includes('--check');
	const OWNER = valueOf('--owner') || DEFAULT_OWNER;
	const only = valueOf('--only');
	const outRoot = path.resolve(ROOT, valueOf('--out') || path.join('.data', 'standalone-repos'));

	function valueOf(flag) {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : null;
	}

	const allSkills = collectSkills();
	const specs = only ? REPO_SPECS.filter((r) => r.repo === only) : REPO_SPECS;
	if (!specs.length) {
		console.error(`no repo spec named "${only}". Known: ${REPO_SPECS.map((r) => r.repo).join(', ')}`);
		process.exit(1);
	}

	const built = [];
	let failed = false;

	for (const spec of specs) {
		const skills = allSkills.filter(spec.select).sort((a, b) => a.name.localeCompare(b.name));
		if (!skills.length) {
			console.error(`${spec.repo}: selects no skills: the predicate no longer matches the pack`);
			failed = true;
			continue;
		}
		for (const skill of skills) {
			const src = path.join(ROOT, skill.path);
			if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
				console.error(`${spec.repo}: ${skill.name} has no SKILL.md at ${skill.path}`);
				failed = true;
			}
		}
		if (failed) continue;

		const dest = path.join(outRoot, spec.repo);
		if (!CHECK) {
			fs.rmSync(dest, { recursive: true, force: true });
			fs.mkdirSync(path.join(dest, '.claude-plugin'), { recursive: true });
			for (const skill of skills) {
				copyTree(path.join(ROOT, skill.path), path.join(dest, 'skills', skill.name));
			}
			write(path.join(dest, '.claude-plugin', 'marketplace.json'), marketplaceJson(spec, OWNER));
			write(path.join(dest, '.claude-plugin', 'plugin.json'), pluginJson(spec, OWNER));
			write(path.join(dest, 'README.md'), readme(spec, skills, OWNER));
			fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dest, 'LICENSE'));
			write(path.join(dest, '.gitignore'), 'node_modules/\n.DS_Store\n');
		}
		built.push({ spec, skills, dest });
	}

	if (failed) process.exit(1);

	for (const { spec, skills, dest } of built) {
		console.log(
			`${CHECK ? 'ok' : 'built'}  ${spec.repo}  ${skills.length} skills  ${
				CHECK ? '' : path.relative(ROOT, dest)
			}`.trimEnd(),
		);
		console.log(`        ${skills.map((s) => s.name).join(', ')}`);
	}

	if (CHECK) {
		console.log(`\n${built.length} repo spec(s) resolve against ${allSkills.length} packed skills.`);
		process.exit(0);
	}

	console.log('\nPublish one (owner-gated, run from the generated directory):\n');
	for (const { spec, dest } of built) {
		console.log(`  cd ${path.relative(ROOT, dest)} && git init -b main && git add -A \\`);
		console.log(`    && git commit -m 'feat: ${spec.displayName} for Claude' \\`);
		// Single-quote the description: a double-quoted shell string would expand
		// "$THREE" in any repo blurb that names the coin.
		console.log(
			`    && gh repo create ${OWNER}/${spec.repo} --public --source=. --push --description ${shellQuote(spec.description)}`,
		);
		console.log('');
	}
	console.log(`Users then install with:\n  /plugin marketplace add ${OWNER}/${built[0].spec.repo}`);
}

// ── helpers ────────────────────────────────────────────────────────────────

function shellQuote(value) {
	return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function write(file, body) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, body);
}

function copyTree(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		if (SKILL_FILES_SKIP.has(entry.name)) continue;
		const from = path.join(src, entry.name);
		const to = path.join(dest, entry.name);
		if (entry.isDirectory()) copyTree(from, to);
		else if (entry.isFile()) fs.copyFileSync(from, to);
	}
}

function pluginBody(spec, OWNER) {
	return {
		name: spec.plugin,
		description: spec.description,
		version: '1.0.0',
		author: { name: OWNER },
		homepage: 'https://three.ws',
		license: 'Apache-2.0',
		repository: `https://github.com/${OWNER}/${spec.repo}`,
		keywords: spec.keywords,
	};
}

function pluginJson(spec, OWNER) {
	return `${JSON.stringify({ ...pluginBody(spec, OWNER), skills: './skills' }, null, '\t')}\n`;
}

function marketplaceJson(spec, OWNER) {
	return `${JSON.stringify(
		{
			name: spec.plugin,
			owner: { name: OWNER },
			description: spec.description,
			version: '1.0.0',
			plugins: [
				{
					...pluginBody(spec, OWNER),
					source: './',
					displayName: spec.displayName,
					category: spec.category,
					tags: spec.keywords.slice(0, 4),
				},
			],
		},
		null,
		'\t',
	)}\n`;
}

function readme(spec, skills, OWNER) {
	const rows = skills
		.map((s) => `| \`${s.name}\` | ${s.description.replace(/\|/g, '\\|').replace(/\s+/g, ' ')} |`)
		.join('\n');
	return `# ${spec.displayName}

${spec.description}

${spec.tagline}

Generated from the canonical packs in [${OWNER}/three.ws](https://github.com/${OWNER}/three.ws)
(\`.agents/skills/\`), so these folders are always byte-identical to what the platform
itself ships. Every skill follows the [Agent Skills spec](https://agentskills.io/specification):
a \`SKILL.md\` whose frontmatter \`description\` is the trigger the model reads when
deciding to load it.

## Install

In Claude Code:

\`\`\`
/plugin marketplace add ${OWNER}/${spec.repo}
/plugin install ${spec.plugin}@${spec.plugin}
\`\`\`

Then start a request in plain language. Skills are model-invoked, so you do not have to
name one, but you can: \`/${spec.plugin}:${skills[0].name}\`.

In a Claude app, upload a skill folder under **Project → Skills**. For the Agent SDK,
point its skills directory at \`skills/\`. Or drop a single folder into any project:

\`\`\`bash
cp -r skills/${skills[0].name} ~/my-project/.claude/skills/
\`\`\`

## Skills

| Skill | What it does and when it loads |
| --- | --- |
${rows}

## Links

- Platform: [three.ws](https://three.ws)
- Docs: [three.ws/docs/agent-skills](https://three.ws/docs/agent-skills)
- Source of truth: [${OWNER}/three.ws](https://github.com/${OWNER}/three.ws)

## License

Apache-2.0. See [LICENSE](LICENSE).
`;
}
