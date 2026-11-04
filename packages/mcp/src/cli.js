#!/usr/bin/env node
import { runStdio } from './proxy.js';

runStdio().catch((err) => {
	process.stderr.write(`three-ws-mcp: ${err.message}\n`);
	process.exit(1);
});
