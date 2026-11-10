#!/usr/bin/env node
// Inventory of legacy button and pill class families (docs/btn-pill-migration.md).
// Default run: prints every family with file counts and exits 1 only when a
// family marked "migrated" has reappeared (or forge.html shadows .btn again).
// --strict: also exits 1 while any open (non-kept) family remains.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIRS = ['pages', 'src', 'public'];
const EXT = new Set(['.html', '.js', '.css']);

const MIGRATED = [
	'explore-btn',
	'explore-chain-badge',
	'erc8004-brand-badge',
	'deploy-svc-pill',
	'market-empty-cta-btn.primary',
	'ad-btn',
	'as-btn',
	'br-btn',
	'fm-btn',
	'bento-action-btn',
];

const KEPT = {
	'anim-btn': 'bespoke animation tile layout (key hint, icon, label); not a plain button',
	'ltm-toggle-btn': 'segmented mainnet/devnet toggle inside .ltm-toggle; the group border is the affordance',
	'nav-pill-sm': 'nav badge with live/new tones and mono 8.5px type owned by nav.css',
	'price-badge': 'marketplace price tag with per-card positioning',
	'market-empty-cta-btn': 'now rides on .btn; kept only as a thin sizing hook for the empty-state row',
	'ar-btn': 'viewer toolbar AR toggle with BEM label and an active state toggled from viewer.js; the other hits are element ids',
	'pay-btn': 'brand-gradient (Solana purple / orange) and theme-inverting checkout CTA with its own .spin/.busy payment state',
	'back-btn': 'per-flow wizard back link whose JS selectors depend on it',
};

const OPEN = [];

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, out);
		else if (EXT.has(p.slice(p.lastIndexOf('.')))) out.push(p);
	}
	return out;
}

const files = DIRS.flatMap((d) => walk(join(ROOT, d)));
const text = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

function count(cls) {
	const re = new RegExp(`(^|[^a-zA-Z0-9_-])${cls.replace(/[.]/g, '\\.')}([^a-zA-Z0-9_-]|$)`);
	const hits = [];
	for (const [f, t] of text) {
		const lines = t.split('\n').filter((l) => re.test(l)).length;
		if (lines) hits.push({ file: relative(ROOT, f), lines });
	}
	return hits;
}

let failed = false;
console.log('Migrated families (must stay at zero):');
for (const cls of MIGRATED) {
	const hits = cls.includes('.')
		? count(cls.split('.')[0]).filter((h) => /market-empty-cta-btn primary|market-empty-cta-btn\.primary/.test(text.get(join(ROOT, h.file))))
		: count(cls);
	console.log(`  ${cls}: ${hits.length} files`);
	if (hits.length) {
		failed = true;
		for (const h of hits) console.log(`    REAPPEARED ${h.file} (${h.lines} lines)`);
	}
}

const forge = text.get(join(ROOT, 'pages/forge.html')) || '';
if (/^\s*\.btn(-ghost)?\s*[{:]/m.test(forge)) {
	failed = true;
	console.log('REAPPEARED: pages/forge.html defines its own .btn / .btn-ghost');
}

console.log('Kept deliberately:');
for (const [cls, why] of Object.entries(KEPT)) console.log(`  ${cls}: ${count(cls).length} files (${why})`);

let open = 0;
console.log('Open (still to migrate):');
for (const cls of OPEN) {
	const hits = count(cls);
	open += hits.length;
	console.log(`  ${cls}: ${hits.length} files`);
}

if (failed) process.exit(1);
if (process.argv.includes('--strict') && open) process.exit(1);
