#!/usr/bin/env node
// Vet every entry in data/mcp-integrations.json against the live internet.
//
// For each remote server: open an MCP session with no credentials. An open
// server must answer initialize and tools/list (its tool count is recorded); a
// protected one must answer 401 and publish OAuth discovery metadata, whose
// registration_endpoint decides whether the platform can self-register
// (`dynamic`) or needs its own client (`platform`). For each stdio server: the
// package must exist on npm or PyPI. Every docs link must resolve.
//
//   node scripts/vet-mcp-integrations.mjs            report only, exit 1 on any failure
//   node scripts/vet-mcp-integrations.mjs --write    also record open servers' tool counts
//   node scripts/vet-mcp-integrations.mjs --only=github,linear
//
// Network-bound on purpose, so it is not part of the offline build check
// (scripts/check-mcp-integrations.mjs). Run it before adding or changing entries.

import { readFileSync, writeFileSync } from 'node:fs';
import { CATALOG_PATH, validateCatalog } from '../api/_lib/mcp-connections/catalog.js';
import { probeServer } from '../api/_lib/mcp-connections/client.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

const doc = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const schemaErrors = validateCatalog(doc);
if (schemaErrors.length) {
	console.error(schemaErrors.join('\n'));
	process.exit(1);
}

async function registryExists(pkg) {
	const url =
		pkg.registry === 'npm'
			? `https://registry.npmjs.org/${pkg.name.replace('/', '%2F')}/latest`
			: `https://pypi.org/pypi/${encodeURIComponent(pkg.name)}/json`;
	const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
	return res.ok;
}

async function docsResolve(url) {
	const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Mozilla/5.0 three.ws-vet' } });
	// Some vendor sites answer bots with 403 while serving people fine; only a hard 404/410 is dead.
	return res.status !== 404 && res.status !== 410;
}

async function vet(entry) {
	const problems = [];
	const notes = [];
	try {
		if (!(await docsResolve(entry.docs))) problems.push(`docs link is dead: ${entry.docs}`);
	} catch (err) {
		notes.push(`docs link unverified (${err.message})`);
	}
	if (entry.transport === 'stdio') {
		if (!(await registryExists(entry.package))) problems.push(`${entry.package.registry} package ${entry.package.name} not found`);
		return { entry, problems, notes };
	}
	try {
		const probe = await probeServer(entry.url, { transport: entry.transport });
		if (probe.auth === 'none') {
			notes.push(`open, ${probe.tools.length} tools`);
			if (write) entry.toolCount = probe.tools.length;
			if (entry.auth.type === 'oauth') problems.push('catalog says oauth but the server is open');
		} else if (probe.auth === 'oauth') {
			notes.push(`oauth (${probe.registration})`);
			if (entry.auth.type === 'none') problems.push('catalog says no auth but the server demands it');
			if (entry.auth.type === 'oauth' && probe.registration === 'platform' && entry.auth.registration !== 'platform') {
				problems.push('server has no dynamic registration; set auth.registration to platform with a clientEnv');
			}
		} else {
			notes.push('401 without discovery: bearer token');
			if (entry.auth.type === 'oauth') problems.push('catalog says oauth but the server publishes no OAuth metadata');
		}
	} catch (err) {
		problems.push(`${err.code || 'error'}: ${err.message}`);
	}
	return { entry, problems, notes };
}

const targets = doc.servers.filter((s) => !only.length || only.includes(s.id));
const results = [];
const queue = [...targets];
await Promise.all(
	Array.from({ length: 8 }, async () => {
		while (queue.length) results.push(await vet(queue.shift()));
	}),
);

let failed = 0;
for (const r of results.sort((a, b) => a.entry.id.localeCompare(b.entry.id))) {
	const ok = r.problems.length === 0;
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.entry.id.padEnd(26)} ${[...r.notes, ...r.problems].join('; ')}`);
}

if (write) {
	writeFileSync(CATALOG_PATH, `${JSON.stringify(doc, null, '\t')}\n`);
	console.log(`\nwrote ${CATALOG_PATH}`);
}
console.log(`\n${results.length - failed}/${results.length} entries vetted`);
process.exit(failed ? 1 : 0);
