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

const CANDIDATES = `com net org info biz name mobi pro tel asia xyz online site store tech cloud app dev page art shop club live
life studio media agency academy accountant actor adult africa ai airforce army attorney auction audio auto band bar bargains
beer best bet bid bike bio black blog blue boutique build builders business buzz cab cafe camera camp capital car cards care
career careers cash casino catering center ceo charity chat cheap church city claims cleaning click clinic clothing coach codes
coffee community company computer condos construction consulting contact contractors cool coupons credit creditcard cricket
cruises dance date dating deals degree delivery democrat dental dentist design diamonds digital direct directory discount
doctor dog domains earth education email energy engineer engineering enterprises equipment estate events exchange expert
exposed express fail faith family fan fans farm fashion film finance financial fish fishing fit fitness flights florist flowers
football forsale foundation fun fund furniture futbol fyi gallery game games garden gift gifts gives glass global gmbh gold
golf graphics gratis green gripe group guide guitars guru haus health healthcare help hockey holdings holiday home horse
hospital host house how icu immo immobilien inc industries ink institute insure international investments io irish jewelry
juegos kaufen kim kitchen kiwi land lawyer lease legal lgbt lighting limited limo link live loan loans lol love ltd luxury
maison management market marketing mba media memorial men menu moda moe money mortgage movie navy network new news ninja
nyc one onl organic page partners parts party pet photo photography photos pics pictures pink pizza place plumbing plus
poker porn press productions promo properties property pub quest racing recipes red rehab reise reisen rent rentals repair
report republican rest restaurant review reviews rich rip rocks rodeo run sale salon sarl school schule science security
services sex sexy shiksha shoes show singles site ski soccer social software solar solutions soy space sport store stream
studio study style sucks supplies supply support surf surgery systems tax taxi team tech technology tennis theater tips
tires today tools top tours town toys trade trading training tube university uno vacations vegas ventures vet viajes video
villas vin vip vision vodka vote voting voto voyage wang watch webcam website wedding wiki win wine work works world wtf
xyz yoga zone co us uk de fr es it nl be ch at se no dk fi pl cz pt ie eu ca au nz jp in br mx ar cl`.split(/\s+/);

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
