// One-shot: ensure every user-facing top-level HTML page has the global
// nav and footer wired in. Idempotent — re-running is a no-op for pages
// already correct.
//
// Run with: node scripts/add-nav-footer.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());

// User-facing pages. Embeds, widgets, and standalone artifact pages are
// intentionally excluded — they're rendered inside iframes or on devices
// where chrome would be noise.
const PAGES = [
	'agent-detail.html',
	'agent-edit.html',
	'agent-home.html',
	'a-edit.html',
	'app.html',
	'app-demo.html',
	'avatar-page.html',
	'community.html',
	'create.html',
	'home.html',
	'marketplace.html',
	'playground.html',
	'pretext-demo.html',
	'profile.html',
	'pump-3d-agent.html',
	'pump-coin-page.html',
	'pump-dashboard.html',
	'pump-live.html',
	'pump-sdk-case-study.html',
	'pump-visualizer.html',
	'pumpfun-buy.html',
	'pumpfun-search.html',
	'pumpfun-trending.html',
	'three-ws-launch-week.html',
	'threews-launch-week-case-study.html',
	'tutorials.html',
	'widget-studio.html',
	'widgets.html',
];

const NAV_CSS = '<link rel="stylesheet" href="/nav.css" />';
const FOOTER_CSS = '<link rel="stylesheet" href="/footer.css" />';
const NEWSLETTER_JS = '<script defer src="/footer-newsletter.js"></script>';

const NAV_BLOCK = `
		<header class="site-header">
			<h1 class="site-header-brand">
				<a href="/" aria-label="three.ws home"><img class="wordmark-logo" src="/three.svg" alt="" aria-hidden="true" /><span class="wordmark-dot" aria-hidden="true"></span>three.ws</a>
			</h1>
			<div id="nav-container"></div>
		</header>
		<script src="/nav.js"></script>
`;

const FOOTER_BLOCK = `
		<div id="footer-container"></div>
		<script src="/footer.js"></script>
`;

function ensureInHead(html, snippet, marker) {
	if (html.includes(marker)) return html;
	const m = html.match(/<\/head>/i);
	if (!m) return html;
	const idx = m.index;
	return html.slice(0, idx) + `\t\t${snippet}\n\t` + html.slice(idx);
}

function hasAnyNav(html) {
	if (/id=["']nav-container["']/.test(html)) return true;
	if (/class=["'][^"']*home-nav/.test(html)) return true;
	// A custom <header> that itself contains a <nav> is treated as having nav.
	const headerMatch = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/i);
	if (headerMatch && /<nav\b/i.test(headerMatch[0])) return true;
	return false;
}

function hasFooter(html) {
	return /<footer[\s>]/i.test(html) || /id=["']footer-container["']/.test(html);
}

function injectAfterBody(html, snippet) {
	const m = html.match(/<body[^>]*>/i);
	if (!m) return html;
	const idx = m.index + m[0].length;
	return html.slice(0, idx) + snippet + html.slice(idx);
}

function injectBeforeBodyClose(html, snippet) {
	const m = html.match(/<\/body>/i);
	if (!m) return html;
	const idx = m.index;
	return html.slice(0, idx) + snippet + html.slice(idx);
}

let changed = 0;
for (const file of PAGES) {
	const path = resolve(ROOT, file);
	let html;
	try {
		html = readFileSync(path, 'utf8');
	} catch {
		console.warn(`skip (missing): ${file}`);
		continue;
	}
	const orig = html;

	// Always make sure the global stylesheets/scripts are present in <head>.
	html = ensureInHead(html, NAV_CSS, '/nav.css');
	html = ensureInHead(html, FOOTER_CSS, '/footer.css');
	html = ensureInHead(html, NEWSLETTER_JS, '/footer-newsletter.js');

	if (!hasAnyNav(html)) {
		html = injectAfterBody(html, NAV_BLOCK);
	}
	if (!hasFooter(html)) {
		html = injectBeforeBodyClose(html, FOOTER_BLOCK);
	}

	if (html !== orig) {
		writeFileSync(path, html);
		changed++;
		console.log(`updated: ${file}`);
	} else {
		console.log(`ok:      ${file}`);
	}
}
console.log(`\n${changed} files updated of ${PAGES.length}`);
