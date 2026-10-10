#!/usr/bin/env node
// Rebuilds data/domain-tlds.json, the list of TLDs the domain_* tools price.
//
// Cloud Domains has no "list supported TLDs" endpoint, so this probes a
// candidate list (every TLD Google documents plus common requests) against
// retrieveRegisterParameters with a throwaway label. A TLD the registrar does
// not sell answers UNSUPPORTED and is dropped; the rest are written with their
// live yearly price, supported privacy modes and required notices.
//
//   node scripts/refresh-domain-tlds.mjs            write data/domain-tlds.json
//   node scripts/refresh-domain-tlds.mjs --dry-run  print, write nothing
//
// Credentials: the same chain as the API (GCP_SERVICE_ACCOUNT_JSON, metadata
// server, or `gcloud auth application-default login`).

import { writeFileSync } from 'node:fs';
import { retrieveRegisterParameters, moneyToNumber } from '../api/_lib/cloud-domains.js';

const CANDIDATES = `com net org info biz name pro xyz online site store tech cloud app dev page art shop club live life studio media agency
academy ai auto bar best blog blue build business buzz cafe capital cash center chat city click coach codes community company
computer consulting cool dance deals design digital direct domains earth email energy events exchange expert express family
fan farm finance fit fun fund fyi gallery game games global gold golf graphics green group guide guru health help holdings
home host house inc industries ink io land link lol love ltd market marketing money network news ninja one partners party
photo pics place plus press productions promo run sale school science services show social software solutions space support
systems team technology today tools top town trade training tube vip wiki win work works world wtf zone co us uk de fr es it
nl ch se ca au in`.split(/\s+/);

const dryRun = process.argv.includes('--dry-run');
const unique = [...new Set(CANDIDATES)];
const label = 'threews-tld-probe';
const rows = [];
const skipped = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// retrieveRegisterParameters is quota-limited per minute. Probe serially and,
// when the API answers 429, wait out the window instead of failing the run.
async function lookup(tld) {
	for (let attempt = 0; attempt < 6; attempt++) {
		try {
			return await retrieveRegisterParameters(`${label}.${tld}`);
		} catch (err) {
			if (err.code !== 'domains_rate_limited') throw err;
			await sleep(20_000);
		}
	}
	throw new Error(`still rate limited probing .${tld}`);
}

async function probe(tld) {
	try {
		const p = await lookup(tld);
		if (!p || p.availability === 'UNSUPPORTED') return skipped.push(tld);
		rows.push({
			tld,
			yearlyUsd: moneyToNumber(p.yearlyPrice),
			currency: p.yearlyPrice?.currencyCode || 'USD',
			privacy: p.supportedPrivacy || [],
			notices: p.domainNotices || [],
		});
	} catch (err) {
		if (err.code === 'domains_invalid_request') return skipped.push(tld);
		throw err;
	}
}

const queue = [...unique];
while (queue.length) {
	await probe(queue.shift());
	await sleep(400);
}

rows.sort((a, b) => a.tld.localeCompare(b.tld));
const out = { generatedAt: new Date().toISOString(), probed: unique.length, supported: rows.length, tlds: rows };
console.log(`probed ${unique.length}, supported ${rows.length}, unsupported ${skipped.length}`);
if (dryRun) console.log(JSON.stringify(out.tlds.slice(0, 10), null, 2));
else {
	writeFileSync(new URL('../data/domain-tlds.json', import.meta.url), JSON.stringify(out, null, '\t') + '\n');
	console.log('wrote data/domain-tlds.json');
}
