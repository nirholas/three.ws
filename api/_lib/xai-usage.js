// The xAI spend ledger writer. Every lane that calls api.x.ai on the platform's
// key records the call here, so one table (xai_usage) answers "what did each
// lane spend" against the startups credit grant.
//
// Call shape: recordXaiUsage with an object of lane, model, response, usage, units, accountId, requestId and meta.
//
//   lane       'chat' | 'image' | 'video' | 'voice' | 'eval' | 'mention-bot' | 'other'
//   model      the id sent to api.x.ai (read it from chat-models.js)
//   response   the parsed JSON body of a non-streaming reply (usage and id are
//              read from it), or
//   usage      the usage object alone (a streamed reply's final usage chunk)
//   units      images generated, seconds of video, minutes of voice
//
// New lanes add one call to this function next to their fetch; nothing else.
// Both xAI wire shapes are read: chat completions (prompt_tokens,
// completion_tokens, prompt_tokens_details.cached_tokens,
// completion_tokens_details.reasoning_tokens) and the Responses API
// (input_tokens, output_tokens, input_tokens_details, output_tokens_details).
// When the reply carries `cost_in_usd_ticks`, that is the authoritative charge
// (cost_source 'api'); otherwise the cost is computed from xai-pricing.js
// (cost_source 'price_table'). A model with no price and no reported cost
// records 0 and is logged, so the gap is loud rather than silent.
//
// Recording is off the request's critical path: rows queue in memory and flush
// in one batched insert every FLUSH_MS. A write failure logs and drops; it
// never fails the user call. Only calls on the platform's own key are recorded:
// a caller's BYOK key spends their credit, not ours (isHostXaiKey).

import { sql } from './db.js';
import { withDbRetry } from './db-retry.js';
import { env } from './env.js';
import { priceTableCostMicro, TICKS_PER_MICRO_USD } from './xai-pricing.js';

export const XAI_LANES = Object.freeze(['chat', 'image', 'video', 'voice', 'eval', 'mention-bot', 'other']);

const FLUSH_MS = 1_000;
const QUEUE_MAX = 5_000;
const INSERT_TIMEOUT_MS = 5_000;

/** @type {Array<object>} */
let queue = [];
let timer = null;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** True when `key` is the platform's own xAI key (a BYOK key is not our spend). */
export function isHostXaiKey(key) {
	return Boolean(key) && key === env.GROK_API_KEY;
}

/**
 * Read both xAI usage shapes into one. PURE.
 * @returns {{ inputTokens: number, outputTokens: number, cachedTokens: number, reasoningTokens: number, costMicro: number|null }}
 */
export function normalizeXaiUsage(u) {
	const usage = u && typeof u === 'object' ? u : {};
	const ticks = Number(usage.cost_in_usd_ticks);
	return {
		inputTokens: num(usage.prompt_tokens ?? usage.input_tokens),
		outputTokens: num(usage.completion_tokens ?? usage.output_tokens),
		cachedTokens: num(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens),
		reasoningTokens: num(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens),
		costMicro: Number.isFinite(ticks) && ticks >= 0 && usage.cost_in_usd_ticks != null ? Math.round(ticks / TICKS_PER_MICRO_USD) : null,
	};
}

/** Build the ledger row for one call. PURE. */
export function buildXaiUsageRow({ lane = 'other', model, response = null, usage = null, units = 0, accountId = null, requestId = null, meta = {} }) {
	const u = normalizeXaiUsage(usage ?? response?.usage);
	const fromTable = u.costMicro === null ? priceTableCostMicro(model, { ...u, units }) : null;
	if (u.costMicro === null && fromTable === null) {
		console.warn(`[xai-usage] unpriced model ${model} on lane ${lane}: recording cost 0; add it to chat-models.js`);
	}
	return {
		lane: XAI_LANES.includes(lane) ? lane : 'other',
		model: String(model || 'unknown'),
		request_id: requestId ?? (typeof response?.id === 'string' ? response.id : null),
		input_tokens: u.inputTokens,
		output_tokens: u.outputTokens,
		cached_tokens: u.cachedTokens,
		reasoning_tokens: u.reasoningTokens,
		units: num(units),
		cost_usd_micro: u.costMicro ?? fromTable ?? 0,
		cost_source: u.costMicro === null ? 'price_table' : 'api',
		account_id: accountId,
		meta,
	};
}

async function insertRow(r) {
	await withDbRetry(
		() => sql`
			insert into xai_usage (lane, model, request_id, input_tokens, output_tokens, cached_tokens, reasoning_tokens, units, cost_usd_micro, cost_source, account_id, meta)
			values (${r.lane}, ${r.model}, ${r.request_id}, ${r.input_tokens}, ${r.output_tokens}, ${r.cached_tokens}, ${r.reasoning_tokens}, ${r.units}, ${r.cost_usd_micro}, ${r.cost_source}, ${r.account_id}, ${JSON.stringify(r.meta ?? {})}::jsonb)
		`,
		{ timeoutMs: INSERT_TIMEOUT_MS },
	);
}

/** Write every queued row now. Resolves when done; never rejects. */
export async function flushXaiUsage() {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	const batch = queue;
	queue = [];
	await Promise.all(
		batch.map((r) =>
			insertRow(r).catch((err) => console.warn(`[xai-usage] dropped a ${r.lane}/${r.model} row: ${err?.message}`)),
		),
	);
}

/**
 * Queue one call for the ledger. Returns the row (for tests and callers that
 * want it); the write happens later. Never throws.
 */
export function recordXaiUsage(input) {
	try {
		const row = buildXaiUsageRow(input);
		if (queue.length >= QUEUE_MAX) queue.shift();
		queue.push(row);
		if (!timer) {
			timer = setTimeout(() => void flushXaiUsage(), FLUSH_MS);
			timer.unref?.();
		}
		return row;
	} catch (err) {
		console.warn(`[xai-usage] could not record a call: ${err?.message}`);
		return null;
	}
}
