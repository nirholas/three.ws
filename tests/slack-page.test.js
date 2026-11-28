// /slack is the page the Slack Marketplace listing and the install receiver
// both send people to. It promises commands and lists scopes, so it must stay
// in step with the code that implements them, and it must be routable.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../api/_lib/gateway/commands.js';
import { SLACK_BOT_SCOPES } from '../api/_lib/gateway/slack-installs.js';
import { readOutcome } from '../src/slack-page.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(ROOT, 'pages/slack.html'), 'utf8');
const receiver = readFileSync(path.join(ROOT, 'api/gateway/slack.js'), 'utf8');

describe('/slack page content', () => {
	it('only advertises /three commands the gateway implements', () => {
		const names = new Set(COMMANDS.map((c) => c.name));
		const advertised = [...html.matchAll(/<code>\/three ([a-z]+)/g)].map((m) => m[1]);
		expect(advertised.length).toBeGreaterThan(5);
		for (const name of advertised) expect(names, `/three ${name}`).toContain(name);
	});

	it('explains exactly the scopes the install requests', () => {
		const block = html.match(/<ul class="sk-scopes"[\s\S]*?<\/ul>/)[0];
		const listed = [...block.matchAll(/<li><code>([a-z:_]+)<\/code>/g)].map((m) => m[1]);
		expect([...listed].sort()).toEqual([...SLACK_BOT_SCOPES].sort());
	});

	it('handles every outcome the receiver can redirect here with', () => {
		const statuses = new Set(['cancelled', 'expired', 'failed', 'not_configured']);
		for (const m of receiver.matchAll(/outcome\(res, signedIn, '([a-z_]+)'/g)) {
			if (m[1] !== 'installed') expect(statuses, m[1]).toContain(m[1]);
		}
		for (const s of statuses) expect(readOutcome(`?install=${s}`)).toEqual({ kind: s });
	});

	it('uses only well-formed Slack ids for the Open in Slack link', () => {
		expect(readOutcome('?installed=1&team=T012AB3C4&app=A0123ABCD')).toEqual({ kind: 'installed', team: 'T012AB3C4', app: 'A0123ABCD' });
		expect(readOutcome('?installed=1&team=T1%26x%3D1&app=a/b')).toEqual({ kind: 'installed', team: null, app: null });
		expect(readOutcome('?install=__proto__')).toBeNull();
		expect(readOutcome('')).toBeNull();
	});
});

describe('/slack routing', () => {
	it.each(['/slack', '/slack/', '/integrations/slack', '/slack?installed=1&team=T1&app=A1'])('serves the page for %s', async (href) => {
		const { loadRouteTable, resolvePhase1 } = await import('../server/route-resolve.mjs');
		const { phase1Routes } = loadRouteTable(path.join(ROOT, 'vercel.json'));
		const out = resolvePhase1(phase1Routes, { headers: {} }, new URL(href, 'https://three.ws'));
		expect(out.terminal).toBeNull();
		expect(out.path).toBe('/slack.html');
	});

	it('is a build input and a listed page', () => {
		expect(readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8')).toContain("slack: resolve(__dirname, 'pages/slack.html')");
		const pages = JSON.parse(readFileSync(path.join(ROOT, 'data/pages.json'), 'utf8'));
		const all = JSON.stringify(pages);
		expect(all).toContain('"path":"/slack"');
	});
});
