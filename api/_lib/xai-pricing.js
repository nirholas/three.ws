// xAI list prices and the one function that turns a usage report into a cost.
//
// Prices are read from the catalog in chat-models.js (GROK_MODELS for text,
// XAI_MEDIA_MODELS for image, video and voice), so a model id is never typed
// here. Source: https://docs.x.ai/developers/models, read 2026-11-20. A model
// with two tiers is billed at the higher rate for ALL tokens of a request once
// its prompt reaches 200k tokens (LONG_CONTEXT_TOKENS, LONG_CONTEXT_MULTIPLIER).
//
// tests/xai-pricing.test.js fails when a catalog model has no price, so a new
// model cannot ship unmetered.

import { GROK_MODELS, GROK_RETIRED_ALIASES, GROK_RETIRED_PRICES, XAI_MEDIA_MODELS } from './chat-models.js';

export const XAI_PRICES_SOURCE = 'https://docs.x.ai/developers/models';
export const XAI_PRICES_READ_ON = '2026-11-20';
export const LONG_CONTEXT_TOKENS = 200_000;
export const LONG_CONTEXT_MULTIPLIER = 2;

/** xAI reports cost in ticks of 1e-10 USD; one micro-USD is 10,000 ticks. */
export const TICKS_PER_MICRO_USD = 10_000;

const TEXT = new Map(
	GROK_MODELS.map((m) => [m.id, { kind: 'text', input: m.price[0], cached: m.cachedInputPrice ?? m.price[0], output: m.price[1] }]),
);
for (const [id, p] of Object.entries(GROK_RETIRED_PRICES)) {
	if (!TEXT.has(id)) TEXT.set(id, { kind: 'text', input: p[0], cached: p[0], output: p[1] });
}
const MEDIA = new Map(XAI_MEDIA_MODELS.map((m) => [m.id, { kind: m.kind, unit: m.unit, price: m.price }]));

/** Every model id that has a price, for the coverage test. */
export function pricedModelIds() {
	return [...TEXT.keys(), ...MEDIA.keys()];
}

/**
 * The price row for a model id, or null when unpriced. Retired aliases resolve
 * to their successor only when they have no price of their own.
 */
export function xaiPrice(model) {
	if (TEXT.has(model)) return TEXT.get(model);
	if (MEDIA.has(model)) return MEDIA.get(model);
	const successor = GROK_RETIRED_ALIASES[model];
	return successor && TEXT.has(successor) ? TEXT.get(successor) : null;
}

/**
 * Cost in micro-USD from the price table, or null when the model is unpriced.
 * Text: uncached prompt at the input rate, cached prompt at the cached rate,
 * completion plus reasoning tokens at the output rate. Media: price per unit
 * (voice is priced per minute, so pass minutes; video per second).
 * @param {string} model
 * @param {{ inputTokens?: number, cachedTokens?: number, outputTokens?: number, reasoningTokens?: number, units?: number }} u
 *   inputTokens is the whole prompt (cached included), as xAI's prompt_tokens.
 * @returns {number|null}
 */
export function priceTableCostMicro(model, u = {}) {
	const p = xaiPrice(model);
	if (!p) return null;
	if (p.kind !== 'text') return Math.round((u.units ?? 0) * p.price * 1_000_000);
	const prompt = u.inputTokens ?? 0;
	const cached = Math.min(u.cachedTokens ?? 0, prompt);
	const out = (u.outputTokens ?? 0) + (u.reasoningTokens ?? 0);
	const mult = prompt >= LONG_CONTEXT_TOKENS ? LONG_CONTEXT_MULTIPLIER : 1;
	const usd = ((prompt - cached) * p.input + cached * p.cached + out * p.output) * mult;
	return Math.round(usd);
}
