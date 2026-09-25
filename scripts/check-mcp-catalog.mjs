#!/usr/bin/env node
// Offline build check for data/mcp-catalog.json, the vetted list of external
// MCP servers an agent owner can connect on /integrations/mcp.
//
// Runs the same validateCatalog() the API uses at runtime, so a malformed entry
// fails `npm run build` (it runs from `prebuild`) and `npm run gate` instead of
// a 500 on /api/integrations/mcp. It also rejects a tier glob listed under two
// tiers of one entry, since first-match-wins would silently hide the second.
//
// Network checks (is the URL live, is the npm package real) live in
// scripts/vet-mcp-integrations.mjs, which contributors run before a PR.
//
//   node scripts/check-mcp-catalog.mjs          exit 1 on any error
//   node scripts/check-mcp-catalog.mjs --json   print the summary as JSON

import { readFileSync } from 'node:fs';
import { CATALOG_PATH, validateCatalog } from '../api/_lib/mcp-connections/catalog.js';

let doc;
try {
	doc = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
} catch (err) {
	console.error(`check:mcp-catalog: data/mcp-catalog.json is not valid JSON (${err.message})`);
	process.exit(1);
}

const errors = validateCatalog(doc);
for (const s of doc.servers || []) {
	const seen = new Map();
	for (const [tier, list] of Object.entries(s.tiers || {})) {
		for (const glob of list || []) {
			if (seen.has(glob)) errors.push(`servers (${s.id}).tiers: "${glob}" is listed under both ${seen.get(glob)} and ${tier}`);
			seen.set(glob, tier);
		}
	}
}

const byCategory = {};
for (const s of doc.servers || []) byCategory[s.category] = (byCategory[s.category] || 0) + 1;
const summary = {
	servers: (doc.servers || []).length,
	hosted: (doc.servers || []).filter((s) => s.transport !== 'stdio').length,
	local: (doc.servers || []).filter((s) => s.transport === 'stdio').length,
	categories: byCategory,
	errors,
};

if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
if (errors.length) {
	console.error(`check:mcp-catalog: ${errors.length} problem(s) in data/mcp-catalog.json`);
	for (const e of errors) console.error(`  ${e}`);
	process.exit(1);
}
if (!process.argv.includes('--json')) {
	console.log(`check:mcp-catalog: ok, ${summary.servers} servers (${summary.hosted} hosted, ${summary.local} local) in ${Object.keys(byCategory).length} categories`);
}
