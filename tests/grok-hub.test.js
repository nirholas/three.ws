// /grok is the one page that shows everything three.ws does with Grok. These
// checks pin the parts a reader acts on: the section order, every install value
// and deep link, the showcase posters and share card, the Live and Reliability
// numbers, and the approved Grok for Startups wording.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GROK_ENDPOINT } from '../src/grok-connector.js';
import { formatAgo, formatCount, formatMs, formatRate, statsTiles, uptimeRows } from '../src/grok-hub-live.js';

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

const html = fs.readFileSync(path.join(ROOT, 'pages/grok.html'), 'utf8');
const CONNECTOR_URL = `${GROK_ENDPOINT}?auth=oauth`;
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const textOf = (id) => {
	const m = html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</(?:code|pre|p)>`));
	if (!m) throw new Error(`no element #${id}`);
	return decode(m[1].replace(/<[^>]+>/g, '')).trim();
};

describe('/grok structure', () => {
	it('lists the sections in the order the reader needs them', () => {
		const order = [...html.matchAll(/<section class="gk-sec" id="([a-z]+)"/g)].map((m) => m[1]).filter((id) => id !== 'bot');
		expect(order).toEqual(['install', 'make', 'build', 'live', 'reliability', 'faq']);
	});

	it('every on-page nav link and hero action lands on an element that exists', () => {
		const nav = html.match(/<ul class="gk-toc">([\s\S]*?)<\/ul>/)[1];
		const hero = html.match(/<div class="gk-actions">([\s\S]*?)<\/div>/)[1];
		const hashes = [...`${nav}${hero}`.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
		expect(hashes.length).toBe(8);
		for (const id of hashes) expect(html).toContain(`id="${id}"`);
	});

	it('every install tab controls a panel named install-<key>, so a hash opens it', () => {
		const tabs = [...html.matchAll(/role="tab" id="tab-([a-z]+)" aria-controls="([^"]+)"/g)];
		expect(tabs.map((m) => m[1])).toEqual(['bot', 'grokcom', 'build', 'cursor', 'any', 'api']);
		for (const [, key, panel] of tabs) {
			expect(panel).toBe(`install-${key}`);
			expect(html).toMatch(new RegExp(`role="tabpanel" id="${panel}" aria-labelledby="tab-${key}"`));
		}
	});

	it('states only the approved Grok for Startups line, and stays token-free', () => {
		expect(html).toContain(`<p class="gk-cred">three.ws is a member of xAI's Grok for Startups program.</p>`);
		expect(html).not.toMatch(/partner of xai|xai partner|backed by xai|official grok|endorsed by spacex|\$THREE|solana|pump\.fun|wallet|trading/i);
	});
});

describe('/grok install values', () => {
	it('every pasted URL is the Grok connector with OAuth sign-in', () => {
		for (const id of ['gk-url-bot', 'gk-url-web', 'gk-url-any']) expect(textOf(id)).toBe(CONNECTOR_URL);
	});

	it('the CLI commands add the server under three-ws-grok', () => {
		expect(textOf('gk-build-add')).toBe(`grok mcp add --transport http three-ws-grok "${CONNECTOR_URL}"`);
		expect(textOf('gk-any-claude')).toBe(`claude mcp add --transport http three-ws-grok "${CONNECTOR_URL}"`);
		const code = textOf('gk-any-code').match(/^code --add-mcp '(.+)'$/);
		expect(JSON.parse(code[1])).toEqual({ name: 'three-ws-grok', type: 'http', url: CONNECTOR_URL });
	});

	it('every JSON config parses and points three-ws-grok at the connector', () => {
		for (const id of ['gk-build-mcp', 'gk-cursor-json', 'gk-any-json']) {
			const cfg = JSON.parse(textOf(id));
			expect(Object.keys(cfg.mcpServers)).toEqual(['three-ws-grok']);
			expect(cfg.mcpServers['three-ws-grok'].url).toBe(CONNECTOR_URL);
		}
	});

	it('the Cursor link follows the documented install-link format', () => {
		const href = decode(html.match(/id="gk-cursor-link" href="([^"]+)"/)[1]);
		const url = new URL(href);
		expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('cursor://anysphere.cursor-deeplink/mcp/install');
		expect(url.searchParams.get('name')).toBe('three-ws-grok');
		expect(JSON.parse(Buffer.from(url.searchParams.get('config'), 'base64').toString('utf8'))).toEqual({ url: CONNECTOR_URL });
	});
});

describe('/grok showcase and share card', () => {
	const script = fs.readFileSync(path.join(ROOT, 'scripts/build-grok-assets.mjs'), 'utf8');
	const SHOWCASE = [...script.match(/export const SHOWCASE = \[([\s\S]*?)\];/)[1].matchAll(/'([0-9a-f-]{36})'/g)].map((m) => m[1]);

	it('every showcase card links a model the build script renders, with its poster on disk', () => {
		const cards = [...html.matchAll(/<a href="\/m\/([0-9a-f-]{36})"><img src="\/grok\/showcase\/([0-9a-f-]{36})\.webp"/g)];
		expect(cards.map((m) => m[1])).toEqual(SHOWCASE);
		for (const [, id, poster] of cards) {
			expect(poster).toBe(id);
			expect(fs.existsSync(path.join(ROOT, `public/grok/showcase/${id}.webp`))).toBe(true);
		}
	});

	it('og:image and twitter:image are the 1200x630 card on disk', () => {
		expect(html).toContain('<meta property="og:image" content="https://three.ws/og/grok.png" />');
		expect(html).toContain('<meta name="twitter:image" content="https://three.ws/og/grok.png" />');
		const png = fs.readFileSync(path.join(ROOT, 'public/og/grok.png'));
		expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
	});
});

describe('/grok live numbers', () => {
	it('formats counts, rates and latencies without rounding up', () => {
		expect(formatCount(9999)).toBe('9,999');
		expect(formatCount(12_345)).toBe('12.3K');
		expect(formatCount(-1)).toBe('0');
		expect(formatRate(1)).toBe('100%');
		expect(formatRate(0.99996)).toBe('99.99%');
		expect(formatRate(null)).toBe('No probes yet');
		expect(formatMs(840.4)).toBe('840 ms');
		expect(formatMs(2400)).toBe('2.4 s');
		expect(formatMs(null)).toBe('n/a');
	});

	it('says how long ago a probe ran', () => {
		const now = Date.parse('2026-11-20T12:00:00Z');
		expect(formatAgo('2026-11-20T11:59:40Z', now)).toBe('just now');
		expect(formatAgo('2026-11-20T11:56:00Z', now)).toBe('4 minutes ago');
		expect(formatAgo('2026-11-20T10:00:00Z', now)).toBe('2 hours ago');
		expect(formatAgo('not a date', now)).toBe('at an unknown time');
	});

	it('builds the three tiles from a stats answer and nothing from an error body', () => {
		const view = statsTiles({
			counting_since: '2026-11-02T08:00:00.000Z',
			models: { '24h': 3, '30d': 41 },
			tool_calls: { '24h': 20, '30d': 12_800 },
			clients: { '30d': 7 },
			methodology: { models: 'Distinct GLBs.', clients: 'Signed-in only.' },
		});
		expect(view.tiles.map((t) => [t.key, t.value])).toEqual([['models', '41'], ['tool_calls', '12.8K'], ['clients', '7']]);
		expect(view.tiles[0].detail).toBe('3 in the last 24 hours');
		expect(view.since).toBe('Counting since Nov 2, 2026 (UTC).');
		expect(view.methodology).toEqual(['Distinct GLBs.', 'Signed-in only.']);
		expect(statsTiles({ error: 'internal' })).toBeNull();
		expect(statsTiles(null)).toBeNull();
	});

	it('lists the Grok-facing servers in order and ignores the rest', () => {
		const server = (p, rate) => ({ name: p, path: p, server: `https://three.ws${p}`, last: { checkedAt: '2026-11-20T11:58:00Z', ok: true }, windows: { '24h': { successRate: 1 }, '30d': { probes: 8640, successRate: rate, handshakeP50Ms: 310, toolCallP50Ms: 1250 } } });
		const rows = uptimeRows({ servers: [server('/api/mcp', 1), server('/api/mcp-studio', 0.998), server('/api/mcp-grok', 0.9995)] });
		expect(rows.map((r) => [r.path, r.up30d, r.probes30d, r.handshakeP50, r.toolCallP50, r.lastOk])).toEqual([
			['/api/mcp-grok', '99.95%', '8,640', '310 ms', '1.3 s', true],
			['/api/mcp-studio', '99.80%', '8,640', '310 ms', '1.3 s', true],
		]);
		expect(uptimeRows({ servers: [server('/api/mcp', 1)] })).toBeNull();
		expect(uptimeRows({ error: 'down' })).toBeNull();
	});
});
