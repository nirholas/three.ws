// The /notifications page must follow the server category list instead of a
// hand-copied type map (bug: knock, mail and event-market rows landed under
// Account and had no tab).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CATEGORIES, typeCategoryMap } from '../api/_lib/notify-prefs.js';

const pageSrc = readFileSync(new URL('../src/notifications-page.js', import.meta.url), 'utf8');
const pageHtml = readFileSync(new URL('../pages/notifications.html', import.meta.url), 'utf8');

describe('notifications page category parity', () => {
	it('does not keep a literal TYPE_CATEGORY table', () => {
		expect(pageSrc).not.toMatch(/TYPE_CATEGORY\s*=/);
	});

	it('does not hard-code category tabs in the html', () => {
		for (const c of CATEGORIES) {
			expect(pageHtml).not.toContain(`data-type="${c.key}"`);
		}
	});

	it('resolves every server type to its server category and unknown types to account', async () => {
		const { categoryOf, tabsFor } = await import('../src/notifications-page.js');
		const map = typeCategoryMap();
		for (const [type, cat] of Object.entries(map)) expect(categoryOf(type, map)).toBe(cat);
		expect(categoryOf('knock_received', map)).toBe('knock');
		expect(categoryOf('mail_received', map)).toBe('mail');
		expect(categoryOf('event_market_entrant', map)).toBe('markets');
		expect(categoryOf('totally_unknown_type', map)).toBe('account');
		expect(categoryOf('knock_received', null)).toBe('account');
	});

	it('builds a tab for every populated category plus the active one, in server order', async () => {
		const { tabsFor } = await import('../src/notifications-page.js');
		const map = typeCategoryMap();
		const rows = [{ type: 'mail_received' }, { type: 'knock_received' }, { type: 'event_market_entrant' }];
		const tabs = tabsFor(CATEGORIES, map, rows, 'sales');
		expect(tabs.map((t) => t.key)).toEqual(['sales', 'markets', 'knock', 'mail']);
		expect(tabs.find((t) => t.key === 'knock').label).toBe(CATEGORIES.find((c) => c.key === 'knock').label);
		expect(tabsFor(CATEGORIES, map, [], '').length).toBe(0);
	});
});
