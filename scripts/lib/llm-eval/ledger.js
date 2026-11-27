// The eval's side of the xAI credit ledger (api/_lib/xai-usage.js, lane `eval`).
// A Grok call made while the process had no database access is saved with
// `ledgered: false`; these two functions say which saved rows still owe the
// ledger a row and what that row is. PURE.

/** Saved Grok results that were billed but have not reached the ledger. */
export function unledgered(results, lanes) {
	return results.filter((r) => r.ok && lanes[r.lane]?.provider === 'grok' && r.ledgered === false && Boolean(r.responseId));
}

/**
 * The recordXaiUsage input for one saved Grok result. The response id is the
 * ledger's request id, which is what makes a later backfill safe to repeat.
 */
export function ledgerInput(rec, extra = {}) {
	return {
		lane: 'eval',
		model: rec.model,
		usage: rec.usage,
		requestId: rec.responseId,
		meta: { eval: 'grok-eval-llm', task: rec.task, row: rec.id, calledAt: rec.at, ...extra },
	};
}
