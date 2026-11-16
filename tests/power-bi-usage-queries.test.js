// The Power Query scripts shipped in integrations/microsoft/power-bi-usage/queries/
// must match the usage feed model: one query per entity set, every column typed.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ENTITY_SETS } from '../api/_lib/odata/usage-model.js';
import { QUERY_DIR, queryFiles } from '../scripts/build-power-bi-usage-queries.mjs';

describe('Power BI usage queries', () => {
	it('ships one query per entity set plus the FeedUrl parameter, and nothing else', () => {
		const shipped = readdirSync(QUERY_DIR).filter((f) => f.endsWith('.pq')).sort();
		expect(shipped).toEqual(['FeedUrl.pq', ...ENTITY_SETS.map((s) => `${s.name}.pq`)].sort());
	});

	it.each(queryFiles())('%s is current with the model (run scripts/build-power-bi-usage-queries.mjs)', (name, expected) => {
		expect(readFileSync(join(QUERY_DIR, name), 'utf8')).toBe(expected);
	});

	it.each(ENTITY_SETS.map((s) => [s.name, s]))('%s types every column the feed serves', (name, set) => {
		const text = readFileSync(join(QUERY_DIR, `${name}.pq`), 'utf8');
		expect(text).toContain(`Source{[Name = "${name}", Signature = "table"]}[Data]`);
		const typed = [...text.matchAll(/\{"([A-Za-z]+)", (type \w+|Int64\.Type)\}/g)].map((m) => m[1]);
		expect(typed).toEqual(Object.keys(set.props));
	});
});
