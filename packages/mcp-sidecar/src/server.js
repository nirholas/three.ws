import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	ListToolsRequestSchema,
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	ListResourceTemplatesRequestSchema,
	ListPromptsRequestSchema,
	GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.js';
import { fetchRemoteTools, callRemoteTool } from './proxy.js';
import { getCached, setCached, cacheStats } from './cache.js';
import { checkSpend, recordSpend, setSpendLimit, spendStats, TOOL_COST_USDC } from './spend.js';
import { RESOURCES, RESOURCE_TEMPLATES, readResource } from './resources.js';
import { PROMPTS, getPrompt } from './prompts.js';

// Injected into every paid tool result so the LLM can surface cost to the user.
function costMeta() {
	const s = spendStats();
	return {
		cost_usdc: TOOL_COST_USDC,
		session_spend_usdc: s.session_spend_usdc,
		...(s.remaining_usdc !== null ? { remaining_budget_usdc: s.remaining_usdc } : {}),
	};
}

const SPEND_STATUS_TOOL = {
	name: 'spend_status',
	title: 'Session spend status',
	description:
		'Returns session USDC spend, call count, cache hit rate, and remaining budget. ' +
		'Free — does not count against your spend limit.',
	inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

export async function runServer() {
	const config = loadConfig();

	if (config.spendLimitUsdc) setSpendLimit(config.spendLimitUsdc);

	// Fetch live tool catalog from remote on startup. Fall back to empty list with
	// a warning rather than crashing — the server is still useful for resources/prompts.
	let remoteTools = [];
	try {
		remoteTools = await fetchRemoteTools(config);
	} catch (err) {
		process.stderr.write(`[three-ws-mcp] warn: could not fetch remote tools: ${err.message}\n`);
		if (!config.apiKey) {
			process.stderr.write('[three-ws-mcp] hint: run `three-ws-mcp init` to configure your API key\n');
		}
	}

	const server = new Server(
		{ name: 'three-ws', version: '1.0.0' },
		{
			capabilities: {
				tools: { listChanged: false },
				resources: { listChanged: false, subscribe: false },
				prompts: { listChanged: false },
				logging: {},
			},
		},
	);

	// ── tools/list ──────────────────────────────────────────────────────────────
	server.setRequestHandler(ListToolsRequestSchema, async () => {
		const tools = remoteTools.map((t) => ({
			...t,
			description: `[cost: $${TOOL_COST_USDC} USDC] ${t.description ?? ''}`.trim(),
		}));
		tools.push(SPEND_STATUS_TOOL);
		return { tools };
	});

	// ── tools/call ──────────────────────────────────────────────────────────────
	server.setRequestHandler(CallToolRequestSchema, async (req) => {
		const { name, arguments: args = {} } = req.params;

		// Local tool — free, no proxy
		if (name === 'spend_status') {
			const data = { ...spendStats(), cache: cacheStats() };
			return {
				content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
				structuredContent: data,
			};
		}

		// Spend guard
		const guard = checkSpend();
		if (!guard.allowed) {
			return { content: [{ type: 'text', text: `Error: ${guard.reason}` }], isError: true };
		}

		// Cache hit
		if (config.cache?.enabled !== false) {
			const cached = getCached(name, args);
			if (cached) {
				return { ...cached, _meta: { ...cached._meta, cache_hit: true } };
			}
		}

		// Call remote
		let result;
		try {
			result = await callRemoteTool(name, args, config);
		} catch (err) {
			// Surface 402 hint prominently
			return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
		}

		recordSpend();

		const annotated = { ...result, _meta: { ...(result?._meta ?? {}), ...costMeta() } };

		if (config.cache?.enabled !== false) {
			setCached(name, args, annotated);
		}

		return annotated;
	});

	// ── resources/list ──────────────────────────────────────────────────────────
	server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

	// ── resources/templates/list ────────────────────────────────────────────────
	server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
		resourceTemplates: RESOURCE_TEMPLATES,
	}));

	// ── resources/read ──────────────────────────────────────────────────────────
	server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
		try {
			return await readResource(req.params.uri, config);
		} catch (err) {
			throw Object.assign(new Error(err.message), { code: -32002 });
		}
	});

	// ── prompts/list ────────────────────────────────────────────────────────────
	server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

	// ── prompts/get ─────────────────────────────────────────────────────────────
	server.setRequestHandler(GetPromptRequestSchema, async (req) => {
		const { name, arguments: args } = req.params;
		try {
			return getPrompt(name, args);
		} catch (err) {
			throw Object.assign(new Error(err.message), { code: -32602 });
		}
	});

	const transport = new StdioServerTransport();
	await server.connect(transport);
	process.stderr.write('[three-ws-mcp] ready\n');
}
