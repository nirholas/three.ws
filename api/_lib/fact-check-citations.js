// Citation validity for the fact-check benchmark.
//
// Every claim in agents/fact-checker/benchmark/claims.json cites the authority
// behind its label: { title, url, quote }. A citation is VALID only when the URL
// answers and its readable text actually contains the quoted evidence. A page
// that cannot be reached is UNREACHABLE: recorded as a degradation and left out
// of the validity ratio, because a network failure says nothing about whether
// the quote is real. A page that answers without the quote is INVALID.

const UA = 'three.ws-fact-check-benchmark/1.0 (+https://three.ws/fact-check)';
const MAX_BODY_CHARS = 4_000_000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Lowercase, strip tags/entities, unify quotes and dashes, collapse whitespace. */
export function normalizeText(input) {
	return String(input ?? '')
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
		.replace(/[‘’‛]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/[‐-―−]/g, '-')
		.replace(/\[\d+\]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/** True when the normalized page text contains the normalized quote. */
export function pageContainsQuote(pageText, quote) {
	const q = normalizeText(quote);
	return q.length > 0 && normalizeText(pageText).includes(q);
}

/**
 * Fetch one authority and classify it.
 * @returns {Promise<{status:'valid'|'invalid'|'unreachable', detail?:string}>}
 */
export async function verifyAuthority(authority, { fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
	if (!authority?.url || !authority?.quote) return { status: 'invalid', detail: 'authority needs url and quote' };
	let res;
	try {
		res = await fetchImpl(authority.url, {
			redirect: 'follow',
			headers: { 'user-agent': UA, accept: 'text/html,text/plain' },
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (err) {
		return { status: 'unreachable', detail: String(err?.message || err) };
	}
	if (res.status >= 500 || res.status === 429 || res.status === 408) {
		return { status: 'unreachable', detail: `HTTP ${res.status}` };
	}
	if (!res.ok) return { status: 'invalid', detail: `HTTP ${res.status}` };
	let body;
	try {
		body = (await res.text()).slice(0, MAX_BODY_CHARS);
	} catch (err) {
		return { status: 'unreachable', detail: String(err?.message || err) };
	}
	return pageContainsQuote(body, authority.quote)
		? { status: 'valid' }
		: { status: 'invalid', detail: 'page does not contain the quoted evidence' };
}

/** Verify every claim's authority with bounded concurrency. */
export async function verifyAuthorities(claims, { concurrency = 8, ...opts } = {}) {
	const out = new Array(claims.length);
	let next = 0;
	async function worker() {
		for (;;) {
			const i = next++;
			if (i >= claims.length) return;
			out[i] = { claim: claims[i].claim, url: claims[i].authority?.url, ...(await verifyAuthority(claims[i].authority, opts)) };
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, claims.length) }, worker));
	return out;
}

/** Pure summary of verifyAuthorities output. */
export function scoreCitations(checks) {
	const valid = checks.filter((c) => c.status === 'valid').length;
	const invalid = checks.filter((c) => c.status === 'invalid');
	const unreachable = checks.filter((c) => c.status === 'unreachable');
	const reachable = valid + invalid.length;
	return {
		checked: checks.length,
		valid,
		invalid: invalid.length,
		unreachable: unreachable.length,
		validity_pct: reachable > 0 ? Math.round((valid / reachable) * 1000) / 10 : null,
		failures: [...invalid, ...unreachable].map((c) => ({ claim: c.claim, url: c.url, status: c.status, detail: c.detail })),
	};
}
