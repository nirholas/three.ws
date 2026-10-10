#!/usr/bin/env node
// Turns packages from this monorepo into complete, standalone GitHub repositories:
// community files, agent-discovery files (AGENTS.md, llms.txt), a static docs site
// for GitHub Pages, and optionally the repository itself (created, pushed, topics set).
//
//   node scripts/export-standalone-repos.mjs                      build trees under dist/standalone-repos
//   node scripts/export-standalone-repos.mjs --target glb-tools   one repo
//   node scripts/export-standalone-repos.mjs --publish            also create/push/configure on GitHub
//
// The monorepo stays the source of truth. A repository that does not exist yet
// is created from the regenerated tree. A repository that already has history is
// never force-pushed: the export is cloned, the generated discovery files are
// added on top as one ordinary commit (existing files such as the README are
// kept), and the push must fast-forward. Config is
// data/standalone-repos.json. --publish reads the token from GITHUB_TOKEN or the
// file named by GITHUB_TOKEN_FILE; the token is passed per command and never
// written to a remote URL or git config.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import sharp from 'sharp';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => (argv.indexOf(name) === -1 ? null : argv[argv.indexOf(name) + 1]);
const OUT = resolve(value('--out') || join(REPO, 'dist', 'standalone-repos'));
const config = JSON.parse(readFileSync(join(REPO, 'data', 'standalone-repos.json'), 'utf8'));
const API = 'https://api.github.com';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const topicOk = (t) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(t);

function meta(target) {
	const pkg = JSON.parse(readFileSync(join(REPO, target.source, 'package.json'), 'utf8'));
	const slug = `${config.owner}/${target.repo}`;
	return {
		pkg,
		slug,
		repoUrl: `https://github.com/${slug}`,
		pagesUrl: `https://${config.owner}.github.io/${target.repo}/`,
		topics: [...new Set([...target.topics, ...config.baseTopics, ...(Object.keys(pkg.dependencies || {}).length ? [] : ['zero-dependencies']), ...(pkg.keywords || []).map((k) => String(k).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))])].filter(topicOk).slice(0, 20),
	};
}

// A README written for the monorepo links to ../../api/x.js. Those links must
// resolve once the package lives alone, so anything outside the package becomes
// an absolute link into the monorepo.
function rewriteLinks(markdown, target) {
	return markdown.replace(/\]\((?!https?:|mailto:|#|\/\/)([^)\s]+)\)/g, (whole, href) => {
		const [path, hash] = href.split('#');
		const joined = posix.normalize(posix.join(target.source, path));
		if (!joined.startsWith('..') && joined.startsWith(`${target.source}/`)) return whole;
		if (joined.startsWith('..')) return whole;
		return `](${config.monorepo}/blob/main/${joined}${hash ? `#${hash}` : ''})`;
	});
}

// The house style bans em and en dashes in anything we publish.
const plainDashes = (text) => text.replace(/\s*[\u2013\u2014]\s*/g, ' - ');

function badges(m, target) {
	const npm = encodeURIComponent(m.pkg.name);
	return [
		`[![npm](https://img.shields.io/npm/v/${npm}?color=cb3837&logo=npm)](https://www.npmjs.com/package/${m.pkg.name})`,
		`[![license](https://img.shields.io/badge/license-${encodeURIComponent(m.pkg.license || 'Apache-2.0').replace(/-/g, '--')}-blue)](LICENSE)`,
		`[![node](https://img.shields.io/node/v/${npm}?color=339933&logo=node.js)](package.json)`,
		`[![zero deps](https://img.shields.io/badge/runtime%20deps-${Object.keys(m.pkg.dependencies || {}).length}-brightgreen)](package.json)`,
		`[![docs](https://img.shields.io/badge/docs-site-7c3aed)](${m.pagesUrl})`,
		`[![part of three.ws](https://img.shields.io/badge/part%20of-three.ws-111)](${config.site})`,
	].join('\n');
}

function readme(m, target) {
	let md = plainDashes(rewriteLinks(readFileSync(join(REPO, target.source, 'README.md'), 'utf8'), target));
	if (!md.includes('img.shields.io')) md = md.replace(/^(# .+\n)/, `$1\n${badges(m, target)}\n`);
	const footer = [
		'',
		'---',
		'',
		`Part of [three.ws](${config.site}), the open-source platform for 3D AI agents. This repository is exported from the [monorepo](${config.monorepo}/tree/main/${target.source}), which is the source of truth: open issues here, and send larger changes there.`,
		'',
	].join('\n');
	return md.trimEnd() + '\n' + footer;
}

function agentsMd(m, target) {
	return `# AGENTS.md

Instructions for AI coding agents working in or with \`${m.pkg.name}\`.

## What this is

${m.pkg.description}

## Use it

\`\`\`bash
npm install ${m.pkg.name}
\`\`\`

Full API reference: [README.md](README.md). Machine-readable summary: [llms.txt](llms.txt). Full text: [llms-full.txt](llms-full.txt).

## Work on it

- Node 20 or newer, ESM only.
- Run the tests with \`npm test\` before proposing a change.
- Keep runtime dependencies at their current count. Prefer a well-maintained library over new hand-rolled code, and say why in the pull request.
- No mocks, placeholders or TODO comments in committed code.
- Do not use em-dashes or en-dashes in code, comments or docs.

## Source of truth

This repository is exported from ${config.monorepo}/tree/main/${target.source}. Bug reports belong here; larger changes should be proposed against the monorepo path.
`;
}

function llmsTxt(m, target) {
	return `# ${m.pkg.name}

> ${m.pkg.description}

- Repository: ${m.repoUrl}
- Documentation: ${m.pagesUrl}
- npm: https://www.npmjs.com/package/${m.pkg.name}
- License: ${m.pkg.license || 'Apache-2.0'}
- Part of three.ws: ${config.site}

## Docs

- [README](${m.repoUrl}/blob/main/README.md): install, usage and full API reference
- [Full text for LLMs](${m.pagesUrl}llms-full.txt): the entire README as plain text
- [AGENTS.md](${m.repoUrl}/blob/main/AGENTS.md): conventions for coding agents
- [Security policy](${m.repoUrl}/blob/main/SECURITY.md)
- [Contributing](${m.repoUrl}/blob/main/CONTRIBUTING.md)
`;
}

const SECURITY = (m) => `# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private report form:
${m.repoUrl}/security/advisories/new

Include the affected version, a minimal reproduction and the impact you expect. You will get an acknowledgement within three business days and a fix or mitigation plan within fourteen.

## Supported versions

The latest published minor version of \`${m.pkg.name}\` receives fixes.
`;

const CONTRIBUTING = (m, target) => `# Contributing to ${m.pkg.name}

Thanks for helping. Small, focused pull requests are merged fastest.

1. Fork and clone the repository, then \`npm install\`.
2. Make the change and add or update a test next to it.
3. Run \`npm test\`. It must pass.
4. Open a pull request that says what changed and why.

Larger features are developed in the monorepo at ${config.monorepo}/tree/main/${target.source}. Open an issue here first so the change can be placed in the right tree.

Look for issues labelled \`good first issue\` if you want a place to start.
`;

const CONDUCT = `# Code of conduct

We follow the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Be kind, assume good intent, and keep discussion about the work. Report conduct concerns privately through the maintainers' GitHub profile contact.
`;

const BUG = `name: Bug report
description: Something does not work as documented
labels: [bug]
body:
  - type: input
    attributes: { label: Version, description: Output of npm ls for this package }
    validations: { required: true }
  - type: textarea
    attributes: { label: What happened, description: What you did, what you expected, what you saw }
    validations: { required: true }
  - type: textarea
    attributes: { label: Minimal reproduction, render: js }
`;

const FEATURE = `name: Feature request
description: Suggest a capability
labels: [enhancement]
body:
  - type: textarea
    attributes: { label: The problem, description: What are you trying to do that you cannot today? }
    validations: { required: true }
  - type: textarea
    attributes: { label: Proposed API or behaviour }
`;

const PR = `## What changed and why

## Checklist

- [ ] \`npm test\` passes
- [ ] Tests added or updated
- [ ] README updated if the public API changed
`;

const citation = (m) => `cff-version: 1.2.0
message: If you use this software, please cite it as below.
title: "${m.pkg.name}"
abstract: "${String(m.pkg.description).replace(/"/g, "'")}"
type: software
authors:
  - name: three.ws contributors
repository-code: "${m.repoUrl}"
url: "${m.pagesUrl}"
license: ${m.pkg.license || 'Apache-2.0'}
version: ${m.pkg.version}
`;

async function ogImage(m, target, dest) {
	const title = esc(m.pkg.name);
	const words = String(m.pkg.description).split(' ');
	const lines = [];
	for (const w of words) {
		const last = lines[lines.length - 1];
		if (last !== undefined && (last + ' ' + w).length <= 52) lines[lines.length - 1] = last + ' ' + w;
		else lines.push(w);
	}
	const body = lines.slice(0, 3).map((l, i) => `<text x="80" y="${330 + i * 54}" font-size="38" fill="#cbd5e1" font-family="Helvetica, Arial, sans-serif">${esc(l)}</text>`).join('');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient></defs><rect width="1280" height="640" fill="url(#g)"/><rect x="80" y="90" width="64" height="8" rx="4" fill="#8b5cf6"/><text x="80" y="220" font-size="72" font-weight="700" fill="#fff" font-family="Helvetica, Arial, sans-serif">${title}</text>${body}<text x="80" y="570" font-size="30" fill="#a78bfa" font-family="Helvetica, Arial, sans-serif">open source  |  Apache-2.0  |  three.ws</text></svg>`;
	await sharp(Buffer.from(svg)).png().toFile(dest);
}

function siteHtml(m, target, bodyHtml) {
	const title = `${m.pkg.name}: ${String(m.pkg.description).split('.')[0]}`.slice(0, 110);
	const ld = {
		'@context': 'https://schema.org',
		'@type': 'SoftwareSourceCode',
		name: m.pkg.name,
		description: m.pkg.description,
		codeRepository: m.repoUrl,
		url: m.pagesUrl,
		programmingLanguage: 'JavaScript',
		license: `https://spdx.org/licenses/${m.pkg.license || 'Apache-2.0'}`,
		version: m.pkg.version,
		runtimePlatform: 'Node.js',
		isPartOf: { '@type': 'WebSite', name: 'three.ws', url: config.site },
	};
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(m.pkg.description)}">
<link rel="canonical" href="${m.pagesUrl}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(m.pkg.name)}">
<meta property="og:description" content="${esc(m.pkg.description)}">
<meta property="og:url" content="${m.pagesUrl}">
<meta property="og:image" content="${m.pagesUrl}og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="text/plain" href="${m.pagesUrl}llms.txt" title="llms.txt">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{--bg:#fff;--fg:#0f172a;--mut:#475569;--line:#e2e8f0;--code:#f1f5f9;--acc:#6d28d9}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--fg:#e2e8f0;--mut:#94a3b8;--line:#1e293b;--code:#111a33;--acc:#a78bfa}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}
header{border-bottom:1px solid var(--line)}.bar{max-width:880px;margin:0 auto;padding:14px 20px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.bar a{color:var(--mut);text-decoration:none;font-size:14px}.bar a:hover,.bar a:focus-visible{color:var(--acc)}.bar b{color:var(--fg);margin-right:auto}
main{max-width:880px;margin:0 auto;padding:28px 20px 80px}h1,h2,h3{line-height:1.25}h2{margin-top:2.2em;padding-bottom:.3em;border-bottom:1px solid var(--line)}
a{color:var(--acc)}pre{background:var(--code);padding:14px 16px;border-radius:8px;overflow:auto}code{background:var(--code);padding:.1em .35em;border-radius:4px;font-size:.92em}pre code{padding:0;background:none}
table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left}img{max-width:100%}
</style>
</head>
<body>
<header><nav class="bar" aria-label="Project"><b>${esc(m.pkg.name)}</b><a href="${m.repoUrl}">GitHub</a><a href="https://www.npmjs.com/package/${esc(m.pkg.name)}">npm</a><a href="llms.txt">llms.txt</a><a href="${config.site}">three.ws</a></nav></header>
<main>
${bodyHtml}
</main>
</body>
</html>
`;
}

async function buildTree(target) {
	const m = meta(target);
	const dest = join(OUT, target.repo);
	rmSync(dest, { recursive: true, force: true });
	cpSync(join(REPO, target.source), dest, { recursive: true, filter: (p) => !['node_modules', '.git'].includes(p.split('/').at(-1)) });
	for (const legal of ['LICENSE', 'NOTICE']) {
		if (!existsSync(join(dest, legal)) && existsSync(join(REPO, legal))) cpSync(join(REPO, legal), join(dest, legal));
	}

	const pkgPath = join(dest, 'package.json');
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
	pkg.repository = { type: 'git', url: `git+${m.repoUrl}.git` };
	pkg.homepage = m.pagesUrl;
	pkg.bugs = { url: `${m.repoUrl}/issues` };
	pkg.keywords = [...new Set([...(pkg.keywords || []), ...m.topics])];
	pkg.files = [...new Set([...(pkg.files || []), 'README.md', 'LICENSE'])];
	writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
	m.pkg = pkg;

	const md = readme(m, target);
	writeFileSync(join(dest, 'README.md'), md);
	writeFileSync(join(dest, 'AGENTS.md'), agentsMd(m, target));
	writeFileSync(join(dest, 'llms.txt'), llmsTxt(m, target));
	writeFileSync(join(dest, 'llms-full.txt'), md.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'));
	writeFileSync(join(dest, 'SECURITY.md'), SECURITY(m));
	writeFileSync(join(dest, 'CONTRIBUTING.md'), CONTRIBUTING(m, target));
	writeFileSync(join(dest, 'CODE_OF_CONDUCT.md'), CONDUCT);
	writeFileSync(join(dest, 'CITATION.cff'), citation(m));
	if (!existsSync(join(dest, '.gitignore'))) writeFileSync(join(dest, '.gitignore'), 'node_modules\n.env\n.env.*\n*.log\ndist\n.DS_Store\n');
	mkdirSync(join(dest, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
	writeFileSync(join(dest, '.github', 'ISSUE_TEMPLATE', 'bug_report.yml'), BUG);
	writeFileSync(join(dest, '.github', 'ISSUE_TEMPLATE', 'feature_request.yml'), FEATURE);
	writeFileSync(join(dest, '.github', 'ISSUE_TEMPLATE', 'config.yml'), `blank_issues_enabled: false\ncontact_links:\n  - name: three.ws documentation\n    url: ${config.site}/docs\n    about: Platform-level questions\n`);
	writeFileSync(join(dest, '.github', 'PULL_REQUEST_TEMPLATE.md'), PR);

	const docs = join(dest, 'docs');
	mkdirSync(docs, { recursive: true });
	const body = marked.parse(md.replace(/^# .+\n/, (h) => h), { gfm: true });
	writeFileSync(join(docs, 'index.html'), siteHtml(m, target, body));
	writeFileSync(join(docs, '.nojekyll'), '');
	writeFileSync(join(docs, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${m.pagesUrl}sitemap.xml\n`);
	writeFileSync(join(docs, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${m.pagesUrl}</loc><changefreq>weekly</changefreq></url></urlset>\n`);
	cpSync(join(dest, 'llms.txt'), join(docs, 'llms.txt'));
	cpSync(join(dest, 'llms-full.txt'), join(docs, 'llms-full.txt'));
	await ogImage(m, target, join(docs, 'og.png'));

	return { m, dest };
}

function verify(target, dest) {
	const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'));
	if (Object.keys(pkg.dependencies || {}).length) execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dest, stdio: 'inherit' });
	if (pkg.scripts?.test) execFileSync('npm', ['test'], { cwd: dest, stdio: 'inherit' });
	rmSync(join(dest, 'node_modules'), { recursive: true, force: true });
	rmSync(join(dest, 'package-lock.json'), { force: true });
}

function token() {
	const t = process.env.GITHUB_TOKEN || (process.env.GITHUB_TOKEN_FILE && readFileSync(process.env.GITHUB_TOKEN_FILE, 'utf8').trim());
	if (!t) throw new Error('--publish needs GITHUB_TOKEN or GITHUB_TOKEN_FILE');
	return t;
}

async function gh(method, path, body, tok) {
	const r = await fetch(`${API}${path}`, {
		method,
		headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await r.text();
	return { status: r.status, json: text ? JSON.parse(text) : null };
}

async function publish(target, m, dest, tok) {
	const exists = await gh('GET', `/repos/${m.slug}`, null, tok);
	if (exists.status === 404) {
		const made = await gh('POST', '/user/repos', { name: target.repo, description: String(m.pkg.description).slice(0, 350), homepage: m.pagesUrl, has_issues: true, has_projects: false, has_wiki: false, has_discussions: true, auto_init: false }, tok);
		if (made.status !== 201) throw new Error(`create ${m.slug} failed: ${made.status} ${made.json?.message}`);
	} else if (exists.status !== 200) throw new Error(`lookup ${m.slug} failed: ${exists.status}`);

	const auth = `Authorization: Basic ${Buffer.from(`x-access-token:${tok}`).toString('base64')}`;
	const identity = ['-c', 'user.name=three.ws release builder', '-c', 'user.email=support@three.ws'];
	const hasHistory = exists.status === 200 && (await gh('GET', `/repos/${m.slug}/commits?per_page=1`, null, tok)).status === 200;
	let mode = 'created';
	if (!hasHistory) {
		const git = (args) => execFileSync('git', args, { cwd: dest, stdio: 'pipe' }).toString();
		rmSync(join(dest, '.git'), { recursive: true, force: true });
		git(['init', '-b', 'main']);
		git(['add', '--all']);
		git([...identity, 'commit', '-m', `feat: publish ${m.pkg.name} ${m.pkg.version} as a standalone repository with docs site and agent discovery files`]);
		git(['remote', 'add', 'origin', `${m.repoUrl}.git`]);
		git(['-c', `http.extraheader=${auth}`, 'push', '-u', 'origin', 'main']);
	} else {
		const work = mkdtempSync(join(tmpdir(), 'standalone-'));
		try {
			const git = (args) => execFileSync('git', args, { cwd: work, stdio: 'pipe' }).toString();
			execFileSync('git', ['-c', `http.extraheader=${auth}`, 'clone', '--depth', '1', `${m.repoUrl}.git`, work], { stdio: 'pipe' });
			// Add-only: files the repository already has (README, AGENTS.md, src) are kept.
			// The docs site is regenerated whole because it is a build product.
			rmSync(join(work, 'docs', 'index.html'), { force: true });
			cpSync(dest, work, { recursive: true, force: false, errorOnExist: false, filter: (p) => !p.endsWith('/.git') });
			for (const f of readdirSync(join(dest, 'docs'))) cpSync(join(dest, 'docs', f), join(work, 'docs', f), { recursive: true, force: true });
			git(['add', '--all']);
			if (git(['status', '--porcelain']).trim()) {
				git([...identity, 'commit', '-m', `docs: add docs site, llms.txt, security policy, citation and issue templates for ${m.pkg.name} discovery`]);
				git(['-c', `http.extraheader=${auth}`, 'push', 'origin', 'HEAD']);
				mode = 'overlay';
			} else mode = 'unchanged';
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	}

	await gh('PATCH', `/repos/${m.slug}`, { description: String(m.pkg.description).slice(0, 350), homepage: m.pagesUrl, has_discussions: true }, tok);
	const topics = await gh('PUT', `/repos/${m.slug}/topics`, { names: m.topics }, tok);
	const pages = await gh('POST', `/repos/${m.slug}/pages`, { source: { branch: 'main', path: '/docs' } }, tok);
	for (const [name, color, description] of [['good first issue', '7057ff', 'Good for newcomers'], ['help wanted', '008672', 'Extra attention is needed']]) {
		await gh('POST', `/repos/${m.slug}/labels`, { name, color, description }, tok);
	}
	return { mode, topics: topics.status, pages: pages.status === 409 ? 'already enabled' : pages.status };
}

function topicsFor(pkg, dir) {
	const t = new Set();
	const text = `${pkg.name} ${pkg.description || ''}`.toLowerCase();
	if (pkg.mcpName || /mcp/.test(pkg.name)) ['mcp', 'mcp-server', 'model-context-protocol', 'claude'].forEach((x) => t.add(x));
	if (pkg.bin) t.add('cli');
	if (/solana/.test(text)) t.add('solana');
	if (/x402/.test(text)) ['x402', 'payments'].forEach((x) => t.add(x));
	if (/glb|gltf|3d|avatar|three\.js|webgl|mesh/.test(text)) ['3d', 'gltf', 'webgl'].forEach((x) => t.add(x));
	if (/agent/.test(text)) ['ai-agents', 'llm-tools'].forEach((x) => t.add(x));
	return [...t].filter(topicOk);
}

function autoTargets() {
	const auto = config.auto;
	if (!auto) return [];
	const listed = new Set(config.targets.map((t) => t.source));
	const out = [];
	for (const root of auto.roots) {
		const dirs = root.endsWith('/*') ? readdirSync(join(REPO, root.slice(0, -2))).map((d) => `${root.slice(0, -2)}/${d}`) : [root];
		for (const source of dirs) {
			const pj = join(REPO, source, 'package.json');
			if (!existsSync(pj) || listed.has(source)) continue;
			const pkg = JSON.parse(readFileSync(pj, 'utf8'));
			if (pkg.private || !existsSync(join(REPO, source, 'README.md'))) continue;
			const dir = source.split('/').pop();
			const repo = auto.rename?.[source] || (dir.includes('-') ? dir : `three-ws-${dir}`);
			const hold = auto.hold?.[source];
			out.push({ repo, source, topics: topicsFor(pkg, dir), ...(hold ? { hold } : {}) });
		}
	}
	return out;
}

config.targets = [...config.targets, ...autoTargets()];

const targets = config.targets.filter((t) => (value('--target') ? t.repo === value('--target') : !t.hold));
if (!targets.length) throw new Error(`unknown target: ${value('--target')}`);
mkdirSync(OUT, { recursive: true });
const tok = flag('--publish') ? token() : null;
const report = [];
for (const target of targets) {
	try {
		const { m, dest } = await buildTree(target);
		if (!flag('--skip-tests')) verify(target, dest);
		const row = { repo: m.slug, version: m.pkg.version, topics: m.topics.length, files: readdirSync(dest).length, site: m.pagesUrl };
		if (tok) Object.assign(row, await publish(target, m, dest, tok));
		report.push(row);
	} catch (err) {
		const secrets = tok ? [tok, Buffer.from(`x-access-token:${tok}`).toString('base64')] : [];
		const detail = [String(err.message).split('\n')[0], err.stderr ? String(err.stderr).trim().split('\n').pop() : ''].filter(Boolean).join(' | ');
		report.push({ repo: `${config.owner}/${target.repo}`, error: secrets.reduce((text, secret) => text.split(secret).join('***'), detail).slice(0, 300) });
	}
}
console.table(report);
if (report.some((r) => r.error)) process.exitCode = 1;
