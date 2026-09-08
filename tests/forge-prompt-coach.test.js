/**
 * The forge composer's prompt coach ships its settled message in the HTML.
 *
 * `.prompt-tools` is a flex-wrap row holding the Surprise button, the coach and
 * the character counter. The coach used to ship EMPTY, and `updateCoach()` wrote
 * grade('')'s message into it once the module ran. At desktop widths that text
 * does not fit beside its neighbours, so the row wrapped onto a second line and
 * grew 38px, pushing the quality tiles, the composer and the example-prompt row
 * down with it. Measured against production on 2026-09-08, /forge's CLS was
 * 0.2523 on a Pixel 5, and the growth of the containers above `#examples` is
 * what moves it (see docs/site-performance.md).
 *
 * Shipping the settled text is only a fix while the two copies agree. This test
 * reads them both out of their own files rather than restating either, so
 * editing one without the other fails here instead of silently restoring the
 * shift.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'pages/forge.html'), 'utf8');
const STUDIO = readFileSync(join(ROOT, 'src/forge-prompt-studio.js'), 'utf8');

// The message grade() returns for an empty prompt: the first `msg:` after the
// `if (!text)` branch.
function emptyPromptMessage() {
	const branch = STUDIO.indexOf('if (!text) {');
	expect(branch).toBeGreaterThan(-1);
	const msg = /msg:\s*'((?:[^'\\]|\\.)*)'/.exec(STUDIO.slice(branch));
	expect(msg).not.toBeNull();
	return msg[1];
}

function shippedCoachText() {
	const el = /<span class="prompt-coach"[^>]*>([\s\S]*?)<\/span>/.exec(HTML);
	expect(el).not.toBeNull();
	return el[1].trim();
}

describe('forge prompt coach reserves its own row', () => {
	it('ships the message rather than an empty span', () => {
		expect(shippedCoachText().length).toBeGreaterThan(20);
	});

	it('ships exactly what grade("") writes, so the swap moves nothing', () => {
		expect(shippedCoachText()).toBe(emptyPromptMessage());
	});

	it('carries the grade the empty state renders with', () => {
		const tag = /<span class="prompt-coach"[^>]*>/.exec(HTML)[0];
		expect(tag).toContain(`data-grade="tip"`);
	});

	it('opts out of i18n, because the text becomes dynamic on the first keystroke', () => {
		// docs/site-performance.md rule 6: a node whose text a script owns cannot
		// also carry a catalog key, or the catalog pass reverts it.
		const tag = /<span class="prompt-coach"[^>]*>/.exec(HTML)[0];
		expect(tag).toContain('data-no-i18n');
		expect(tag).not.toContain('data-i18n=');
	});
});
