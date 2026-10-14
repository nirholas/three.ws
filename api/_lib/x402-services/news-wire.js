// Live, keyless global news data from the GDELT Project's DOC 2.0 API.
// GDELT monitors worldwide news media in 65+ languages, updated every 15
// minutes. It enforces roughly one request per 5 seconds per IP and
// returns a plain-text throttle notice (HTTP 200) when hit too fast, so
// every call here goes through a serialized queue that spaces requests
// >= 5.1s apart, with bounded retries on throttle.

const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc';
const THREE_WS_UA = 'three.ws/1.0 (+https://three.ws; support@three.ws)';
const MIN_GAP_MS = 5_100;
const TIMEOUT_MS = 20_000;
const THROTTLE_RETRIES = 2;
const RETRY_BACKOFF_MS = 6_000;

export class GdeltThrottledError extends Error {
	constructor() {
		super(
			"GDELT is rate-limiting this server's IP (it allows roughly one request every 5 seconds). " +
				'Retry shortly.',
		);
		this.name = 'GdeltThrottledError';
		this.status = 429;
		this.code = 'upstream_rate_limited';
		this.retryAfterSeconds = 10;
	}
}

let queue = Promise.resolve();
let lastCallAt = 0;

function throttled(fn) {
	const run = queue.then(async () => {
		const wait = lastCallAt + MIN_GAP_MS - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		try {
			return await fn();
		} finally {
			lastCallAt = Date.now();
		}
	});
	queue = run.catch(() => undefined);
	return run;
}

async function gdeltOnce(params) {
	return throttled(async () => {
		const url = `${GDELT}?${new URLSearchParams({ format: 'json', ...params })}`;
		const res = await fetch(url, { headers: { 'user-agent': THREE_WS_UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (res.status === 429 || res.status === 503) throw new GdeltThrottledError();
		const text = await res.text();
		if (!res.ok) {
			const err = new Error(`GDELT HTTP ${res.status}`);
			err.status = 502;
			err.code = 'upstream_error';
			throw err;
		}
		if (/limit requests|rate limit/i.test(text) && !text.trimStart().startsWith('{')) {
			throw new GdeltThrottledError();
		}
		try {
			return JSON.parse(text);
		} catch {
			const err = new Error(`GDELT: ${text.trim().slice(0, 300) || 'empty response'}`);
			err.status = 502;
			err.code = 'upstream_error';
			throw err;
		}
	});
}

async function gdelt(params) {
	let lastErr;
	for (let attempt = 0; attempt <= THROTTLE_RETRIES; attempt++) {
		try {
			return await gdeltOnce(params);
		} catch (err) {
			lastErr = err;
			if (!(err instanceof GdeltThrottledError) || attempt === THROTTLE_RETRIES) throw err;
			await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
		}
	}
	throw lastErr;
}

function normalizeQuery(q) {
	const hasOperators = /["():]|(\b(AND|OR|NOT)\b)|(\w+:)/.test(q);
	if (hasOperators || !q.includes(' ')) return q;
	return `"${q}"`;
}

function mapArticles(raw) {
	return raw.map((a) => ({
		title: a.title ?? '',
		url: a.url ?? '',
		domain: a.domain ?? '',
		language: a.language ?? '',
		sourceCountry: a.sourcecountry ?? '',
		seenDate: a.seendate ?? '',
		socialImage: a.socialimage || null,
	}));
}

function mapTimeline(raw) {
	const series = raw?.timeline?.[0]?.data;
	if (!Array.isArray(series)) return null;
	return series.map((p) => ({ date: p.date ?? '', value: typeof p.value === 'number' ? p.value : Number(p.value ?? 0) }));
}

export function toGdeltDate(d) {
	return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function parseCursor(cursor) {
	if (/^\d{14}$/.test(cursor)) return cursor;
	const d = new Date(cursor);
	if (Number.isNaN(d.getTime())) {
		const err = new Error(`Invalid cursor "${cursor}". Use GDELT format YYYYMMDDHHMMSS or an ISO-8601 timestamp.`);
		err.status = 400;
		err.code = 'invalid_cursor';
		throw err;
	}
	return toGdeltDate(d);
}

export async function query(q, opts = {}) {
	const nq = normalizeQuery(q);
	const timespan = opts.timespan ?? '3d';
	const max = Math.min(Math.max(opts.maxRecords ?? 25, 1), 75);
	let fullQuery = nq;
	if (opts.sourceLang) fullQuery += ` sourcelang:${opts.sourceLang}`;
	if (opts.sourceCountry) fullQuery += ` sourcecountry:${opts.sourceCountry}`;

	const artData = await gdelt({ query: fullQuery, mode: 'artlist', maxrecords: String(max), timespan, sort: 'datedesc' });
	const articles = mapArticles(artData.articles ?? []);

	let timeline = null;
	let timelineStatus = 'ok';
	if (opts.includeTimeline !== false) {
		try {
			const tlData = await gdelt({ query: fullQuery, mode: 'timelinevolraw', timespan });
			timeline = mapTimeline(tlData);
		} catch (err) {
			timelineStatus = `unavailable: ${err.message}`;
		}
	} else {
		timelineStatus = 'skipped (timeline=false)';
	}

	return {
		query: q,
		effectiveQuery: fullQuery,
		timespan,
		count: articles.length,
		articles,
		volumeTimeline: timeline,
		timelineStatus,
		source: 'gdelt-doc-2.0',
		retrievedAt: new Date().toISOString(),
	};
}

export async function pulse(q, cursor, maxRecords = 50) {
	const since = parseCursor(cursor);
	const now = new Date();
	const nextCursor = toGdeltDate(new Date(now.getTime() - 60_000));
	const max = Math.min(Math.max(maxRecords, 1), 75);

	const data = await gdelt({
		query: normalizeQuery(q),
		mode: 'artlist',
		maxrecords: String(max),
		startdatetime: since,
		enddatetime: toGdeltDate(now),
		sort: 'datedesc',
	});
	const articles = mapArticles(data.articles ?? []);

	return {
		query: q,
		cursor: since,
		nextCursor,
		newArticleCount: articles.length,
		truncated: articles.length >= max,
		articles,
		source: 'gdelt-doc-2.0',
		retrievedAt: now.toISOString(),
	};
}
