import { describe, it, expect } from 'vitest';
import {
	extractRoutes,
	extractMentionedRoutes,
	extractFileCitations,
	compileRouteTable,
	routeResolves,
	rankUncovered,
	checkRatchet,
	auditUxFlows,
} from '../scripts/audit-ux-flows.mjs';

const deps = (over = {}) => ({
	pagePaths: new Set(['/trading']),
	matchers: compileRouteTable({
		routes: [
			{ src: '/old-name/?', dest: '/trading.html' },
			{ src: '/skip', dest: '/x', continue: true },
			{ src: '/(.*)', dest: '/$1' },
			{ src: '/(?!_vercel/).*', dest: '/404.html' },
		],
	}),
	fileExists: () => false,
	...over,
});

describe('extractRoutes', () => {
	it('reads routes from headings and table first cells, not from prose bullets', () => {
		const md = [
			'### Trading Hub: `/trading`',
			'- **Entry point:** links to `/prose-only`',
			'| `/table-route` | `pages/x.html` |',
		].join('\n');
		const routes = new Set(extractRoutes(md));
		expect(routes.has('/trading')).toBe(true);
		expect(routes.has('/table-route')).toBe(true);
		expect(routes.has('/prose-only')).toBe(false);
	});
	it('counts any backticked route as mentioned for coverage', () => {
		expect(new Set(extractMentionedRoutes('see `/prose-only` here')).has('/prose-only')).toBe(true);
	});
});

describe('routeResolves', () => {
	it('resolves an indexed page and an alias through the route table', () => {
		expect(routeResolves('/trading', deps())).toBe(true);
		expect(routeResolves('/old-name', deps())).toBe(true);
	});
	it('does not let the catch-all routes resolve a made-up route', () => {
		expect(routeResolves('/definitely-not-a-page', deps())).toBe(false);
	});
	it('ignores continue routes', () => {
		expect(routeResolves('/skip', deps())).toBe(false);
	});
	it('resolves a static file', () => {
		expect(routeResolves('/static', deps({ fileExists: (p) => p === 'public/static.html' }))).toBe(true);
	});
});

describe('extractFileCitations', () => {
	it('returns repo file paths and ignores plain words', () => {
		const files = [...extractFileCitations('uses `src/a.js` and `pages/b.html` and `word`')];
		expect(files.map((f) => (typeof f === 'string' ? f : f.path ?? f))).toEqual(expect.arrayContaining(['src/a.js', 'pages/b.html']));
	});
});

describe('rankUncovered', () => {
	it('orders uncovered pages by atlas weight and drops covered ones', () => {
		const atlas = { pages: [['/a', 'A', '', 's', 0.2], ['/b', 'B', '', 's', 0.9], ['/c', 'C', '', 's', 0.5]] };
		const ranked = rankUncovered(new Set(['/a', '/b', '/c']), new Set(['/c']), atlas);
		expect(ranked.map((r) => r.path ?? r[0] ?? r)).toEqual(['/b', '/a']);
	});
});

describe('checkRatchet', () => {
	it('flags a page that lost coverage', () => {
		const problems = checkRatchet({ covered: ['/a'] }, new Set(), {});
		expect(problems.join()).toMatch(/coverage regressed: \/a/);
	});
	it('allows missing files up to the baseline and fails above it', () => {
		const base = { covered: [], missingFiles: { '01.md': 1 } };
		expect(checkRatchet(base, new Set(), { '01.md': ['src/x.js'] })).toEqual([]);
		expect(checkRatchet(base, new Set(), { '01.md': ['src/x.js', 'src/y.js'] })).toHaveLength(1);
	});
	it('fails any missing file in a strict cluster', () => {
		const base = { covered: [], strictFileClusters: ['13.md'], missingFiles: {} };
		expect(checkRatchet(base, new Set(), { '13.md': ['src/x.js'] })).toHaveLength(1);
	});
});

describe('the real atlas', () => {
	it('has no stale routes, no regressions and a clean strict cluster', () => {
		const result = auditUxFlows();
		expect(result.stale).toEqual([]);
		expect(result.missingByFile['13-additional-routes.md']).toEqual([]);
		expect(result.files).toContain('13-additional-routes.md');
	});
});
