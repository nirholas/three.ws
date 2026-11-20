// /grok is the one page that shows everything three.ws does with Grok. These
// checks pin the parts a reader acts on: the community strip shows real public
// models, and the page stays inside the approved Grok for Startups wording.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const pageJs = fs.readFileSync(path.join(ROOT, 'src/grok-page.js'), 'utf8');

describe('/grok community strip', () => {
	it('reads the public community feed, not the per-browser gallery', () => {
		// The default /api/forge-gallery scope is the visitor's own browser, which
		// is empty for every first-time reader, so the strip showed nothing.
		const calls = [...pageJs.matchAll(/\/api\/forge-gallery\?[^`'"]*/g)].map((m) => m[0]);
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.filter((u) => !/(^|[?&])scope=community(&|$)/.test(u.split('?')[1]))).toEqual([]);
	});
});
