#!/usr/bin/env node
// `npx 3d-ar-studio-mcp`
//
// This package exists purely so that command works: the studio itself lives in
// `3d-ar-studio`, whose own binary is the project scaffolder, and npx resolves a
// binary by package name. Everything here is one line of delegation, so the
// server can never drift from the library it belongs to.

import { main } from '3d-ar-studio/mcp';

main().catch((err) => {
	// stdout is the protocol channel: diagnostics must go to stderr or they
	// corrupt the JSON-RPC stream.
	console.error('[3d-ar-studio-mcp]', err?.stack || err?.message || err);
	process.exit(1);
});
