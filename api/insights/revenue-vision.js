// GET /api/insights/revenue-vision
//
// Paid endpoint cataloged by the CDP x402 Bazaar (agentic.market). For $0.001
// USDC on Base or Arbitrum mainnet the server hands the caller's mission_brief
// to Claude and returns a structured { power_mode, insight, recommended_move,
// confidence } object. Buyers pay programmatically with @x402/fetch — no API keys.
//
// Wire stack (mirrors api/x402/model-check.js for consistency):
//   • @x402/express     paymentMiddleware → Express adapter
//   • @x402/core        x402ResourceServer + HTTPFacilitatorClient
//   • @x402/evm         ExactEvmScheme (eip155:* networks)
//   • @x402/extensions  declareDiscoveryExtension → bazaar discovery shape
//   • @coinbase/x402    facilitator config with ES256 JWT auth (CDP)
//
// Bazaar listing requires settlement through the CDP facilitator — that's the
// only one whose verify+settle log feeds the catalog. CDP_API_KEY_ID and
// CDP_API_KEY_SECRET must be set in Vercel.

import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { facilitator as cdpFacilitator } from '@coinbase/x402';

import { env } from '../_lib/env.js';

const NETWORK_BASE = 'eip155:8453';
const NETWORK_ARBITRUM = 'eip155:42161';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const ASSET_FOR_NETWORK = {
	[NETWORK_BASE]: USDC_BASE,
	[NETWORK_ARBITRUM]: env.X402_ASSET_ADDRESS_ARBITRUM,
};

const PAY_TO = env.X402_PAY_TO_BASE;
const PRICE = '$0.001';
const ROUTE = '/api/insights/revenue-vision';

function buildAccepts() {
	return env.X402_EVM_NETWORKS.filter((n) => ASSET_FOR_NETWORK[n]).map((network) => ({
		scheme: 'exact',
		network,
		price: PRICE,
		payTo: PAY_TO,
		asset: ASSET_FOR_NETWORK[network],
		extra: { name: 'USDC', version: '2', decimals: 6 },
	}));
}

const facilitatorClient = new HTTPFacilitatorClient(cdpFacilitator);

let resourceServer = new x402ResourceServer(facilitatorClient);
for (const network of env.X402_EVM_NETWORKS) {
	if (!ASSET_FOR_NETWORK[network]) continue;
	resourceServer = resourceServer.register(network, new ExactEvmScheme());
}

const ROUTE_DESCRIPTION =
	'Revenue Vision — agentic growth analysis for AI buyers. Hand over a mission_brief ' +
	'(a free-text growth question or hypothesis) and get back a single prioritized next-best ' +
	'tactical move, a specific data-grounded insight, and an honestly-calibrated confidence ' +
	'rating. Powered by Claude. Pay-per-call in USDC on Base or Arbitrum mainnet.';

const DISCOVERY_INPUT_EXAMPLE = {
	agent_codename: 'ledger-bot',
	power_request: 'revenue-vision',
	mission_brief: 'Find the highest-converting buyer segment this week.',
};

const DISCOVERY_INPUT_SCHEMA = {
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

const DISCOVERY_OUTPUT_EXAMPLE = {
	power_mode: 'revenue-vision',
	insight:
		'Developer teams at 10–50 employees convert 2.4x better than enterprise prospects on the current funnel.',
	recommended_move:
		'Shift 30% of the paid-acquisition budget to builder-focused onboarding campaigns this sprint.',
	confidence: 'high',
};

const DISCOVERY_OUTPUT_SCHEMA = {
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

const routeConfig = {
	[`GET ${ROUTE}`]: {
		accepts: buildAccepts(),
		description: ROUTE_DESCRIPTION,
		mimeType: 'application/json',
		extensions: {
			...declareDiscoveryExtension({
				input: DISCOVERY_INPUT_EXAMPLE,
				inputSchema: DISCOVERY_INPUT_SCHEMA,
				output: {
					example: DISCOVERY_OUTPUT_EXAMPLE,
					schema: DISCOVERY_OUTPUT_SCHEMA,
				},
			}),
		},
	},
};

const app = express();

// Initializes by hitting the CDP facilitator's /supported endpoint to discover
// advertised scheme/network pairs. Requires CDP_API_KEY_ID and CDP_API_KEY_SECRET
// — without them the first request returns 500.
app.use(paymentMiddleware(routeConfig, resourceServer));

const SYSTEM_PROMPT =
	'You are Revenue Vision, an agentic growth analyst. Reply with a single JSON object ' +
	'exactly matching the schema {"power_mode":"revenue-vision","insight":string,"recommended_move":string,"confidence":"high"|"medium"|"low"}. ' +
	'The insight should be specific and quantitative when possible. The recommended_move should be one concrete tactical action. ' +
	'Calibrate confidence honestly: "high" only when you can defend the claim, otherwise "medium" or "low". ' +
	'No prose, no markdown, no preamble.';

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
			system: SYSTEM_PROMPT,
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
		const err = new Error(`Claude returned ${upstream.status}: ${errText.slice(0, 300)}`);
		err.status = 502;
		throw err;
	}
	const data = await upstream.json();
	const text = data?.content?.find?.((b) => b.type === 'text')?.text || '';
	const match = text.match(/\{[\s\S]*\}/);
	const parsed = JSON.parse(match ? match[0] : text);
	const allowedConfidence = new Set(['high', 'medium', 'low']);
	return {
		power_mode: 'revenue-vision',
		insight: String(parsed.insight || '').trim(),
		recommended_move: String(parsed.recommended_move || '').trim(),
		confidence: allowedConfidence.has(parsed.confidence) ? parsed.confidence : 'medium',
	};
}

app.get(ROUTE, async (req, res) => {
	const agentCodename = String(req.query?.agent_codename || '').trim();
	const powerRequest = String(req.query?.power_request || '').trim();
	const missionBrief = String(req.query?.mission_brief || '').trim();

	if (!agentCodename || agentCodename.length > 120) {
		return res
			.status(400)
			.json({
				error: 'invalid_agent_codename',
				message: 'agent_codename is required (≤120 chars)',
			});
	}
	if (powerRequest !== 'revenue-vision') {
		return res
			.status(400)
			.json({
				error: 'invalid_power_request',
				message: 'power_request must be "revenue-vision"',
			});
	}
	if (missionBrief.length < 4 || missionBrief.length > 4000) {
		return res
			.status(400)
			.json({
				error: 'invalid_mission_brief',
				message: 'mission_brief must be 4–4000 chars',
			});
	}

	let result;
	try {
		result = await callClaude(missionBrief, agentCodename);
	} catch (err) {
		const status = err.status || 502;
		return res
			.status(status)
			.json({ error: 'upstream_error', message: err.message || 'Claude call failed' });
	}

	res.setHeader('cache-control', 'no-store');
	res.json(result);
});

app.use((err, req, res, _next) => {
	console.error('[insights/revenue-vision] unhandled', err);
	res.status(500).json({ error: 'internal_error', message: err?.message || 'unknown error' });
});

export default app;
