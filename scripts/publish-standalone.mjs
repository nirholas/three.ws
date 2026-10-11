#!/usr/bin/env node
// Turn a packages/<name> directory into a standalone, fully documented GitHub repo
// (README badges, AGENTS.md, llms.txt, SECURITY/CONTRIBUTING/CoC, issue templates,
// a GitHub Pages site under docs/, topics) and optionally publish it.
//
//   node scripts/publish-standalone.mjs <package-dir> [--repo <name>] [--publish]
//
// Without --publish it builds and tests the repo under ~/projects/standalone/<repo>
// and stops. With --publish it creates nirholas/<repo> via the gh CLI, pushes,
// sets topics and enables Pages. It never publishes to npm.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'nirholas';
const OUT = path.join(os.homedir(), 'projects', 'standalone');
const BASE_TOPICS = ['three-ws', 'ai-agents', 'llms-txt', 'nodejs'];

const argv = process.argv.slice(2);
const pkgDir = argv.find((a) => !a.startsWith('--'));
const flag = (n) => argv.includes(n);
const val = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
if (!pkgDir) {
	console.error('usage: publish-standalone.mjs <package-dir> [--repo <name>] [--publish]');
	process.exit(2);
}

const src = path.resolve(ROOT, 'packages', pkgDir);
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
if (pkg.private) throw new Error(`${pkg.name} is private and is not extracted`);
const repo = val('--repo') || pkgDir;
const dest = path.join(OUT, repo);
const slug = `${OWNER}/${repo}`;
const siteUrl = `https://${OWNER}.github.io/${repo}/`;
const desc = (pkg.description || `${pkg.name}, part of three.ws`).replace(/\s+/g, ' ').trim();
const shortDesc = desc.length > 340 ? desc.slice(0, 337) + '...' : desc;

function run(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}
const write = (rel, body) => {
	fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
	fs.writeFileSync(path.join(dest, rel), body.endsWith('\n') ? body : body + '\n');
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// 1. copy the package, without installed deps or build output
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, {
	recursive: true,
	filter: (p) => !/(^|\/)(node_modules|dist|\.turbo)(\/|$)/.test(path.relative(src, p)),
});

// 2. package.json points at the new repo
const next = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
next.repository = { type: 'git', url: `git+https://github.com/${slug}.git` };
next.bugs = { url: `https://github.com/${slug}/issues` };
next.homepage = siteUrl;
fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(next, null, 2) + '\n');

// 3. README: badges on top, links to the repo files below
let readme = fs.readFileSync(path.join(dest, 'README.md'), 'utf8');
const badges = [
	`[![npm](https://img.shields.io/npm/v/${next.name}?color=7c5cff)](https://www.npmjs.com/package/${next.name})`,
	`[![license](https://img.shields.io/badge/license-${(next.license || 'Apache-2.0').replace(/-/g, '--')}-blue)](LICENSE)`,
	`[![docs](https://img.shields.io/badge/docs-site-black)](${siteUrl})`,
].join('\n');
readme = readme.replace(/^(# .+\n)/, `$1\n${badges}\n`);
if (!/AGENTS\.md/.test(readme)) {
	readme = readme.trimEnd() + `\n\n## Security and contributing\n\nSee [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) (for AI agents). Part of [three.ws](https://three.ws).\n`;
}
fs.writeFileSync(path.join(dest, 'README.md'), readme);

// 4. docs and discovery files
const testCmd = next.scripts?.test ? 'npm test' : 'node --version';
write('AGENTS.md', `# AGENTS.md

Guidance for AI coding agents working in, or using, this repository.

## What this is

\`${next.name}\`: ${shortDesc}

Part of [three.ws](https://three.ws). Canonical docs: [README.md](README.md). Machine-readable summary: [llms.txt](llms.txt).

## Work on it

\`\`\`bash
npm install
${testCmd}
\`\`\`

Rules:

- Read the README and the neighboring code before changing anything; match the existing style.
- Every behavior change gets a test. Tests use real inputs, no network calls unless the package is a client for one.
- Never commit secrets, private keys or real wallet material.
- Keep the public API in the README accurate: update it in the same change.
- Use plain, specific commit messages (\`fix(scope): what changed and why\`).

## Discovery

- Site: ${siteUrl}
- npm: https://www.npmjs.com/package/${next.name}
- Platform: https://three.ws
`);
const llms = `# ${next.name}

> ${shortDesc}

## Docs
- [README](https://github.com/${slug}/blob/main/README.md): install, usage and API
- [AGENTS.md](https://github.com/${slug}/blob/main/AGENTS.md): how an AI agent should use and modify this repo
- [Site](${siteUrl}): rendered docs
- [npm](https://www.npmjs.com/package/${next.name})

## Optional
- [three.ws](https://three.ws): the platform this package belongs to
- [llms-full.txt](https://three.ws/llms-full.txt): platform-wide index
`;
write('llms.txt', llms);
write('docs/llms.txt', llms);
write('docs/.nojekyll', '');
write('.gitignore', 'node_modules/\ndist/\n*.tgz\n.DS_Store\n');
write('SECURITY.md', `# Security policy

Email support@three.ws with a description and reproduction steps. Please do not open a public issue for a vulnerability. We acknowledge reports within 3 business days.
`);
write('CONTRIBUTING.md', `# Contributing

\`\`\`bash
git clone https://github.com/${slug}
cd ${repo}
npm install
${testCmd}
\`\`\`

Keep changes small and tested, keep the README accurate, and never commit secrets. By contributing you agree your work is licensed under ${next.license || 'Apache-2.0'}.
`);
write('CODE_OF_CONDUCT.md', '# Code of conduct\n\nBe respectful and constructive. No harassment, discrimination or personal attacks. Maintainers may remove content or block contributors who break this. Report concerns to support@three.ws.\n');
write('CHANGELOG.md', `# Changelog\n\n## ${next.version}\n\nInitial standalone release of ${next.name} as its own repository. History before this point lives in [three.ws](https://github.com/${OWNER}/three.ws/tree/main/packages/${pkgDir}).\n`);
write('.github/ISSUE_TEMPLATE/bug_report.md', `---\nname: Bug report\nabout: Something does not work as documented\n---\n\n**Version of ${next.name}**\n\n**What you ran**\n\n**Expected vs actual**\n`);
write('.github/ISSUE_TEMPLATE/feature_request.md', `---\nname: Feature request\nabout: An improvement or new capability\n---\n\n**The problem**\n\n**What you would like**\n`);
write('.github/pull_request_template.md', '## What changed and why\n\n## How I tested it\n- [ ] Tests pass\n- [ ] README updated if the API changed\n');

// 5. docs site rendered from the README
const body = marked.parse(fs.readFileSync(path.join(dest, 'README.md'), 'utf8'));
const ld = {
	'@context': 'https://schema.org',
	'@type': 'SoftwareSourceCode',
	name: next.name,
	description: shortDesc,
	codeRepository: `https://github.com/${slug}`,
	url: siteUrl,
	license: next.license ? `https://spdx.org/licenses/${next.license}` : undefined,
	programmingLanguage: 'JavaScript',
};
write('docs/index.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(next.name)}</title>
<meta name="description" content="${esc(shortDesc)}">
<link rel="canonical" href="${siteUrl}">
<meta property="og:title" content="${esc(next.name)}">
<meta property="og:description" content="${esc(shortDesc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${siteUrl}">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="text/plain" href="llms.txt" title="llms.txt">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<style>
:root{--bg:#fff;--ink:#14141a;--dim:#4d4d5c;--accent:#5b3cf0;--code:#f3f2f9;--line:#e3e1ee}
@media (prefers-color-scheme:dark){:root{--bg:#0e0e14;--ink:#f1f0f8;--dim:#b4b3c4;--accent:#9d86ff;--code:#1a1a24;--line:#2a2a38}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:820px;margin:0 auto;padding:40px 16px 80px}
nav{max-width:820px;margin:0 auto;padding:16px;display:flex;gap:16px;flex-wrap:wrap;font-size:.9rem}
h1,h2,h3{line-height:1.2}h2{margin-top:2.2em;border-bottom:1px solid var(--line);padding-bottom:.3em}
p,li{color:var(--dim)}a{color:var(--accent)}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
pre{background:var(--code);border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow-x:auto}
code{font:.9em ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink)}
table{border-collapse:collapse;display:block;overflow-x:auto}td,th{border:1px solid var(--line);padding:6px 10px;text-align:left}
img{max-width:100%}
</style>
</head>
<body>
<nav aria-label="Project"><a href="https://github.com/${slug}">GitHub</a><a href="https://www.npmjs.com/package/${next.name}">npm</a><a href="llms.txt">llms.txt</a><a href="https://three.ws">three.ws</a></nav>
<main>
${body}
</main>
</body>
</html>`);

// 6. refuse em-dashes anywhere in what we wrote or copied
const bad = [];
(function scan(d) {
	for (const e of fs.readdirSync(d, { withFileTypes: true })) {
		const p = path.join(d, e.name);
		if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') scan(p); }
		else if (/\.(md|js|mjs|json|html|txt)$/.test(e.name) && /[\u2014\u2013]/.test(fs.readFileSync(p, 'utf8'))) bad.push(path.relative(dest, p));
	}
})(dest);
if (bad.length) {
	for (const f of bad) {
		const p = path.join(dest, f);
		fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\s*\u2014\s*/g, ', ').replace(/\u2013/g, '-'));
	}
	console.log(`replaced dash glyphs in ${bad.length} file(s)`);
}

// 7. a test script that reaches into the monorepo cannot run standalone
if (/--root\s+\.\./.test(next.scripts?.test || '')) throw new Error(`${next.name}: test script depends on the monorepo root; not extractable as-is`);
// 7b. install and test, so nothing broken is ever published
if (next.scripts?.test) {
	run('npm', ['install', '--no-audit', '--no-fund'], { cwd: dest });
	run('npm', ['test'], { cwd: dest });
}

// 8. git
const git = (...a) => execFileSync('git', ['-c', 'user.name=nirholas', '-c', 'user.email=claudescammer@outlook.com', ...a], { cwd: dest, encoding: 'utf8' });
git('init', '-q', '-b', 'main');
git('add', '-A');
git('commit', '-q', '-m', `feat: standalone ${next.name} with docs site, agent discovery files and community health files\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`);
console.log(`built ${dest}`);

if (!flag('--publish')) process.exit(0);

// 9. publish
if (spawnSync('gh', ['repo', 'view', slug], { stdio: 'ignore' }).status === 0) {
	console.log(`${slug} already exists; built locally only`);
	process.exit(0);
}
const topics = [...new Set([...(next.keywords || []), ...BASE_TOPICS]
	.map((k) => String(k).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''))
	.filter((k) => k && k.length <= 50 && /^[a-z0-9]/.test(k)))].slice(0, 20);
run('gh', ['repo', 'create', slug, '--public', '--description', shortDesc.slice(0, 340), '--homepage', siteUrl, '--source', '.', '--remote', 'origin', '--push'], { cwd: dest });
run('gh', ['repo', 'edit', slug, ...topics.flatMap((t) => ['--add-topic', t])]);
run('gh', ['api', '-X', 'POST', `repos/${slug}/pages`, '-f', 'source[branch]=main', '-f', 'source[path]=/docs']);
console.log(`published https://github.com/${slug}  site ${siteUrl}`);
