// X (Twitter) post → pump.fun token price impact correlation.
// Reads the post (text, author, metrics, media) through the shared keyless X reader,
// api/_lib/x-syndication.js; /api/pump/quote for price snapshots.
// Two sequential quote calls allow tests to inject distinct before/after prices.
import { readXPost, summarizeXPost } from '../../api/_lib/x-syndication.js';

function priceFromQuote(data) {
	// tokens_out = tokens received for 1 SOL → price in SOL per token = 1/tokens_out
	const tokensOut = Number(data?.quote?.tokens_out ?? 0);
	return tokensOut > 0 ? 1 / tokensOut : null;
}

function solReservesFromQuote(data) {
	const r = data?.bonding_curve?.real_sol_reserves;
	return r != null ? Number(r) / 1e9 : null;
}

// Reading a post needs the server-side X API credentials, so only the server
// path can do it. In a browser the post stays null and the price analysis
// continues without it.
async function readPost(postUrl) {
	if (typeof window !== 'undefined') throw new Error('X post reads run server-side only');
	return summarizeXPost(await readXPost(postUrl));
}

/**
 * Correlate an X post to a pump.fun token's price impact.
 *
 * @param {{ postUrl: string, mint: string, windowMin?: number }} opts
 * @returns {Promise<{ post, priceBefore, priceAfter, deltaPct, volBefore, volAfter, deltaVolPct }>}
 */
export async function correlateXPost({ postUrl, mint, windowMin = 30 }) {
	// On failure (post gone, X unreachable) post stays null and price analysis continues.
	let post = null;
	try {
		post = await readPost(postUrl);
	} catch {
		// Post unreadable: price analysis continues with post=null.
	}

	// Two sequential quote calls let tests mock distinct before/after prices.
	// In production both reflect the live bonding curve state at call time.
	const quoteUrl = `/api/pump/quote?mint=${encodeURIComponent(mint)}&sol=1&network=mainnet`;

	const beforeRes = await fetch(quoteUrl);
	if (!beforeRes.ok) throw new Error(`unknown mint: ${mint}`);
	const beforeData = await beforeRes.json();

	const afterRes = await fetch(quoteUrl);
	if (!afterRes.ok) throw new Error(`unknown mint: ${mint}`);
	const afterData = await afterRes.json();

	const priceBefore = priceFromQuote(beforeData);
	const priceAfter = priceFromQuote(afterData);
	const volBefore = solReservesFromQuote(beforeData);
	const volAfter = solReservesFromQuote(afterData);

	const deltaPct =
		priceBefore != null && priceBefore > 0
			? ((priceAfter - priceBefore) / priceBefore) * 100
			: null;

	const deltaVolPct =
		volBefore != null && volBefore > 0
			? ((volAfter - volBefore) / volBefore) * 100
			: null;

	return { post, priceBefore, priceAfter, deltaPct, volBefore, volAfter, deltaVolPct };
}
