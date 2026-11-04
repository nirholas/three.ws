// /notifications filters by category. The type to category map and the
// category list are owned by api/_lib/notify-prefs.js and served on
// GET /api/notifications/preferences; the page used to keep a hand-copied
// TYPE_CATEGORY table that drifted (knock, mail and event-market rows landed
// under Account, and four categories had no tab at all). These tests hold the
// page to the server's list.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATEGORIES, typeCategoryMap } from '../api/_lib/notify-prefs.js';
import {
	categoryOf,
	visibleTabs,
	FALLBACK_CATEGORIES,
} from '../src/notification-categories.js';

const pageSource = readFileSync(new URL('../src/notifications-page.js', import.meta.url), 'utf8');
const pageHtml = readFileSync(new URL('../pages/notifications.html', import.meta.url), 'utf8');

describe('categoryOf', () => {
	const map = typeCategoryMap();

	it('resolves types the old client table never knew to their own category', () => {
		expect(categoryOf('knock_received', map)).toBe('knock');
		expect(categoryOf('mail_received', map)).toBe('mail');
		expect(categoryOf('event_market_entrant', map)).toBe('markets');
		expect(categoryOf('order_update', map)).toBe('orders');
	});

	it('falls back to account for a type the server map does not name', () => {
		expect(categoryOf('a_type_from_the_future', map)).toBe('account');
	});

	it('falls back to account when there is no map at all (preferences fetch failed)', () => {
		expect(categoryOf('knock_received', null)).toBe('account');
		expect(categoryOf('knock_received', undefined)).toBe('account');
	});

	it('does not resolve inherited object keys as categories', () => {
		expect(categoryOf('constructor', map)).toBe('account');
		expect(categoryOf('__proto__', map)).toBe('account');
	});

	it('agrees with the server for every type the server maps', () => {
		for (const [type, category] of Object.entries(map)) {
			expect(categoryOf(type, map)).toBe(category);
		}
	});
});

describe('visibleTabs', () => {
	const map = typeCategoryMap();
	const rows = [
		{ type: 'knock_received' },
		{ type: 'mail_received' },
		{ type: 'event_market_entrant' },
		{ type: 'sale' },
	];

	it('every server category is reachable as a tab once it has a row', () => {
		const typeFor = {};
		for (const [type, category] of Object.entries(map)) typeFor[category] ??= type;
		for (const c of CATEGORIES) {
			const sample = typeFor[c.key] ? [{ type: typeFor[c.key] }] : [];
			// account is the fallback, so it is reachable through any unknown type
			if (!sample.length && c.key === 'account') sample.push({ type: 'unmapped_type' });
			expect(sample.length, `no type maps to category ${c.key}`).toBeGreaterThan(0);
			const keys = visibleTabs(CATEGORIES, sample, '', map).map((t) => t.key);
			expect(keys).toContain(c.key);
		}
	});

	it('lists only categories with rows, in server order, plus the active one', () => {
		const keys = visibleTabs(CATEGORIES, rows, 'approvals', map).map((t) => t.key);
		expect(keys).toEqual(['sales', 'markets', 'knock', 'mail', 'approvals']);
	});

	it('carries the server label and description on each tab', () => {
		const knock = visibleTabs(CATEGORIES, rows, '', map).find((t) => t.key === 'knock');
		const server = CATEGORIES.find((c) => c.key === 'knock');
		expect(knock.label).toBe(server.label);
		expect(knock.description).toBe(server.description);
	});

	it('keeps an active category that no longer has rows, so the selection never vanishes', () => {
		const keys = visibleTabs(CATEGORIES, [], 'mail', map).map((t) => t.key);
		expect(keys).toEqual(['mail']);
	});

	it('the fallback list (preferences unreachable) is Account only and always shown', () => {
		expect(FALLBACK_CATEGORIES.map((c) => c.key)).toEqual(['account']);
		const keys = visibleTabs(FALLBACK_CATEGORIES, [], '', null, { always: ['account'] }).map((t) => t.key);
		expect(keys).toEqual(['account']);
	});
});

describe('the page keeps no copy of the server map', () => {
	it('src/notifications-page.js has no hand-written TYPE_CATEGORY table', () => {
		expect(pageSource).not.toMatch(/TYPE_CATEGORY/);
	});

	it('pages/notifications.html hard-codes no category tab buttons', () => {
		expect(pageHtml).not.toMatch(/class="n-tab[^"]*"[^>]*data-type="(?!")/);
	});

	it('the page reads type_categories and categories from the preferences endpoint', () => {
		expect(pageSource).toMatch(/\/api\/notifications\/preferences/);
		expect(pageSource).toMatch(/type_categories/);
	});
});
