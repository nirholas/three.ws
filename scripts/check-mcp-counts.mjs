#!/usr/bin/env node
// Every MCP tool, resource and prompt count a living doc quotes must match the
// census the build computes (public/tools.json, from scripts/build-mcp-catalog.mjs).
//
// A doc states a count through a marker, so the number is checked rather than
// trusted:
//
//   <!-- mcp-count:mcp-3d.tools -->40<!-- /mcp-count -->
//
// The key is <scope>.<field>. Scope is `all`, `hosted`, `stdio`, or a server id
// from /tools.json (`mcp`, `mcp-3d`, `three-ws-mcp-server`, `vanity-mcp`, ...).
// Fields: servers, tools, uniqueTools, resources, templates, prompts, free, paid
// (servers and uniqueTools only make sense for all, hosted and stdio).
//
// Two rules fail the check:
//   1. A marker whose number differs from the census (or whose key is unknown).
//   2. An unmarked "<n> tools" in a living doc that is about a server: on a line
//      naming a server's endpoint or npm package, or anywhere in a server's own
//      directory (mcp-server/, packages/<id>/). A markdown table row naming a
//      server counts too when its number sits under a "Tools" / "Tool Count" /
//      "Paid Tools" column header. Dated posts, research notes and
//      changelogs are snapshots of their day and are not scanned. A count that
//      is not about a three.ws server opts out with <!-- mcp-count-ignore --> on
//      the same line.
//
//   node scripts/check-mcp-counts.mjs         report, exit 1 on any mismatch
//   node scripts/check-mcp-counts.mjs --fix   rewrite marker numbers in place

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIX = process.argv.includes('--fix');
const INDEX = join(ROOT, 'public', 'tools.json');

const MARKER = /<!-- mcp-count:([a-z0-9.-]+?)\.([a-zA-Z]+) -->([^<]*)<!-- \/mcp-count -->/g;
// A count and the word "tools", with up to six describing words between them
// ("23 free, read-only pump.fun + Solana tools"). Words that start a new clause
// ("5 servers with 20 tools") break the match so the wrong number is not read.
const UNMARKED = /\b(\d{1,4})\s+(?:(?!(?:with|of|and|across|on|in|at|to|for|from|per|servers?|or)\b)[^\s\d|][^\s|]*\s+){0,6}?tools\b/g;
const IGNORE = '<!-- mcp-count-ignore -->';
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TOOL_COLUMN = /^(paid\s+)?tools?(\s+count)?$/i;
const BARE_COUNT = /^~?\s*(\d{1,4})\b/;

const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** The tool-count column of a markdown table header row, if it has one. */
function toolColumn(row) {
	const index = cells(row).findIndex((c) => TOOL_COLUMN.test(c.replace(/[*_`]/g, '')));
	if (index < 0) return null;
	return { index, field: /paid/i.test(cells(row)[index]) ? 'paid' : 'tools' };
}

// Docs that describe the product as it is now. Everything else under docs/ that
// is a dated post, thread, article, pitch or research note keeps its day's
// numbers on purpose.
const SNAPSHOT = /(^|\/)(CHANGELOG\.md|ALL\.md)$|^docs\/(x-posts|announcements|research|partners|prompts|articles|marketing|content)\/|^docs\/[^/]*(post|thread|article|pitch|brief|plan|kit|landscape|proposal)[^/]*\.md$|^marketing\//;
const LIVING = /^[^/]+\.md$|^docs\/[^/]+\.md$|^docs\/tutorials\/|^marketplace\/plugins\/|^mcp-server\/|^packages\/[^/]+-mcp\//;

function loadCensus() {
	if (!existsSync(INDEX)) {
		console.error('[check:mcp-counts] public/tools.json is missing. Fix: npm run build:mcp-catalog');
		process.exit(1);
	}
	const index = JSON.parse(readFileSync(INDEX, 'utf8'));
	const scopes = new Map();
	const priced = (ids) => {
		const tools = index.tools.filter((t) => ids.has(t.server));
		return { free: tools.filter((t) => !t.price).length, paid: tools.filter((t) => t.price > 0).length };
	};
	const byTransport = (transport) => new Set(index.servers.filter((s) => s.transport === transport).map((s) => s.id));
	const groups = { all: new Set(index.servers.map((s) => s.id)), hosted: byTransport('remote'), stdio: byTransport('stdio') };
	for (const [scope, ids] of Object.entries(groups)) scopes.set(scope, { ...index.totals[scope], ...priced(ids) });
	for (const s of index.servers) {
		scopes.set(s.id, { tools: s.tools, resources: s.resources, templates: s.templates, prompts: s.prompts, ...priced(new Set([s.id])) });
	}
	return { index, scopes };
}

/** Text files git knows about (tracked or new), minus generated and vendored trees. */
function candidateFiles() {
	const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md', '*.html', '*.txt'], {
		cwd: ROOT,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	return [...new Set(out.split('\n'))].filter((f) => f && !/(^|\/)(node_modules|dist|build|vendor)\//.test(f) && existsSync(join(ROOT, f)));
}

/** Server ids whose own directory a path sits in. */
function ownerOf(file, index) {
	if (file.startsWith('mcp-server/')) return 'three-ws-mcp-server';
	const m = file.match(/^packages\/([^/]+)\//);
	if (!m) return null;
	return index.servers.find((s) => s.id === m[1])?.id ?? null;
}

/** The strings that tie a doc line to a server: its endpoint path or npm package, code-quoted or linked. */
function serverMentions(index) {
	return index.servers.map((s) => {
		const name = s.endpoint?.startsWith('npx -y ') ? s.endpoint.slice('npx -y '.length) : s.endpoint;
		return { id: s.id, needles: ['`', ' ', ')', ']'].map((end) => `${name}${end}`) };
	});
}

/** The server named earliest on a line (a row for one package may also cite the endpoint it proxies). */
function firstMention(line, mentions) {
	let best = null;
	for (const m of mentions) {
		for (const needle of m.needles) {
			const at = line.indexOf(needle);
			if (at >= 0 && (!best || at < best.at)) best = { id: m.id, at };
		}
	}
	return best?.id;
}

function main() {
	const { index, scopes } = loadCensus();
	const mentions = serverMentions(index);
	const problems = [];
	const fixed = [];
	let markers = 0;

	for (const file of candidateFiles()) {
		const abs = join(ROOT, file);
		const text = readFileSync(abs, 'utf8');
		const hasMarker = text.includes('<!-- mcp-count:');
		const living = LIVING.test(file) && !SNAPSHOT.test(file);
		if (!hasMarker && !living) continue;

		let changed = false;
		const lines = text.split('\n');
		const owner = living ? ownerOf(file, index) : null;
		let column = null;
		lines.forEach((line, i) => {
			const where = `${file}:${i + 1}`;
			if (line.includes('<!-- mcp-count:')) {
				lines[i] = line.replace(MARKER, (whole, scope, field, value) => {
					markers += 1;
					const want = scopes.get(scope)?.[field];
					if (want === undefined) {
						problems.push(`${where}: unknown count key ${scope}.${field}`);
						return whole;
					}
					if (String(want) === value.trim()) return whole;
					if (FIX) {
						changed = true;
						fixed.push(`${where}: ${scope}.${field} ${value.trim()} -> ${want}`);
						return `<!-- mcp-count:${scope}.${field} -->${want}<!-- /mcp-count -->`;
					}
					problems.push(`${where}: ${scope}.${field} says ${value.trim()}, the census says ${want}`);
					return whole;
				});
			}
			// A header row is followed by its |---| separator; remember its tool
			// column until the table ends.
			if (!TABLE_ROW.test(line)) column = null;
			else if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) column = toolColumn(line);
			if (!living || line.includes(IGNORE)) return;
			const bare = lines[i].replace(MARKER, '');
			const about = owner ?? firstMention(bare, mentions);
			if (!about) return;
			const cell = column && !/^\s*\|[\s:|-]+\|\s*$/.test(line) ? cells(lines[i])[column.index] : null;
			const count = cell && !cell.includes('<!-- mcp-count:') ? cell.match(BARE_COUNT) : null;
			if (count) {
				const actual = scopes.get(about)?.[column.field];
				problems.push(
					`${where}: unmarked table count "${cell}" about ${about} (census: ${actual}). Write <!-- mcp-count:${about}.${column.field} -->${actual}<!-- /mcp-count --> in that cell or add ${IGNORE} to the row.`,
				);
			}
			for (const [phrase] of bare.matchAll(UNMARKED)) {
				const field = /\bpaid\b/.test(phrase) ? 'paid' : /\bfree\b/.test(phrase) ? 'free' : 'tools';
				const actual = scopes.get(about)?.[field];
				problems.push(
					`${where}: unmarked "${phrase}" about ${about} (census: ${actual}). Write <!-- mcp-count:${about}.${field} -->${actual}<!-- /mcp-count --> or, if the number is not about that server, add ${IGNORE} to the line.`,
				);
			}
		});
		if (changed) writeFileSync(abs, lines.join('\n'));
	}

	if (fixed.length) console.log(`[check:mcp-counts] rewrote ${fixed.length} marker(s):\n  ${fixed.join('\n  ')}`);
	if (problems.length) {
		console.error(`[check:mcp-counts] ${problems.length} count(s) do not match the MCP census (public/tools.json):`);
		for (const p of problems) console.error(`  ${p}`);
		console.error('  Fix: npm run check:mcp-counts -- --fix rewrites markers; mark or reword the unmarked ones.');
		process.exit(1);
	}
	console.log(`[check:mcp-counts] ${markers} marked count(s) match the census (${index.totals.all.tools} tools on ${index.totals.all.servers} servers)`);
}

main();
