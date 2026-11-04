import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	CORE_PAGES,
	EXIT,
	aggregateExitCode,
	formatTable,
	isReloadError,
	pageExitCode,
	parseArgs,
	ruleCounts,
	validateCorePages,
} from '../scripts/lint-ui-pages.mjs';

const pagesJson = JSON.parse(readFileSync(new URL('../data/pages.json', import.meta.url), 'utf8'));
const pass = { path: '/a', findings: [], suppressed: 0, error: null };
const findings = { path: '/b', findings: [{ rule: 'control-gap' }], suppressed: 0, error: null };
const error = { path: '/c', findings: [], suppressed: 0, error: 'Page checks exceeded the time limit.' };

describe('exit-code aggregation', () => {
	it('maps one page to lintapple codes', () => {
		expect(pageExitCode(pass)).toBe(EXIT.PASS);
		expect(pageExitCode(findings)).toBe(EXIT.FINDINGS);
		expect(pageExitCode(error)).toBe(EXIT.ERROR);
	});

	it('passes only when every page passes', () => {
		expect(aggregateExitCode([pass, pass])).toBe(0);
		expect(aggregateExitCode([pass, findings])).toBe(1);
	});

	it('lets an unfinished check outrank findings in either order', () => {
		expect(aggregateExitCode([findings, error])).toBe(2);
		expect(aggregateExitCode([error, findings, pass])).toBe(2);
	});

	it('treats an empty run as an error, not a pass', () => {
		expect(aggregateExitCode([])).toBe(2);
	});
});

describe('core page list integrity', () => {
	it('lists the seven core pages from the order, each in data/pages.json', () => {
		expect(CORE_PAGES.map((p) => p.path)).toEqual(['/', '/gallery', '/create', '/forge', '/discover', '/docs', '/agents']);
		expect(validateCorePages(CORE_PAGES, pagesJson)).toEqual([]);
	});

	it('reports unlisted, duplicate, readyless and empty-scope entries', () => {
		const problems = validateCorePages(
			[
				{ path: '/gallery', ready: 'main' },
				{ path: '/gallery', ready: 'main' },
				{ path: '/no-such-page-xyz', ready: 'main' },
				{ path: '/create', ready: '' },
				{ path: '/forge', ready: 'main', scope: ' ' },
			],
			pagesJson,
		);
		expect(problems).toEqual([
			'/gallery: listed twice',
			'/no-such-page-xyz: not in data/pages.json',
			'/create: needs a ready selector',
			'/forge: scope must be a nonempty selector',
		]);
	});
});

describe('summary', () => {
	it('counts rules most frequent first, ties alphabetical', () => {
		expect(ruleCounts([{ rule: 'text-contrast' }, { rule: 'control-gap' }, { rule: 'text-contrast' }, { rule: 'aria-reference' }])).toEqual([
			['text-contrast', 2],
			['aria-reference', 1],
			['control-gap', 1],
		]);
	});

	it('prints one row per page with status and detail', () => {
		const lines = formatTable([pass, findings, { ...error, scope: '#grid' }]).split('\n');
		expect(lines).toHaveLength(5);
		expect(lines[0]).toMatch(/^page\s+status\s+findings\s+detail$/);
		expect(lines[2]).toMatch(/^\/a\s+PASS\s+0\s+0 suppressed by policy exceptions$/);
		expect(lines[3]).toMatch(/^\/b\s+FINDINGS\s+1\s+control-gap 1$/);
		expect(lines[4]).toMatch(/^\/c \(#grid\)\s+ERROR\s+0\s+Page checks exceeded the time limit\.$/);
	});
});

describe('dev-server reload detection', () => {
	it('recognises a page torn down by a reload, and nothing else', () => {
		expect(isReloadError('page.evaluate: Execution context was destroyed, most likely because of a navigation')).toBe(true);
		expect(isReloadError('locator.waitFor: Target page, context or browser has been closed')).toBe(true);
		expect(isReloadError('Page checks exceeded the time limit.')).toBe(false);
		expect(isReloadError('Page exceeds the 5000 element limit. Check a smaller page or component.')).toBe(false);
	});
});

describe('argument parsing', () => {
	it('defaults to the dev server on :3000 with a 120s budget', () => {
		expect(parseArgs([])).toEqual({ base: 'http://localhost:3000', only: null, timeout: 120000, json: null });
	});

	it('parses base, subset, timeout and json output', () => {
		expect(parseArgs(['--base', 'http://localhost:3017/', '--only', '/gallery, /create', '--timeout', '60000', '--json', 'r.json'])).toEqual({
			base: 'http://localhost:3017',
			only: ['/gallery', '/create'],
			timeout: 60000,
			json: 'r.json',
		});
	});

	it('rejects unknown flags, missing values and tiny budgets', () => {
		expect(() => parseArgs(['--fast'])).toThrow('Unknown option: --fast');
		expect(() => parseArgs(['--base'])).toThrow('Missing value for --base');
		expect(() => parseArgs(['--timeout', '50'])).toThrow('at least 1000 ms');
	});
});
