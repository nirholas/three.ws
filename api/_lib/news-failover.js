// Last-resort rung under getNews (api/_lib/news.js): the hosted cryptocurrency.cv
// news API, asked only when the native RSS merge came back empty (cold start,
// feed-wide outage). Its articles are mapped onto our own article shape and
// pass through the same rights, curation and query filters as native ones.
//
// Only /api/v1/news is used. /api/whales and /api/ai/narratives answer 500 on
// that host (measured 2026-10-08) and must not be wired here.
//
// The body is validated, never trusted: a payload that is not the documented
// `{ articles: [...] }` shape fails the rung, and an individual item without a
// usable title, http(s) link and date is dropped.

import { fetchUpstreamJson } from './upstream-fetch.js';
import { recordSource } from './brownout/provenance.js';
import { articleId, extractTickers, lexiconSentiment, stripHtml, truncateWords, cleanImageUrl, clampFuturePubDate } from './news.js';

export const FAILOVER_NEWS_URL = 'https://cryptocurrency.cv/api/v1/news';
const FAILOVER_TIMEOUT_MS = 3500;
const FAILOVER_LIMIT = 50;
const BREAKER_NAME = 'cryptocurrency-cv-news';

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Map one hosted article onto the native article shape, or null when it lacks
 * a title, an http(s) link or a parseable date.
 */
export function mapHostedArticle(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const title = stripHtml(str(raw.title) || '');
	const link = str(raw.link);
	if (!title || !link || !/^https?:\/\//i.test(link)) return null;
	const date = new Date(raw.pubDate);
	if (Number.isNaN(date.getTime())) return null;
	const description = truncateWords(stripHtml(str(raw.description) || ''), 320) || null;
	const sourceKey = str(raw.sourceKey);
	return {
		id: articleId(link),
		title,
		link,
		description,
		image: cleanImageUrl(str(raw.imageUrl)),
		author: str(raw.author),
		source: str(raw.source) || sourceKey || 'cryptocurrency.cv',
		source_key: sourceKey ? `cv:${sourceKey}` : 'cv',
		category: str(raw.category) || 'general',
		pub_date: clampFuturePubDate(date.toISOString()),
		tickers: extractTickers(`${title} ${description || ''}`),
		sentiment: lexiconSentiment(`${title} ${description || ''}`),
		content_text: null,
	};
}

/**
 * Fetch and validate the hosted feed. Returns mapped articles, or [] when the
 * rung fails (timeout, open breaker, schema mismatch); the failure is recorded
 * in the request's provenance ledger and never thrown into getNews.
 *
 * @param {{ category?: string, lang?: string }} [opts]
 * @returns {Promise<Array>}
 */
export async function fetchHostedNews({ category, lang } = {}) {
	const url = new URL(FAILOVER_NEWS_URL);
	url.searchParams.set('limit', String(FAILOVER_LIMIT));
	if (category && category !== 'all') url.searchParams.set('category', category);
	if (lang && lang !== 'all') url.searchParams.set('lang', lang);
	const t0 = Date.now();
	try {
		const body = await fetchUpstreamJson(url.toString(), {}, {
			name: BREAKER_NAME,
			timeoutMs: FAILOVER_TIMEOUT_MS,
			attempts: 1,
			breakerThreshold: 3,
			halfOpenAfterMs: 60_000,
		});
		if (!body || !Array.isArray(body.articles)) throw new Error('hosted news: unexpected response shape');
		const articles = body.articles.map(mapHostedArticle).filter(Boolean);
		recordSource({ name: 'news:failover', outcome: articles.length ? 'ok' : 'fail', ms: Date.now() - t0, tier: 'fallback', detail: articles.length ? undefined : 'empty' });
		return articles;
	} catch (err) {
		recordSource({ name: 'news:failover', outcome: 'fail', ms: Date.now() - t0, tier: 'fallback', detail: err?.status ?? 'error' });
		return [];
	}
}
