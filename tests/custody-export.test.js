// Key export: the server seals the key to the browser's ephemeral key, the
// browser re-encrypts it to a passphrase. These tests run both halves for real
// (node:crypto on the server, WebCrypto in src/wallet/export.js) and assert the
// plaintext secret never appears in what the server returns.

import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { sealForClient } from '../api/_lib/custody/export-seal.js';
import {
	beginKeyExport, decryptKeyEnvelope, encryptKeyToPassphrase, openSealedKey, passphraseProblem,
} from '../src/wallet/export.js';

const AGENT = '44444444-4444-4444-8444-444444444444';

describe('key export sealing', () => {
	const kp = Keypair.generate();
	const address = kp.publicKey.toBase58();

	it('never puts the plaintext secret in the server response', async () => {
		const { publicKey } = await beginKeyExport();
		const sealed = sealForClient(kp.secretKey, publicKey, { agentId: AGENT, address });
		const wire = JSON.stringify(sealed);
		const secretB64 = Buffer.from(kp.secretKey).toString('base64');
		const seedB64 = Buffer.from(kp.secretKey.slice(0, 32)).toString('base64');
		const secretHex = Buffer.from(kp.secretKey).toString('hex');
		expect(wire).not.toContain(secretB64);
		expect(wire).not.toContain(seedB64);
		expect(wire).not.toContain(secretHex);
		expect(wire).not.toContain(JSON.stringify(Array.from(kp.secretKey)));
		expect(Object.keys(sealed).sort()).toEqual(['alg', 'ciphertext', 'iv', 'salt', 'server_public_key', 'v']);
	});

	it('round-trips through the browser module to the same key', async () => {
		const { publicKey, privateKey } = await beginKeyExport();
		const sealed = sealForClient(kp.secretKey, publicKey, { agentId: AGENT, address });
		const opened = await openSealedKey(sealed, privateKey, { agentId: AGENT, address });
		expect(Buffer.from(opened).equals(Buffer.from(kp.secretKey))).toBe(true);
		expect(Keypair.fromSecretKey(opened).publicKey.toBase58()).toBe(address);
	});

	it('cannot be opened by a different browser key or for a different agent', async () => {
		const a = await beginKeyExport();
		const b = await beginKeyExport();
		const sealed = sealForClient(kp.secretKey, a.publicKey, { agentId: AGENT, address });
		await expect(openSealedKey(sealed, b.privateKey, { agentId: AGENT, address })).rejects.toThrow();
		await expect(openSealedKey(sealed, a.privateKey, { agentId: '99999999-9999-4999-8999-999999999999', address })).rejects.toThrow();
	});

	it('rejects a malformed client public key with a 400', () => {
		expect(() => sealForClient(kp.secretKey, 'AAAA', { agentId: AGENT, address })).toThrow(/uncompressed P-256/);
		const bad = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');
		expect(() => sealForClient(kp.secretKey, bad, { agentId: AGENT, address })).toThrow(/valid P-256 point/);
	});
});

describe('passphrase envelope', () => {
	const kp = Keypair.generate();
	const address = kp.publicKey.toBase58();
	const passphrase = 'correct horse battery staple';

	it('encrypts to a passphrase and decrypts back to the same key', async () => {
		const envelope = await encryptKeyToPassphrase(kp.secretKey, passphrase, { address, agentId: AGENT });
		expect(JSON.stringify(envelope)).not.toContain(Buffer.from(kp.secretKey).toString('base64'));
		const back = await decryptKeyEnvelope(envelope, passphrase);
		expect(Buffer.from(back).equals(Buffer.from(kp.secretKey))).toBe(true);
	});

	it('refuses the wrong passphrase and a tampered ciphertext', async () => {
		const envelope = await encryptKeyToPassphrase(kp.secretKey, passphrase, { address });
		await expect(decryptKeyEnvelope(envelope, 'not the right passphrase')).rejects.toThrow(/Wrong passphrase/);
		const ct = Buffer.from(envelope.ciphertext, 'base64');
		ct[0] ^= 1;
		await expect(decryptKeyEnvelope({ ...envelope, ciphertext: ct.toString('base64') }, passphrase)).rejects.toThrow(/Wrong passphrase/);
	});

	it('rejects weak passphrases before encrypting', async () => {
		expect(passphraseProblem('short')).toMatch(/at least/);
		expect(passphraseProblem('aaaaaaaaaaaaaaaa')).toMatch(/variety/);
		await expect(encryptKeyToPassphrase(kp.secretKey, 'short', { address })).rejects.toThrow(/at least/);
	});
});
