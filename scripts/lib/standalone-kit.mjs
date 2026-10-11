// Standalone mirror boost: the layers that sit on top of standalone-enrich.mjs.
//
// standalone-enrich.mjs writes the community files, agent files (AGENTS.md,
// llms.txt) and the rendered docs site. This module adds what makes a mirror
// shareable and credible on top of that:
//
//   - a real 1200x630 Open Graph card (docs/og.png), wired into the site's
//     og:image and twitter:image tags in place of the generic GitHub card
//   - a robots.txt that names the AI crawlers explicitly, plus security.txt
//   - a README footer that links the mirror back to the platform, and a LICENSE
//     file when the package ships none or an "all rights reserved" one
//
// Pure functions are exported for tests. boostMirror is the only writer.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { pagesUrl } from './standalone-enrich.mjs';
import { applyBadges, applyGrowthBlock, badgeRow, growthBlock } from './repo-growth-kit.mjs';

const SITE = 'https://three.ws';
const MONOREPO = 'https://github.com/nirholas/three.ws';
const SUPPORT_EMAIL = 'support@three.ws';

/** Replace the dash glyphs the house style bans, in text this module generates. */
export function plain(text = '') {
	return String(text).replace(/\s[\u2014\u2013]\s/g, ': ').replace(/[\u2014\u2013]/g, '-');
}

export function escapeHtml(s = '') {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Wrap text to lines of at most `max` characters, capped at `maxLines` (for the SVG card). */
export function wrapLines(text, max, maxLines) {
	const words = plain(text).split(/\s+/).filter(Boolean);
	const lines = [];
	let cur = '';
	for (const w of words) {
		if ((cur + ' ' + w).trim().length > max && cur) {
			lines.push(cur);
			cur = w;
		} else cur = (cur + ' ' + w).trim();
	}
	if (cur) lines.push(cur);
	if (lines.length > maxLines) {
		lines.length = maxLines;
		lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s.,;:]*$/, '') + '...';
	}
	return lines;
}

export function installCommand(pkg) {
	return pkg.bin ? `npx -y ${pkg.name}` : `npm install ${pkg.name}`;
}

export function fixLicenseFooter(readme) {
	return readme.replace(/^.*all rights reserved.*$/gim, 'Licensed under the [Apache License 2.0](./LICENSE).');
}

export function ecosystemFooter({ pkg, slug, dir }) {
	const site = pagesUrl(slug);
	return [
		'<!-- three.ws:ecosystem -->',
		'## Part of three.ws',
		'',
		`[three.ws](${SITE}) is a platform for 3D AI agents with Solana wallets: avatars, a skill marketplace, x402 payments and more than seventy MCP servers. \`${pkg.name}\` is one package from it.`,
		'',
		`- Documentation site: ${site}`,
		`- npm: https://www.npmjs.com/package/${pkg.name}`,
		`- Canonical source: ${MONOREPO} (this repository is a generated mirror of \`${dir}\`)`,
		'- Agent-readable summary: [llms.txt](./llms.txt) and [AGENTS.md](./AGENTS.md)',
		`- Issues and ideas: https://github.com/${slug}/issues`,
		'<!-- /three.ws:ecosystem -->',
		'',
	].join('\n');
}

export function decorateReadme(readme, ctx) {
	const stripped = fixLicenseFooter(readme).replace(/<!-- three\.ws:ecosystem -->[\s\S]*?<!-- \/three\.ws:ecosystem -->\n?/g, '');
	const name = ctx.slug.split('/')[1];
	const files = new Set(['AGENTS.md', 'llms.txt', 'llms-full.txt']);
	const badged = applyBadges(stripped, badgeRow({ name, hasLicense: true }));
	const grown = applyGrowthBlock(badged, growthBlock({ name, description: ctx.pkg.description || '', files, readme: badged }));
	return grown.replace(/\s*$/, '\n\n') + ecosystemFooter(ctx);
}

const AI_CRAWLERS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot'];

export function robotsTxt(slug) {
	const blocks = AI_CRAWLERS.map((b) => `User-agent: ${b}\nAllow: /\n`).join('\n');
	return `User-agent: *\nAllow: /\n\n${blocks}\nSitemap: ${pagesUrl(slug)}sitemap.xml\n`;
}

/** A 1200x630 social card: package name, one-line pitch and the install command. */
export async function ogCard({ pkg, install }) {
	const tagline = (pkg.description || '').split(/(?<=[.!?])\s/)[0];
	const title = wrapLines(pkg.name, 26, 2);
	const desc = wrapLines(tagline, 58, 3);
	const text = (lines, x, y, size, lh, fill, weight = 400) =>
		lines.map((l, i) => `<text x="${x}" y="${y + i * lh}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="Helvetica,Arial,sans-serif">${escapeHtml(l)}</text>`).join('');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0e14"/><stop offset="1" stop-color="#1b1f4a"/></linearGradient>
<radialGradient id="r" cx="0.85" cy="0.1" r="0.7"><stop offset="0" stop-color="#6d5dfc" stop-opacity="0.55"/><stop offset="1" stop-color="#6d5dfc" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/><rect width="1200" height="630" fill="url(#r)"/>
<rect x="72" y="72" width="64" height="64" rx="16" fill="#6d5dfc"/><text x="104" y="118" text-anchor="middle" font-size="40" font-weight="700" fill="#fff" font-family="Helvetica,Arial,sans-serif">3</text>
<text x="154" y="116" font-size="34" font-weight="600" fill="#cfd5ff" font-family="Helvetica,Arial,sans-serif">three.ws</text>
${text(title, 72, 280, 72, 84, '#ffffff', 700)}
${text(desc, 72, 280 + title.length * 84 + 24, 34, 46, '#b8c0dc')}
<rect x="72" y="540" width="${Math.min(1056, 60 + install.length * 17)}" height="56" rx="14" fill="#000" fill-opacity="0.45" stroke="#3a4170"/>
<text x="96" y="577" font-size="26" fill="#e6ebf5" font-family="Menlo,Consolas,monospace">$ ${escapeHtml(install)}</text>
</svg>`;
	return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

function put(dir, rel, content) {
	const full = join(dir, rel);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content);
}

/** Point the site's social tags at the generated card instead of GitHub's generic one. */
export function useOgCard(html, slug) {
	const card = `${pagesUrl(slug)}og.png`;
	return html
		.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${card}$2`)
		.replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${card}$2`);
}

/**
 * Layer the shareability extras onto a mirror working tree that enrichMirror has
 * already populated. `monorepoLicense` is the text of the monorepo LICENSE.
 */
export async function boostMirror(dir, { pkg, slug, kind, sourceDir, monorepoLicense }) {
	const install = installCommand(pkg);
	const readmePath = join(dir, 'README.md');
	const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : `# ${pkg.name}\n\n${pkg.description || ''}\n`;
	put(dir, 'README.md', decorateReadme(readme, { pkg, slug, dir: sourceDir }));

	const licensePath = join(dir, 'LICENSE');
	if (!existsSync(licensePath) || /all rights reserved/i.test(readFileSync(licensePath, 'utf8'))) put(dir, 'LICENSE', monorepoLicense);
	if (!existsSync(join(dir, '.gitignore'))) put(dir, '.gitignore', 'node_modules/\n.env\n.env.*\n!.env.example\n*.log\ndist/\n.DS_Store\n');

	put(dir, 'docs/og.png', await ogCard({ pkg, install }));
	put(dir, 'docs/robots.txt', robotsTxt(slug));
	put(dir, 'docs/.well-known/security.txt', `Contact: mailto:${SUPPORT_EMAIL}\nPreferred-Languages: en\nCanonical: ${pagesUrl(slug)}.well-known/security.txt\nExpires: ${new Date(Date.now() + 365 * 864e5).toISOString()}\n`);
	for (const page of ['docs/index.html', 'docs/404.html']) {
		const f = join(dir, page);
		if (existsSync(f)) writeFileSync(f, useOgCard(readFileSync(f, 'utf8'), slug));
	}
	if (kind === 'mcp' && existsSync(join(dir, 'server.json'))) put(dir, 'docs/server.json', readFileSync(join(dir, 'server.json')));
}
