#!/usr/bin/env node
// Owner-run review queue for the NVIDIA Inception member perk.
//
//   node --env-file=.env scripts/inception-review.mjs list [--status pending|approved|rejected]
//   node --env-file=.env scripts/inception-review.mjs approve <id> [--usd 25] [--note "text"]
//   node --env-file=.env scripts/inception-review.mjs reject  <id> --note "reason the applicant can act on"
//
// There is no public API that proves Inception membership, so check the applicant's
// Inception portal profile (the optional reference they gave) or reply to their
// contact email before approving. Approval credits the account's prepaid wallet with
// a 'grant' ledger row, idempotent on inception:<id>, so a re-run never double-grants.
// A platform credit grant is not an on-chain action and needs no spend confirmation.
// Guide: docs/nvidia-inception-perk.md.

import {
	listApplications,
	approveApplication,
	rejectApplication,
	DEFAULT_GRANT_USD,
} from '../api/_lib/inception.js';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt = null) => {
	const i = rest.indexOf(`--${name}`);
	return i !== -1 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : dflt;
};
const die = (msg) => {
	console.error(`error: ${msg}`);
	process.exit(1);
};

if (!process.env.DATABASE_URL) die('DATABASE_URL is not set. Run with --env-file=.env');

try {
	if (cmd === 'list') {
		const rows = await listApplications({ status: flag('status', 'pending') });
		if (!rows.length) console.log('No applications in that state.');
		for (const r of rows) {
			console.log(`\n${r.id}  ${r.status}  ${new Date(r.created_at).toISOString()}`);
			console.log(`  company   ${r.company}  (${r.website})`);
			console.log(`  contact   ${r.contact_email}   account: ${r.username || r.account_email}`);
			console.log(`  inception ${r.inception_ref || '(none given)'}`);
			console.log(`  use case  ${r.use_case}`);
			if (r.grant_usd != null) console.log(`  granted   $${Number(r.grant_usd).toFixed(2)}`);
			if (r.reviewer_note) console.log(`  note      ${r.reviewer_note}`);
		}
	} else if (cmd === 'approve') {
		const id = rest[0];
		if (!id || id.startsWith('--')) die('approve needs an application id');
		const out = await approveApplication({
			id,
			grantUsd: Number(flag('usd', DEFAULT_GRANT_USD)),
			note: flag('note'),
		});
		console.log(
			`approved ${out.id}: granted $${out.grantUsd.toFixed(2)}, balance now $${out.balanceUsd.toFixed(2)}` +
				(out.replay ? ' (credit already existed, status repaired)' : ''),
		);
	} else if (cmd === 'reject') {
		const id = rest[0];
		if (!id || id.startsWith('--')) die('reject needs an application id');
		const out = await rejectApplication({ id, note: flag('note') });
		console.log(`rejected ${out.id}`);
	} else {
		die('usage: inception-review.mjs list | approve <id> | reject <id> --note "..."');
	}
} catch (err) {
	die(err.message || String(err));
}
process.exit(0);
