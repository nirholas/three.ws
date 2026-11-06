// An ad blocker, a corporate filter or a flaky request can drop /i18n.js. Vite
// folds every `<script type="module">` of a page into ONE entry chunk, so a
// module tag for /i18n.js becomes `import "/i18n.js"` at the top of the game
// bundle and a blocked i18n.js stops the whole world from starting (the boot
// error card appears). /play must load it as an optional extra instead.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'pages/play.html'), 'utf8');

describe('/play optional locale runtime', () => {
	it('does not statically import /i18n.js through a module script tag', () => {
		expect(html).not.toMatch(/<script[^>]*type=["']module["'][^>]*src=["']\/i18n\.js["']/);
	});

	it('still loads /i18n.js, with a handler for the load failing', () => {
		expect(html).toMatch(/import\(\s*['"]\/i18n\.js['"]\s*\)\s*\.catch\(/);
	});
});
