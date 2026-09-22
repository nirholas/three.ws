// Published prices for the tool gateway, the single source for every surface
// that shows or charges them: the metering in ./meter.js, GET /api/pricing (and
// through it the /pricing page), GET /api/v1/models, GET /api/v1/gateway and
// docs/tool-gateway.md.
//
// Every tool is billed per unit of the thing it produces, in USD credits drawn
// from the same account balance model calls use (api/_lib/credits.js). A call
// is never cheaper than its `min_usd`, so a one-character speech request still
// books a real ledger row and a budget always converges.
//
// Prices sit at or above the platform's own cost on the lane that serves the
// call (Vertex grounding, Imagen, Veo, Gemini, the NIM speech lanes), never
// below it, so the gateway can never quietly run at a loss per call.

export const GATEWAY_ACTION_PREFIX = 'gateway.';

export const GATEWAY_PRICES = Object.freeze({
	web_search: {
		label: 'Web search',
		unit: 'search',
		usd_per_unit: 0.01,
		min_usd: 0.01,
		summary: 'Grounded Google Search on Vertex AI: a synthesized answer plus the cited sources.',
	},
	web_fetch: {
		label: 'Web fetch',
		unit: 'page',
		usd_per_unit: 0.002,
		min_usd: 0.002,
		summary: 'Fetch one public URL and return its readable text, title, description and links.',
	},
	browser: {
		label: 'Browser',
		unit: 'step',
		usd_per_unit: 0.003,
		min_usd: 0.003,
		summary: 'Headless Chromium: navigate, click, type, scroll, extract and screenshot, with sessions that keep cookies between calls.',
	},
	image_generate: {
		label: 'Image generation',
		unit: 'image',
		usd_per_unit: 0.02,
		min_usd: 0.02,
		summary: 'Text to image on the forge lanes, Vertex Imagen first, with automatic failover.',
	},
	video_generate: {
		label: 'Video generation',
		unit: 'second',
		usd_per_unit: 0.2,
		min_usd: 0.8,
		summary: 'Text to video with Veo on Vertex AI, 4 to 8 seconds per clip, refunded if the clip is filtered or fails.',
	},
	tts: {
		label: 'Text to speech',
		unit: '1k characters',
		usd_per_unit: 0.03,
		min_usd: 0.001,
		summary: 'Speech synthesis on the NIM Magpie lane with Gemini TTS failover. Returns a hosted audio file.',
	},
	transcribe: {
		label: 'Speech to text',
		unit: 'minute',
		usd_per_unit: 0.01,
		min_usd: 0.001,
		summary: 'Transcription on the NIM Riva lane with Gemini on Vertex failover. WAV, FLAC, OGG, MP3 and more.',
	},
	parse_document: {
		label: 'Document parsing',
		unit: 'page',
		usd_per_unit: 0.002,
		min_usd: 0.002,
		summary: 'Text and tables from PDF, DOCX, XLSX, CSV, HTML and plain text, with Gemini OCR for scanned PDFs.',
	},
});

export const GATEWAY_TOOL_NAMES = Object.freeze(Object.keys(GATEWAY_PRICES));

export function round6(n) {
	return Math.round((Number(n) || 0) * 1e6) / 1e6;
}

/** The credit-ledger action id a tool's charges are booked under. */
export function gatewayAction(tool) {
	return `${GATEWAY_ACTION_PREFIX}${tool}`;
}

/**
 * Price `units` of a tool. Units are fractional where the unit is (1.2k
 * characters, 0.4 minutes); the result is clamped up to the tool's minimum.
 * @returns {number} USD, six decimals
 */
export function priceGatewayCall(tool, units) {
	const p = GATEWAY_PRICES[tool];
	if (!p) throw Object.assign(new Error(`unknown gateway tool: ${tool}`), { status: 404, code: 'unknown_tool' });
	const u = Math.max(0, Number(units) || 0);
	return round6(Math.max(p.min_usd, u * p.usd_per_unit));
}

/** Display-safe price list, in the order the docs and the pricing page show it. */
export function gatewayPricing() {
	return GATEWAY_TOOL_NAMES.map((tool) => {
		const p = GATEWAY_PRICES[tool];
		return {
			tool,
			action: gatewayAction(tool),
			label: p.label,
			unit: p.unit,
			usd_per_unit: p.usd_per_unit,
			min_usd: p.min_usd,
			summary: p.summary,
		};
	});
}
