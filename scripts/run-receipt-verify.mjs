#!/usr/bin/env node
// Verify a three.ws run receipt offline, then print it stage by stage.
//
//   node scripts/run-receipt-verify.mjs rr_…                  fetch from three.ws and verify
//   node scripts/run-receipt-verify.mjs https://three.ws/runs/rr_…
//   node scripts/run-receipt-verify.mjs ./receipt.json         a saved envelope, no network at all
//   --signer <base58>   pin the issuer key (fails unless the receipt was signed by it)
//   --base <origin>     fetch from another deployment (default https://three.ws)
//   --json              print the verification result as JSON
//
// The check runs locally with the same pure verifier the server uses
// (api/_lib/run-receipt.js verifyReceipt): sha256 of the canonical receipt, then
// the ed25519 signature over the domain-tagged bytes. The server's own
// `verification` field is ignored; the point is not to take its word for it.
// Exit code 0 when every check passes, 1 otherwise.

import { readFileSync, existsSync } from 'node:fs';
import { verifyReceipt } from '../api/_lib/run-receipt.js';

const argv = process.argv.slice(2);
const flag = (name) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv.splice(i, 2)[1] : undefined;
};
const asJson = argv.includes('--json') ? (argv.splice(argv.indexOf('--json'), 1), true) : false;
const signer = flag('--signer');
const base = (flag('--base') || 'https://three.ws').replace(/\/$/, '');
const target = argv[0];

if (!target) {
	console.error('usage: node scripts/run-receipt-verify.mjs <rr_id | receipt URL | envelope.json> [--signer <base58>] [--base <origin>] [--json]');
	process.exit(2);
}

async function loadEnvelope(t) {
	if (existsSync(t)) return JSON.parse(readFileSync(t, 'utf8'));
	const id = /rr_[1-9A-HJ-NP-Za-km-z]{16,32}/.exec(t)?.[0];
	if (!id) throw new Error(`"${t}" is not a receipt id, a receipt URL, or a file`);
	const origin = /^https?:\/\//.test(t) ? new URL(t).origin : base;
	const res = await fetch(`${origin}/api/runs?id=${id}`, { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`${origin} answered ${res.status} for ${id}`);
	return res.json();
}

const MARK = { met: 'MET      ', recovered: 'RECOVERED', missed: 'MISSED   ', skipped: 'SKIPPED  ', pending: 'PENDING  ' };

try {
	const envelope = await loadEnvelope(target);
	const { receipt, sha256, signature, signer: signedBy } = envelope;
	const result = verifyReceipt({ receipt, sha256, signature, signer: signedBy }, signer ? { trustedSigner: signer } : {});
	if (asJson) {
		console.log(JSON.stringify({ id: receipt?.id, outcome: receipt?.outcome, signer: signedBy, ...result }, null, 2));
	} else {
		console.log(`${receipt.id}  ${receipt.tool}  ${receipt.outcome}`);
		console.log(receipt.summary);
		if (receipt.input?.prompt) console.log(`prompt: ${receipt.input.prompt}`);
		console.log('');
		for (const s of receipt.stages) {
			const ms = Number.isFinite(s.ms) ? ` (${(s.ms / 1000).toFixed(1)}s)` : '';
			console.log(`${MARK[s.verdict] || s.verdict}  ${s.label}${ms}`);
			console.log(`           expected: ${s.expected}`);
			console.log(`           observed: ${s.observed}`);
			if (s.cause) console.log(`           cause:    ${s.cause}`);
		}
		console.log('');
		for (const c of result.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
		console.log(result.ok ? `\nVerified. Signed by ${signedBy}.` : '\nNot verified.');
	}
	process.exit(result.ok ? 0 : 1);
} catch (err) {
	console.error(err.message || err);
	process.exit(1);
}
