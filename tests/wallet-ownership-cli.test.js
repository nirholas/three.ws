// End-to-end tests for scripts/verify-wallet-ownership.mjs: the real script is
// run as a child process, claimants sign with freshly generated keypairs, and
// claim records land in a throwaway directory (WALLET_OWNERSHIP_CLAIMS_DIR).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

const b58 = bs58.default ?? bs58;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts/verify-wallet-ownership.mjs');
const AGENT = '0b6f6a3e-6a52-4c8e-9a1d-2f4e8c7b5d10';
const ISSUED = '2026-11-04T12:00:00Z';

let dir;

function run(args, extraEnv = {}) {
	const env = { ...process.env, WALLET_OWNERSHIP_CLAIMS_DIR: dir, ...extraEnv };
	delete env.DATABASE_URL;
	if (extraEnv.DATABASE_URL) env.DATABASE_URL = extraEnv.DATABASE_URL;
	const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env, encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function sign(keypair, message) {
	return b58.encode(ed25519.sign(new TextEncoder().encode(message), keypair.secretKey.slice(0, 32)));
}

function openClaim(issued = ISSUED) {
	const r = run(['challenge', '--agent', AGENT, '--issued', issued]);
	expect(r.code).toBe(0);
	const [file] = readdirSync(dir);
	const claimPath = path.join(dir, file);
	return { claimPath, claim: JSON.parse(readFileSync(claimPath, 'utf8')), out: r.out };
}

function verifyArgs(claimPath, login, loginSig, funding, fundingSig) {
	return [
		'verify',
		'--claim',
		claimPath,
		'--login-wallet',
		login.publicKey.toBase58(),
		'--login-sig',
		loginSig,
		'--funding-wallet',
		funding.publicKey.toBase58(),
		'--funding-sig',
		fundingSig,
	];
}

const WITHIN_WINDOW = { WALLET_OWNERSHIP_NOW: '2026-11-05T12:00:00Z' };

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wallet-ownership-'));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('verify-wallet-ownership challenge', () => {
	it('prints the exact block to send and writes an open claim record', () => {
		const { claim, out } = openClaim();
		expect(claim).toMatchObject({ agent_id: AGENT, issued_at: ISSUED, status: 'open' });
		expect(claim.nonce).toMatch(/^[A-Za-z0-9_-]{12}$/);
		expect(claim.message).toBe(
			`three.ws wallet recovery\nagent: ${AGENT}\nnonce: ${claim.nonce}\nissued: ${ISSUED}`,
		);
		expect(out).toContain(claim.message);
	});

	it('refuses an agent id that is not a UUID and writes nothing', () => {
		const r = run(['challenge', '--agent', 'agent-42']);
		expect(r.code).toBe(1);
		expect(readdirSync(dir)).toHaveLength(0);
	});
});

describe('verify-wallet-ownership verify', () => {
	it('passes two valid signatures, marks the claim verified and names the login wallet as payout', () => {
		const { claimPath, claim } = openClaim();
		const login = Keypair.generate();
		const funding = Keypair.generate();
		const r = run(
			verifyArgs(claimPath, login, sign(login, claim.message), funding, sign(funding, claim.message)),
			WITHIN_WINDOW,
		);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/login wallet\s+PASS/);
		expect(r.out).toMatch(/funding wallet\s+PASS/);
		expect(r.out).toContain(`Payout destination: ${login.publicKey.toBase58()}`);
		const after = JSON.parse(readFileSync(claimPath, 'utf8'));
		expect(after.status).toBe('verified');
		expect(after.login_wallet).toBe(login.publicKey.toBase58());
		expect(after.funding_wallet).toBe(funding.publicKey.toBase58());
	});

	it('fails when one signature is from the wrong key and prints no payout destination', () => {
		const { claimPath, claim } = openClaim();
		const login = Keypair.generate();
		const funding = Keypair.generate();
		const r = run(
			verifyArgs(claimPath, login, sign(login, claim.message), funding, sign(Keypair.generate(), claim.message)),
			WITHIN_WINDOW,
		);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/funding wallet\s+FAIL\s+signature_invalid/);
		expect(r.out).not.toMatch(/Payout destination/);
		expect(JSON.parse(readFileSync(claimPath, 'utf8')).status).toBe('open');
	});

	it('fails after the 72 hour window even with valid signatures', () => {
		const { claimPath, claim } = openClaim();
		const login = Keypair.generate();
		const funding = Keypair.generate();
		const r = run(
			verifyArgs(claimPath, login, sign(login, claim.message), funding, sign(funding, claim.message)),
			{ WALLET_OWNERSHIP_NOW: '2026-11-07T12:00:01Z' },
		);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/expired/i);
		expect(r.out).not.toMatch(/Payout destination/);
	});

	it('refuses to verify the same claim twice', () => {
		const { claimPath, claim } = openClaim();
		const login = Keypair.generate();
		const funding = Keypair.generate();
		const args = verifyArgs(claimPath, login, sign(login, claim.message), funding, sign(funding, claim.message));
		expect(run(args, WITHIN_WINDOW).code).toBe(0);
		const replay = run(args, WITHIN_WINDOW);
		expect(replay.code).toBe(1);
		expect(replay.out).toMatch(/already verified/i);
		expect(replay.out).not.toMatch(/Payout destination/);
	});

	it('refuses a used claim', () => {
		const { claimPath, claim } = openClaim();
		const login = Keypair.generate();
		const funding = Keypair.generate();
		const args = verifyArgs(claimPath, login, sign(login, claim.message), funding, sign(funding, claim.message));
		expect(run(args, WITHIN_WINDOW).code).toBe(0);
		const used = run(['mark-used', '--claim', claimPath, '--tx', '5'.repeat(88)]);
		expect(used.code).toBe(0);
		expect(JSON.parse(readFileSync(claimPath, 'utf8')).status).toBe('used');
		const replay = run(args, WITHIN_WINDOW);
		expect(replay.code).toBe(1);
		expect(replay.out).toMatch(/already used/i);
	});

	it('refuses the same wallet for login and funding unless a reason is recorded', () => {
		const { claimPath, claim } = openClaim();
		const one = Keypair.generate();
		const sig = sign(one, claim.message);
		const args = verifyArgs(claimPath, one, sig, one, sig);
		const refused = run(args, WITHIN_WINDOW);
		expect(refused.code).toBe(1);
		expect(refused.out).toMatch(/same wallet/i);
		expect(refused.out).not.toMatch(/Payout destination/);

		const allowed = run([...args, '--allow-same-wallet', 'deposited from the login wallet itself'], WITHIN_WINDOW);
		expect(allowed.code).toBe(0);
		expect(JSON.parse(readFileSync(claimPath, 'utf8')).same_wallet_reason).toBe(
			'deposited from the login wallet itself',
		);
	});

	it('fails a signature made over a different nonce', () => {
		const { claimPath, claim } = openClaim();
		const login = Keypair.generate();
		const funding = Keypair.generate();
		const otherNonce = claim.message.replace(claim.nonce, 'AAAAAAAAAAAA');
		const r = run(
			verifyArgs(claimPath, login, sign(login, otherNonce), funding, sign(funding, claim.message)),
			WITHIN_WINDOW,
		);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/login wallet\s+FAIL\s+signature_invalid/);
	});

	it('says the account check was skipped when no database is configured', () => {
		const { claimPath, claim } = openClaim();
		const login = Keypair.generate();
		const funding = Keypair.generate();
		const r = run(
			[...verifyArgs(claimPath, login, sign(login, claim.message), funding, sign(funding, claim.message)), '--check-account'],
			WITHIN_WINDOW,
		);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/account check skipped: DATABASE_URL is not set/i);
	});
});
