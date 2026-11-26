#!/usr/bin/env node
/**
 * Pull every entry from NVIDIA's public Accelerated Apps Catalog.
 *
 * Source: the JSON API behind nvidia.com/accelerated-applications (the same
 * endpoint the catalog widget calls). No key, plain GET.
 *
 *   node scripts/nvidia-apps-catalog-pull.mjs                 all apps
 *   node scripts/nvidia-apps-catalog-pull.mjs --inception     the Inception startup view only
 *   node scripts/nvidia-apps-catalog-pull.mjs --out <dir>     where to write (default docs/nvidia-apps-catalog)
 *   node scripts/nvidia-apps-catalog-pull.mjs --find three    print entries whose title, company or link match
 *
 * Writes <dir>/catalog[-inception].json (raw entries, attributes flattened) and
 * a .csv with one row per app. Exits non-zero if the API answers with an error
 * or the page count does not add up to totalCount.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ENDPOINT = 'https://api-prod.nvidia.com/services/apps-catalog/v1/catalog?locale=en-us&groupID=appscatalog';
const PAGE = 100;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const inception = flag('--inception');
const outDir = resolve(value('--out') || 'docs/nvidia-apps-catalog');
const find = value('--find');

function filterParam() {
	if (!inception) return '';
	const json = JSON.stringify({ Collections: ['Inception'] });
	return `&filter=${encodeURIComponent(Buffer.from(json).toString('base64'))}`;
}

async function page(start) {
	const url = `${ENDPOINT}&start=${start}&total=${PAGE}${filterParam()}`;
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(url, {
				headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (catalog-check)' },
				signal: AbortSignal.timeout(60_000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = await res.json();
			if (body.responseCode && body.responseCode !== '200') throw new Error(`API ${body.responseCode}: ${body.responseMessage}`);
			return body;
		} catch (err) {
			if (attempt >= 4) throw new Error(`page start=${start} failed after ${attempt} tries: ${err.message}`);
			await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
		}
	}
}

function flatten(entry) {
	const attrs = {};
	for (const { attribute, value: v } of entry.attributes || []) {
		const val = String(v ?? '').trim();
		if (!val) continue;
		(attrs[attribute] ||= []).push(val);
	}
	return {
		productID: entry.productID,
		title: entry.title,
		company: entry.companyTitle,
		link: entry.link,
		companyLink: entry.companyLink,
		description: entry.description,
		logo: entry.logo,
		attributes: attrs,
	};
}

const csvCell = (v) => {
	const s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const first = await page(0);
const total = first.totalCount;
const entries = [...(first.applicationList || first.applications || first.data || findList(first))];
for (let start = PAGE; start < total; start += PAGE) entries.push(...findList(await page(start)));

function findList(body) {
	const list = Object.values(body).find((v) => Array.isArray(v) && v.length && v[0]?.productID);
	return list || [];
}

const apps = [...new Map(entries.map((e) => [e.productID, flatten(e)])).values()];
if (apps.length !== total) {
	console.error(`expected ${total} apps, got ${apps.length} unique`);
	process.exitCode = 1;
}

mkdirSync(outDir, { recursive: true });
const base = inception ? 'catalog-inception' : 'catalog';
const fetchedAt = new Date().toISOString();
writeFileSync(join(outDir, `${base}.json`), JSON.stringify({ fetchedAt, source: ENDPOINT, inception, totalCount: total, apps }, null, '\t') + '\n');

const cols = ['title', 'company', 'link', 'companyLink', 'Catalog_Type', 'Acceleration_Type', 'Workloads', 'IndustrySegment', 'AppCategories', 'Country', 'Collections', 'description'];
const rows = [cols.join(',')];
for (const a of apps) rows.push(cols.map((c) => csvCell(a[c] ?? a.attributes[c])).join(','));
writeFileSync(join(outDir, `${base}.csv`), rows.join('\n') + '\n');

console.log(`${apps.length} apps (totalCount ${total}${inception ? ', Inception view' : ''}) -> ${join(outDir, base)}.{json,csv}`);

if (find) {
	const q = find.toLowerCase();
	const hits = apps.filter((a) => [a.title, a.company, a.link, a.companyLink].some((v) => String(v || '').toLowerCase().includes(q)));
	console.log(`\n${hits.length} match "${find}":`);
	for (const h of hits) console.log(`- ${h.title} | ${h.company} | ${h.link}`);
}
