// /api/pulse avatar thumbnail URLs (prompt-402 "console errors" work order).
//
// `r2Url()` built every `avatar_thumbnail_url` in the Money Pulse feed, the
// agent wallet story, and the money-flow graph from `publicUrlOrNull()`: the
// raw `*.r2.dev` bucket domain. An <img> pointed at that domain trips Chrome's
// Opaque Response Blocking the moment the response's actual content doesn't
// match what an <img> tag expects (and ORBs outright on a 404's text/plain
// body for a since-deleted key). thumbnailUrl() is the ORB-safe, same-origin
// /cdn/ form every other avatar thumbnail already uses, and it additionally
// nulls out the legacy-poisoned *_og.png keys a stale cache bug once wrote
// (see isLegacyOgThumbnailKey() in api/_lib/r2.js).
//
// api/pulse.js has heavy top-level DB/cache dependencies, so (matching
// tests/pulse-marketplace-paid-filter.test.js) this pins the fix against the
// source text rather than importing the module.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../api/pulse.js', import.meta.url)), 'utf8');

describe('pulse avatar thumbnail URLs are ORB-safe', () => {
	it('imports thumbnailUrl from r2.js', () => {
		expect(SRC).toMatch(/import\s*\{[^}]*\bthumbnailUrl\b[^}]*\}\s*from\s*'\.\/_lib\/r2\.js'/);
	});

	it('builds r2Url() on thumbnailUrl(), not the raw bucket domain', () => {
		const def = SRC.match(/const r2Url = \([^)]*\) =>\s*\n?\s*[^\n;]+;/);
		expect(def, 'r2Url() helper should exist').toBeTruthy();
		expect(def[0]).toMatch(/thumbnailUrl\(/);
		expect(def[0]).not.toMatch(/r2PublicUrl\(|publicUrlOrNull\(/);
	});
});
