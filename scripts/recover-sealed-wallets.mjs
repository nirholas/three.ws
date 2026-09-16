#!/usr/bin/env node
// Recover custodial wallets sealed under a key production does not hold, in place.
//
// A sealed wallet is not a lost wallet. Its ciphertext is intact in the database;
// only the key that sealed it is missing from production. Hand this script that
// key and it opens the secret, proves the secret really belongs to the stored
// address, and re-encrypts it under the CURRENT production key. The address does
// not change and no funds move: the owner's balance simply becomes withdrawable.
//
// Where the missing keys came from (measured 2026-09-16): every sealed wallet was
// written by a deployment that shared the production database but carried its own
// WALLET_ENCRYPTION_KEY or JWT_SECRET. June 2026 wallets came from a Vercel-era
// deployment other than production (a preview environment or a second project on
// the same database); August and September ones from dev and preview servers.
// None of those values exist in Secret Manager or any Cloud Run revision. The
// place to look is the Vercel dashboard (Project > Settings > Environment
// Variables, every project and every environment that pointed at this database)
// and any local .env a developer ran against production. secret-box.js now
// refuses such writes, so the set can only shrink.
//
// Candidate keys are read from STDIN, one per line, so they never land in shell
// history or a process listing. Values are never printed.
//
// Usage (production key and database pulled from the live service):
//   export DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)"
//   export WALLET_ENCRYPTION_KEY="$(node scripts/read-service-env.mjs '^WALLET_ENCRYPTION_KEY$' --raw)"
//   node scripts/recover-sealed-wallets.mjs --list                 # which wallets are sealed
//   node scripts/recover-sealed-wallets.mjs < candidate-keys.txt   # dry run: which keys open which wallets
//   node scripts/recover-sealed-wallets.mjs --apply < candidate-keys.txt
//   node scripts/recover-sealed-wallets.mjs --bind                 # bind the database to the production key
//
// Exit codes: 0 ok, 2 bad invocation, 3 no production key configured.

import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { sql } from '../api/_lib/db.js';
import { decryptSecret, encryptSecret, secretBoxKeyCandidates, verifyWriteKey } from '../api/_lib/secret-box.js';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const LIST = args.has('--list');
const BIND = args.has('--bind');
const subtle = webcrypto.subtle;

const FIELDS = [
	{ field: 'encrypted_solana_secret', kind: 'solana' },
	{ field: 'encrypted_wallet_key', kind: 'evm' },
];

// Same derivation as secret-box.js, but against one explicit candidate instead of
// the environment's candidate list.
async function openWith(ciphertext, secret) {
	if (!ciphertext.startsWith('v2:')) return null;
	const raw = Buffer.from(ciphertext.slice(3), 'base64');
	const base = await subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
	const key = await subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: raw.subarray(0, 16), info: new Uint8Array(0) },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['decrypt'],
	);
	try {
		const plain = await subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(16, 28) }, key, raw.subarray(28));
		return new TextDecoder().decode(plain);
	} catch {
		return null;
	}
}

async function opensInProduction(ciphertext) {
	try {
		await decryptSecret(ciphertext);
		return true;
	} catch {
		return false;
	}
}

// A decrypt that succeeds under the wrong record would be caught by AES-GCM, but
// the address check also proves the stored address is the one the secret signs for.
async function addressOf(kind, plaintext) {
	if (kind === 'solana') {
		const { Keypair } = await import('@solana/web3.js');
		return Keypair.fromSecretKey(Buffer.from(plaintext, 'base64')).publicKey.toBase58();
	}
	const { computeAddress } = await import('ethers');
	return computeAddress(plaintext);
}

function readCandidates() {
	if (process.stdin.isTTY) return [];
	return [...new Set(readFileSync(0, 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim().length >= 16))];
}

async function sealedRecords() {
	const rows = await sql`
		SELECT id, name, user_id, created_at, deleted_at, wallet_address, meta
		FROM agent_identities
		WHERE meta ? 'encrypted_solana_secret' OR meta ? 'encrypted_wallet_key'
		ORDER BY created_at
	`;
	const sealed = [];
	for (const row of rows) {
		for (const { field, kind } of FIELDS) {
			const ciphertext = row.meta?.[field];
			if (typeof ciphertext !== 'string' || !ciphertext) continue;
			if (await opensInProduction(ciphertext)) continue;
			sealed.push({
				agentId: row.id,
				name: row.name,
				createdAt: new Date(row.created_at).toISOString(),
				deleted: Boolean(row.deleted_at),
				field,
				kind,
				ciphertext,
				address: kind === 'solana' ? row.meta.solana_address : row.wallet_address,
			});
		}
	}
	return sealed;
}

async function rewrap(record, plaintext) {
	const fresh = await encryptSecret(plaintext);
	if ((await decryptSecret(fresh)) !== plaintext) throw new Error('re-encrypted secret did not round-trip');
	// Compare-and-swap on the old ciphertext so a concurrent writer is never clobbered.
	const updated = await sql`
		UPDATE agent_identities
		SET meta = jsonb_set(meta, ${[record.field]}::text[], to_jsonb(${fresh}::text))
			|| jsonb_build_object('custody_key_rewrapped_at', now())
		WHERE id = ${record.agentId} AND meta->>${record.field} = ${record.ciphertext}
		RETURNING id
	`;
	return updated.length === 1;
}

async function main() {
	if (secretBoxKeyCandidates().length === 0) {
		console.error('No production key configured. Export WALLET_ENCRYPTION_KEY from the live service first (see header).');
		process.exit(3);
	}
	const [current] = secretBoxKeyCandidates();

	if (BIND) {
		const result = await verifyWriteKey(sql, current);
		console.log(`database bound to the production key (fingerprint ${result.fingerprint.slice(0, 12)}...)`);
		return;
	}

	const sealed = await sealedRecords();
	console.log(`${sealed.length} sealed secret(s) across ${new Set(sealed.map((r) => r.agentId)).size} agent(s)`);

	if (LIST) {
		for (const r of sealed) {
			console.log(`  ${r.agentId}  ${r.createdAt.slice(0, 10)}  ${r.kind.padEnd(6)} ${r.address || '(no address)'}${r.deleted ? '  [deleted]' : ''}  ${r.name}`);
		}
		return;
	}

	const candidates = readCandidates();
	if (candidates.length === 0) {
		console.error('No candidate keys on stdin. Pipe them in, one per line, or pass --list or --bind.');
		process.exit(2);
	}
	console.log(`${candidates.length} candidate key(s) supplied; ${APPLY ? 'APPLY: matching secrets will be re-encrypted' : 'dry run'}`);

	let recovered = 0;
	for (const record of sealed) {
		let match = null;
		for (let i = 0; i < candidates.length && !match; i++) {
			const plaintext = await openWith(record.ciphertext, candidates[i]);
			if (plaintext !== null) match = { index: i, plaintext };
		}
		const label = `${record.agentId} ${record.kind} ${record.address || ''}`;
		if (!match) {
			console.log(`  sealed     ${label}`);
			continue;
		}
		const derived = await addressOf(record.kind, match.plaintext);
		if (record.address && derived !== record.address) {
			console.log(`  MISMATCH   ${label} opens with candidate #${match.index + 1} but signs for ${derived}; left untouched`);
			continue;
		}
		if (!APPLY) {
			console.log(`  opens      ${label} with candidate #${match.index + 1}`);
			continue;
		}
		const ok = await rewrap(record, match.plaintext);
		console.log(`  ${ok ? 'recovered ' : 'CHANGED   '} ${label}${ok ? '' : ' (record changed underneath; rerun)'}`);
		if (ok) recovered++;
	}
	if (APPLY) console.log(`${recovered} secret(s) re-encrypted under the production key`);
}

main().catch((err) => {
	console.error(err?.message || err);
	process.exit(1);
});
