// `three-ws pay mcp`: a stdio MCP server that lets an agent pay for x402 and MPP
// resources under the same pay-permissions.json the CLI uses. The agent can never
// raise a limit: there is no confirmation channel over stdio, so a payment above
// confirmAbove is refused (confirm_required) and the owner approves it in a terminal.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { VERSION } from '../http.js';
import { isPayError } from './errors.js';
import { pay, quote } from './engine.js';
import { describeOffer } from './permissions.js';

const MAX_BODY_BYTES = 100_000;

const requestShape = {
	url: z.string().url().describe('The http(s) URL of the paid resource'),
	method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().describe('HTTP method. Defaults to GET, or POST when a body is given.'),
	body: z.string().optional().describe('Request body, sent as given (set content-type in headers for JSON).'),
	headers: z.record(z.string()).optional().describe('Extra request headers. Do not set payment headers.'),
	network: z.string().optional().describe('Restrict to one network: mainnet, devnet or a CAIP-2 id.'),
};

const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

function failure(err) {
	if (isPayError(err)) {
		return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: err.reason, exit: err.exit, message: err.message, detail: err.detail }, null, 2) }] };
	}
	return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'error', message: err?.message ?? String(err) }) }] };
}

function bodyView({ bytes, contentType }) {
	const clipped = bytes.subarray(0, MAX_BODY_BYTES);
	const textual = /^(text\/|application\/(json|xml|[\w.+-]*\+(json|xml)))/i.test(contentType);
	return textual
		? { contentType, body: clipped.toString('utf8'), truncated: bytes.length > clipped.length }
		: { contentType, bodyBase64: clipped.toString('base64'), truncated: bytes.length > clipped.length };
}

const requestOf = ({ method, body, headers }) => ({ method, body, headers });

export function createPayMcpServer({ env, keystore, fetchImpl = fetch }) {
	const server = new McpServer({ name: 'three-ws-pay', version: VERSION });

	server.registerTool(
		'pay_quote',
		{
			title: 'Quote a paid resource',
			description:
				'Fetches the URL and, if it answers 402, reports the Solana payment option that would be used (payee, exact amount, network, asset) and whether the permissions allow it. Signs and pays nothing.',
			annotations: { readOnlyHint: true, openWorldHint: true },
			inputSchema: requestShape,
		},
		async (args) => {
			try {
				const q = await quote({ url: args.url, env, request: requestOf(args), networkFlag: args.network, fetchImpl });
				if (q.free) return text({ paymentRequired: false, status: q.response.status });
				return text({
					paymentRequired: true,
					chosen: describeOffer(q.decision.offer),
					needsConfirmation: q.decision.confirm,
					offers: q.offers,
					skipped: q.decision.skipped,
				});
			} catch (err) {
				return failure(err);
			}
		},
	);

	server.registerTool(
		'pay_fetch',
		{
			title: 'Fetch a paid resource',
			description:
				'SPENDS REAL MONEY. Fetches the URL; on a 402 it pays from the local Solana wallet if the permissions file allows it, retries once, and returns the response with the settlement receipt. Refused outright when the origin, network, asset or amount is outside pay-permissions.json. Each successful call is a new charge.',
			annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
			inputSchema: { ...requestShape, max: z.string().optional().describe('Per-call ceiling in whole units, e.g. "0.05". Cannot exceed the permissions file.') },
		},
		async (args) => {
			try {
				const result = await pay({ url: args.url, env, request: requestOf(args), maxFlag: args.max, networkFlag: args.network, keystore, fetchImpl });
				return text({ paid: result.paid, status: result.status, payer: result.payer, offer: result.offer, receipt: result.receipt, ...bodyView(result) });
			} catch (err) {
				return failure(err);
			}
		},
	);

	return server;
}

export async function runPayMcp(deps) {
	const server = createPayMcpServer(deps);
	await server.connect(new StdioServerTransport());
	await new Promise((resolve) => {
		process.stdin.once('close', resolve);
		process.stdin.once('end', resolve);
	});
	await server.close();
}
