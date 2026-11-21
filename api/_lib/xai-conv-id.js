// x-grok-conv-id: route every request of one conversation to the same xAI
// server so its prompt cache hits.
//
// xAI caches the longest exact prefix of the messages array automatically,
// but the cache lives per server and requests are load-balanced, so without a
// routing key a follow-up turn usually lands somewhere cold and pays full
// input price for the whole prefix again. The header pins them together
// (docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits).
// Cached input is a quarter of the input price on grok-4.7 ($0.50 vs $2 per 1M)
// and xai-usage.js already meters `cached_tokens`, so hits show up in the ledger.
//
// The id is a hash of whatever stays fixed for the conversation's lifetime,
// chosen by the caller: for chat, the agent and the first user message (the
// client re-sends the full history every turn, so the opening message never
// changes); for one-shot tasks, the task and its system prompt (every call to
// the same task shares that prefix). It carries no user content in the clear.

import { createHash } from 'node:crypto';

export const XAI_CONV_ID_HEADER = 'x-grok-conv-id';

export function isXaiUrl(url) {
	try {
		return new URL(url).hostname === 'api.x.ai';
	} catch {
		return false;
	}
}

const asText = (part) => (part == null ? '' : typeof part === 'string' ? part : JSON.stringify(part));

export function grokConvId(...parts) {
	const digest = createHash('sha256').update(parts.map(asText).join('\u0000')).digest('hex');
	return `tws-${digest.slice(0, 32)}`;
}

// Returns `headers` with the routing header added when `url` is xAI's API, and
// the same object untouched for every other provider.
export function withGrokConvId(url, headers, ...parts) {
	if (!isXaiUrl(url)) return headers;
	return { ...headers, [XAI_CONV_ID_HEADER]: grokConvId(...parts) };
}
