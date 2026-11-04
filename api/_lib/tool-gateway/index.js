// The gateway tool registry: one table every surface dispatches through.
//
// The REST route (api/v1/tools/[tool].js), the MCP tools (api/_mcp/tools/gateway.js)
// and the agent runtime all call callGatewayTool, so a tool means the same thing,
// is validated the same way, and is billed identically wherever it is reached.

import { randomUUID } from 'node:crypto';
import { meteredCall } from './meter.js';
import { GatewayError } from './errors.js';
import { GATEWAY_PRICES } from './pricing.js';
import { webSearch, webFetch } from './web.js';
import { parseDocument, estimateParseDocument } from './documents.js';
import { tts, estimateTts, transcribe, estimateTranscribe } from './speech.js';
import { imageGenerate, estimateImage } from './image.js';

const one = () => 1;

/** tool name to { estimate(args) -> units charged up front, run(args, principal) -> { result, units, provider } } */
export const GATEWAY_TOOLS = Object.freeze({
	web_search: { estimate: one, run: (args) => webSearch(args || {}) },
	web_fetch: { estimate: one, run: (args) => webFetch(args || {}) },
	parse_document: { estimate: estimateParseDocument, run: (args) => parseDocument(args || {}) },
	tts: { estimate: estimateTts, run: (args, principal) => tts(args || {}, principal) },
	transcribe: { estimate: estimateTranscribe, run: (args) => transcribe(args || {}) },
	image_generate: { estimate: estimateImage, run: (args) => imageGenerate(args || {}) },
});

/**
 * Run one gateway tool for a principal, billed against their credits.
 * @param {{ principal: object, tool: string, args?: object, callId?: string }} o
 * @returns {Promise<{ result: object, billing: object }>}
 */
export async function callGatewayTool({ principal, tool, args = {}, callId = randomUUID() }) {
	const def = Object.hasOwn(GATEWAY_TOOLS, tool) ? GATEWAY_TOOLS[tool] : null;
	if (!def || !GATEWAY_PRICES[tool]) throw new GatewayError(404, 'unknown_tool', `No gateway tool named "${tool}".`);
	const estimateUnits = def.estimate(args);
	return meteredCall({ principal, tool, estimateUnits, callId, run: () => def.run(args, principal) });
}

export { GatewayError };
