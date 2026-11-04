#!/usr/bin/env node
// Wallet-recovery ownership proof: generate the challenge a claimant signs,
// verify the two signatures that come back, and close the claim after payout.
// Support releases a stranded agent-wallet balance only after this passes.
//
//   node scripts/verify-wallet-ownership.mjs challenge --agent <uuid> [--issued <iso>]
//       [--login-wallet <addr>] [--funding-wallet <addr>]
//   node scripts/verify-wallet-ownership.mjs verify --claim <file>
//       --login-wallet <addr> --login-sig <sig> --funding-wallet <addr> --funding-sig <sig>
//       [--allow-same-wallet "<reason>"] [--check-account]
//   node scripts/verify-wallet-ownership.mjs mark-used --claim <file> --tx <payout signature>
//
// Claim records are JSON files in .support-claims/ (git-ignored: they name a
// real customer's wallets). WALLET_OWNERSHIP_CLAIMS_DIR overrides the
// directory. WALLET_OWNERSHIP_NOW overrides the clock (ISO-8601); it exists so
// the expiry tests are deterministic and has no other use.
//
// --check-account reads DATABASE_URL inside a read-only transaction. This
// script never writes to the database and never moves funds.
// Runbook: docs/support/stranded-wallet-ownership-proof.md

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	buildChallenge,
	decodeAddress,
	generateNonce,
	isLookAlike,
	isUuid,
	toIsoSeconds,
	verifyWalletSignature,
} from './lib/wallet-ownership.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLAIM_TTL_MS = 72 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const SPEC = {
	challenge: { values: ['--agent', '--issued', '--login-wallet', '--funding-wallet'], flags: [] },
	verify: {
		values: ['--claim', '--login-wallet', '--login-sig', '--funding-wallet', '--funding-sig', '--allow-same-wallet'],
		flags: ['--check-account'],
	},
	'mark-used': { values: ['--claim', '--tx'], flags: [] },
};

const USAGE = `usage:
  verify-wallet-ownership challenge --agent <uuid> [--issued <iso>] [--login-wallet <addr>] [--funding-wallet <addr>]
  verify-wallet-ownership verify --claim <file> --login-wallet <addr> --login-sig <sig>
      --funding-wallet <addr> --funding-sig <sig> [--allow-same-wallet "<reason>"] [--check-account]
  verify-wallet-ownership mark-used --claim <file> --tx <payout signature>
runbook: docs/support/stranded-wallet-ownership-proof.md`;

function fail(message) {
	console.error(`verify-wallet-ownership: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const [command, ...rest] = argv;
	if (!command || command === '--help' || command === '-h') {
		console.log(USAGE);
		process.exit(command ? 0 : 1);
	}
	const spec = SPEC[command];
	if (!spec) fail(`unknown command: ${command}\n${USAGE}`);
	const opts = {};
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (spec.flags.includes(a)) opts[a.slice(2)] = true;
		else if (spec.values.includes(a) && rest[i + 1] !== undefined) opts[a.slice(2)] = rest[++i];
		else fail(`unknown or incomplete argument for ${command}: ${a}`);
	}
	return { command, opts };
}

function now() {
	const override = process.env.WALLET_OWNERSHIP_NOW;
	if (!override) return new Date();
	const d = new Date(override);
	if (Number.isNaN(d.getTime())) fail(`WALLET_OWNERSHIP_NOW is not a valid timestamp: ${override}`);
	return d;
}

function claimsDir() {
	return path.resolve(process.env.WALLET_OWNERSHIP_CLAIMS_DIR || path.join(ROOT, '.support-claims'));
}

function writeClaim(file, claim) {
	const tmp = `${file}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(claim, null, 2)}\n`, { mode: 0o600 });
	renameSync(tmp, file);
}

function requireAddress(value, flag) {
	if (!value) fail(`${flag} is required`);
	if (!decodeAddress(value)) fail(`${flag} is not a valid Solana address: ${value}`);
	return value.trim();
}

function loadClaim(file) {
	if (!file) fail('--claim is required');
	if (!existsSync(file)) fail(`claim file not found: ${file}`);
	let claim;
	try {
		claim = JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		fail(`claim file is not valid JSON (${err.message}): ${file}`);
	}
	let expected;
	try {
		expected = buildChallenge({ agentId: claim.agent_id, nonce: claim.nonce, issuedAt: claim.issued_at });
	} catch (err) {
		fail(`claim record is malformed: ${err.message}`);
	}
	// The stored text is what the claimant was sent. If it no longer matches the
	// fields it was built from, the record was edited and cannot be trusted.
	if (claim.message !== expected) fail('claim record was altered: its message no longer matches its fields');
	return claim;
}

function cmdChallenge(opts) {
	if (!isUuid(opts.agent)) fail(`--agent must be the agent's UUID, got: ${opts.agent ?? '(missing)'}`);
	const issued = opts.issued ? toIsoSeconds(opts.issued) : toIsoSeconds(now());
	if (!issued) fail(`--issued is not a valid ISO-8601 timestamp: ${opts.issued}`);
	const agentId = opts.agent.toLowerCase();
	const nonce = generateNonce();
	const message = buildChallenge({ agentId, nonce, issuedAt: issued });
	const expires = toIsoSeconds(new Date(Date.parse(issued) + CLAIM_TTL_MS));

	const dir = claimsDir();
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const file = path.join(dir, `${agentId}-${nonce}.json`);
	const claim = {
		agent_id: agentId,
		nonce,
		issued_at: issued,
		expires_at: expires,
		message,
		login_wallet: opts['login-wallet'] ? requireAddress(opts['login-wallet'], '--login-wallet') : null,
		funding_wallet: opts['funding-wallet'] ? requireAddress(opts['funding-wallet'], '--funding-wallet') : null,
		status: 'open',
		attempts: [],
	};
	writeFileSync(file, `${JSON.stringify(claim, null, 2)}\n`, { mode: 0o600, flag: 'wx' });

	console.log(`Claim opened: ${file}`);
	console.log(`Expires: ${expires} (72 hours after issue)`);
	console.log('');
	console.log('Send the claimant this exact text, to sign once from each wallet:');
	console.log('');
	console.log(message);
	console.log('');
}

async function checkAccount(claim, login, funding) {
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.log('account check skipped: DATABASE_URL is not set, so the owner wallet and custody trail were not read.');
		console.log('Rerun with --check-account on a machine that has the production connection string before paying out.');
		return { ok: true, skipped: true };
	}
	const { neon } = await import('@neondatabase/serverless');
	const sql = neon(url);
	let agentRows;
	let walletRows;
	let destRows;
	try {
		[agentRows, walletRows, destRows] = await sql.transaction(
			[
				sql`select user_id, meta->>'solana_address' as agent_wallet, deleted_at
				    from agent_identities where id = ${claim.agent_id}`,
				sql`select uw.address from user_wallets uw
				    join agent_identities a on a.user_id = uw.user_id
				    where a.id = ${claim.agent_id} and uw.chain_type = 'solana'`,
				sql`select destination, count(*)::int as uses, max(created_at) as last_used
				    from agent_custody_events
				    where agent_id = ${claim.agent_id} and destination is not null
				    group by destination order by max(created_at) desc`,
			],
			{ readOnly: true },
		);
	} catch (err) {
		console.log(`account check FAILED: the database could not be read (${err.message}).`);
		return { ok: false };
	}

	if (!agentRows.length) {
		console.log(`account check FAIL: no agent ${claim.agent_id} exists.`);
		return { ok: false };
	}
	const agent = agentRows[0];
	const ownerWallets = walletRows.map((r) => r.address);
	console.log(`account check: agent wallet ${agent.agent_wallet ?? '(none recorded)'}${agent.deleted_at ? ' (agent deleted)' : ''}`);
	console.log(`  owner's Solana wallets: ${ownerWallets.length ? ownerWallets.join(', ') : '(none recorded)'}`);
	const loginLinked = ownerWallets.includes(login);
	console.log(`  login wallet linked to owner: ${loginLinked ? 'yes' : 'NO'}`);

	let flagged = 0;
	if (destRows.length) {
		console.log('  custody-event destinations:');
		for (const r of destRows) {
			const lookAlike = isLookAlike(r.destination, login) || isLookAlike(r.destination, funding);
			if (lookAlike) flagged++;
			const tag =
				r.destination === login
					? 'login wallet'
					: r.destination === funding
						? 'funding wallet'
						: lookAlike
							? 'LOOK-ALIKE: address poisoning, never pay here'
							: 'other';
			console.log(`    ${r.destination}  x${r.uses}  ${tag}`);
		}
	} else {
		console.log('  custody-event destinations: none recorded');
	}
	if (flagged) console.log(`  ${flagged} look-alike destination(s) flagged; confirm the signing wallets are the genuine ones.`);
	if (!loginLinked) {
		console.log('account check FAIL: the login wallet is not a wallet recorded for the agent owner.');
		return { ok: false };
	}
	return { ok: true };
}

async function cmdVerify(opts) {
	const file = path.resolve(opts.claim ?? '');
	const claim = loadClaim(opts.claim ? file : undefined);
	if (claim.status === 'verified') fail(`claim already verified at ${claim.verified_at}; a claim is single-use. Open a new one.`);
	if (claim.status === 'used') fail(`claim already used for payout ${claim.payout_tx}; a claim is single-use. Open a new one.`);
	if (claim.status !== 'open') fail(`claim status is ${claim.status}, not open`);

	const login = requireAddress(opts['login-wallet'], '--login-wallet');
	const funding = requireAddress(opts['funding-wallet'], '--funding-wallet');
	if (!opts['login-sig']) fail('--login-sig is required');
	if (!opts['funding-sig']) fail('--funding-sig is required');

	const at = now();
	const problems = [];
	const issuedMs = Date.parse(claim.issued_at);
	if (at.getTime() - issuedMs > CLAIM_TTL_MS) problems.push(`claim expired at ${claim.expires_at ?? 'issue + 72h'}; open a new one`);
	if (issuedMs - at.getTime() > CLOCK_SKEW_MS) problems.push(`claim issued in the future (${claim.issued_at})`);
	if (claim.login_wallet && claim.login_wallet !== login) problems.push(`login wallet differs from the one on the claim (${claim.login_wallet})`);
	if (claim.funding_wallet && claim.funding_wallet !== funding) problems.push(`funding wallet differs from the one on the claim (${claim.funding_wallet})`);
	const sameReason = opts['allow-same-wallet']?.trim();
	if (login === funding && !sameReason) {
		problems.push('the same wallet was given as login and funding wallet; pass --allow-same-wallet "<reason>" if that is genuinely how the account was funded');
	}

	const loginResult = verifyWalletSignature({ message: claim.message, address: login, signature: opts['login-sig'] });
	const fundingResult = verifyWalletSignature({ message: claim.message, address: funding, signature: opts['funding-sig'] });
	const line = (label, r) => `  ${label.padEnd(15)} ${r.ok ? 'PASS' : `FAIL ${r.reason}`}`;
	console.log(`Claim ${claim.agent_id} nonce ${claim.nonce}`);
	console.log(line('login wallet', loginResult));
	console.log(line('funding wallet', fundingResult));
	for (const p of problems) console.log(`  FAIL ${p}`);

	let account = { ok: true };
	if (opts['check-account'] && loginResult.ok && fundingResult.ok && !problems.length) {
		account = await checkAccount(claim, login, funding);
	}

	const passed = loginResult.ok && fundingResult.ok && !problems.length && account.ok;
	claim.attempts = [
		...(claim.attempts ?? []),
		{
			at: toIsoSeconds(at),
			login_wallet: login,
			funding_wallet: funding,
			login: loginResult.reason ?? 'pass',
			funding: fundingResult.reason ?? 'pass',
			problems,
			account_check: opts['check-account'] ? (account.skipped ? 'skipped' : account.ok ? 'pass' : 'fail') : 'not_run',
			result: passed ? 'pass' : 'fail',
		},
	];
	if (passed) {
		Object.assign(claim, {
			status: 'verified',
			verified_at: toIsoSeconds(at),
			login_wallet: login,
			funding_wallet: funding,
			login_signature: opts['login-sig'].trim(),
			funding_signature: opts['funding-sig'].trim(),
			same_wallet_reason: login === funding ? sameReason : null,
		});
	}
	writeClaim(file, claim);

	if (!passed) {
		console.log('RESULT: FAIL. Do not release funds. Tell the claimant which check failed; a retry needs a new claim.');
		process.exit(1);
	}
	console.log('RESULT: PASS. Both wallets proven.');
	console.log(`Payout destination: ${login}`);
	console.log('Pay only to that address, then close the claim with mark-used --tx <signature>.');
}

function cmdMarkUsed(opts) {
	const file = path.resolve(opts.claim ?? '');
	const claim = loadClaim(opts.claim ? file : undefined);
	if (claim.status !== 'verified') fail(`only a verified claim can be marked used; this one is ${claim.status}`);
	const tx = opts.tx?.trim();
	if (!tx || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(tx)) fail('--tx must be the base58 payout transaction signature');
	Object.assign(claim, { status: 'used', used_at: toIsoSeconds(now()), payout_tx: tx });
	writeClaim(file, claim);
	console.log(`Claim closed: payout ${tx} to ${claim.login_wallet}`);
}

const { command, opts } = parseArgs(process.argv.slice(2));
if (command === 'challenge') cmdChallenge(opts);
else if (command === 'verify') await cmdVerify(opts);
else cmdMarkUsed(opts);
