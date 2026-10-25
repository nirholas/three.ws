// /settings is one hash-routed single-page app (public/settings/index.html).
// Its catch-all must fall back to that shell. Mapping /settings/(.*) to
// /settings/$1 looks for a file that does not exist, so every deep link the
// server itself hands out (/settings/connections from the bot pairing prompt,
// the X connect return URL and the notification settings copy) returned 404.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vercelConfig = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

describe('/settings SPA catch-all', () => {
	it('falls back to the settings shell for any subpath', () => {
		const rule = vercelConfig.routes.find((r) => r.src === '/settings/(.*)');
		expect(rule, 'vercel.json has no /settings/(.*) rule').toBeTruthy();
		expect(rule.dest).toBe('/settings/index.html');
	});

	it('serves a real file at the shell destination', () => {
		expect(existsSync(path.join(ROOT, 'public/settings/index.html'))).toBe(true);
	});

	it('keeps the api-keys redirect ahead of the catch-all', () => {
		const idx = (src) => vercelConfig.routes.findIndex((r) => r.src === src);
		expect(idx('/settings/api-keys/?')).toBeGreaterThan(-1);
		expect(idx('/settings/api-keys/?')).toBeLessThan(idx('/settings/(.*)'));
	});
});
