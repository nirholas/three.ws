// Static XSS / injection risk scan for pump.fun token metadata.
//
// Inspects Metaplex name, symbol, description, image, external_url, website, and
// socials for payloads that downstream clients (dashboards, telegram bots, AI
// agents) commonly render unsanitized. Returns a score 0–100 (higher = more
// risk) plus the matched signals so callers can render reasons.

const RTL_OVERRIDE_CHARS = /[‪-‮⁦-⁩]/;
const ZERO_WIDTH = /[​-‍﻿]/;
const HTML_TAG = /<\s*(script|iframe|object|embed|svg|img|link|meta|style|video|audio|source|base)\b/i;
const EVENT_HANDLER = /\bon[a-z]+\s*=/i;
const JS_URL = /^\s*(javascript|data|vbscript|file):/i;
const HTML_ENTITY_ENCODED_SCRIPT = /&#x?\d+;/;
const SUSPICIOUS_UNICODE_HOMOGLYPH = /[аорес]/; // cyrillic a, o, p, e, c that mimic latin

function scanString(value, allowMarkdown = false) {
	if (typeof value !== 'string' || !value) return [];
	const hits = [];
	if (HTML_TAG.test(value)) hits.push('html_tag');
	if (EVENT_HANDLER.test(value)) hits.push('event_handler');
	if (RTL_OVERRIDE_CHARS.test(value)) hits.push('rtl_override');
	if (ZERO_WIDTH.test(value)) hits.push('zero_width');
	if (HTML_ENTITY_ENCODED_SCRIPT.test(value)) hits.push('html_entity_encoded');
	if (!allowMarkdown && SUSPICIOUS_UNICODE_HOMOGLYPH.test(value)) hits.push('cyrillic_homoglyph');
	return hits;
}

function scanUrl(value) {
	if (typeof value !== 'string' || !value) return [];
	const hits = [];
	if (JS_URL.test(value)) hits.push('js_url_scheme');
	if (value.toLowerCase().endsWith('.svg')) hits.push('svg_image');
	if (RTL_OVERRIDE_CHARS.test(value)) hits.push('rtl_override_in_url');
	return hits;
}

function pickField(obj, ...keys) {
	for (const k of keys) {
		const v = obj?.[k];
		if (typeof v === 'string' && v) return v;
	}
	return null;
}

export function scanTokenMetadata(intel) {
	if (!intel || typeof intel !== 'object') {
		return { score: 0, level: 'unknown', signals: [], fields: {} };
	}

	const meta = intel.metadata ?? intel.offchain ?? intel.token ?? intel;
	const fields = {
		name: pickField(meta, 'name', 'tokenName'),
		symbol: pickField(meta, 'symbol', 'tokenSymbol'),
		description: pickField(meta, 'description'),
		image: pickField(meta, 'image', 'image_url', 'imageUrl'),
		external_url: pickField(meta, 'external_url', 'externalUrl', 'website'),
		twitter: pickField(meta, 'twitter', 'twitterUrl', 'x', 'twitterHandle'),
		telegram: pickField(meta, 'telegram', 'telegramUrl', 'tg'),
	};

	const signals = [];
	const seen = new Set();
	const push = (field, hits) => {
		for (const h of hits) {
			const key = `${field}:${h}`;
			if (seen.has(key)) continue;
			seen.add(key);
			signals.push({ field, signal: h });
		}
	};

	push('name', scanString(fields.name));
	push('symbol', scanString(fields.symbol));
	push('description', scanString(fields.description, true));
	push('image', scanUrl(fields.image));
	push('external_url', scanUrl(fields.external_url));
	push('twitter', scanUrl(fields.twitter));
	push('telegram', scanUrl(fields.telegram));

	const WEIGHTS = {
		html_tag: 35,
		event_handler: 35,
		js_url_scheme: 40,
		rtl_override: 25,
		rtl_override_in_url: 30,
		svg_image: 15,
		zero_width: 10,
		html_entity_encoded: 15,
		cyrillic_homoglyph: 10,
	};
	let score = 0;
	for (const s of signals) score += WEIGHTS[s.signal] ?? 5;
	score = Math.min(100, score);

	const level = score >= 50 ? 'high' : score >= 20 ? 'medium' : score > 0 ? 'low' : 'none';
	const xss_risk = score >= 20;

	return { xss_risk, score, level, signals, fields };
}
