// Named commerce tools: one MCP tool per three.ws x402 service, generated
// from ../tools.json. A model names weather_go_no_go or domain_rdap_check far more
// reliably than it composes a raw pay_and_call(url) call, and a fixed
// description + price ceiling per tool beats a free-form URL every time.
//
// Every tool here pays a FIXED endpoint (THREE_WS_BASE + entry.path); the only
// thing the caller supplies is the service's own input (lat/lon, a domain,
// a query, ...) plus the usual payment knobs (confirm, max_usd, token,
// secret, session_token, idempotency_key). Settlement goes through the same
// ../lib/pay-core.js used by pay_and_call, so behavior (confirm gate, spend
// cap, ledger) is identical.

import { z } from 'zod';
import { createRequire } from 'node:module';

import { jsonSchemaToZodShape } from '../lib/json-schema-to-zod.js';
import { payUrl } from '../lib/pay-core.js';
import { THREE_WS_BASE } from '../config.js';

const require = createRequire(import.meta.url);
const registry = require('../tools.json');

const PAYMENT_ARG_KEYS = ['method', 'token', 'max_usd', 'secret', 'confirm', 'session_token', 'idempotency_key'];

const paymentArgsShape = {
	token: z.enum(['usdc', 'three']).default('usdc').describe('Settlement token. "usdc" (default) or "three", when this endpoint advertises it.'),
	max_usd: z.number().positive().optional().describe(`Hard ceiling for THIS call in USD. Can only lower the service's listed price, never raise it.`),
	secret: z.string().optional().describe('Per-call base58 Solana signer override (defaults to SOLANA_SECRET_KEY).'),
	confirm: z.boolean().optional().describe('Must be true to execute when REQUIRE_CONFIRM is on (the default).'),
	session_token: z.string().optional().describe('three.ws Payment Session token (pss_…). When set, the platform wallet pays instead of a local key.'),
	idempotency_key: z.string().optional().describe('Deduplication key, recommended with session_token so a retry cannot double-charge.'),
};

function buildUrl(entry, serviceArgs) {
	const url = new URL(entry.path, THREE_WS_BASE);
	if (entry.method === 'GET') {
		for (const [key, value] of Object.entries(serviceArgs)) {
			if (value === undefined) continue;
			url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
		}
	}
	return url.toString();
}

function splitArgs(args) {
	const serviceArgs = {};
	const paymentArgs = {};
	for (const [key, value] of Object.entries(args || {})) {
		if (PAYMENT_ARG_KEYS.includes(key)) paymentArgs[key] = value;
		else serviceArgs[key] = value;
	}
	return { serviceArgs, paymentArgs };
}

function buildTool(entry) {
	const serviceShape = jsonSchemaToZodShape(entry.inputSchema);
	return {
		name: entry.name,
		title: entry.title,
		// Pays a real three.ws x402 service: execution, not read-only, and the
		// service lives behind an open, external-feeling endpoint.
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
		description: `[$${entry.priceUsd} USDC per call] ${entry.description}`,
		inputSchema: { ...serviceShape, ...paymentArgsShape },
		async handler(args) {
			const { serviceArgs, paymentArgs } = splitArgs(args);
			const url = buildUrl(entry, serviceArgs);
			return payUrl(url, {
				...paymentArgs,
				method: entry.method,
				body: entry.method === 'POST' ? serviceArgs : undefined,
				max_usd: paymentArgs.max_usd ?? entry.priceUsd,
				toolName: entry.name,
			});
		},
	};
}

export const NAMED_SERVICE_TOOLS = registry.tools.map(buildTool);
