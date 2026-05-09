// GET /api/insights/revenue-vision — paid endpoint listed on agentic.market.
//
// x402 v2 + CDP facilitator. Charges $0.001 USDC on Base mainnet per call.
// On a valid payment, hands the caller's mission_brief to Claude and returns
// a structured { power_mode, insight, recommended_move, confidence } object.
//
// First successful settle through the CDP facilitator is what triggers Bazaar
// indexing — see api/x402-status for facilitator wiring health.

import { z } from 'zod';
import { cors, error, json, method, wrap } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import {
	NETWORK_BASE_MAINNET,
	X402Error,
	encodePaymentResponseHeader,
	paymentRequirements,
	resolveResourceUrl,
	send402,
	settlePayment,
	verifyPayment,
} from '../_lib/x402-spec.js';

const RESOURCE_DESCRIPTION =
	'Revenue Vision — agentic growth analysis for AI buyers. Pay $0.001 USDC on Base mainnet, hand over a mission_brief, and get back a prioritized next-best growth move with a structured confidence rating. Powered by Claude.';

const inputExample = {
	agent_codename: 'ledger-bot',
	power_request: 'revenue-vision',
	mission_brief: 'Find the highest-converting buyer segment this week.',
};

const outputExample = {
	power_mode: 'revenue-vision',
	insight:
		'Developer teams at 10–50 employees convert 2.4x better than enterprise prospects on the current funnel.',
	recommended_move:
		'Shift 30% of the paid-acquisition budget to builder-focused onboarding campaigns this sprint.',
	confidence: 'high',
};

const inputSchema = {
	type: 'object',
	required: ['agent_codename', 'power_request', 'mission_brief'],
	properties: {
		agent_codename: {
			type: 'string',
			description: 'Caller agent name for attribution and rate-limit telemetry.',
		},
		power_request: {
			type: 'string',
			enum: ['revenue-vision'],
			description: 'Power mode requested. Currently only "revenue-vision".',
		},
		mission_brief: {
			type: 'string',
			minLength: 4,
			maxLength: 4000,
			description: 'Free-text growth question or hypothesis to analyze.',
		},
	},
};

const outputSchema = {
	type: 'object',
	required: ['power_mode', 'insight', 'recommended_move', 'confidence'],
	properties: {
		power_mode: { type: 'string', enum: ['revenue-vision'] },
		insight: {
			type: 'string',
			description: 'A specific, data-grounded observation about the mission.',
		},
		recommended_move: {
			type: 'string',
			description: 'A single tactical action the caller should take next.',
		},
		confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
	},
};

function bazaarRevenueVision() {
	return {
		method: 'GET',
		discoverable: true,
		input: inputExample,
		inputSchema,
		output: { example: outputExample, schema: outputSchema },
	};
}

const querySchema = z.object({
	agent_codename: z.string().min(1).max(120),
	power_request: z.literal('revenue-vision'),
	mission_brief: z.string().min(4).max(4000),
});

function baseAccepts() {
	const all = paymentRequirements();
	const base = all.filter((a) => a.network === NETWORK_BASE_MAINNET);
	if (!base.length) {
		throw new X402Error(
			'misconfigured',
			'X402_PAY_TO_BASE / X402_ASSET_ADDRESS_BASE must be set to advertise Base mainnet payments',
			500,
		);
	}
	return base;
}

async function callClaude(missionBrief, agentCodename) {
	const upstream = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'anthropic-version': '2023-06-01',
			'x-api-key': env.ANTHROPIC_API_KEY,
		},
		body: JSON.stringify({
			model: 'claude-sonnet-4-6',
			max_tokens: 800,
			system: 'You are Revenue Vision, an agentic growth analyst. Reply with a single JSON object exactly matching the schema {"power_mode":"revenue-vision","insight":string,"recommended_move":string,"confidence":"high"|"medium"|"low"}. The insight should be specific and quantitative when possible. The recommended_move should be one concrete tactical action. Calibrate confidence honestly: "high" only when you can defend the claim, otherwise "medium" or "low". No prose, no markdown, no preamble.',
			messages: [
				{
					role: 'user',
					content: `Caller agent: ${agentCodename}\nMission brief: ${missionBrief}\n\nReturn the JSON object only.`,
				},
			],
		}),
		signal: AbortSignal.timeout(20_000),
	});
	if (!upstream.ok) {
		const errText = await upstream.text();
		throw new X402Error(
			'upstream_error',
			`Claude returned ${upstream.status}: ${errText.slice(0, 300)}`,
			502,
		);
	}
	const data = await upstream.json();
	const text = data?.content?.find?.((b) => b.type === 'text')?.text || '';
	let parsed;
	try {
		const match = text.match(/\{[\s\S]*\}/);
		parsed = JSON.parse(match ? match[0] : text);
	} catch (err) {
		throw new X402Error('upstream_error', `Claude returned non-JSON: ${err.message}`, 502);
	}
	const allowedConfidence = new Set(['high', 'medium', 'low']);
	return {
		power_mode: 'revenue-vision',
		insight: String(parsed.insight || '').trim(),
		recommended_move: String(parsed.recommended_move || '').trim(),
		confidence: allowedConfidence.has(parsed.confidence) ? parsed.confidence : 'medium',
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const accepts = baseAccepts();
	const resourceUrl = resolveResourceUrl(req, '/api/insights/revenue-vision');
	const send402Here = (message) =>
		send402(res, {
			resourceUrl,
			accepts,
			error: message || 'X-PAYMENT header is required',
			description: RESOURCE_DESCRIPTION,
			bazaar: bazaarRevenueVision(),
		});

	// Always return 402 for unauthenticated requests BEFORE any query validation —
	// agentic.market's Bazaar crawler explicitly de-indexes endpoints that 400 on
	// its discovery probes, so payment-gating must come first.
	const paymentHeader = req.headers['x-payment'] || req.headers['X-PAYMENT'];
	if (!paymentHeader) return send402Here();

	const url = new URL(req.url, 'http://x');
	const query = {
		agent_codename: url.searchParams.get('agent_codename') || '',
		power_request: url.searchParams.get('power_request') || '',
		mission_brief: url.searchParams.get('mission_brief') || '',
	};
	const parsed = querySchema.safeParse(query);
	if (!parsed.success) {
		return error(
			res,
			400,
			'validation_error',
			parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
		);
	}

	let verified;
	try {
		verified = await verifyPayment({ paymentHeader, requirements: accepts });
	} catch (err) {
		if (err instanceof X402Error && err.status === 402) return send402Here(err.message);
		throw err;
	}

	const result = await callClaude(parsed.data.mission_brief, parsed.data.agent_codename);
	const settled = await settlePayment({
		paymentPayload: verified.paymentPayload,
		requirement: verified.requirement,
	});

	res.setHeader('payment-response', encodePaymentResponseHeader(settled));
	return json(res, 200, result);
});
