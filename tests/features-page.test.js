import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const p = (...parts) => resolve(repoRoot, ...parts);

const html = readFileSync(p('public/features/index.html'), 'utf8');
const css = readFileSync(p('public/features/features.css'), 'utf8');
const js = readFileSync(p('public/features/features.js'), 'utf8');
const vercel = JSON.parse(readFileSync(p('vercel.json'), 'utf8'));
const elementJs = readFileSync(p('src/element.js'), 'utf8');

describe('/features page — structure', () => {
	it('lives at public/features/index.html (folder pattern, not root features.html)', () => {
		expect(existsSync(p('public/features/index.html'))).toBe(true);
		expect(existsSync(p('features.html'))).toBe(false);
		expect(existsSync(p('features.css'))).toBe(false);
	});

	it('has metadata: title, canonical, og:image', () => {
		expect(html).toContain('<title>Features · 3D Agent</title>');
		expect(html).toContain('rel="canonical"');
		expect(html).toContain('og:image');
	});

	it('renders three parallax acts', () => {
		const acts = html.match(/<section\b[^>]*class="parallax-act/g) || [];
		expect(acts.length).toBe(3);
		expect(html).toContain('data-act="1"');
		expect(html).toContain('data-act="2"');
		expect(html).toContain('data-act="3"');
	});

	it('embeds three live <agent-3d> elements (one per act)', () => {
		const matches = html.match(/<agent-3d\b/g) || [];
		expect(matches.length).toBe(3);
		expect(html).toContain('data-role="act1-agent"');
		expect(html).toContain('data-role="act2-agent"');
		expect(html).toContain('data-role="act3-agent"');
	});

	it('Act 1 boots eagerly; Acts 2 and 3 lazy-boot', () => {
		// Act 1 carries the eager attr; the others do not.
		const act1 = html.match(/<agent-3d\b[^>]*data-role="act1-agent"[^>]*>/)?.[0];
		const act2 = html.match(/<agent-3d\b[^>]*data-role="act2-agent"[^>]*>/)?.[0];
		const act3 = html.match(/<agent-3d\b[^>]*data-role="act3-agent"[^>]*>/)?.[0];
		expect(act1).toBeTruthy();
		expect(act2).toBeTruthy();
		expect(act3).toBeTruthy();
		expect(act1).toMatch(/\beager\b/);
		expect(act2).not.toMatch(/\beager\b/);
		expect(act3).not.toMatch(/\beager\b/);
	});

	it('has a deploy CTA pointing at /deploy', () => {
		expect(html).toMatch(/href="\/deploy"[^>]*class="btn-primary"/);
	});

	it('cross-links to /discover (see who is on-chain)', () => {
		expect(html).toContain('href="/discover"');
	});

	it('skip-link targets the deploy CTA', () => {
		expect(html).toContain('href="#deploy"');
		expect(html).toContain('id="deploy"');
	});

	it('does not reference the legacy /explore route', () => {
		expect(html).not.toMatch(/href="\/explore"/);
	});

	it('keeps the site nav consistent with /discover and /my-agents', () => {
		expect(html).toContain('class="features-nav"');
		expect(html).toContain('href="/discover"');
		expect(html).toContain('href="/my-agents"');
	});

	it('exposes Act 2 emotion chips for the empathy demo', () => {
		const chips = html.match(/data-emotion="[^"]+"/g) || [];
		expect(chips.length).toBeGreaterThanOrEqual(4);
		// Vocabulary must match agent-avatar.js emotion keys
		expect(html).toContain('data-emotion="celebration"');
		expect(html).toContain('data-emotion="curiosity"');
		expect(html).toContain('data-emotion="empathy"');
		expect(html).toContain('data-emotion="concern"');
	});
});

describe('/features page — CSS contract', () => {
	it('establishes a perspective scroll container', () => {
		expect(css).toContain('perspective: var(--features-perspective)');
		expect(css).toMatch(/--features-perspective:\s*[\d.]+rem/);
	});

	it('layers use translateZ + scale to compensate for depth', () => {
		expect(css).toContain('translateZ(calc(var(--features-perspective)');
		expect(css).toContain('scale(calc(var(--depth) + 1))');
	});

	it('honors prefers-reduced-motion (collapses parallax)', () => {
		expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
	});

	it('has a narrow-viewport flat layout', () => {
		expect(css).toMatch(/@media \(max-width: 768px\)/);
	});
});

describe('/features page — JS wiring', () => {
	it('lazy-boots Acts 2 and 3 via IntersectionObserver', () => {
		expect(js).toContain('IntersectionObserver');
		expect(js).toContain('agent-3d:not([eager])');
	});

	it('triggers expressEmotion() on emotion-chip click', () => {
		expect(js).toContain('expressEmotion');
		expect(js).toContain('data-emotion');
	});

	it('fetches a real on-chain agent via /api/agents/suggest', () => {
		expect(js).toContain('/api/agents/suggest');
	});

	it('paints a chain ribbon for Act 3', () => {
		expect(js).toContain('chain-pill');
		expect(js).toContain('CHAIN_LABELS');
	});
});

describe('<agent-3d> public API — expressEmotion()', () => {
	it('exposes expressEmotion as a public method', () => {
		// The method calls into the protocol with ACTION_TYPES.EMOTE.
		expect(elementJs).toMatch(/expressEmotion\s*\(/);
		expect(elementJs).toContain('ACTION_TYPES.EMOTE');
	});
});

describe('/features routing — vercel.json', () => {
	const routes = vercel.routes || [];

	it('serves /features from /features/index.html', () => {
		const r = routes.find((x) => x.src === '/features');
		expect(r?.dest).toBe('/features/index.html');
	});

	it('serves /features/ from /features/index.html', () => {
		const r = routes.find((x) => x.src === '/features/');
		expect(r?.dest).toBe('/features/index.html');
	});

	it('rewrites /features/(.*) to /features/$1 for assets', () => {
		const r = routes.find((x) => x.src === '/features/(.*)');
		expect(r?.dest).toBe('/features/$1');
	});

	it('redirects legacy /features.html → /features (301)', () => {
		const r = routes.find((x) => x.src === '/features.html');
		expect(r).toBeTruthy();
		expect(r.status).toBe(301);
		expect(r.headers?.Location).toBe('/features');
	});

	it('redirects come before catch-all rewrites', () => {
		const idx = (src) => routes.findIndex((x) => x.src === src);
		// /features.html redirect must precede /features rewrite
		expect(idx('/features.html')).toBeLessThan(idx('/features'));
	});
});
