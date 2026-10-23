import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, canonicalJson } from '../src/pay/encoding.js';
import { parseAuthenticate, readChallenge } from '../src/pay/challenge.js';
import { EXIT, REASON } from '../src/pay/errors.js';
import { createKeystore, seal, unseal, walletMetaPath, walletSealedPath } from '../src/pay/keystore.js';
import {
	atomicToDecimal,
	decimalToAtomic,
	evaluateOffer,
	initPermissions,
	loadPermissions,
	normalizeNetwork,
	permissionsPath,
	SOLANA_DEVNET,
	SOLANA_MAINNET,
	USDC_MAINNET,
	validatePermissions,
} from '../src/pay/permissions.js';
import { tempEnv } from './pay-helpers.js';

const offer = (over = {}) => ({ protocol: 'x402', network: SOLANA_MAINNET, asset: USDC_MAINNET, payTo: 'Payee1111111111111111111111111111111111111', amountAtomic: 10000n, ...over });
const perms = (over = {}) => validatePermissions({ version: 1, allowedOrigins: ['https://three.ws'], allowedNetworks: ['solana'], maxPerCall: '0.10', ...over });

describe('amount math', () => {
	it('round-trips decimals without floats', () => {
		expect(decimalToAtomic('0.10', 6)).toBe(100000n);
		expect(decimalToAtomic('12', 6)).toBe(12000000n);
		expect(atomicToDecimal(10000n, 6)).toBe('0.01');
		expect(atomicToDecimal(1000000n, 6)).toBe('1');
	});
	it('rejects malformed and over-precise amounts', () => {
		expect(() => decimalToAtomic('1e3', 6)).toThrow(/plain decimal/);
		expect(() => decimalToAtomic('-1', 6)).toThrow(/plain decimal/);
		expect(() => decimalToAtomic('0.0000001', 6)).toThrow(/decimal places/);
	});
});

describe('permissions file', () => {
	it('normalizes network aliases and applies safe defaults', () => {
		const p = perms();
		expect(p.allowedNetworks).toEqual([SOLANA_MAINNET]);
		expect(p.allowedAssets).toContain(USDC_MAINNET);
		expect(normalizeNetwork('solana-devnet')).toBe(SOLANA_DEVNET);
	});
	it('rejects a file with no per-call ceiling or a bad limit', () => {
		expect(() => validatePermissions({ version: 1, allowedOrigins: [], allowedNetworks: [] })).toThrow(/maxPerCall/);
		expect(() => perms({ maxPerCall: 0.1 })).toThrow(/decimal string/);
		expect(() => perms({ allowedOrigins: ['not a url'] })).toThrow(/URL origin/);
	});
	it('init writes a private, valid file and never overwrites', () => {
		const env = tempEnv();
		const file = initPermissions(env);
		expect(file).toBe(permissionsPath(env));
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
		expect(loadPermissions(env).maxPerCall).toBe('0.10');
		fs.writeFileSync(file, '{"mine":true}');
		expect(initPermissions(env)).toBeNull();
		expect(fs.readFileSync(file, 'utf8')).toBe('{"mine":true}');
	});
	it('a missing file is a permission refusal with the documented exit code', () => {
		const err = (() => {
			try {
				loadPermissions(tempEnv());
			} catch (e) {
				return e;
			}
		})();
		expect(err.exit).toBe(EXIT.PERMISSION_DENIED);
		expect(err.reason).toBe(REASON.permissionsMissing);
	});
});

describe('evaluateOffer', () => {
	const ctx = { origin: 'https://three.ws' };
	it('allows an in-policy offer and flags confirmation above the threshold', () => {
		expect(evaluateOffer(perms({ confirmAbove: '0.05' }), offer(), ctx).confirm).toBe(false);
		expect(evaluateOffer(perms({ confirmAbove: '0.005' }), offer(), ctx).confirm).toBe(true);
	});
	it('treats the limits as inclusive', () => {
		expect(() => evaluateOffer(perms({ maxPerCall: '0.01' }), offer(), ctx)).not.toThrow();
		expect(() => evaluateOffer(perms({ maxPerCall: '0.009999' }), offer(), ctx)).toThrow(/maxPerCall/);
	});
	it('refuses an asset with unknown decimals instead of guessing a scale', () => {
		const stranger = 'Stranger1111111111111111111111111111111111';
		expect(() => evaluateOffer(perms({ allowedAssets: [stranger] }), offer({ asset: stranger }), ctx)).toThrow(/decimals/);
		expect(evaluateOffer(perms({ allowedAssets: [stranger] }), offer({ asset: stranger, decimals: 9, amountAtomic: 1000n }), ctx)).toEqual({ confirm: false });
	});
	it('counts what was already spent today', () => {
		const p = perms({ maxPerDay: '0.02' });
		expect(() => evaluateOffer(p, offer(), { ...ctx, spent: 10000n })).not.toThrow();
		expect(() => evaluateOffer(p, offer(), { ...ctx, spent: 10001n })).toThrow(/maxPerDay/);
	});
});

describe('encoding', () => {
	it('canonicalizes objects by sorted key with no whitespace', () => {
		expect(canonicalJson({ b: 1, a: { d: [3, 'x'], c: null }, e: undefined })).toBe('{"a":{"c":null,"d":[3,"x"]},"b":1}');
	});
	it('base64url has no padding and decodes with or without it', () => {
		const text = b64urlEncode('hello?>>');
		expect(text).not.toMatch(/[+/=]/);
		expect(b64urlDecode(text).toString()).toBe('hello?>>');
		expect(b64urlDecode(`${text}==`).toString()).toBe('hello?>>');
	});
});

describe('challenge parsing', () => {
	it('splits multiple WWW-Authenticate challenges and quoted values', () => {
		const parsed = parseAuthenticate('Bearer realm="a, b", Payment id="x", method=solana, request="abc"');
		expect(parsed.map((p) => p.scheme)).toEqual(['Bearer', 'Payment']);
		expect(parsed[0].params.realm).toBe('a, b');
		expect(parsed[1].params).toEqual({ id: 'x', method: 'solana', request: 'abc' });
	});
	it('ignores a Payment challenge for another method and a malformed request', async () => {
		const res = new Response('', { status: 402, headers: { 'www-authenticate': 'Payment id="1", method="tempo", intent="charge", request="e30"' } });
		expect((await readChallenge(res)).offers).toEqual([]);
		const bad = new Response('', { status: 402, headers: { 'www-authenticate': 'Payment id="1", method="solana", intent="charge", request="!!"' } });
		expect((await readChallenge(bad)).offers).toEqual([]);
	});
	it('marks unsupported MPP shapes instead of attempting them', async () => {
		const request = b64urlEncode(canonicalJson({ amount: '1', currency: USDC_MAINNET, recipient: 'R', methodDetails: { decimals: 6, splits: [{ recipient: 'S', amount: '1' }] } }));
		const res = new Response('', { status: 402, headers: { 'www-authenticate': `Payment id="1", method="solana", intent="charge", request="${request}"` } });
		const [o] = (await readChallenge(res)).offers;
		expect(o.unsupported).toMatch(/splits/);
	});
	it('reads a v1 body and prefers the v2 header when both exist', async () => {
		const accept = { scheme: 'exact', network: 'solana', maxAmountRequired: '5', asset: USDC_MAINNET, payTo: 'P' };
		const v1 = await readChallenge(new Response(JSON.stringify({ x402Version: 1, accepts: [accept] }), { status: 402 }));
		expect(v1.offers[0]).toMatchObject({ version: 1, network: SOLANA_MAINNET, amountAtomic: 5n });
		const header = Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ ...accept, network: SOLANA_MAINNET, amount: '7' }] })).toString('base64');
		const both = await readChallenge(new Response(JSON.stringify({ x402Version: 1, accepts: [accept] }), { status: 402, headers: { 'payment-required': header } }));
		expect(both.offers).toHaveLength(1);
		expect(both.offers[0].amountAtomic).toBe(7n);
	});
});

describe('key custody', () => {
	const noKeychain = async () => Promise.reject(new Error('no keychain'));
	const passphrase = 'a long enough passphrase';

	it('seal and unseal round-trip, and a wrong passphrase is refused', () => {
		const seed = Buffer.alloc(32, 7);
		const sealed = seal(seed, passphrase);
		expect(unseal(sealed, passphrase).equals(seed)).toBe(true);
		expect(() => unseal(sealed, 'a different passphrase')).toThrow(/Wrong passphrase/);
	});

	it('auto falls back to a sealed file, never leaves the seed in plaintext, and signs after a reload', async () => {
		const env = tempEnv({ THREE_WS_WALLET_PASSPHRASE: passphrase });
		const made = await createKeystore({ env, keyring: noKeychain }).init();
		expect(made.storage).toBe('file');
		for (const f of [walletMetaPath(env), walletSealedPath(env)]) expect(fs.statSync(f).mode & 0o777).toBe(0o600);
		const sealedText = fs.readFileSync(walletSealedPath(env), 'utf8');
		expect(sealedText).not.toContain(made.address);
		const signer = await createKeystore({ env, keyring: noKeychain }).signer();
		expect(signer.address).toBe(made.address);
	});

	it('uses the keychain when one is reachable and keeps the seed out of the config dir', async () => {
		const env = tempEnv();
		const slot = { value: null };
		const keyring = async () => ({
			setPassword: (v) => (slot.value = v),
			getPassword: () => slot.value,
			deletePassword: () => true,
		});
		const store = createKeystore({ env, keyring });
		const made = await store.init();
		expect(made.storage).toBe('keychain');
		expect(fs.existsSync(walletSealedPath(env))).toBe(false);
		expect(fs.readFileSync(walletMetaPath(env), 'utf8')).not.toContain(slot.value);
		expect((await store.signer()).address).toBe(made.address);
	});

	it('refuses to overwrite an existing wallet and a short passphrase', async () => {
		const env = tempEnv({ THREE_WS_WALLET_PASSPHRASE: 'short' });
		await expect(createKeystore({ env, keyring: noKeychain }).init()).rejects.toThrow(/at least 12/);
		env.vars.THREE_WS_WALLET_PASSPHRASE = passphrase;
		const store = createKeystore({ env, keyring: noKeychain });
		await store.init();
		await expect(store.init()).rejects.toThrow(/never overwrites/);
	});

	it('requires --storage file when the keychain was demanded but is unavailable', async () => {
		const env = tempEnv();
		await expect(createKeystore({ env, keyring: noKeychain }).init({ storage: 'keychain' })).rejects.toThrow(/--storage file/);
	});
});
