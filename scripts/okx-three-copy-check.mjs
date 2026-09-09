#!/usr/bin/env node
/**
 * The copy rule for the OKX.AI listing, enforced mechanically.
 *
 * Agent #2632's catalog exists in four places, and OKX rejects the listing if
 * they disagree:
 *   1. the module: api/_lib/okx-catalog.js, the source of truth
 *   2. the live: GET https://three.ws/api/okx/3d/catalog, what a buyer reads
 *   3. the listing: scripts/okx-listing-payload.mjs, what gets submitted to OKX
 *   4. the on-chain listing: what OKX actually stores for #2632 today, read with
 *      `onchainos agent service-list --agent-id 2632`
 *
 * Copies 1 and 2 diverge on every deploy that ships a catalog edit but does not
 * reach production; copies 1 and 3 diverge whenever the payload generator is
 * edited by hand. Both have happened. Copy 4 diverges whenever the module's
 * listing text changes and no `agent update` is submitted afterwards, which is
 * the failure this check missed for a week: the four-part description format
 * landed on 2026-09-02 and the seven rows OKX stores kept the two-part text,
 * while two sessions reported the listing as drift-free because nothing
 * compared that copy. A reviewer who reads a price or a parameter spec on the
 * listing and gets something else from the endpoint fails the listing, so this
 * runs before any resubmission and after any catalog deploy.
 *
 * Copy 4 needs a live `onchainos` wallet session. Without one it is reported as
 * NOT COMPARED rather than silently passing, so the output can never imply a
 * check that did not run.
 *
 * Usage:
 *   node scripts/okx-three-copy-check.mjs
 *   node scripts/okx-three-copy-check.mjs --base http://localhost:3000
 *   node scripts/okx-three-copy-check.mjs --json report.json
 *   node scripts/okx-three-copy-check.mjs --listing capture.json   # saved service-list
 *   node scripts/okx-three-copy-check.mjs --no-onchain             # copies 1-3 only
 *   AGENT_ID=2632 node scripts/okx-three-copy-check.mjs            # a different agent
 *
 * Exit 0 = every compared copy agrees. Exit 1 = drift (each divergence printed).
 * Exit 2 = the live endpoint could not be read.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { OKX_CATALOG, catalogIndex, listedCatalog, listingDescription, validateCatalog } from '../api/_lib/okx-catalog.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The agent whose listing copy 4 reads, taken from the catalog module so the
// id cannot drift from the one the catalog publishes to buyers. AGENT_ID
// overrides it for a second agent or a staging listing.
const AGENT_ID = process.env.AGENT_ID || catalogIndex().okxAgentId;

function parseArgs(argv) {
	const args = { base: 'https://three.ws', json: null, listing: null, onchain: true };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--base') args.base = argv[++i].replace(/\/$/, '');
		else if (argv[i] === '--json') args.json = argv[++i];
		else if (argv[i] === '--listing') args.listing = argv[++i];
		else if (argv[i] === '--no-onchain') args.onchain = false;
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
const drift = [];
const fail = (where, detail) => drift.push({ where, detail });

// Copy 1: the module must be internally valid before it is worth comparing.
validateCatalog();
const LISTED = listedCatalog();
console.log(
	`module    ${OKX_CATALOG.length} rows (${LISTED.length} listed, ${OKX_CATALOG.length - LISTED.length} back burner), validateCatalog PASS`,
);

// Copy 2: the live endpoint. catalogIndex() is the exact function the route
// serializes, so a byte-identical JSON comparison is the strongest available
// check, not an approximation of one.
let live;
try {
	const res = await fetch(`${args.base}/api/okx/3d/catalog`, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	live = await res.json();
} catch (err) {
	console.error(`FAIL  could not read ${args.base}/api/okx/3d/catalog: ${err.message}`);
	process.exit(2);
}

const mod = catalogIndex();
if (JSON.stringify(mod) === JSON.stringify(live)) {
	console.log(`live      ${live.services.length} rows, byte-identical to the module`);
} else {
	const liveById = new Map((live.services || []).map((s) => [s.id, s]));
	for (const m of mod.services) {
		const l = liveById.get(m.id);
		if (!l) {
			fail('live', `missing row "${m.id}" (deploy did not ship it)`);
			continue;
		}
		for (const key of new Set([...Object.keys(m), ...Object.keys(l)])) {
			if (JSON.stringify(m[key]) !== JSON.stringify(l[key])) {
				fail('live', `${m.id}.${key}\n    module: ${JSON.stringify(m[key])}\n    live  : ${JSON.stringify(l[key])}`);
			}
		}
		liveById.delete(m.id);
	}
	// A row the live catalog still publishes under `services` that the module no
	// longer lists. Distinguish the two causes: a row demoted to the back burner
	// is expected here until the deploy lands, a row missing from the module
	// entirely is real drift.
	for (const extra of liveById.keys()) {
		const known = OKX_CATALOG.find((e) => e.id === extra);
		fail(
			'live',
			known
				? `row "${extra}" is still listed live but is back burner in the module (deploy pending)`
				: `row "${extra}" is live but not in the module at all`,
		);
	}
	for (const key of ['provider', 'okxAgentId', 'chain', 'docs']) {
		if (JSON.stringify(mod[key]) !== JSON.stringify(live[key])) {
			fail('live', `${key}: module ${JSON.stringify(mod[key])} vs live ${JSON.stringify(live[key])}`);
		}
	}
}

// Copy 3: the submission payload. Compared by service name because that is the
// key OKX matches on when updating an existing listing.
const submission = JSON.parse(
	execFileSync('node', ['scripts/okx-listing-payload.mjs'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24 }),
);
console.log(`listing   ${submission.length} rows from scripts/okx-listing-payload.mjs`);

const byName = new Map(submission.map((s) => [s.serviceName, s]));
// The submission carries the LISTED rows only; a back-burner row is expected to
// be absent from it, so comparing the whole module here would fail by design.
for (const row of LISTED) {
	const s = byName.get(row.name);
	if (!s) {
		fail('listing', `submission omits "${row.name}"`);
		continue;
	}
	if (s.serviceDescription !== listingDescription(row)) {
		fail('listing', `"${row.name}" description differs from listingDescription(entry)`);
	}
	if (String(s.fee) !== String(row.priceUsd)) fail('listing', `"${row.name}" fee ${s.fee} vs module ${row.priceUsd}`);
	if (s.endpoint !== row.endpoint) fail('listing', `"${row.name}" endpoint ${s.endpoint} vs module ${row.endpoint}`);
	byName.delete(row.name);
}
for (const extra of byName.keys()) fail('listing', `submission has "${extra}" which is not in the module`);

// Copy 4: the rows OKX stores for #2632 right now. Read from a saved capture
// when one is given, otherwise from the CLI, which needs a wallet session.
// `service-list` shape: { ok, data: { "0": { total, list: [...] } } }.
function readOnChainListing() {
	if (args.listing) {
		return { rows: JSON.parse(readFileSync(args.listing, 'utf8')), source: args.listing };
	}
	const cli = `${process.env.HOME}/.local/bin/onchainos`;
	if (!existsSync(cli)) return { skipped: `${cli} is not installed` };
	const raw = execFileSync(cli, ['agent', 'service-list', '--agent-id', String(AGENT_ID)], {
		encoding: 'utf8',
		maxBuffer: 1 << 24,
		timeout: 120_000,
	});
	return { rows: JSON.parse(raw), source: `onchainos agent service-list --agent-id ${AGENT_ID}` };
}

// Both the CLI envelope and a bare array of rows are accepted, because the
// capture people save by hand is usually one or the other.
function listingRows(parsed) {
	if (Array.isArray(parsed)) return parsed;
	const container = parsed?.data?.['0'] ?? parsed?.data?.[0] ?? parsed?.data ?? parsed;
	const rows = container?.list ?? container?.rows ?? container?.services;
	if (!Array.isArray(rows)) throw new Error(`no service array found (top-level keys: ${Object.keys(parsed || {}).join(', ')})`);
	return rows;
}

let onChainCompared = false;
let onChainSkipped = args.onchain ? null : 'disabled with --no-onchain';
if (args.onchain) {
	try {
		const read = readOnChainListing();
		if (read.skipped) {
			onChainSkipped = read.skipped;
		} else {
			if (read.rows?.ok === false) throw new Error(read.rows.error || 'the CLI refused the read');
			const live = listingRows(read.rows);
			console.log(`on-chain  ${live.length} rows from ${read.source}`);
			onChainCompared = true;
			const onChainByName = new Map(live.map((r) => [r.serviceName ?? r.name, r]));
			for (const row of LISTED) {
				const stored = onChainByName.get(row.name);
				if (!stored) {
					fail('on-chain', `the listing has no row named "${row.name}" (submit it with an \`agent update\` create)`);
					continue;
				}
				onChainByName.delete(row.name);
				const want = listingDescription(row);
				if ((stored.serviceDescription ?? '') !== want) {
					fail(
						'on-chain',
						`"${row.name}" description is stale on the listing\n    module: ${JSON.stringify(want)}\n    listing: ${JSON.stringify(stored.serviceDescription ?? '')}`,
					);
				}
				if (String(stored.fee ?? '') !== String(row.priceUsd)) {
					fail('on-chain', `"${row.name}" fee ${stored.fee} on the listing vs module ${row.priceUsd}`);
				}
				if ((stored.endpoint ?? '') !== row.endpoint) {
					fail('on-chain', `"${row.name}" endpoint ${stored.endpoint} on the listing vs module ${row.endpoint}`);
				}
			}
			for (const extra of onChainByName.keys()) {
				fail('on-chain', `the listing still sells "${extra}", which the module does not list (delete it in the next \`agent update\`)`);
			}
		}
	} catch (err) {
		// A logged-out session is the ordinary case, not a failure of the
		// listing: say so plainly and keep the other three copies' verdict.
		const message = String(err?.message || err);
		onChainSkipped = /session expired|please login/i.test(message)
			? 'no onchainos wallet session (run: onchainos wallet login --phase init)'
			: message.split('\n')[0];
	}
}
if (!onChainCompared) console.log(`on-chain  NOT COMPARED (${onChainSkipped})`);

if (args.json) {
	writeFileSync(
		args.json,
		JSON.stringify(
			{
				base: args.base,
				rows: OKX_CATALOG.length,
				listed: LISTED.length,
				onChainCompared,
				...(onChainCompared ? {} : { onChainSkipped }),
				drift,
				ok: drift.length === 0,
			},
			null,
			2,
		),
	);
}

const agreed = onChainCompared
	? 'module == live == listing submission == on-chain listing'
	: 'module == live == listing submission; on-chain listing NOT COMPARED';
const scope = onChainCompared ? 'all four copies' : 'copies 1-3 only, on-chain listing NOT COMPARED';

if (drift.length === 0) {
	console.log(`\nCOPY CHECK: PASS (${agreed})`);
	process.exit(0);
}
console.log('');
for (const d of drift) console.log(`DRIFT [${d.where}] ${d.detail}`);
console.log(`\nCOPY CHECK: FAIL (${drift.length} divergence${drift.length === 1 ? '' : 's'} across ${scope})`);
process.exit(1);
