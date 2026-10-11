// Discovery layer for the standalone package mirrors (scripts/sync-standalone-repos.mjs).
//
// A bare snapshot of a package dir is a repo nobody finds. This module adds what
// makes a repo findable and trustworthy to both humans and agents, entirely from
// facts already in the package (package.json, server.json, README.md):
//
//   - community health files (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CITATION.cff,
//     issue + PR templates)
//   - agent discovery files (AGENTS.md, llms.txt, llms-full.txt, glama.json)
//   - a static docs site under docs/ (the README rendered, with OG/Twitter tags,
//     JSON-LD, sitemap.xml, robots.txt, 404.html) served by GitHub Pages from main:/docs
//   - repository settings applied over the API (topics, description, homepage, Pages)
//
// Every file is generated, never hand-edited in the mirror. A file the package
// already ships is kept, so a package can override any of them in the monorepo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { marked } from 'marked';

const OWNER_HANDLE = 'nirholas';
const SITE = 'https://three.ws';

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function put(dir, rel, body, { overwrite = false } = {}) {
	const path = join(dir, rel);
	if (!overwrite && existsSync(path)) return false;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, body.endsWith('\n') ? body : body + '\n');
	return true;
}

export function pagesUrl(slug) {
	const [owner, repo] = slug.split('/');
	return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}

/** GitHub topics: lowercase, [a-z0-9-], <=50 chars, <=20 total, most specific first. */
export function topicsFor(pkg, kind) {
	const base = kind === 'mcp'
		? ['mcp', 'model-context-protocol', 'mcp-server', 'ai-agents']
		: ['ai-agents', 'sdk'];
	const raw = [...(pkg.keywords || []), ...base, 'three-ws', 'threejs', 'nodejs'];
	const out = [];
	for (const k of raw) {
		const t = String(k).toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
		if (t && !/^\d+$/.test(t) && !out.includes(t)) out.push(t);
	}
	return out.slice(0, 20);
}

function installCommand(pkg) {
	return pkg.bin ? `npx -y ${pkg.name}` : `npm install ${pkg.name}`;
}

function agentsMd(pkg, slug, kind) {
	const scripts = Object.entries(pkg.scripts || {}).map(([k, v]) => `- \`npm run ${k}\`: \`${v}\``).join('\n');
	const what = kind === 'mcp'
		? 'A Model Context Protocol server. Run it over stdio from any MCP client.'
		: 'A JavaScript library. Import it from ESM.';
	return `# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

\`${pkg.name}\` v${pkg.version}. ${pkg.description || ''}

${what}

## Use it

\`\`\`bash
${installCommand(pkg)}
\`\`\`

Full usage, tool list and configuration are in [README.md](README.md). Machine-readable summaries: [llms.txt](llms.txt) and [llms-full.txt](llms-full.txt).

## Develop

\`\`\`bash
npm install
${pkg.scripts?.test ? 'npm test' : 'node --check src/index.js'}
\`\`\`

${scripts ? `Scripts:\n${scripts}\n` : ''}
## Conventions

- ES modules, Node ${pkg.engines?.node || '>=20'}.
- Read-only by default. Anything that signs, spends or sends must be an explicit, separately named tool or option, and must never be inferred from untrusted text (token names, memos, listings).
- Never commit credentials. Configuration comes from environment variables documented in the README.
- Keep changes small and covered by a test next to the code they change.

## Source of truth

This repository is a generated mirror of \`${pkg.repository?.directory || 'packages'}\` in https://github.com/${OWNER_HANDLE}/three.ws. Open issues here; send substantial changes as a pull request here or upstream.
`;
}

function llmsTxt(pkg, slug, kind, site) {
	return `# ${pkg.name}

> ${pkg.description || pkg.name}

${pkg.name} is ${kind === 'mcp' ? 'a Model Context Protocol server' : 'a JavaScript library'} from three.ws. Install: \`${installCommand(pkg)}\`.

## Docs

- [README](https://github.com/${slug}/blob/main/README.md): install, configuration, full reference
- [Documentation site](${site}): the README as a web page
- [Full text for LLMs](${site}llms-full.txt): README inlined
- [AGENTS.md](https://github.com/${slug}/blob/main/AGENTS.md): guidance for coding agents

## Project

- [Source](https://github.com/${slug})
- [npm](https://www.npmjs.com/package/${pkg.name})
- [three.ws](${SITE}): the platform this is part of
- [Issues](https://github.com/${slug}/issues)
${kind === 'mcp' ? `- [MCP Registry](https://registry.modelcontextprotocol.io/?q=${encodeURIComponent(pkg.mcpName || pkg.name)})\n` : ''}`;
}

function contributing(pkg, slug) {
	return `# Contributing to ${pkg.name}

Thanks for helping. Small, focused changes land fastest.

## Ways to contribute

- **Report a bug** with the [bug form](https://github.com/${slug}/issues/new?template=bug.yml). Include the version, your Node version and the smallest reproduction you can.
- **Propose a feature** with the [feature form](https://github.com/${slug}/issues/new?template=feature.yml). Describe the problem first, then the change.
- **Fix something** with a pull request. Run the tests before you open it.

## Local setup

\`\`\`bash
git clone https://github.com/${slug}.git
cd ${slug.split('/')[1]}
npm install
${pkg.scripts?.test ? 'npm test' : 'node --check src/index.js'}
\`\`\`

## Pull requests

- One change per pull request, with a test where the change is testable.
- Describe what changed and why in plain language.
- Do not add dependencies for something a few lines of code can do.
- Security-sensitive reports go through [SECURITY.md](SECURITY.md), not a public issue.

By contributing you agree that your work is licensed under ${pkg.license || 'Apache-2.0'}, the license of this project.
`;
}

function security(pkg, slug) {
	return `# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

Use GitHub's private reporting: https://github.com/${slug}/security/advisories/new

You will get an acknowledgement within 3 business days and a status update within 10. Fixes ship as a patch release of \`${pkg.name}\` with credit to the reporter unless you prefer otherwise.

## Scope

In scope: this package's code, its published npm artifact, and its documented configuration. Out of scope: third-party services it talks to, and findings that need a compromised machine or a leaked key.

## Supported versions

The latest published minor version of \`${pkg.name}\` receives fixes.
`;
}

function codeOfConduct() {
	return `# Code of Conduct

This project follows the [Contributor Covenant, version 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

In short: be respectful, assume good faith, keep feedback about the work, and do not harass anyone. Maintainers may remove comments, commits or contributions that break these rules and may block repeat offenders.

Report conduct concerns privately to support@three.ws. Reports are handled in confidence.
`;
}

function citation(pkg, slug) {
	return `cff-version: 1.2.0
message: If you use this software, please cite it as below.
title: "${String(pkg.name).replace(/"/g, '')}"
abstract: "${String(pkg.description || '').replace(/"/g, "'").replace(/\n/g, ' ')}"
version: ${pkg.version}
license: ${pkg.license || 'Apache-2.0'}
repository-code: "https://github.com/${slug}"
url: "${SITE}"
authors:
  - name: three.ws
    website: "${SITE}"
`;
}

const BUG_FORM = (pkg) => `name: Bug report
description: Something does not work as documented
labels: [bug]
body:
  - type: input
    id: version
    attributes:
      label: ${pkg.name} version
      placeholder: ${pkg.version}
    validations:
      required: true
  - type: input
    id: node
    attributes:
      label: Node version and OS
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

const FEATURE_FORM = `name: Feature request
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

const ISSUE_CONFIG = (slug) => `blank_issues_enabled: false
contact_links:
  - name: three.ws platform support
    url: ${SITE}
    about: Questions about the hosted platform rather than this package.
  - name: Security report
    url: https://github.com/${slug}/security/advisories/new
    about: Report a vulnerability privately.
`;

const PR_TEMPLATE = `## What changed and why

## How it was checked

- [ ] Tests pass locally
- [ ] Docs updated where behavior changed
`;

/** Rewrite README-relative links so they resolve on the docs site. */
function absolutizeLinks(md, slug) {
	const blob = `https://github.com/${slug}/blob/main/`;
	const raw = `https://raw.githubusercontent.com/${slug}/main/`;
	return md
		.replace(/(!\[[^\]]*\]\()(?!https?:|#|\/\/|data:)\.?\/?([^)\s]+)/g, `$1${raw}$2`)
		.replace(/(\[[^\]]*\]\()(?!https?:|#|\/\/|mailto:|data:)\.?\/?([^)\s]+)/g, `$1${blob}$2`)
		.replace(/(src=")(?!https?:|\/\/|data:)\.?\/?([^"]+)/g, `$1${raw}$2`)
		.replace(/(href=")(?!https?:|#|\/\/|mailto:)\.?\/?([^"]+)/g, `$1${blob}$2`);
}

function slugify(text) {
	return text.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

function renderBody(md, slug) {
	let html = marked.parse(absolutizeLinks(md, slug), { gfm: true });
	const seen = new Set();
	html = html.replace(/<h([2-4])>([\s\S]*?)<\/h\1>/g, (_, lvl, inner) => {
		let id = slugify(inner) || 'section';
		for (let n = 2; seen.has(id); n++) id = `${slugify(inner)}-${n}`;
		seen.add(id);
		return `<h${lvl} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${inner}</h${lvl}>`;
	});
	return html;
}

function tocFrom(html) {
	const items = [...html.matchAll(/<h2 id="([^"]+)">[\s\S]*?<\/a>([\s\S]*?)<\/h2>/g)];
	if (items.length < 3) return '';
	return `<nav class="toc" aria-label="On this page"><p>On this page</p><ul>${items
		.map(([, id, label]) => `<li><a href="#${id}">${label.replace(/<[^>]+>/g, '')}</a></li>`)
		.join('')}</ul></nav>`;
}

const SITE_CSS = `:root{--bg:#fff;--fg:#111418;--mut:#586069;--line:#e3e6ea;--acc:#2563eb;--code:#f4f6f8;--card:#fafbfc}
@media(prefers-color-scheme:dark){:root{--bg:#0b0d10;--fg:#e8eaed;--mut:#9aa3ad;--line:#232830;--acc:#6ea0ff;--code:#14181d;--card:#10141a}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--acc)}a:focus-visible,button:focus-visible{outline:2px solid var(--acc);outline-offset:2px;border-radius:4px}
header.bar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.bar-in{max-width:1100px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.brand{font-weight:700;text-decoration:none;color:var(--fg)}
.bar nav{margin-left:auto;display:flex;gap:16px;font-size:14px}
.bar nav a{color:var(--mut);text-decoration:none;transition:color .15s}.bar nav a:hover{color:var(--fg)}
.hero{max-width:1100px;margin:0 auto;padding:48px 16px 24px}
.hero h1{font-size:clamp(28px,5vw,44px);line-height:1.15;margin:0 0 12px;letter-spacing:-.02em}
.hero p{color:var(--mut);max-width:70ch;font-size:18px;margin:0 0 24px}
.install{display:flex;align-items:center;gap:8px;max-width:620px;background:var(--code);border:1px solid var(--line);border-radius:10px;padding:6px 6px 6px 14px}
.install code{flex:1;overflow-x:auto;white-space:nowrap;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}
.install button{border:0;background:var(--acc);color:#fff;border-radius:7px;padding:8px 14px;font:600 13px system-ui;cursor:pointer;transition:transform .12s,opacity .12s}
.install button:hover{opacity:.9}.install button:active{transform:scale(.96)}
.cta{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
.cta a{padding:9px 16px;border:1px solid var(--line);border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;color:var(--fg);transition:border-color .15s,transform .15s}
.cta a:hover{border-color:var(--acc);transform:translateY(-1px)}.cta a.pri{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.layout{max-width:1100px;margin:0 auto;padding:8px 16px 64px;display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:40px}
@media(max-width:860px){.layout{grid-template-columns:minmax(0,1fr)}.toc{display:none}}
.toc{position:sticky;top:76px;align-self:start;font-size:14px;border-left:1px solid var(--line);padding-left:16px}
.toc p{margin:0 0 8px;font-weight:700;color:var(--mut);text-transform:uppercase;font-size:12px;letter-spacing:.06em}
.toc ul{list-style:none;margin:0;padding:0}.toc li{margin:6px 0}.toc a{color:var(--mut);text-decoration:none}.toc a:hover{color:var(--fg)}
main{min-width:0;overflow-wrap:anywhere}main pre code{overflow-wrap:normal}main img{max-width:100%;height:auto}
main h2{margin-top:2.2em;padding-bottom:.3em;border-bottom:1px solid var(--line)}
.anchor{margin-left:-1.1em;padding-right:.4em;text-decoration:none;opacity:0;color:var(--mut)}h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{opacity:1}
pre{background:var(--code);border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow-x:auto;font-size:14px;line-height:1.5}
code{font:0.9em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);padding:.15em .35em;border-radius:5px}pre code{background:none;padding:0}
table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}th,td{border:1px solid var(--line);padding:8px 12px;text-align:left}th{background:var(--card)}
blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid var(--line);color:var(--mut)}
footer{border-top:1px solid var(--line);color:var(--mut);font-size:14px}
.foot-in{max-width:1100px;margin:0 auto;padding:24px 16px;display:flex;gap:16px;flex-wrap:wrap}
@media(prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}`;

const SITE_JS = `document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){
var t=b.getAttribute('data-copy');var done=function(){var o=b.textContent;b.textContent='Copied';setTimeout(function(){b.textContent=o},1400)};
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,function(){})}
else{var a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();try{document.execCommand('copy');done()}catch(e){}a.remove()}})});`;

/** Trim to `max` characters at a sentence end, else a word boundary, never mid-word. */
function clampText(text, max) {
	const flat = String(text).replace(/\s+/g, ' ').trim();
	if (flat.length <= max) return flat;
	const cut = flat.slice(0, max);
	const sentence = cut.match(/^[\s\S]*[.!?](?=\s)/);
	if (sentence && sentence[0].length > max * 0.4) return sentence[0];
	return cut.replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '') + '...';
}

function siteIndex(pkg, slug, kind, readme, site) {
	const body = renderBody(readme.replace(/^\s*(?:<p[^>]*>[\s\S]*?<\/p>\s*)?<h1[\s\S]*?<\/h1>/i, ''), slug);
	const lead = (pkg.description || '').split(/\s[\u2014\u2013-]\s|[.:]\s/)[0].slice(0, 70);
	const title = lead ? `${pkg.name}: ${lead}` : pkg.name;
	const desc = clampText(pkg.description || pkg.name, 300);
	const cmd = installCommand(pkg);
	const ld = {
		'@context': 'https://schema.org',
		'@type': 'SoftwareSourceCode',
		name: pkg.name,
		description: desc,
		codeRepository: `https://github.com/${slug}`,
		programmingLanguage: 'JavaScript',
		license: `https://spdx.org/licenses/${pkg.license || 'Apache-2.0'}.html`,
		version: pkg.version,
		url: site,
		author: { '@type': 'Organization', name: 'three.ws', url: SITE },
		keywords: (pkg.keywords || []).join(', '),
	};
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${site}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="three.ws">
<meta property="og:title" content="${esc(pkg.name)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${site}">
<meta property="og:image" content="https://opengraph.githubassets.com/1/${slug}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(pkg.name)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="https://opengraph.githubassets.com/1/${slug}">
<meta name="keywords" content="${esc((pkg.keywords || []).join(', '))}">
<link rel="alternate" type="text/plain" href="llms.txt" title="llms.txt">
<link rel="icon" href="${SITE}/three-ws-mcp-icon.svg" type="image/svg+xml">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>${SITE_CSS}</style>
</head>
<body>
<header class="bar"><div class="bar-in">
<a class="brand" href="${site}">${esc(pkg.name)}</a>
<nav aria-label="Project links"><a href="https://github.com/${slug}">GitHub</a><a href="https://www.npmjs.com/package/${esc(pkg.name)}">npm</a><a href="llms.txt">llms.txt</a><a href="${SITE}">three.ws</a></nav>
</div></header>
<section class="hero">
<h1>${esc(pkg.name)}</h1>
<p>${esc(desc)}</p>
<div class="install" role="group" aria-label="Install command"><code>${esc(cmd)}</code><button type="button" data-copy="${esc(cmd)}">Copy</button></div>
<div class="cta"><a class="pri" href="https://github.com/${slug}">View on GitHub</a><a href="https://github.com/${slug}/stargazers">Star the repo</a>${kind === 'mcp' ? `<a href="https://registry.modelcontextprotocol.io/?q=${encodeURIComponent(pkg.mcpName || pkg.name)}">MCP Registry</a>` : ''}</div>
</section>
<div class="layout">
<main id="content">${body}</main>
${tocFrom(body)}
</div>
<footer><div class="foot-in"><span>${esc(pkg.license || 'Apache-2.0')} licensed</span><a href="https://github.com/${slug}/issues">Issues</a><a href="https://github.com/${slug}/blob/main/CONTRIBUTING.md">Contributing</a><a href="https://github.com/${slug}/security/policy">Security</a><a href="${SITE}">Part of three.ws</a></div></footer>
<script>${SITE_JS}</script>
</body>
</html>
`;
}

function notFound(pkg, site) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found - ${esc(pkg.name)}</title><meta name="robots" content="noindex"><style>${SITE_CSS}</style></head><body><section class="hero"><h1>Page not found</h1><p>That page does not exist. The documentation for ${esc(pkg.name)} is on the home page.</p><div class="cta"><a class="pri" href="${site}">Go to the docs</a></div></section></body></html>
`;
}

/** Write every discovery file into the mirror working tree. Returns the list written. */
export function enrichMirror(workDir, { pkg, slug, kind }) {
	const site = pagesUrl(slug);
	const written = [];
	const w = (rel, body, opts) => { if (put(workDir, rel, body, opts)) written.push(rel); };

	w('AGENTS.md', agentsMd(pkg, slug, kind));
	w('CONTRIBUTING.md', contributing(pkg, slug));
	w('SECURITY.md', security(pkg, slug));
	w('CODE_OF_CONDUCT.md', codeOfConduct());
	w('CITATION.cff', citation(pkg, slug));
	w('.github/ISSUE_TEMPLATE/bug.yml', BUG_FORM(pkg));
	w('.github/ISSUE_TEMPLATE/feature.yml', FEATURE_FORM);
	w('.github/ISSUE_TEMPLATE/config.yml', ISSUE_CONFIG(slug));
	w('.github/PULL_REQUEST_TEMPLATE.md', PR_TEMPLATE);
	if (kind === 'mcp') {
		w('glama.json', JSON.stringify({ $schema: 'https://glama.ai/mcp/schemas/server.json', maintainers: [OWNER_HANDLE] }, null, '\t'));
	}

	const readmePath = join(workDir, 'README.md');
	const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : `# ${pkg.name}\n\n${pkg.description || ''}\n`;
	w('llms.txt', llmsTxt(pkg, slug, kind, site));
	w('llms-full.txt', `${llmsTxt(pkg, slug, kind, site)}\n---\n\n${readme}`);

	w('docs/index.html', siteIndex(pkg, slug, kind, readme, site), { overwrite: true });
	w('docs/404.html', notFound(pkg, site), { overwrite: true });
	w('docs/llms.txt', llmsTxt(pkg, slug, kind, site), { overwrite: true });
	w('docs/llms-full.txt', `${llmsTxt(pkg, slug, kind, site)}\n---\n\n${readme}`, { overwrite: true });
	w('docs/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${site}sitemap.xml\n`, { overwrite: true });
	const today = new Date().toISOString().slice(0, 10);
	w('docs/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site}</loc><lastmod>${today}</lastmod></url></urlset>`, { overwrite: true });
	w('docs/.nojekyll', '', { overwrite: true });
	return written;
}

/** Make package.json discoverable: keywords, homepage, bugs. Preserves everything else. */
export function enrichPackageJson(workDir, { slug, kind }) {
	const path = join(workDir, 'package.json');
	if (!existsSync(path)) return;
	const pkg = JSON.parse(readFileSync(path, 'utf8'));
	const kw = new Set((pkg.keywords || []).map(String));
	for (const k of kind === 'mcp' ? ['mcp', 'model-context-protocol', 'mcp-server', 'ai-agents'] : ['ai-agents']) kw.add(k);
	kw.add('three.ws');
	pkg.keywords = [...kw];
	pkg.homepage = pagesUrl(slug);
	pkg.bugs = { url: `https://github.com/${slug}/issues` };
	writeFileSync(path, JSON.stringify(pkg, null, '\t') + '\n');
}

/**
 * Apply repository settings over the API using the supplied `gh` runner:
 * topics, description, homepage, issues, discussions and GitHub Pages from main:/docs.
 */
export function applyRepoSettings(gh, { pkg, slug, kind }) {
	const site = pagesUrl(slug);
	const steps = [];
	const attempt = (label, fn) => {
		try { fn(); steps.push(`${label}: ok`); } catch (e) { steps.push(`${label}: ${String(e.message).split('\n')[0].slice(0, 120)}`); }
	};
	attempt('settings', () => gh(['api', '-X', 'PATCH', `repos/${slug}`,
		'-f', `description=${(pkg.description || '').replace(/\s+/g, ' ').slice(0, 350)}`,
		'-f', `homepage=${site}`, '-F', 'has_issues=true', '-F', 'has_discussions=true', '-F', 'has_wiki=false']));
	attempt('topics', () => gh(['api', '-X', 'PUT', `repos/${slug}/topics`, '--input', '-'],
		{ input: JSON.stringify({ names: topicsFor(pkg, kind) }) }));
	attempt('pages', () => {
		try {
			gh(['api', '-X', 'POST', `repos/${slug}/pages`, '--input', '-'],
				{ input: JSON.stringify({ build_type: 'legacy', source: { branch: 'main', path: '/docs' } }) });
		} catch (e) {
			if (!/already|409|422/i.test(String(e.stderr || e.message))) throw e;
			gh(['api', '-X', 'PUT', `repos/${slug}/pages`, '--input', '-'],
				{ input: JSON.stringify({ build_type: 'legacy', source: { branch: 'main', path: '/docs' } }) });
		}
	});
	attempt('vulnerability-alerts', () => gh(['api', '-X', 'PUT', `repos/${slug}/vulnerability-alerts`]));
	return steps;
}
