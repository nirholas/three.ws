// An ad blocker, a corporate filter or a flaky request can drop /i18n.js. Vite
// folds every `<script type="module">` of a page into ONE entry chunk, so a
// module tag for /i18n.js becomes `import "/i18n.js"` at the top of the game
// bundle and a blocked i18n.js stops the whole world from starting (the boot
// error card appears). /play must load it as an optional extra instead.
//
// The optional load must also survive `vite build`: Vite's HTML pass rewrites a
// dynamic `import('/i18n.js')` even inside a classic inline script, resolves it
// as an on-disk asset and fails the whole frontend build (ENOENT i18n.js), which
// blocked the 2026-11-06 deploy. Injecting a separate module script element keeps
// the failure isolated at runtime and leaves nothing for the build to resolve.

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

	it('does not dynamically import /i18n.js from inline script (breaks vite build)', () => {
		expect(html).not.toMatch(/import\(\s*['"]\/i18n\.js['"]\s*\)/);
	});

	it('still loads /i18n.js as its own module script, with a handler for the load failing', () => {
		const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
		const body = inline.find((b) => /['"]\/i18n\.js['"]/.test(b));
		expect(body).toBeDefined();
		expect(body).toMatch(/createElement\(\s*['"]script['"]\s*\)/);
		expect(body).toMatch(/\.type\s*=\s*['"]module['"]/);
		expect(body).toMatch(/\.src\s*=\s*['"]\/i18n\.js['"]/);
		expect(body).toMatch(/\.onerror\s*=/);
	});
});
