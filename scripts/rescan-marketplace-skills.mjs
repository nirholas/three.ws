#!/usr/bin/env node
/**
 * Rescan every marketplace skill with the supply-chain scanner
 * (api/_lib/skill-supply-scan.js) and record the verdicts.
 *
 * Safe by default: a dry run that writes nothing and prints what would change.
 *
 *   node --env-file=.env.local scripts/rescan-marketplace-skills.mjs            # dry run
 *   node --env-file=.env.local scripts/rescan-marketplace-skills.mjs --apply    # write verdicts, hide held/blocked skills
 *   node --env-file=.env.local scripts/rescan-marketplace-skills.mjs --apply --only-stale   # skip rows already scanned by this scanner version
 *   node --env-file=.env.local scripts/rescan-marketplace-skills.mjs --json     # machine-readable summary
 *
 * Applying makes `review` and `blocked` skills private (review goes to the
 * moderator queue at /api/skills/moderation) and leaves clean skills as they
 * were. A moderator approval survives a rescan of unchanged content.
 */

import { rescanCatalog } from '../api/_lib/skill-scan-store.js';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');

if (!process.env.DATABASE_URL) {
	console.error('missing required env var: DATABASE_URL (run with --env-file=.env.local)');
	process.exit(2);
}

const summary = await rescanCatalog({ apply, onlyStale: args.has('--only-stale') });

if (args.has('--json')) {
	console.log(JSON.stringify(summary, null, 2));
} else {
	console.log(`scanner ${summary.scanner_version}  ${apply ? 'APPLIED' : 'dry run (nothing written)'}`);
	console.log(`scanned:        ${summary.total}${summary.skipped_current ? `  (skipped ${summary.skipped_current} already current)` : ''}`);
	console.log(`clean:          ${summary.verdicts.clean}`);
	console.log(`review:         ${summary.verdicts.review}`);
	console.log(`blocked:        ${summary.verdicts.blocked}`);
	console.log(`${apply ? 'made private' : 'would hide'}:   ${summary.made_private}  (already private: ${summary.already_private}, approvals kept: ${summary.approvals_kept})`);
	const rules = Object.entries(summary.by_rule).sort((a, b) => b[1] - a[1]);
	if (rules.length) console.log(`findings by rule: ${rules.map(([r, n]) => `${r}=${n}`).join(' ')}`);
	for (const f of summary.flagged.slice(0, 40)) console.log(`  ${f.verdict.padEnd(7)} ${f.was_public ? 'public ' : 'private'} ${f.slug}  ${f.rules.join(' ')}`);
	if (summary.flagged.length > 40) console.log(`  ... and ${summary.flagged.length - 40} more (use --json)`);
}
process.exit(0);
