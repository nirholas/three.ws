// scripts/build-page-index.mjs refuses a malformed data/changelog.json entry,
// but it only runs inside `build:pages` and the production build. On 2026-11-19
// an entry tagged "forge" (not an allowed tag) was committed in 4d13c883d and
// sat unnoticed until it killed `npm run deploy:gcp:full` minutes into the
// build. Validating the committed file in the test suite moves that failure to
// `npm test`, where it costs seconds instead of a deploy.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHANGELOG_TAGS, validateChangelogEntries } from '../scripts/lib/changelog-entries.mjs';

const entry = (over = {}) => ({ date: '2026-11-19', title: 'A title', summary: 'A summary', tags: ['fix'], ...over });

describe('changelog entry validation', () => {
	it('accepts the committed data/changelog.json', () => {
		const { entries } = JSON.parse(readFileSync(resolve(import.meta.dirname, '../data/changelog.json'), 'utf8'));
		expect(() => validateChangelogEntries(entries)).not.toThrow();
	});

	it('rejects a tag outside the allowed set and names it', () => {
		expect(() => validateChangelogEntries([entry({ tags: ['fix', 'forge'] })])).toThrow(/unknown tag "forge"/);
	});

	it('rejects a malformed date, a missing summary and an empty tag list', () => {
		expect(() => validateChangelogEntries([entry({ date: '2026-11-1' })])).toThrow(/YYYY-MM-DD/);
		expect(() => validateChangelogEntries([entry({ summary: '' })])).toThrow(/title and summary/);
		expect(() => validateChangelogEntries([entry({ tags: [] })])).toThrow(/at least one tag/);
	});

	it('rejects a verbatim duplicate but keeps distinct entries that share a title', () => {
		expect(() => validateChangelogEntries([entry(), entry()])).toThrow(/duplicated verbatim/);
		expect(() => validateChangelogEntries([entry(), entry({ summary: 'Different words' })])).not.toThrow();
	});

	it('allows every documented tag', () => {
		expect([...CHANGELOG_TAGS]).toEqual(['feature', 'improvement', 'fix', 'sdk', 'infra', 'docs', 'security', 'desktop']);
	});
});
