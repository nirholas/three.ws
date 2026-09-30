// The public experiment log (/experiments): the validator that gates
// `npm run build:pages`, and the index it publishes. The real data file is
// validated too, so a broken entry fails `npm test` as well as the build.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
	validateExperiments,
	buildExperimentsJson,
	loadExperiments,
	WRITEUP_SECTIONS,
} from '../scripts/lib/experiments-index.mjs';

const GOOD_DOC = `# Title\n\n${WRITEUP_SECTIONS.map((s) => `## ${s}\n\nBody.\n`).join('\n')}\n## Appendix: the queries\n`;

function entry(overrides = {}) {
	return {
		slug: 'agent-launch-funnel',
		title: 'Funnel',
		question: 'Who launches?',
		published: '2026-09-30',
		spend_usd: 0,
		status: 'concluded',
		doc: 'experiments-agent-launch-funnel',
		...overrides,
	};
}

const docs = (map) => ({ readDoc: (doc) => (doc in map ? map[doc] : null) });

describe('validateExperiments', () => {
	it('accepts a complete entry whose write-up has the six sections in order', () => {
		const out = validateExperiments({ experiments: [entry()] }, docs({ 'experiments-agent-launch-funnel': GOOD_DOC }));
		expect(out).toHaveLength(1);
	});

	it.each(['slug', 'title', 'question', 'published', 'spend_usd', 'status', 'doc'])('fails on a missing %s', (field) => {
		const e = entry();
		delete e[field];
		expect(() => validateExperiments({ experiments: [e] }, docs({ 'experiments-agent-launch-funnel': GOOD_DOC }))).toThrow(
			field === 'doc' || field === 'slug' ? /missing required field|doc must be/ : new RegExp(`missing required field "${field}"`),
		);
	});

	it('fails on an unknown status, a negative spend and a bad date', () => {
		const io = docs({ 'experiments-agent-launch-funnel': GOOD_DOC });
		expect(() => validateExperiments({ experiments: [entry({ status: 'paused' })] }, io)).toThrow(/status must be one of/);
		expect(() => validateExperiments({ experiments: [entry({ spend_usd: -1 })] }, io)).toThrow(/spend_usd/);
		expect(() => validateExperiments({ experiments: [entry({ spend_usd: '5' })] }, io)).toThrow(/spend_usd/);
		expect(() => validateExperiments({ experiments: [entry({ published: '2026-13-45' })] }, io)).toThrow(/published/);
	});

	it('fails when the write-up does not exist', () => {
		expect(() => validateExperiments({ experiments: [entry()] }, docs({}))).toThrow(/does not exist/);
	});

	it('fails when a template section is missing or out of order', () => {
		const missing = GOOD_DOC.replace('## What we got wrong', '## Lessons');
		expect(() => validateExperiments({ experiments: [entry()] }, docs({ 'experiments-agent-launch-funnel': missing }))).toThrow(
			/"## What we got wrong"/,
		);
		const swapped = GOOD_DOC.replace('## Spend', '## TMP').replace('## Result', '## Spend').replace('## TMP', '## Result');
		expect(() => validateExperiments({ experiments: [entry()] }, docs({ 'experiments-agent-launch-funnel': swapped }))).toThrow(
			/out of order/,
		);
	});

	it('fails on a doc slug that does not follow experiments-<slug>, a duplicate slug and a bad live_url', () => {
		const io = docs({ 'experiments-agent-launch-funnel': GOOD_DOC, 'trading-experiment': GOOD_DOC });
		expect(() => validateExperiments({ experiments: [entry({ doc: 'trading-experiment' })] }, io)).toThrow(/doc must be/);
		expect(() => validateExperiments({ experiments: [entry(), entry()] }, io)).toThrow(/duplicate slug/);
		expect(() => validateExperiments({ experiments: [entry({ live_url: 'https://x.test' })] }, io)).toThrow(/live_url/);
	});
});

describe('buildExperimentsJson', () => {
	it('publishes newest first with the write-up URL', () => {
		const out = JSON.parse(
			buildExperimentsJson([entry({ slug: 'a', published: '2026-09-01' }), entry({ slug: 'b', published: '2026-09-30' })]),
		);
		expect(out.count).toBe(2);
		expect(out.experiments.map((e) => e.slug)).toEqual(['b', 'a']);
		expect(out.experiments[0].url).toBe('/docs/experiments-agent-launch-funnel');
	});
});

describe('the committed experiment log', () => {
	it('validates against the real write-ups', () => {
		const { entries } = loadExperiments(resolve(import.meta.dirname, '..'));
		expect(entries.length).toBeGreaterThan(0);
	});
});
