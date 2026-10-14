// A base58-encoded Solana secret key is how most wallet tools print one, and
// scripts/check-secrets.mjs only recognized the 64-byte JSON array form until
// the solana-keypair-base58 rule was added. These tests prove the rule
// catches a real secret key AND leaves a same-length, same-shape value that
// is NOT a secret key (a transaction signature) alone.
//
// Every secret key here is generated at test runtime and thrown away: none
// is ever written to a tracked file or a commit.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function scannerRepo() {
	const root = mkdtempSync(join(tmpdir(), 'threews-secret-scan-sol-'));
	mkdirSync(join(root, 'scripts'));
	copyFileSync(join(REPO, 'scripts', 'check-secrets.mjs'), join(root, 'scripts', 'check-secrets.mjs'));
	writeFileSync(join(root, 'README.md'), '# scanner fixture\n');
	execFileSync('git', ['init', '-q'], { cwd: root });
	execFileSync('git', ['config', 'user.email', 'scanner@example.invalid'], { cwd: root });
	execFileSync('git', ['config', 'user.name', 'Scanner Test'], { cwd: root });
	execFileSync('git', ['add', 'README.md', 'scripts/check-secrets.mjs'], { cwd: root });
	execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
	return root;
}

function scanAddedLines(lines) {
	const root = scannerRepo();
	writeFileSync(join(root, 'leak.txt'), lines.map((l) => `${l}\n`).join(''));
	return spawnSync('node', ['scripts/check-secrets.mjs'], { cwd: root, encoding: 'utf8' });
}

// A freshly generated, never-committed ed25519 keypair in the exact 64-byte
// (32-byte seed || 32-byte public key) layout solana-keygen and Phantom
// export, base58 encoded.
function freshSolanaSecretBase58() {
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	const seed = Buffer.from(privateKey.export({ format: 'der', type: 'pkcs8' })).subarray(-32);
	const pub = Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).subarray(-32);
	return bs58.encode(Buffer.concat([seed, pub]));
}

// 64 random bytes, base58 encoded: the same length and alphabet as a real
// secret key, but with no seed/pubkey relationship, exactly the shape of a
// Solana transaction signature, which the repo carries thousands of.
function randomSignatureLikeBase58() {
	return bs58.encode(randomBytes(64));
}

describe('base58 Solana secret-key guard', () => {
	it('catches a real secret key planted in a file', () => {
		const secret = freshSolanaSecretBase58();
		const result = scanAddedLines([`WALLET_SECRET=${secret}`]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('[solana-keypair-base58]');
	});

	it('does not report a same-length value that is not a derivable keypair', () => {
		const signature = randomSignatureLikeBase58();
		const result = scanAddedLines([`tx signature: ${signature}`]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('OK');
	});

	it('catches the real secret while leaving a real-shaped signature alone on the same file', () => {
		const secret = freshSolanaSecretBase58();
		const signature = randomSignatureLikeBase58();
		const result = scanAddedLines([`tx signature: ${signature}`, `WALLET_SECRET=${secret}`]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('[solana-keypair-base58]');
		// Only the real secret's line is reported, not the signature's.
		expect(result.stderr).not.toMatch(new RegExp(`leak\\.txt:1\\s+\\[solana-keypair-base58\\]`));
	});
});
