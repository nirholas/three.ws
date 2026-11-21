// scripts/check-xai-models.mjs: the drift check between GROK_MODELS and xAI.
// Fixtures are captured, not invented: xai-docs-*.md.txt are docs.x.ai pages
// fetched on 2026-10-08 (markdown, stored as .txt so the docs link audit does
// not read xAI's relative links as ours), and xai-v1-*.json are the response
// examples xAI publishes for GET /v1/models and GET /v1/language-models
// (docs.x.ai/developers/rest-api-reference/inference/models.md).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	normalizeApiModels,
	parseDocsPricingTable,
	parseDocsModelPage,
	compareCatalog,
	parseReleaseNotesEndOfLife,
} from '../scripts/check-xai-models.mjs';
import { GROK_MODELS, GROK_RETIRED_ALIASES } from '../api/_lib/chat-models.js';

const fixture = (name) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

// Upstream rows that agree with the catalog in every field the docs report.
function upstreamFromCatalog(models = GROK_MODELS) {
	return new Map(
		models.map((m) => [
			m.id,
			{
				id: m.id,
				contextWindow: m.contextWindow,
				price: [...m.price],
				vision: m.vision,
				tools: m.tools,
				reasoningEfforts: [...m.reasoningEfforts],
				aliases: [],
			},
		]),
	);
}

describe('docs parsing', () => {
	it('reads every text model, its context and base price from the models page', () => {
		const rows = parseDocsPricingTable(fixture('xai-docs-models.md.txt'));
		// The table still lists slugs xAI has retired in its release notes; those
		// live in GROK_RETIRED_ALIASES rather than the catalog.
		const live = [...rows.keys()].filter((id) => !GROK_RETIRED_ALIASES[id]);
		expect(live.sort()).toEqual(GROK_MODELS.map((m) => m.id).sort());
		expect(rows.get('grok-4.3')).toEqual({ id: 'grok-4.3', contextWindow: 1_000_000, price: [1.25, 2.5] });
		expect(rows.get('grok-build-0.1')).toEqual({ id: 'grok-build-0.1', contextWindow: 256_000, price: [1, 2] });
		// Image and video models live in their own tables and are not text models.
		expect(rows.has('grok-imagine-image')).toBe(false);
	});

	it('reads capabilities from a model page', () => {
		expect(parseDocsModelPage(fixture('xai-docs-grok-4.3.md.txt'))).toEqual({
			vision: true,
			contextWindow: 1_000_000,
			tools: true,
			reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'],
			aliases: ['grok-4.3-latest'],
		});
		const fast = parseDocsModelPage(fixture('xai-docs-grok-4.20-0309-non-reasoning.md.txt'));
		expect(fast.reasoningEfforts).toEqual([]);
		expect(fast.aliases).toContain('grok-4.20-non-reasoning');
	});

	it('the captured docs agree with the catalog', () => {
		const rows = parseDocsPricingTable(fixture('xai-docs-models.md.txt'));
		const upstream = new Map([...rows.values()].map((r) => [r.id, { ...r, vision: null, tools: null, reasoningEfforts: null, aliases: [] }]));
		expect(compareCatalog(GROK_MODELS, upstream).drift).toEqual([]);
	});
});

describe('API parsing', () => {
	const models = JSON.parse(fixture('xai-v1-models.json'));
	const language = JSON.parse(fixture('xai-v1-language-models.json'));

	it('keeps chat models only, converts prices to USD per 1M, and reads vision from modalities', () => {
		const out = normalizeApiModels(models, language);
		expect([...out.keys()]).toEqual(['grok-420-reasoning']);
		expect(out.get('grok-420-reasoning')).toMatchObject({
			contextWindow: 256_000,
			price: [2, 8],
			vision: false,
			tools: null,
			reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
		});
	});

	it('without the language-models list it still drops media models by id', () => {
		const out = normalizeApiModels(models, null);
		expect(out.has('grok-imagine-image')).toBe(false);
		expect(out.get('grok-420-reasoning').vision).toBeNull();
	});
});

describe('compareCatalog', () => {
	it('reports nothing when xAI matches the catalog', () => {
		expect(compareCatalog(GROK_MODELS, upstreamFromCatalog())).toEqual({ drift: [], notes: [] });
	});

	it('flags a model xAI stopped listing, and one it folded into another as an alias', () => {
		const upstream = upstreamFromCatalog();
		upstream.delete('grok-4.5');
		upstream.delete('grok-4.6');
		upstream.get('grok-4.7').aliases = ['grok-4.6'];
		const kinds = compareCatalog(GROK_MODELS, upstream).drift.map((d) => `${d.id}:${d.kind}`);
		expect(kinds).toEqual(['grok-4.6:now-alias', 'grok-4.5:missing']);
	});

	it('flags a new upstream model, and a context, price, vision, tools or efforts change', () => {
		const upstream = upstreamFromCatalog();
		upstream.set('grok-5', { id: 'grok-5', contextWindow: 2_000_000, price: [3, 9], vision: true, tools: true, reasoningEfforts: [], aliases: [] });
		Object.assign(upstream.get('grok-4.3'), { contextWindow: 2_000_000, price: [1, 2] });
		Object.assign(upstream.get('grok-4.7'), { vision: false, tools: false, reasoningEfforts: ['low'] });
		const kinds = compareCatalog(GROK_MODELS, upstream).drift.map((d) => `${d.id}:${d.kind}`);
		expect(kinds.sort()).toEqual(
			['grok-4.3:context', 'grok-4.3:price', 'grok-4.7:vision', 'grok-4.7:tools', 'grok-4.7:reasoning-efforts', 'grok-5:new'].sort(),
		);
	});

	it('a retired slug xAI still lists is a note, not drift', () => {
		const upstream = upstreamFromCatalog();
		upstream.set('grok-3', { id: 'grok-3', contextWindow: 131_072, price: [3, 15], vision: false, tools: true, reasoningEfforts: [], aliases: [] });
		const { drift, notes } = compareCatalog(GROK_MODELS, upstream);
		expect(drift).toEqual([]);
		expect(notes.map((n) => n.id)).toEqual(['grok-3']);
	});
});

// xai-docs-release-notes.md.txt is the November and October release notes,
// captured 2026-11-21. xAI announced grok-build-0.1's end of life there on
// 2026-11-19 while the models table still listed it, so the table alone missed
// the retirement and the model stayed in our menus as a guaranteed error.
describe('release-notes end of life', () => {
	const notes = fixture('xai-docs-release-notes.md.txt');

	it('reads every slug the release notes retire', () => {
		const eol = parseReleaseNotesEndOfLife(notes);
		expect(eol.map((e) => e.id).sort()).toEqual(['grok-build-0.1', 'grok-voice-transcribe-1.0']);
		expect(eol.find((e) => e.id === 'grok-build-0.1').detail).toMatch(/no longer served/);
	});

	it('flags a catalog model the release notes retired even while the table still lists it', () => {
		const ours = [...GROK_MODELS, { ...GROK_MODELS[0], id: 'grok-build-0.1' }];
		const eol = parseReleaseNotesEndOfLife(notes);
		const kinds = compareCatalog(ours, upstreamFromCatalog(ours), eol).drift.map((d) => `${d.id}:${d.kind}`);
		expect(kinds).toEqual(['grok-build-0.1:end-of-life']);
	});

	it('the live catalog carries no retired slug, and the retired coding model maps to Grok 4.7', () => {
		const retired = new Set(parseReleaseNotesEndOfLife(notes).map((e) => e.id));
		expect(GROK_MODELS.filter((m) => retired.has(m.id)).map((m) => m.id)).toEqual([]);
		expect(GROK_RETIRED_ALIASES['grok-build-0.1']).toBe('grok-4.7');
		expect(GROK_RETIRED_ALIASES['grok-code-fast-1']).toBe('grok-4.7');
	});
});
