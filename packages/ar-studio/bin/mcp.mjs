#!/usr/bin/env node
// The 3D AR Studio MCP server, over stdio.
//
//   npx 3d-ar-studio-mcp
//
// Add it to a client's config as { "command": "npx", "args": ["-y", "3d-ar-studio-mcp"] }.

import { main } from '../mcp/index.js';

main().catch((err) => {
	// stdout is the protocol channel: diagnostics must go to stderr or they
	// corrupt the JSON-RPC stream.
	console.error('[3d-ar-studio-mcp]', err?.stack || err?.message || err);
	process.exit(1);
});
