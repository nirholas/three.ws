#!/usr/bin/env node
// Owner-run review queue for the partner startup-program perks (NVIDIA Inception
// first).
//
//   node --env-file=.env scripts/inception-review.mjs list [--status pending|approved|rejected]
//   node --env-file=.env scripts/inception-review.mjs approve <id> [--usd N] [--note "text"]
//   node --env-file=.env scripts/inception-review.mjs reject  <id> --note "reason the applicant can act on"
//   node --env-file=.env scripts/inception-review.mjs shoutouts
//   node --env-file=.env scripts/inception-review.mjs approve-shoutout <id> [--usd N] [--note "text"]
//   node --env-file=.env scripts/inception-review.mjs reject-shoutout  <id> --note "why"
//
// No public API proves program membership or that a post is live. Before approving
// an application, check the applicant's portal profile (the optional reference they
// gave) or reply to their contact email. Before approving a shoutout, open the link
// logged out: it must load publicly, be recent, and be about three.ws.
// Approval credits the prepaid wallet with a 'grant' ledger row, idempotent per row,
// so a re-run never double-grants. A platform credit grant is not an on-chain action
// and needs no spend confirmation. Guide: docs/nvidia-inception-perk.md.

import {
	listApplications,
	listShoutouts,
	approveApplication,
	rejectApplication,
	approveShoutout,
	rejectShoutout,
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
const idArg = (what) => {
	const id = rest[0];
	if (!id || id.startsWith('--')) die(`${what} needs an application id`);
	return id;
};
const usd = () => (flag('usd') == null ? undefined : Number(flag('usd')));

if (!process.env.DATABASE_URL) die('DATABASE_URL is not set. Run with --env-file=.env');

try {
	if (cmd === 'list') {
		const rows = await listApplications({ status: flag('status', 'pending') });
		if (!rows.length) console.log('No applications in that state.');
		for (const r of rows) {
			console.log(`\n${r.id}  ${r.program}  ${r.status}  ${new Date(r.created_at).toISOString()}`);
			console.log(`  company   ${r.company}  (${r.website})`);
			console.log(`  contact   ${r.contact_email}   account: ${r.username || r.account_email}`);
			console.log(`  ref       ${r.inception_ref || '(none given)'}`);
			console.log(`  use case  ${r.use_case}`);
			if (r.grant_usd != null) console.log(`  granted   $${Number(r.grant_usd).toFixed(2)}`);
			if (r.reviewer_note) console.log(`  note      ${r.reviewer_note}`);
			if (r.shoutout_status !== 'none') console.log(`  shoutout  ${r.shoutout_status} ${r.shoutout_url || ''}`);
		}
	} else if (cmd === 'approve') {
		const out = await approveApplication({ id: idArg('approve'), grantUsd: usd(), note: flag('note') });
		console.log(
			`approved ${out.id}: granted $${out.grantUsd.toFixed(2)}, balance now $${out.balanceUsd.toFixed(2)}` +
				(out.replay ? ' (credit already existed, status repaired)' : ''),
		);
	} else if (cmd === 'reject') {
		const out = await rejectApplication({ id: idArg('reject'), note: flag('note') });
		console.log(`rejected ${out.id}`);
	} else if (cmd === 'shoutouts') {
		const rows = await listShoutouts();
		if (!rows.length) console.log('No shoutouts waiting.');
		for (const r of rows) {
			console.log(`\n${r.id}  ${r.program}  ${r.company}  (${r.username || r.account_email})`);
			console.log(`  ${r.shoutout_url}   submitted ${new Date(r.shoutout_at).toISOString()}`);
		}
	} else if (cmd === 'approve-shoutout') {
		const out = await approveShoutout({ id: idArg('approve-shoutout'), bonusUsd: usd(), note: flag('note') });
		console.log(
			`shoutout approved ${out.id}: bonus $${out.bonusUsd.toFixed(2)}, balance now $${out.balanceUsd.toFixed(2)}` +
				(out.replay ? ' (credit already existed, status repaired)' : ''),
		);
	} else if (cmd === 'reject-shoutout') {
		const out = await rejectShoutout({ id: idArg('reject-shoutout'), note: flag('note') });
		console.log(`shoutout rejected ${out.id}`);
	} else {
		die('usage: inception-review.mjs list | approve | reject | shoutouts | approve-shoutout | reject-shoutout');
	}
} catch (err) {
	die(err.message || String(err));
}
process.exit(0);
