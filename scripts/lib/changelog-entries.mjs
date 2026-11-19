// Validation for the curated entries in data/changelog.json. Shared by
// scripts/build-page-index.mjs (which fails the build on a bad entry) and
// tests/changelog-entries.test.js (which fails `npm test` first, so a bad
// entry never reaches a deploy).

// `desktop` marks entries that ship in the desktop app: apps/desktop/scripts/bump-version.mjs
// collects them into each release's notes.
export const CHANGELOG_TAGS = new Set(['feature', 'improvement', 'fix', 'sdk', 'infra', 'docs', 'security', 'desktop']);

// Community delivery keys an entry by date + title (api/_lib/changelog-push.js),
// so a repeated entry is a repeated Telegram announcement to every subscriber.
// Concurrent agents editing this file have produced that byte-for-byte three
// times. An identical repeat carries no information, so it is rejected here
// rather than caught downstream. Entries that merely share a date and title
// while saying different things are left alone: that is a wording call on
// published copy, and the delivery layer collapses them either way.
export function validateChangelogEntries(entries) {
	const identicalEntries = new Map();
	for (const [index, e] of entries.entries()) {
		const ctx = `data/changelog.json entry "${e.title || '?'}" (${e.date || 'no date'})`;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) throw new Error(`${ctx}: date must be YYYY-MM-DD`);
		if (!e.title || !e.summary) throw new Error(`${ctx}: title and summary are required`);
		if (!Array.isArray(e.tags) || e.tags.length === 0) throw new Error(`${ctx}: at least one tag required`);
		for (const t of e.tags) {
			if (!CHANGELOG_TAGS.has(t)) throw new Error(`${ctx}: unknown tag "${t}" (allowed: ${[...CHANGELOG_TAGS].join(', ')})`);
		}
		const fingerprint = JSON.stringify(e);
		if (identicalEntries.has(fingerprint)) {
			throw new Error(`${ctx}: duplicated verbatim (also at index ${identicalEntries.get(fingerprint)}); delete one copy`);
		}
		identicalEntries.set(fingerprint, index);
	}
	return entries;
}
