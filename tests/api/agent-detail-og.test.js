// The bot-UA rewrite for /agents/:id lands crawlers on api/agent-detail-og.js.
// That page is the only version of the agent a search engine ever sees, so it
// carries the agent's real content, keeps private agents out entirely (the
// query used to omit is_public and served their name and description to
// anything sending a bot UA), and never hands an indexing crawler a script that
// navigates back to the URL it is already on.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeReq, makeRes } from '../_helpers/monetization.js';

const sqlState = { rows: [], queue: null, calls: 0, seen: [] };

vi.mock('../../api/_lib/db.js', () => {
	const sql = vi.fn(async (strings) => {
		sqlState.seen.push(strings.join(' ? '));
		const rows = sqlState.queue ? (sqlState.queue[sqlState.calls] ?? []) : sqlState.rows;
		sqlState.calls += 1;
		return rows;
	});
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const { default: handler } = await import('../../api/agent-detail-og.js');

const AGENT_ID = '00000000-0000-4000-8000-0000000000a1';
const GOOGLEBOT =
	'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/128.0.0.0 Safari/537.36';
const UNFURLER = 'Mozilla/5.0 (compatible; TelegramBot; like TwitterBot)';

const AGENT_ROW = {
	id: AGENT_ID,
	name: 'Atlas',
	description: 'A market-watching agent.',
	skills: ['research', 'trading'],
	home_url: 'https://example.com/atlas',
	erc8004_agent_id: '4821',
	chain_id: 8453,
	created_at: new Date('2026-05-04T00:00:00Z'),
	updated_at: new Date('2026-06-01T00:00:00Z'),
};

async function invokeHtml(reqOpts) {
	const req = makeReq({ headers: { 'user-agent': GOOGLEBOT }, ...reqOpts });
	const res = makeRes();
	await handler(req, res);
	return { status: res.statusCode, headers: res.headers, html: res.body };
}

beforeEach(() => {
	sqlState.rows = [];
	sqlState.queue = null;
	sqlState.calls = 0;
	sqlState.seen = [];
});

describe('agent-detail-og', () => {
	it('rejects a non-GET method with 405 before touching the db', async () => {
		const { status } = await invokeHtml({
			method: 'POST',
			url: `/api/agent-detail-og?id=${AGENT_ID}`,
		});
		expect(status).toBe(405);
		expect(sqlState.calls).toBe(0);
	});

	it('only reads public agents', async () => {
		sqlState.rows = [AGENT_ROW];
		await invokeHtml({ url: `/api/agent-detail-og?id=${AGENT_ID}` });
		expect(sqlState.seen[0]).toMatch(/is_public = true/);
	});

	it('404s an unknown agent instead of redirecting to the directory', async () => {
		const { status, html } = await invokeHtml({ url: `/api/agent-detail-og?id=${AGENT_ID}` });
		expect(status).toBe(404);
		expect(html).toMatch(/name="robots" content="noindex/);
		expect(sqlState.calls).toBe(2);
	});

	it('301s to /avatars/:id when the id names an avatar, not an agent', async () => {
		sqlState.queue = [[], [{ id: AGENT_ID }]];
		const { status, headers } = await invokeHtml({ url: `/api/agent-detail-og?id=${AGENT_ID}` });
		expect(status).toBe(301);
		expect(headers.location).toBe(`https://three.ws/avatars/${AGENT_ID}`);
	});

	it('renders the agent as real indexable content', async () => {
		sqlState.rows = [AGENT_ROW];
		const { status, html } = await invokeHtml({ url: `/api/agent-detail-og?id=${AGENT_ID}` });
		expect(status).toBe(200);
		expect(html).toMatch(/<h1>Atlas<\/h1>/);
		expect(html).toContain('A market-watching agent.');
		expect(html).toContain('research, trading');
		expect(html).toContain('ERC-8004 agent #4821');
		expect(html).toMatch(/rel="canonical" href="https:\/\/three\.ws\/agents\//);
		expect(html).toContain('"@type":"SoftwareApplication"');
		expect(html).not.toContain('<noscript>');
	});

	it('marks the agent home link nofollow so a crawler does not pass authority out', async () => {
		sqlState.rows = [AGENT_ROW];
		const { html } = await invokeHtml({ url: `/api/agent-detail-og?id=${AGENT_ID}` });
		expect(html).toMatch(/rel="nofollow noopener"/);
	});

	it('renders an untouched onboarding agent noindex, with no canonical', async () => {
		sqlState.rows = [
			{
				...AGENT_ROW,
				name: 'My First Agent',
				description:
					'A friendly starter agent. Edit the personality and attach a 3D avatar \u2014 it goes live immediately.',
			},
		];
		const { status, html } = await invokeHtml({ url: `/api/agent-detail-og?id=${AGENT_ID}` });
		// The page still renders and still unfurls; it just does not ask to rank.
		expect(status).toBe(200);
		expect(html).toMatch(/<h1>My First Agent<\/h1>/);
		expect(html).toContain('og:image');
		expect(html).toMatch(/name="robots" content="noindex, follow"/);
		expect(html).not.toContain('rel="canonical"');
	});

	it('never emits a self-navigating script for an indexing crawler', async () => {
		sqlState.rows = [AGENT_ROW];
		const { html } = await invokeHtml({ url: `/api/agent-detail-og?id=${AGENT_ID}` });
		expect(html).not.toContain('location.replace');
	});

	it('still bounces a link unfurler to the app', async () => {
		sqlState.rows = [AGENT_ROW];
		const { html } = await invokeHtml({
			url: `/api/agent-detail-og?id=${AGENT_ID}`,
			headers: { 'user-agent': UNFURLER },
		});
		expect(html).toContain(`location.replace("/agents/${AGENT_ID}")`);
	});
});
