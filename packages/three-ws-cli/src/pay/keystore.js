// Key custody for `three-ws pay`. The 32-byte ed25519 seed lives in the OS
// keychain (macOS Keychain, Windows Credential Manager, Secret Service or the
// kernel keyring on Linux) through @napi-rs/keyring. Where no keychain is
// reachable (headless boxes, containers) the seed is sealed in a file with
// scrypt + AES-256-GCM under a passphrase. A key is never written in plaintext,
// and there is deliberately no command that prints the private half.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { configDir } from '../paths.js';
import { EXIT, PayError, REASON } from './errors.js';

const SERVICE = 'three-ws';
const ACCOUNT = 'pay-wallet';
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export const walletMetaPath = (env) => path.join(configDir(env), 'pay-wallet.json');
export const walletSealedPath = (env) => path.join(configDir(env), 'pay-wallet.sealed.json');

async function defaultKeyring() {
	const { Entry } = await import('@napi-rs/keyring');
	return new Entry(SERVICE, ACCOUNT);
}

function readMeta(env) {
	try {
		return JSON.parse(fs.readFileSync(walletMetaPath(env), 'utf8'));
	} catch (err) {
		if (err.code === 'ENOENT') return null;
		throw new PayError(EXIT.WALLET_UNAVAILABLE, REASON.walletMissing, `${walletMetaPath(env)} is unreadable: ${err.message}`);
	}
}

function writePrivate(file, text) {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	fs.writeFileSync(file, text, { mode: 0o600 });
	fs.chmodSync(file, 0o600);
}

export function seal(seed, passphrase) {
	const salt = crypto.randomBytes(16);
	const iv = crypto.randomBytes(12);
	const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const data = Buffer.concat([cipher.update(seed), cipher.final()]);
	return {
		v: 1,
		kdf: 'scrypt',
		kdfParams: { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
		cipher: 'aes-256-gcm',
		salt: salt.toString('base64'),
		iv: iv.toString('base64'),
		tag: cipher.getAuthTag().toString('base64'),
		data: data.toString('base64'),
	};
}

export function unseal(sealed, passphrase) {
	const { N, r, p } = sealed.kdfParams;
	const key = crypto.scryptSync(passphrase, Buffer.from(sealed.salt, 'base64'), 32, { N, r, p, maxmem: 128 * 1024 * 1024 });
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
	decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
	try {
		return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]);
	} catch {
		throw new PayError(EXIT.WALLET_UNAVAILABLE, REASON.walletLocked, 'Wrong passphrase, or the sealed wallet file is damaged.');
	}
}

/**
 * @param {object} opts
 * @param {object} opts.env resolution context from paths.js
 * @param {() => Promise<{setPassword(s:string):void,getPassword():string|null,deletePassword():boolean}>} [opts.keyring]
 *   keychain entry factory; defaults to @napi-rs/keyring
 * @param {(question: string) => Promise<string>} [opts.askPassphrase] interactive passphrase prompt
 */
export function createKeystore({ env, keyring = defaultKeyring, askPassphrase }) {
	const passphraseFrom = async (question) => {
		const fromEnv = env.vars.THREE_WS_WALLET_PASSPHRASE;
		if (fromEnv) return fromEnv;
		if (!askPassphrase) {
			throw new PayError(
				EXIT.WALLET_UNAVAILABLE,
				REASON.walletLocked,
				'The wallet is sealed in a file and no passphrase was given. Set THREE_WS_WALLET_PASSPHRASE or run in a terminal.',
			);
		}
		const answer = await askPassphrase(question);
		if (!answer) throw new PayError(EXIT.WALLET_UNAVAILABLE, REASON.walletLocked, 'A passphrase is required to unlock the wallet.');
		return answer;
	};

	async function keychainEntry() {
		try {
			return await keyring();
		} catch {
			return null;
		}
	}

	return {
		meta: () => readMeta(env),

		/**
		 * Create a wallet. `storage` is "auto" (keychain, else sealed file), "keychain" or "file".
		 * Refuses to replace an existing wallet. Returns { address, storage }.
		 */
		async init({ storage = 'auto' } = {}) {
			if (readMeta(env)) {
				throw new PayError(EXIT.ERROR, 'wallet_exists', `A wallet already exists (${readMeta(env).address}). Back it up or remove it first; init never overwrites a key.`);
			}
			const seed = crypto.randomBytes(32);
			const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(seed));
			let used = null;
			if (storage !== 'file') {
				const entry = await keychainEntry();
				try {
					if (!entry) throw new Error('no keychain binding');
					entry.setPassword(seed.toString('base64'));
					if (entry.getPassword() !== seed.toString('base64')) throw new Error('keychain read-back mismatch');
					used = 'keychain';
				} catch (err) {
					if (storage === 'keychain') {
						throw new PayError(EXIT.WALLET_UNAVAILABLE, REASON.walletMissing, `The OS keychain is not available here (${err.message}). Re-run with --storage file.`);
					}
				}
			}
			if (!used) {
				const passphrase = await passphraseFrom('New passphrase for the sealed wallet file');
				if (passphrase.length < 12) {
					throw new PayError(EXIT.USAGE, 'passphrase_too_short', 'Use a passphrase of at least 12 characters.');
				}
				writePrivate(walletSealedPath(env), `${JSON.stringify(seal(seed, passphrase), null, 2)}\n`);
				used = 'file';
			}
			writePrivate(walletMetaPath(env), `${JSON.stringify({ version: 1, address: signer.address, storage: used, createdAt: new Date().toISOString() }, null, 2)}\n`);
			seed.fill(0);
			return { address: signer.address, storage: used };
		},

		/** Public address only. Never touches the secret. */
		address() {
			const meta = readMeta(env);
			if (!meta) {
				throw new PayError(EXIT.WALLET_UNAVAILABLE, REASON.walletMissing, 'No wallet yet. Run `three-ws wallet init`.');
			}
			return { address: meta.address, storage: meta.storage };
		},

		/** Unlock the wallet and return a kit TransactionSigner. The seed only lives for the call. */
		async signer() {
			const meta = readMeta(env);
			if (!meta) throw new PayError(EXIT.WALLET_UNAVAILABLE, REASON.walletMissing, 'No wallet yet. Run `three-ws wallet init`.');
			let seed;
			if (meta.storage === 'keychain') {
				const entry = await keychainEntry();
				let stored = null;
				try {
					stored = entry ? entry.getPassword() : null;
				} catch (err) {
					throw new PayError(EXIT.WALLET_UNAVAILABLE, REASON.walletLocked, `The OS keychain could not be read: ${err.message}`);
				}
				if (!stored) throw new PayError(EXIT.WALLET_UNAVAILABLE, REASON.walletMissing, 'The keychain has no pay wallet. It was removed outside this tool.');
				seed = Buffer.from(stored, 'base64');
			} else {
				let sealed;
				try {
					sealed = JSON.parse(fs.readFileSync(walletSealedPath(env), 'utf8'));
				} catch (err) {
					throw new PayError(EXIT.WALLET_UNAVAILABLE, REASON.walletMissing, `The sealed wallet file is unreadable: ${err.message}`);
				}
				seed = unseal(sealed, await passphraseFrom('Passphrase to unlock the wallet'));
			}
			const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(seed));
			seed.fill(0);
			if (signer.address !== meta.address) {
				throw new PayError(EXIT.WALLET_UNAVAILABLE, REASON.walletLocked, 'The stored key does not match the recorded wallet address.');
			}
			return signer;
		},
	};
}
