// Print a correctly tagged URL for a campaign in marketing/growth/campaigns.csv.
//
//   node scripts/campaign-link.mjs <campaign-id> <url> [--source x] [--medium social] [--content anchor-video]
//
// Refuses ids that are not in campaigns.csv, so a link can never carry a campaign
// the ledger and the weekly scorecard do not know.

import { readCampaigns } from './lib/campaigns-csv.mjs';
import { normalizeLabel } from '../public/campaign-attribution.js';

const args = process.argv.slice(2);
const positional = [];
const opts = {};
for (let i = 0; i < args.length; i++) {
	if (args[i].startsWith('--')) opts[args[i].slice(2)] = args[++i];
	else positional.push(args[i]);
}
const [id, rawUrl] = positional;
if (!id || !rawUrl) {
	console.error('usage: node scripts/campaign-link.mjs <campaign-id> <url> [--source s] [--medium m] [--content c]');
	process.exit(2);
}
const known = readCampaigns().map((c) => c.campaign_id);
const match = known.find((k) => k.toLowerCase() === id.toLowerCase());
if (!match) {
	console.error(`unknown campaign id "${id}". Known ids:\n  ${known.join('\n  ')}`);
	process.exit(1);
}
let url;
try {
	url = new URL(rawUrl);
} catch {
	console.error(`not a URL: ${rawUrl}`);
	process.exit(2);
}
for (const [k, v] of Object.entries({ source: opts.source, medium: opts.medium, content: opts.content })) {
	if (v && !normalizeLabel(v)) {
		console.error(`--${k} must be lowercase letters, digits, dot, dash or underscore (max 40)`);
		process.exit(2);
	}
}
if (opts.source) url.searchParams.set('utm_source', opts.source);
if (opts.medium) url.searchParams.set('utm_medium', opts.medium);
url.searchParams.set('utm_campaign', match.toLowerCase());
if (opts.content) url.searchParams.set('utm_content', opts.content);
console.log(url.toString());
