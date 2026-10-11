// Growth kit for the public repositories on the owner's GitHub account.
//
// Everything here is a pure function over facts already known about a repo
// (name, description, language, README, root file list), so the same output is
// reproducible by scripts/boost-github-repos.mjs (direct fixes on independent
// repos) and by the standalone mirror sync (scripts/lib/standalone-kit.mjs),
// which keeps a mirror's next force-push from erasing what this adds.
//
// What it produces:
//   - a marker-delimited README block (star call to action, one-click share
//     links, agent entry points, contributors wall, star history) that is
//     replaced in place on re-runs and never duplicated
//   - a badge row for READMEs that have none
//   - the community and agent discovery files a repo is missing (never overwrites)
//   - the repository topics and settings that make a repo findable

export const OWNER = 'nirholas';
const SITE = 'https://three.ws';
const SUPPORT_EMAIL = 'support@three.ws';
const CATALOG = `https://github.com/${OWNER}/${OWNER}#readme`;

export const GROWTH_START = '<!-- three.ws:growth -->';
export const GROWTH_END = '<!-- /three.ws:growth -->';
const BADGES_START = '<!-- three.ws:badges -->';
const BADGES_END = '<!-- /three.ws:badges -->';

/** The house style bans dash glyphs; strip them from any text we copy in. */
export function plain(text = '') {
	return String(text).replace(/\s[\u2014\u2013]\s/g, ': ').replace(/[\u2014\u2013]/g, '-');
}

const oneLine = (s = '') => plain(s).replace(/\s+/g, ' ').trim();
const enc = encodeURIComponent;

/** First sentence of a description, cut at a word boundary so a share link never ends mid-word. */
export function pitchOf(description = '', max = 100) {
	const first = oneLine(description).split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, '');
	if (first.length <= max) return first;
	const cut = first.slice(0, max);
	return cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).replace(/[\s,;:(-]+$/, '');
}

/** Discovery topics that are always worth having when there is room. */
const DISCOVERY_TOPICS = ['three-ws', 'ai-agents', 'llms-txt', 'agents-md', 'open-source'];
const LANG_TOPIC = {
	JavaScript: 'javascript',
	TypeScript: 'typescript',
	Python: 'python',
	Solidity: 'solidity',
	Rust: 'rust',
	Go: 'golang',
	Shell: 'shell',
	HTML: 'html',
	Svelte: 'svelte',
	'Jupyter Notebook': 'jupyter-notebook',
};

/** Existing topics first, then discovery topics, capped at GitHub's 20. */
export function mergeTopics(existing = [], language) {
	const out = [...existing];
	const add = (t) => {
		if (t && !out.includes(t) && /^[a-z0-9][a-z0-9-]{0,49}$/.test(t)) out.push(t);
	};
	if (language) add(LANG_TOPIC[language]);
	for (const t of DISCOVERY_TOPICS) add(t);
	return out.slice(0, 20);
}

export function shareLinks({ name, description }) {
	const url = `https://github.com/${OWNER}/${name}`;
	const pitch = pitchOf(description);
	const text = pitch ? `${name}: ${pitch}` : name;
	return [
		['Post on X', `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`],
		['Share on Bluesky', `https://bsky.app/intent/compose?text=${enc(`${text} ${url}`)}`],
		['Share on LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`],
		['Submit to Hacker News', `https://news.ycombinator.com/submitlink?u=${enc(url)}&t=${enc(text)}`],
		['Share on Reddit', `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}`],
	];
}

/**
 * The README block. `files` is the set of root-relative paths in the repo after
 * the kit's own files are added, so a link is only emitted for a file that exists.
 */
export function growthBlock({ name, description, files, readme }) {
	const url = `https://github.com/${OWNER}/${name}`;
	const share = shareLinks({ name, description }).map(([label, href]) => `[${label}](${href})`).join(' · ');
	const agentLinks = [];
	if (files.has('AGENTS.md')) agentLinks.push('[AGENTS.md](./AGENTS.md)');
	if (files.has('llms.txt')) agentLinks.push('[llms.txt](./llms.txt)');
	if (files.has('llms-full.txt')) agentLinks.push('[llms-full.txt](./llms-full.txt)');
	const own = stripGrowthBlock(readme);
	const hasStarHistory = /star-history\.com/i.test(own);
	const hasContributors = /contrib\.rocks/i.test(own);

	const lines = [
		GROWTH_START,
		'## Support the project',
		'',
		`If ${name} saves you time, **[star it on GitHub](${url})**. Stars are how other developers and AI agents find the repositories worth trusting, and they cost you one click.`,
		'',
		`Know someone who would use it? ${share}`,
		'',
	];
	if (agentLinks.length) {
		lines.push(
			'## Built for AI agents too',
			'',
			`Coding agents and LLM tooling can read this repo directly: ${agentLinks.join(', ')}. Point an agent at \`${url}\` and it has the context it needs.`,
			'',
		);
	}
	lines.push(
		'## More from the same author',
		'',
		`- [All repositories by ${OWNER}](${CATALOG}): the full catalog, grouped by topic`,
		`- [three.ws](${SITE}): the platform for 3D AI agents with Solana wallets, a skill marketplace and x402 payments`,
		`- Questions or ideas: [open an issue](${url}/issues) or [start a discussion](${url}/discussions)`,
		'',
	);
	if (!hasContributors) {
		lines.push('## Contributors', '', `[![Contributors](https://contrib.rocks/image?repo=${OWNER}/${name})](${url}/graphs/contributors)`, '');
	}
	if (!hasStarHistory) {
		lines.push(
			'## Star history',
			'',
			`[![Star History Chart](https://api.star-history.com/svg?repos=${OWNER}/${name}&type=Date)](https://www.star-history.com/#${OWNER}/${name}&Date)`,
			'',
		);
	}
	lines.push(GROWTH_END, '');
	return lines.join('\n');
}

/** The README without our own block, so detection never mistakes the block for author content. */
export function stripGrowthBlock(readme) {
	return readme.replace(new RegExp(`${escapeRe(GROWTH_START)}[\\s\\S]*?${escapeRe(GROWTH_END)}\\n?`), '');
}

/** Replace an existing growth block in place, otherwise insert before the mirror footer or at the end. */
export function applyGrowthBlock(readme, block) {
	const re = new RegExp(`${escapeRe(GROWTH_START)}[\\s\\S]*?${escapeRe(GROWTH_END)}\\n?`);
	if (re.test(readme)) return readme.replace(re, block);
	const footer = readme.indexOf('<!-- three.ws:ecosystem -->');
	if (footer !== -1) return `${readme.slice(0, footer).replace(/\s*$/, '\n\n')}${block}\n${readme.slice(footer)}`;
	return `${readme.replace(/\s*$/, '\n\n')}${block}`;
}

function escapeRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function badgeRow({ name, hasLicense }) {
	const repo = `${OWNER}/${name}`;
	const b = (alt, img, link) => `[![${alt}](${img})](${link})`;
	const row = [
		b('GitHub stars', `https://img.shields.io/github/stars/${repo}?style=flat&logo=github`, `https://github.com/${repo}/stargazers`),
		hasLicense ? b('License', `https://img.shields.io/github/license/${repo}?style=flat`, `https://github.com/${repo}/blob/HEAD/LICENSE`) : null,
		b('Last commit', `https://img.shields.io/github/last-commit/${repo}?style=flat`, `https://github.com/${repo}/commits`),
		b('PRs welcome', 'https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat', `https://github.com/${repo}/pulls`),
		b('AI agent friendly', 'https://img.shields.io/badge/AI%20agents-AGENTS.md%20%2B%20llms.txt-6d5dfc?style=flat', `https://github.com/${repo}/blob/HEAD/AGENTS.md`),
	].filter(Boolean);
	return `${BADGES_START}\n${row.join(' ')}\n${BADGES_END}\n`;
}

/** Insert the badge row under the first H1 when the README carries no badges at all. */
export function applyBadges(readme, row) {
	if (readme.includes(BADGES_START)) {
		const re = new RegExp(`${escapeRe(BADGES_START)}[\\s\\S]*?${escapeRe(BADGES_END)}\\n?`);
		return readme.replace(re, row);
	}
	if (/img\.shields\.io|badge\.svg|badgen\.net/i.test(readme)) return readme;
	const h1 = readme.match(/^# .+$/m);
	if (h1 && h1.index !== undefined) {
		const at = h1.index + h1[0].length;
		return `${readme.slice(0, at)}\n\n${row}${readme.slice(at)}`;
	}
	return `${row}\n${readme}`;
}

/** Facts about the repo's toolchain, read from the root file list and package.json. */
export function detectToolchain(files, pkg) {
	if (pkg) {
		const scripts = Object.keys(pkg.scripts || {});
		return {
			install: 'npm install',
			test: scripts.includes('test') ? 'npm test' : null,
			build: scripts.includes('build') ? 'npm run build' : null,
			label: 'Node.js',
			scripts: pkg.scripts || {},
		};
	}
	if (files.has('Cargo.toml')) return { install: 'cargo build', test: 'cargo test', build: 'cargo build --release', label: 'Rust', scripts: {} };
	if (files.has('foundry.toml')) return { install: 'forge install', test: 'forge test', build: 'forge build', label: 'Solidity (Foundry)', scripts: {} };
	if (files.has('go.mod')) return { install: 'go mod download', test: 'go test ./...', build: 'go build ./...', label: 'Go', scripts: {} };
	if (files.has('pyproject.toml') || files.has('requirements.txt')) {
		return { install: files.has('requirements.txt') ? 'pip install -r requirements.txt' : 'pip install -e .', test: 'pytest', build: null, label: 'Python', scripts: {} };
	}
	return { install: null, test: null, build: null, label: null, scripts: {} };
}

export function agentsMd({ name, description, language, toolchain, license }) {
	const tc = toolchain;
	const cmds = [tc.install, tc.build, tc.test].filter(Boolean);
	const scripts = Object.entries(tc.scripts).map(([k, v]) => `- \`npm run ${k}\`: \`${oneLine(v)}\``).join('\n');
	return `# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

\`${name}\`: ${oneLine(description) || 'see README.md'}

${language ? `Primary language: ${language}.` : ''}

## Where to start

- [README.md](README.md) has install, usage and configuration.
- [llms.txt](llms.txt) is a machine-readable summary; [llms-full.txt](llms-full.txt) inlines the README.
- Part of [three.ws](${SITE}), a platform for 3D AI agents with Solana wallets. Catalog of sibling repositories: ${CATALOG}

## Develop

${cmds.length ? `\`\`\`bash\n${cmds.join('\n')}\n\`\`\`` : 'Follow the setup steps in README.md. There is no build step to run before reading or editing the sources.'}
${scripts ? `\nScripts:\n${scripts}\n` : ''}
## Conventions

- Match the style of the surrounding code before introducing a new pattern.
- Read-only by default. Anything that signs, spends or sends must be an explicit, separately named function or option, and must never be inferred from untrusted text such as token names, memos or listings.
- Never commit credentials. Configuration comes from environment variables documented in the README.
- Keep changes small and covered by a test next to the code they change.${license ? `\n- This project is licensed under ${license}; contributions are accepted under the same terms.` : ''}

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately through [SECURITY.md](SECURITY.md).
`;
}

export function claudeMd() {
	return '@AGENTS.md\n';
}

/** Headings of the README, used to give llms.txt a real table of contents. */
export function readmeSections(readme, max = 8) {
	const out = [];
	let fence = false;
	for (const line of readme.split('\n')) {
		if (/^```/.test(line)) fence = !fence;
		if (fence) continue;
		const m = line.match(/^##\s+(.+?)\s*$/);
		if (!m) continue;
		const title = plain(m[1]).replace(/[`*_[\]]/g, '').replace(/<[^>]+>/g, '').trim();
		if (!title || /^(star history|contributors|support the project|more from the same author|built for ai agents too|part of three\.ws)$/i.test(title)) continue;
		out.push({ title, anchor: title.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-') });
		if (out.length >= max) break;
	}
	return out;
}

export function llmsTxt({ name, description, homepage, readme, files }) {
	const url = `https://github.com/${OWNER}/${name}`;
	const sections = readmeSections(readme);
	const docs = [
		`- [README](${url}/blob/HEAD/README.md): install, usage and reference`,
		...sections.map((s) => `- [${s.title}](${url}/blob/HEAD/README.md#${s.anchor})`),
		files.has('AGENTS.md') ? `- [AGENTS.md](${url}/blob/HEAD/AGENTS.md): guidance for coding agents` : null,
		files.has('llms-full.txt') ? `- [Full text for LLMs](${url}/blob/HEAD/llms-full.txt): the README inlined` : null,
	].filter(Boolean);
	return `# ${name}

> ${oneLine(description) || name}

${name} is an open-source repository by ${OWNER}, part of the three.ws ecosystem.

## Docs

${docs.join('\n')}

## Project

- [Source](${url})
- [Issues](${url}/issues)
- [Discussions](${url}/discussions)
${homepage ? `- [Homepage](${homepage})\n` : ''}- [three.ws](${SITE}): the platform this is part of
- [All repositories by ${OWNER}](${CATALOG})
`;
}

export function llmsFullTxt({ name, description, readme }) {
	return `# ${name}\n\n> ${oneLine(description) || name}\n\n${plain(stripGrowthBlock(readme)).trim()}\n`;
}

export function contributingMd({ name, toolchain, license }) {
	const url = `https://github.com/${OWNER}/${name}`;
	const setup = [toolchain.install, toolchain.test].filter(Boolean);
	return `# Contributing to ${name}

Thanks for helping. Small, focused changes land fastest.

## Ways to contribute

- **Report a bug** with the [bug form](${url}/issues/new?template=bug.yml). Include what you ran, what you expected and the smallest reproduction you can.
- **Propose a feature** with the [feature form](${url}/issues/new?template=feature.yml). Describe the problem first, then the change.
- **Ask a question or share what you built** in [Discussions](${url}/discussions).
- **Fix something** with a pull request.

## Local setup

\`\`\`bash
git clone ${url}.git
cd ${name}
${setup.length ? setup.join('\n') : '# follow the setup steps in README.md'}
\`\`\`

## Pull requests

- One change per pull request, with a test where the change is testable.
- Describe what changed and why in plain language.
- Do not add dependencies for something a few lines of code can do.
- Security-sensitive reports go through [SECURITY.md](SECURITY.md), not a public issue.

${license ? `By contributing you agree that your work is licensed under ${license}, the license of this project.` : 'By contributing you agree that your work is licensed under the terms in this repository\'s LICENSE file.'}
`;
}

export function securityMd({ name }) {
	return `# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

Use GitHub's private reporting: https://github.com/${OWNER}/${name}/security/advisories/new

You will get an acknowledgement within 3 business days and a status update within 10. Fixes ship in the next release with credit to the reporter unless you prefer otherwise.

## Scope

In scope: this repository's code and its documented configuration. Out of scope: third-party services it talks to, and findings that need a compromised machine or a leaked key.

## Supported versions

The latest release (or the default branch when there are no releases) receives fixes.
`;
}

export function codeOfConductMd() {
	return `# Code of Conduct

This project follows the [Contributor Covenant, version 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

In short: be respectful, assume good faith, keep feedback about the work, and do not harass anyone. Maintainers may remove comments, commits or contributions that break these rules and may block repeat offenders.

Report conduct concerns privately to ${SUPPORT_EMAIL}. Reports are handled in confidence.
`;
}

export function citationCff({ name, description, license }) {
	const q = (s) => `"${oneLine(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	return `cff-version: 1.2.0
message: If you use this software, please cite it as below.
title: ${q(name)}
abstract: ${q(description || name)}
${license ? `license: ${license}\n` : ''}repository-code: "https://github.com/${OWNER}/${name}"
url: "${SITE}"
authors:
  - name: three.ws
    website: "${SITE}"
`;
}

export function fundingYml() {
	return `# Adds a Sponsor button to the repo. Links to the product, not to any token.
custom:
  - ${SITE}
`;
}

export function bugForm({ name }) {
	return `name: Bug report
description: Something does not work as documented
labels: [bug]
body:
  - type: input
    id: version
    attributes:
      label: ${name} version or commit
      placeholder: v1.0.0 or a commit SHA
    validations:
      required: true
  - type: input
    id: env
    attributes:
      label: Runtime and OS
      placeholder: Node 22, macOS 15
  - type: textarea
    id: what
    attributes:
      label: What happened, and what did you expect?
    validations:
      required: true
  - type: textarea
    id: repro
    attributes:
      label: Smallest reproduction
      render: shell
`;
}

export function featureForm() {
	return `name: Feature request
description: Suggest a change or addition
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem are you trying to solve?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: What would you like to see?
`;
}

export function issueConfig({ name }) {
	return `blank_issues_enabled: false
contact_links:
  - name: Ask a question or share what you built
    url: https://github.com/${OWNER}/${name}/discussions
    about: Open-ended questions belong in Discussions.
  - name: three.ws platform support
    url: ${SITE}
    about: Questions about the hosted platform rather than this repository.
  - name: Security report
    url: https://github.com/${OWNER}/${name}/security/advisories/new
    about: Report a vulnerability privately.
`;
}

export function prTemplate() {
	return `## What changed and why

## How it was checked

- [ ] Tests pass locally (or the change is documentation only)
- [ ] Docs updated where behavior changed
`;
}

/**
 * The files to add, as {path: content}, given what the repo already has.
 * Existing files are never replaced. `files` is the root-relative path set.
 */
export function missingFiles(ctx) {
	const { name, description, files, readme, homepage, pkg, license, language } = ctx;
	const has = (re) => [...files].some((p) => re.test(p));
	const toolchain = detectToolchain(files, pkg);
	const out = {};
	const base = { name, description, language, toolchain, license, homepage, readme };
	if (!has(/^readme/i)) return out;
	if (!has(/^llms-full\.txt$/i)) out['llms-full.txt'] = llmsFullTxt(base);
	const withFull = new Set([...files, ...(out['llms-full.txt'] ? ['llms-full.txt'] : [])]);
	if (!has(/^agents\.md$/i)) out['AGENTS.md'] = agentsMd(base);
	const withAgents = new Set([...withFull, 'AGENTS.md']);
	if (!has(/^llms\.txt$/i)) out['llms.txt'] = llmsTxt({ ...base, files: withAgents });
	if (!has(/^claude\.md$/i)) out['CLAUDE.md'] = claudeMd();
	if (!has(/^(\.github\/)?contributing/i)) out['CONTRIBUTING.md'] = contributingMd(base);
	if (!has(/^(\.github\/)?security\.md$/i)) out['SECURITY.md'] = securityMd(base);
	if (!has(/^(\.github\/)?code_of_conduct/i)) out['CODE_OF_CONDUCT.md'] = codeOfConductMd();
	if (!has(/^citation\.cff$/i)) out['CITATION.cff'] = citationCff(base);
	if (!has(/^\.github\/funding\.yml$/i)) out['.github/FUNDING.yml'] = fundingYml();
	if (!has(/^\.github\/issue_template/i)) {
		out['.github/ISSUE_TEMPLATE/bug.yml'] = bugForm(base);
		out['.github/ISSUE_TEMPLATE/feature.yml'] = featureForm();
		out['.github/ISSUE_TEMPLATE/config.yml'] = issueConfig(base);
	}
	if (!has(/pull_request_template/i)) out['.github/PULL_REQUEST_TEMPLATE.md'] = prTemplate();
	return out;
}
