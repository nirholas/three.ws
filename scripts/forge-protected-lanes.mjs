#!/usr/bin/env node
// Which Forge lanes are protected right now, measured from live production stats.
//
//   npm run forge:lanes              print every Forge lane and whether it is protected
//   npm run forge:lanes -- --check   also compare against the dated list in
//                                    docs/ops/forge-protected-lanes.md and exit 1
//                                    when the doc names a different set
//   npm run forge:lanes -- --json    machine-readable output
//
// The rule (docs/ops/forge-protected-lanes.md): a lane is protected when its last
// 7 days show at least 20 finished jobs (done + failed) at 85% success or better.
// trellis_selfhost is protected by name whatever one bad week shows.
//
// Source: GET https://three.ws/api/nvidia/stats (public, read-only). Override the
// origin with FORGE_STATS_ORIGIN, e.g. a local dev server.
//
// Exit codes: 0 ok, 1 the doc disagrees with the measurement (--check), 2 the
// stats could not be read or the doc section could not be parsed.

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const PROTECTED_BY_NAME = Object.freeze(['trellis_selfhost']);
export const MIN_FINISHED_JOBS = 20;
export const MIN_SUCCESS_PCT = 85;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC_PATH = path.join(ROOT, 'docs/ops/forge-protected-lanes.md');
const DOC_REL = 'docs/ops/forge-protected-lanes.md';

// One row per lane that reports Forge jobs. Lanes with `jobs: null` are probe-only
// services (embeddings, chat), not Forge reconstruction lanes, and are skipped.
export function classifyLanes(stats) {
	const lanes = Array.isArray(stats?.lanes) ? stats.lanes : [];
	const rows = [];
	for (const lane of lanes) {
		const week = lane?.jobs?.['7d'];
		if (!lane?.id || !week) continue;
		const done = Number(week.done) || 0;
		const failed = Number(week.failed) || 0;
		const finished = done + failed;
		const successPct = typeof week.success_pct === 'number' ? week.success_pct : null;
		const byName = PROTECTED_BY_NAME.includes(lane.id);
		const byMeasure = finished >= MIN_FINISHED_JOBS && successPct != null && successPct >= MIN_SUCCESS_PCT;
		rows.push({
			id: lane.id,
			label: lane.label || lane.id,
			done,
			failed,
			finished,
			successPct,
			protected: byName || byMeasure,
			reason: byMeasure ? 'measured' : byName ? 'by name' : null,
		});
	}
	return rows;
}

// The lane ids the doc's "Measured state" section lists under "Protected:", in
// the form "- **`lane_id`** ...". Entries that are not Forge lanes (the keyless
// image rung) are filtered by the caller against the live lane ids.
export function parseDocProtected(markdown) {
	const text = String(markdown || '');
	const heading = text.match(/^## Measured state, (.+)$/m);
	if (!heading) return null;
	const section = text.slice(heading.index + heading[0].length);
	const end = section.search(/^## /m);
	const body = end === -1 ? section : section.slice(0, end);
	const start = body.search(/^Protected:\s*$/m);
	if (start === -1) return null;
	const after = body.slice(start);
	const stop = after.search(/^Not protected/m);
	const list = stop === -1 ? after : after.slice(0, stop);
	const ids = [...list.matchAll(/^- \*\*`([a-z0-9_]+)`\*\*/gm)].map((m) => m[1]);
	return { measuredAt: heading[1].trim(), ids };
}

// Compare the doc's protected set with the measured one, over Forge lanes only.
export function compareWithDoc(rows, docProtected) {
	const laneIds = new Set(rows.map((r) => r.id));
	const measured = rows.filter((r) => r.protected).map((r) => r.id).sort();
	const documented = docProtected.ids.filter((id) => laneIds.has(id)).sort();
	const missingFromDoc = measured.filter((id) => !documented.includes(id));
	const staleInDoc = documented.filter((id) => !measured.includes(id));
	return { measured, documented, missingFromDoc, staleInDoc, agrees: !missingFromDoc.length && !staleInDoc.length };
}

function formatRow(r) {
	const tag = r.protected ? 'PROTECTED' : 'open     ';
	const pct = r.successPct == null ? 'n/a' : `${r.successPct}%`;
	const why = r.reason ? `  (${r.reason})` : '';
	return `${tag}  ${r.id.padEnd(18)} 7d done=${String(r.done).padStart(4)} failed=${String(r.failed).padStart(4)} success=${pct.padStart(6)}${why}`;
}

async function fetchStats(origin) {
	const url = `${origin.replace(/\/+$/, '')}/api/nvidia/stats`;
	const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
	if (!res.ok) throw new Error(`${url} answered ${res.status}`);
	return { url, stats: await res.json() };
}

async function main(argv) {
	const check = argv.includes('--check');
	const asJson = argv.includes('--json');
	const origin = process.env.FORGE_STATS_ORIGIN || 'https://three.ws';

	let url;
	let stats;
	try {
		({ url, stats } = await fetchStats(origin));
	} catch (err) {
		console.error(`forge:lanes: could not read live stats: ${err?.message}`);
		console.error('Retry in a minute; the endpoint is public and read-only. Nothing was compared.');
		return 2;
	}

	const rows = classifyLanes(stats);
	if (!rows.length) {
		console.error(`forge:lanes: ${url} returned no lanes with job counts; nothing to classify.`);
		return 2;
	}

	let comparison = null;
	let docMeta = null;
	if (check) {
		docMeta = parseDocProtected(await readFile(DOC_PATH, 'utf8'));
		if (!docMeta) {
			console.error(`forge:lanes: could not find the "## Measured state, <date>" section with a "Protected:" list in ${DOC_REL}.`);
			return 2;
		}
		comparison = compareWithDoc(rows, docMeta);
	}

	if (asJson) {
		console.log(JSON.stringify({ source: url, generated_at: stats.generated_at ?? null, lanes: rows, check: comparison && { doc_measured_at: docMeta.measuredAt, ...comparison } }, null, 2));
	} else {
		console.log(`Forge lanes, last 7 days (source ${url}, generated ${stats.generated_at ?? 'unknown'})`);
		console.log(`Rule: ${MIN_FINISHED_JOBS}+ finished jobs at ${MIN_SUCCESS_PCT}%+ success, or protected by name (${PROTECTED_BY_NAME.join(', ')}).`);
		console.log('');
		for (const r of rows) console.log(formatRow(r));
		if (comparison) {
			console.log('');
			console.log(`Doc ${DOC_REL} (measured ${docMeta.measuredAt}) lists: ${comparison.documented.join(', ') || 'none'}`);
			if (comparison.agrees) {
				console.log('The doc agrees with the measurement.');
			} else {
				if (comparison.missingFromDoc.length) console.log(`Protected now but not in the doc: ${comparison.missingFromDoc.join(', ')}`);
				if (comparison.staleInDoc.length) console.log(`In the doc but not protected now: ${comparison.staleInDoc.join(', ')}`);
				console.log(`Update the "Measured state" section and its date in ${DOC_REL}.`);
			}
		}
	}
	return comparison && !comparison.agrees ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err) => {
			console.error(`forge:lanes: ${err?.stack || err}`);
			process.exit(2);
		},
	);
}
