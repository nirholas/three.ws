#!/usr/bin/env node
// @three-ws/avatar-agent — MCP server entry point.
//
// Boots a Model Context Protocol server over stdio that gives any AI
// assistant a 3D avatar, a Solana wallet, a voice, and full pump.fun
// powers (snapshots + Jupiter buys + atomic Jito-bundled launches +
// creator-fee collection).
//
// Run standalone:
//   node packages/avatar-agent-mcp/src/index.js
//
// Or wire into Claude Desktop / Cursor — see README.md.

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { def as inspectGlb } from './tools/inspect-glb.js';
import { def as validateGlb } from './tools/validate-glb.js';
import { def as optimizeGlb } from './tools/optimize-glb.js';
import { def as thumbnailGlb } from './tools/thumbnail-glb.js';
import { def as viewerUrl } from './tools/viewer-url.js';
import { def as listAvatars } from './tools/list-avatars.js';
import { def as listAnimations } from './tools/list-animations.js';
import { def as spawnAvatar } from './tools/spawn-avatar.js';
import { def as dressAvatar } from './tools/dress-avatar.js';
import { def as renderAvatar } from './tools/render-avatar.js';
import { def as generateAvatar } from './tools/generate-avatar.js';
import { def as speak } from './tools/speak.js';
import { def as walletCreate } from './tools/wallet-create.js';
import { def as walletBalance } from './tools/wallet-balance.js';
import { def as walletSend } from './tools/wallet-send.js';
import { def as walletSendPreview } from './tools/wallet-send-preview.js';
import { def as pumpSnapshot } from './tools/pump-snapshot.js';
import { def as pumpBuy } from './tools/pump-buy.js';
import { def as pumpBuyQuote } from './tools/pump-buy-quote.js';
import { def as pumpLaunch } from './tools/pump-launch.js';
import { def as pumpLaunchPreview } from './tools/pump-launch-preview.js';
import { def as pumpCollect } from './tools/pump-collect.js';
import { def as pumpCollectPreview } from './tools/pump-collect-preview.js';
import { def as ensSnsResolve } from './tools/ens-sns-resolve.js';

// Single source of truth for the advertised server identity — package.json.
// The McpServer version can never drift from the published npm version again.
const require = createRequire(import.meta.url);
const { name: PKG_NAME, version: PKG_VERSION } = require('../package.json');

export const TOOLS = [
	// 3D toolkit — universal GLB / glTF tools
	inspectGlb,
	validateGlb,
	optimizeGlb,
	thumbnailGlb,
	viewerUrl,
	// Avatar
	listAvatars,
	listAnimations,
	spawnAvatar,
	dressAvatar,
	renderAvatar,
	generateAvatar,
	speak,
	// Wallet
	walletCreate,
	walletBalance,
	walletSendPreview,
	walletSend,
	// pump.fun
	pumpSnapshot,
	pumpBuyQuote,
	pumpBuy,
	pumpLaunchPreview,
	pumpLaunch,
	pumpCollectPreview,
	pumpCollect,
	// Identity
	ensSnsResolve,
];

/**
 * Construct a fully-registered McpServer WITHOUT connecting a transport and
 * WITHOUT requiring any secrets. Tool registration (names, descriptions,
 * schemas, annotations) is env-free; only invocations of tools that sign or
 * call third-party APIs need credentials. Safe to import from tests.
 *
 * @returns {McpServer}
 */
export function buildServer() {
	const server = new McpServer(
		// '@three-ws/avatar-agent' is an npm scope; MCP server names are plain
		// identifiers, so keep the long-standing stdio identity.
		{ name: '3d-ai-agent-avatar', title: '3D AI Agent Avatar', version: PKG_VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				'3D AI Agent Avatar — a complete 3D MCP toolkit plus a Solana-wallet-bearing, pump.fun-trading avatar agent. ' +
				'3D tools (work on any GLB URL, no avatar required): inspect_glb returns mesh/material/animation/bbox stats; ' +
				'validate_glb runs the official Khronos validator; optimize_glb runs dedup/prune/weld/Draco and returns the ' +
				"smaller GLB inline; thumbnail_glb renders any GLB to a PNG via three.ws's hosted three-light rig (the same " +
				'pipeline that generates OG cards); viewer_url builds a three.ws/viewer link + iframe embed. ' +
				'Avatar flow: list_avatars → list_animations → spawn_avatar (preset "default"/"cz" or any GLB) → dress_avatar → ' +
				'render_avatar (pose + camera orbit + ARKit-52 expression → real PNG) → speak. generate_avatar text/image-to-3D ' +
				'via Replicate. wallet_create (optional vanity grinder) gives the avatar a Solana wallet; wallet_balance, ' +
				'wallet_send_preview then wallet_send for SOL ops. ' +
				'pump.fun: pump_snapshot for live market data (target="three" for $three); pump_buy_quote then pump_buy via Jupiter, optional Jito ' +
				'bundle; pump_launch_preview then pump_launch is an atomic Jito-bundled launch with separate funder + creator; ' +
				'pump_collect_preview then pump_collect_fees drains pump.fun creator-fee vaults atomically. ' +
				'Every value-moving tool is off until enabled (THREE_WS_TOOLS) and needs its preview id plus its confirm flag. ens_sns_resolve for .eth / .sol names.',
		},
	);

	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
				// MCP ToolAnnotations (readOnlyHint / destructiveHint /
				// idempotentHint / openWorldHint) — lets clients gate
				// confirmation prompts per tool instead of treating every
				// call as a destructive write.
				annotations: tool.annotations,
			},
			async (args, extra) => {
				try {
					const result = await tool.handler(args, extra);
					const text =
						typeof result === 'string' ? result : JSON.stringify(result, null, 2);
					return { content: [{ type: 'text', text }] };
				} catch (err) {
					const payload = {
						ok: false,
						error: err?.code || 'unhandled',
						message: err?.message || String(err),
						...(err?.status ? { status: err.status } : {}),
						...(err?.signature ? { signature: err.signature } : {}),
					};
					return {
						content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
						isError: true,
					};
				}
			},
		);
	}

	return server;
}

async function main() {
	const server = buildServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error(`[${PKG_NAME}@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
}

// Connect stdio ONLY when this file is the process entry point. Importing the
// module (tests, embedding buildServer elsewhere) must not grab the transport.
// realpath both sides: npm bin shims are symlinks, so argv[1] may point at
// node_modules/.bin/... while import.meta.url is the resolved file.
function isProcessEntryPoint() {
	if (!process.argv[1]) return false;
	try {
		return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
	} catch {
		return false;
	}
}

if (isProcessEntryPoint()) {
	main().catch((err) => {
		console.error(`[${PKG_NAME}] fatal:`, err);
		process.exit(1);
	});
}
