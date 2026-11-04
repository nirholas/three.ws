#!/usr/bin/env node
// Read-only preflight for the $THREE receiver wallets.
//
//   npm run token:preflight -- --treasury <addr> --rewards <addr>
//
// Validates both candidates (base58, on-curve, not a program or burn sink, distinct),
// reads mainnet over the configured Solana RPC to confirm each is an ordinary
// system-owned account and to show any existing $THREE token account, flags a
// rewards/signer conflict against the buyback and micro-buy signers, and prints the
// exact config-only gcloud command that applies them. It never signs or sends.
// Exit code 0 only when every check passes and no armed lane conflicts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import {
	buildApplyCommand,
	classifyAccount,
	describeConflicts,
	parseArgs,
	validateReceivers,
} from './lib/token-preflight.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
	for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
		const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
	}
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.treasury || !args.rewards) {
	console.log('Usage: npm run token:preflight -- --treasury <address> --rewards <address>');
	process.exit(args.help ? 0 : 2);
}

const THREE_MINT = process.env.THREE_TOKEN_MINT || 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const rpcUrls = [process.env.SOLANA_RPC_URL, 'https://api.mainnet-beta.solana.com'].filter(Boolean);

async function withRpc(fn) {
	let lastErr;
	for (const url of rpcUrls) {
		try {
			return await fn(new Connection(url, 'confirmed'));
		} catch (e) {
			lastErr = e;
		}
	}
	throw lastErr;
}

const verdict = validateReceivers(args);
let failed = !verdict.ok;
for (const e of verdict.errors) console.log(`FAIL  ${e}`);

for (const [role, v] of [['treasury', verdict.treasury], ['rewards', verdict.rewards]]) {
	if (!v.pubkey) continue;
	try {
		const { info, tokens } = await withRpc(async (conn) => {
			const pk = new PublicKey(v.pubkey);
			const acc = await conn.getAccountInfo(pk);
			const parsed = await conn.getParsedTokenAccountsByOwner(pk, { mint: new PublicKey(THREE_MINT) });
			return {
				info: acc && { owner: acc.owner.toBase58(), executable: acc.executable, lamports: acc.lamports },
				tokens: parsed.value.map((t) => t.account.data.parsed.info.tokenAmount.uiAmountString),
			};
		});
		const c = classifyAccount(info);
		console.log(`${c.ok ? 'OK   ' : 'FAIL '} ${role} ${v.pubkey}: ${c.note}`);
		console.log(`      $THREE token account: ${tokens.length ? `${tokens.join(', ')} $THREE held` : 'none yet (the buyer transaction creates it idempotently)'}`);
		if (!c.ok) failed = true;
	} catch (e) {
		console.log(`FAIL  ${role} ${v.pubkey}: mainnet read failed on every RPC (${e.message}). Set SOLANA_RPC_URL and rerun.`);
		failed = true;
	}
}

if (verdict.rewards.pubkey) {
	const { rewardsSignerConflicts } = await import(path.join(ROOT, 'api/_lib/token/signer-conflict.js'));
	const conflicts = describeConflicts(
		verdict.rewards.pubkey,
		await rewardsSignerConflicts({ rewards: verdict.rewards.pubkey, includeDisabled: true }),
	);
	for (const c of conflicts) {
		console.log(`${c.severity === 'blocking' ? 'FAIL ' : 'WARN '} ${c.message}`);
		if (c.severity === 'blocking') failed = true;
	}
	if (!conflicts.length) {
		console.log('OK    no buyback or micro-buy signer loaded in this environment equals the rewards wallet');
		console.log('      (this check only sees signers whose secrets are in the current env; run it where THREE_BUYBACK_SECRET_KEY_B64 is set for a full answer)');
	}
	console.log('NOTE  rewards must also be the wallet REWARDS_DISTRIBUTOR_SECRET resolves to, or the distribution cron cannot sign for the pool');
}

if (verdict.treasury.pubkey && verdict.rewards.pubkey && !failed) {
	console.log('\nApply (config-only, pre-approved once the owner confirms both addresses):\n');
	console.log(`  ${buildApplyCommand({ treasury: verdict.treasury.pubkey, rewards: verdict.rewards.pubkey })}\n`);
	console.log('Then verify: GET /api/healthz three_token_rail is ok, and a signed-in POST /api/token/quote returns both destinations.');
}
process.exit(failed ? 1 : 0);
