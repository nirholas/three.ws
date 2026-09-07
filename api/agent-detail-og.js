/**
 * Crawler page for agent detail (/agents/:id)
 * -------------------------------------------
 * GET /api/agent-detail-og?id=<agentId>
 *
 * Wired via vercel.json: when a crawler User-Agent hits /agents/<uuid>, a
 * "has" condition rewrites to this endpoint. Real browsers never reach it, so
 * this is the only version of the page a search engine or a link unfurler ever
 * sees, and it has to carry the agent's real content rather than meta tags over
 * a spinner. See the header of api/_lib/crawler-page.js.
 *
 * Mirrors api/avatar-detail-og.js.
 */

import { sql } from './_lib/db.js';
import { cors, method, wrap } from './_lib/http.js';
import { env } from './_lib/env.js';
import { isUuid } from './_lib/validate.js';
import { esc, isSearchCrawler, renderCrawlerPage, renderCrawlerNotFound } from './_lib/crawler-page.js';
import { isIndexableAgent } from './_lib/indexable-entity.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	// Crawler-only SSR read. Without this, a POST answered with a page instead
	// of the 405 the advertised Allow set promises.
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('id');
	const origin = env.APP_ORIGIN || 'https://three.ws';
	const ua = req.headers?.['user-agent'];
	// Only a non-indexing scraper gets bounced to the app. An indexing crawler
	// runs that script, lands back on this same URL behind the same UA branch,
	// and loops on an identical response.
	const redirect = !isSearchCrawler(ua);

	if (!agentId || !isUuid(agentId)) {
		return generic(res, origin, agentId, redirect);
	}

	let agent;
	try {
		[agent] = await sql`
			SELECT i.id, i.name, i.description, i.skills, i.home_url,
			       i.erc8004_agent_id, i.chain_id, i.created_at, i.updated_at
			FROM agent_identities i
			WHERE i.id = ${agentId} AND i.deleted_at IS NULL AND i.is_public = true
			LIMIT 1
		`;
	} catch {
		// A read failure is ours, not the URL's. 503 asks the crawler to come
		// back; a 404 or a redirect here would drop a live page from the index.
		return unavailable(res, origin);
	}

	if (!agent) {
		// Agents and avatars have separate uuid spaces and links cross over
		// (see resolveEntity in src/avatar-page.js). Send the crawler to the
		// path that actually holds the entity instead of reporting nothing.
		let avatar = null;
		try {
			[avatar] = await sql`
				SELECT id FROM avatars
				WHERE id = ${agentId} AND deleted_at IS NULL AND visibility = 'public' LIMIT 1
			`;
		} catch {
			return unavailable(res, origin);
		}
		if (avatar) {
			res.statusCode = 301;
			res.setHeader('location', `${origin}/avatars/${agentId}`);
			res.setHeader('cache-control', 'public, max-age=300');
			res.end();
			return;
		}
		return gone(res, origin);
	}

	const title = agent.name || 'Agent';
	const baseDesc =
		agent.description || 'An AI agent on three.ws, with a body, a place, and an identity.';
	const skills = Array.isArray(agent.skills) ? agent.skills : [];
	const skillSuffix = skills.length
		? ` Skills: ${skills.slice(0, 4).join(', ')}${skills.length > 4 ? '…' : ''}.`
		: '';
	const desc = baseDesc + skillSuffix;

	// Unfurl with the dynamic wallet TRADING CARD (api/og/agent.js) - the same
	// living card shown on the page (avatar, vanity address, live net worth, P&L,
	// reputation tier, finish), rendered from real data. The card embeds the
	// avatar itself, so a shared link previews with identity + wallet, not a bare
	// thumbnail. The card endpoint falls back to the brand image if it can't render.
	const ogImage = `${origin}/api/og/agent?id=${encodeURIComponent(agentId)}`;
	const pageUrl = `${origin}/agents/${agentId}`;

	const facts = [];
	if (skills.length) {
		facts.push({
			term: 'Skills',
			detail: skills.slice(0, 12).map((s) => esc(s)).join(', '),
		});
	}
	if (agent.erc8004_agent_id) {
		facts.push({
			term: 'On-chain identity',
			detail: `ERC-8004 agent #${esc(agent.erc8004_agent_id)}${agent.chain_id ? ` on chain ${esc(agent.chain_id)}` : ''}`,
		});
	}
	if (agent.home_url && /^https?:\/\//i.test(agent.home_url)) {
		const h = esc(agent.home_url);
		facts.push({ term: 'Home', detail: `<a href="${h}" rel="nofollow noopener">${h}</a>` });
	}
	if (agent.created_at) facts.push({ term: 'Registered', detail: isoDay(agent.created_at) });

	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=3600');
	res.end(
		renderCrawlerPage({
			title,
			desc,
			pageUrl,
			ogImage,
			origin,
			ogType: 'profile',
			frameButton: `Meet ${title}`,
			redirect,
			// An untouched onboarding row is identical to every other one, so it
			// unfurls and renders but never asks to be indexed.
			noindex: !isIndexableAgent(agent),
			trail: [
				{ name: 'Home', path: '/' },
				{ name: 'Agents', path: '/agents' },
				{ name: title, path: `/agents/${agentId}` },
			],
			facts,
			// No skill chips: the directory filters on ?q= over name and
			// description, not on a skill facet, so a chip would look like a
			// filter and return an unfiltered list. The skills are in the facts
			// row and in featureList below.
			actions: [
				{ label: 'View in AR', href: `/agents/${agentId}/ar`, primary: true },
				{ label: 'Agent directory', href: '/agents' },
				{ label: 'Build an agent', href: '/create' },
			],
			related: [
				{ label: 'Agent directory', href: '/agents' },
				{ label: 'Agent economy', href: '/agent-economy' },
				{ label: 'Agent marketplace', href: '/marketplace' },
				{ label: 'Avatar gallery', href: '/gallery' },
			],
			jsonLd: {
				'@type': 'SoftwareApplication',
				'@id': pageUrl,
				name: title,
				description: desc,
				url: pageUrl,
				image: ogImage,
				applicationCategory: 'AI agent',
				operatingSystem: 'Web',
				...(skills.length ? { featureList: skills.slice(0, 12) } : {}),
				...(agent.created_at ? { dateCreated: isoDay(agent.created_at) } : {}),
				...(agent.updated_at ? { dateModified: isoDay(agent.updated_at) } : {}),
				publisher: { '@type': 'Organization', name: 'three.ws', url: origin },
			},
		}),
	);
});

/** An id we cannot read: keep the unfurl useful, keep the URL out of the index. */
function generic(res, origin, agentId, redirect) {
	const target = agentId ? `/agents/${encodeURIComponent(agentId)}` : '/agents';
	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'public, max-age=60, s-maxage=600');
	res.end(
		renderCrawlerNotFound({
			heading: 'Agent on three.ws',
			message: 'Open this agent on three.ws to see its body, its wallet, and what it can do.',
			origin,
			actions: [
				{ label: 'Open the agent', href: target },
				{ label: 'Agent directory', href: '/agents' },
			],
			redirect: redirect ? target : '',
		}),
	);
}

/** Nothing public lives at this id. 404 so the URL leaves the index cleanly. */
function gone(res, origin) {
	res.statusCode = 404;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'public, max-age=300');
	res.end(
		renderCrawlerNotFound({
			heading: 'This agent is not public',
			message:
				'The agent behind this link was retired, or its owner keeps it private. The directory lists the ones that are live.',
			origin,
			actions: [
				{ label: 'Agent directory', href: '/agents' },
				{ label: 'Build an agent', href: '/create' },
			],
		}),
	);
}

/** Our read failed. Ask the crawler to retry rather than losing the page. */
function unavailable(res, origin) {
	res.statusCode = 503;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('retry-after', '120');
	res.setHeader('cache-control', 'no-store');
	res.end(
		renderCrawlerNotFound({
			heading: 'Agent temporarily unavailable',
			message: 'three.ws could not load this agent just now. Please try again in a moment.',
			origin,
			actions: [{ label: 'Agent directory', href: '/agents' }],
		}),
	);
}

/** YYYY-MM-DD, the only precision a crawler page needs. */
function isoDay(v) {
	const t = v instanceof Date ? v : new Date(v);
	return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}
