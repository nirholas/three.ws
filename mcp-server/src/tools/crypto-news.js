// `crypto_news` — FREE MCP tool: live crypto headlines from the three.ws
// native aggregator (197 publisher RSS/Atom feeds across 27 categories and
// 17 languages, per-source cached with serve-stale-on-error). No payment, no
// key. Backed by GET /api/news/feed — the same endpoint behind
// three.ws/markets/news.

import { z } from 'zod';

import { free } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { NEWS_API_BASE, newsApiGet, slimArticle } from './_news-core.js';

const TOOL_NAME = 'crypto_news';
const TOOL_DESCRIPTION =
	'Live crypto news headlines aggregated by three.ws directly from 197 publisher RSS/Atom feeds, ' +
	'CoinDesk, The Block, Decrypt, CoinTelegraph, SEC press, exchange blogs, research desks, and ' +
	'international outlets in 17 languages. Filter by category (bitcoin, ethereum, solana, defi, nft, ' +
	'trading, research, security, regulation-adjacent geopolitical, and more), by a single source key, ' +
	'by language, or full-text search the headlines. Each article returns title, publisher link, source, ' +
	'publish time, detected tickers, and lexicon sentiment. An invalid category/source errors with the ' +
	'valid list, so retry from that. Use this for raw, filterable headlines; for the day grouped into ' +
	'stories use crypto_news_digest, and for coverage older than a few days use crypto_news_archive. Free: no payment or API key required.';

const inputZodShape = {
	q: z.string().max(80).describe('Full-text filter over title/description/tickers, e.g. "bitcoin etf" or "SOL".').optional(),
	category: z
		.string()
		.max(24)
		.describe('One category slug, e.g. bitcoin, ethereum, solana, defi, nft, trading, research, onchain, security, mainstream, geopolitical, journalism. Omit for all. Invalid values error with the full list.')
		.optional(),
	source: z.string().max(40).describe('A single source key (e.g. coindesk, theblock, sec_press) — overrides category and lang.').optional(),
	lang: z
		.string()
		.max(5)
		.describe('Language code: en (default), or any of the 17 registry languages (zh, ja, ko, es, de, fr, …), or "all" to interleave every language.')
		.optional(),
	limit: z.number().int().min(1).max(50).describe('Max articles to return (default 20).').optional(),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

async function runCryptoNews({ q, category, source, lang, limit = 20 } = {}) {
	const body = await newsApiGet('/api/news/feed', { q, category, source, lang, limit });
	if (body.ok === false) return body; // toolError envelope, verbatim

	return {
		ok: true,
		total_matching: body.total,
		count: body.articles.length,
		sources_live: `${body.sources_ok}/${body.sources_total}`,
		fetched_at: body.fetched_at,
		articles: body.articles.map(slimArticle),
		browse_url: `${NEWS_API_BASE}/markets/news${q ? `?q=${encodeURIComponent(q)}` : ''}`,
		rss_url: `${NEWS_API_BASE}/api/news/rss`,
	};
}

export function buildCryptoNewsTool() {
	const handler = free({ toolName: TOOL_NAME, inputSchema: inputJsonSchema }, (args) => runCryptoNews(args));
	return {
		name: TOOL_NAME,
		title: 'Crypto news (live, 197 feeds)',
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// Read-only view over a live feed: repeat calls are safe but not
		// byte-identical (new stories arrive), and it reaches the open web.
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		handler,
	};
}

// ── news_resolve ───────────────────────────────────────────────────────────
// Resolve one article URL into a bounded excerpt, our own analysis, and a
// structured trading read, through GET /api/news/article. That endpoint walks
// the extraction ladder (page, reader, Wayback, SEC EDGAR, sibling coverage,
// publisher feed, preview) and enforces the standing excerpt limit, so this
// tool never returns a publisher's full body.

const RESOLVE_NAME = 'news_resolve';
const RESOLVE_DESCRIPTION =
	'Resolve a crypto news article URL into what an agent can act on: a bounded lead excerpt, a summary, key points, ' +
	'detected tickers, and a structured trading read (affected assets with exposure and direction, whether the news is ' +
	'priced in, horizon, and a counter-argument). When the publisher blocks fetches or paywalls the story, three.ws ' +
	'recovers it from the Internet Archive, the SEC EDGAR filing of the company named in the headline, or other outlets ' +
	'covering the same story, and says which lane it used in `extraction`. The excerpt is a quotation, not the article: ' +
	'follow `full_text_url` for the rest. Free: no payment or API key required.';

const resolveZodShape = {
	url: z.string().url().max(2000).describe('Absolute http(s) link to the article, e.g. a `link` from crypto_news.'),
	title: z.string().max(300).describe('Headline, if known. Improves the SEC filing and sibling-coverage lanes.').optional(),
};

const resolveJsonSchema = jsonSchemaFromZod(resolveZodShape);

async function runNewsResolve({ url, title } = {}) {
	const body = await newsApiGet('/api/news/article', { url, title }, { timeoutMs: 60_000 });
	if (body.ok === false) return body;
	return {
		ok: true,
		title: body.title,
		source: body.source,
		published_at: body.published_at,
		extraction: body.extraction,
		lane_sources: body.lane_sources?.length ? body.lane_sources : undefined,
		blocked_reason: body.blocked_reason || undefined,
		excerpt: body.paragraphs,
		excerpt_truncated: body.excerpt_truncated,
		full_text_url: body.full_text_url,
		summary: body.summary,
		key_points: body.key_points,
		sentiment: body.sentiment,
		tickers: body.tickers,
		trading: body.trading || undefined,
		analysis_provider: body.analysis_provider,
	};
}

export function buildNewsResolveTool() {
	const handler = free({ toolName: RESOLVE_NAME, inputSchema: resolveJsonSchema }, (args) => runNewsResolve(args));
	return {
		name: RESOLVE_NAME,
		title: 'Resolve a news article (excerpt, analysis, trading read)',
		description: RESOLVE_DESCRIPTION,
		inputSchema: resolveZodShape,
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		},
		handler,
	};
}
