// End to end against a real local 402 server: real HTTP, real challenge parsing,
// real ed25519 signing with a devnet keypair generated in the test. Only the
// chain is stood in for (a local JSON-RPC node that serves the USDC mint).

import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { EXIT, PayError, REASON } from '../src/pay/errors.js';
import { pay, quote } from '../src/pay/engine.js';
import { createKeystore } from '../src/pay/keystore.js';
import { ledgerPath, SOLANA_DEVNET, USDC_DEVNET } from '../src/pay/permissions.js';
import { inspectTransaction, startPaidServer, startRpc, tempEnv, writePermissions } from './pay-helpers.js';

let rpc;
const servers = [];

beforeAll(async () => {
	rpc = await startRpc();
});
afterAll(() => rpc.close());
afterEach(async () => {
	while (servers.length) await servers.pop().close();
});

async function setup({ mode = 'x402v2', price = '10000', perms = {}, serverOpts = {} } = {}) {
	const payee = (await generateKeyPairSigner()).address;
	const server = await startPaidServer({ mode, price, payTo: payee, ...serverOpts });
	servers.push(server);
	const env = tempEnv({ THREE_WS_SOLANA_RPC_URL: rpc.url, THREE_WS_WALLET_PASSPHRASE: 'correct horse battery staple' });
	writePermissions(env, {
		version: 1,
		allowedOrigins: [server.origin],
		allowedNetworks: [SOLANA_DEVNET],
		allowedAssets: [USDC_DEVNET],
		maxPerCall: '0.05',
		maxPerDay: '0.10',
		confirmAbove: '0.03',
		...perms,
	});
	const keystore = createKeystore({ env, keyring: async () => Promise.reject(new Error('no keychain in test')) });
	const wallet = await keystore.init({ storage: 'file' });
	return { server, env, keystore, wallet, payee };
}

describe('x402 v2', () => {
	it('dry run reports payee, exact amount and network and signs nothing', async () => {
		const { server, env, payee } = await setup();
		const q = await quote({ url: server.url, env });
		expect(q.free).toBe(false);
		expect(q.decision.offer.payTo).toBe(payee);
		expect(q.decision.offer.amountAtomic).toBe(10000n);
		expect(q.decision.offer.network).toBe(SOLANA_DEVNET);
		expect(q.decision.confirm).toBe(false);
		expect(server.seen).toHaveLength(1);
		expect(server.paid).toHaveLength(0);
	});

	it('pays with a real signature the payer key produced, retries once and records the spend', async () => {
		const { server, env, keystore, wallet, payee } = await setup();
		const result = await pay({ url: server.url, env, keystore });
		expect(result.paid).toBe(true);
		expect(result.status).toBe(200);
		expect(JSON.parse(result.bytes.toString()).data).toBe('paid content');
		expect(result.receipt.transaction).toBe('fixture-signature');
		expect(result.payer).toBe(wallet.address);
		expect(server.seen).toHaveLength(2);
		expect(server.paid).toHaveLength(1);

		const sent = await inspectTransaction(server.paid[0].payload.payload.transaction, wallet.address);
		expect(sent.signedByPayer).toBe(true);
		expect(sent.signatureValid).toBe(true);
		expect(sent.tx.signatures[server.feePayer]).toBeNull(); // the server's fee payer slot is left for the server
		expect(server.paid[0].payload.accepted.payTo).toBe(payee);

		const ledger = JSON.parse(fs.readFileSync(ledgerPath(env), 'utf8'));
		expect(ledger.spent[`${SOLANA_DEVNET}|${USDC_DEVNET}`]).toBe('10000');
	});

	it('forwards method and body on the paid retry', async () => {
		const { server, env, keystore } = await setup();
		const result = await pay({ url: server.url, env, keystore, request: { method: 'POST', body: '{"q":1}', headers: { 'content-type': 'application/json' } } });
		expect(JSON.parse(result.bytes.toString()).echoed).toBe('{"q":1}');
		expect(server.seen.map((s) => s.method)).toEqual(['POST', 'POST']);
	});

	it('passes a free resource through without a wallet or a permissions file', async () => {
		const env = tempEnv();
		const fetchImpl = async () => new Response('free content', { status: 200, headers: { 'content-type': 'text/plain' } });
		const q = await quote({ url: 'http://127.0.0.1:1/free', env, fetchImpl });
		expect(q.free).toBe(true);
		const result = await pay({ url: 'http://127.0.0.1:1/free', env, keystore: null, fetchImpl });
		expect(result).toMatchObject({ paid: false, status: 200 });
		expect(result.bytes.toString()).toBe('free content');
	});
});

describe('x402 v1', () => {
	it('settles a v1 body challenge (network "solana-devnet") with X-PAYMENT', async () => {
		const { server, env, keystore, wallet } = await setup({ mode: 'x402v1' });
		const result = await pay({ url: server.url, env, keystore });
		expect(result.paid).toBe(true);
		const sent = await inspectTransaction(server.paid[0].payload.payload.transaction, wallet.address);
		expect(sent.signatureValid).toBe(true);
	});
});

describe('MPP solana charge', () => {
	it('answers a Payment challenge with a signed pull-mode credential bound to the challenge', async () => {
		const { server, env, keystore, wallet, payee } = await setup({ mode: 'mpp' });
		const q = await quote({ url: server.url, env });
		expect(q.decision.offer.protocol).toBe('mpp');
		expect(q.decision.offer.payTo).toBe(payee);

		const result = await pay({ url: server.url, env, keystore });
		expect(result.paid).toBe(true);
		expect(result.receipt.reference).toBe('fixture-signature');
		const { credential } = server.paid[0];
		expect(credential.challenge.id).toBe('test-challenge-1');
		expect(credential.source).toBe(wallet.address);
		expect(credential.payload.type).toBe('transaction');
		const sent = await inspectTransaction(credential.payload.transaction, wallet.address);
		expect(sent.signatureValid).toBe(true);
		expect(sent.tx.signatures[server.feePayer]).toBeNull();
		expect(sent.size).toBeLessThanOrEqual(1232);
	});
});

describe('permissions are enforced before anything is signed', () => {
	async function expectRefusal(promise, reason) {
		const err = await promise.then(() => null, (e) => e);
		expect(err).toBeInstanceOf(PayError);
		expect(err.exit).toBe(EXIT.PERMISSION_DENIED);
		expect(err.reason).toBe(reason);
		return err;
	}

	it('refuses an origin that is not allowed', async () => {
		const { server, env, keystore } = await setup({ perms: { allowedOrigins: ['https://three.ws'] } });
		await expectRefusal(pay({ url: server.url, env, keystore }), REASON.originNotAllowed);
		expect(server.paid).toHaveLength(0);
	});

	it('refuses a network that is not allowed', async () => {
		const { server, env, keystore } = await setup({ perms: { allowedNetworks: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'] } });
		await expectRefusal(pay({ url: server.url, env, keystore }), REASON.networkNotAllowed);
	});

	it('refuses an amount above maxPerCall and above --max', async () => {
		const over = await setup({ price: '60000' });
		await expectRefusal(pay({ url: over.server.url, env: over.env, keystore: over.keystore }), REASON.perCallLimit);
		const flagged = await setup({ price: '10000' });
		await expectRefusal(pay({ url: flagged.server.url, env: flagged.env, keystore: flagged.keystore, maxFlag: '0.005' }), REASON.maxFlag);
	});

	it('refuses once the daily limit would be crossed', async () => {
		const { server, env, keystore } = await setup({ price: '30000', perms: { confirmAbove: '1.00' } });
		for (let i = 0; i < 3; i++) await pay({ url: server.url, env, keystore });
		await expectRefusal(pay({ url: server.url, env, keystore }), REASON.dailyLimit);
		expect(server.paid).toHaveLength(3);
	});

	it('refuses a payee outside allowedPayees', async () => {
		const stranger = (await generateKeyPairSigner()).address;
		const { server, env, keystore } = await setup({ perms: { allowedPayees: [stranger] } });
		await expectRefusal(pay({ url: server.url, env, keystore }), REASON.payeeNotAllowed);
	});

	it('refuses every payment when there is no permissions file', async () => {
		const { server, env, keystore } = await setup();
		fs.rmSync(env.vars.THREE_WS_PAY_PERMISSIONS ?? `${env.home}/.config/three-ws/pay-permissions.json`);
		await expectRefusal(pay({ url: server.url, env, keystore }), REASON.permissionsMissing);
	});

	it('exits 11 above confirmAbove with nobody to ask, and pays when approved', async () => {
		const { server, env, keystore } = await setup({ price: '40000' });
		const err = await pay({ url: server.url, env, keystore }).then(() => null, (e) => e);
		expect(err.exit).toBe(EXIT.CONFIRMATION_REQUIRED);
		expect(err.reason).toBe(REASON.confirmRequired);

		const declined = await pay({ url: server.url, env, keystore, confirm: async () => false }).then(() => null, (e) => e);
		expect(declined.reason).toBe(REASON.declined);
		expect(server.paid).toHaveLength(0);

		const approved = await pay({ url: server.url, env, keystore, confirm: async (s) => s.amount === '0.04' });
		expect(approved.paid).toBe(true);
	});
});

describe('failure handling', () => {
	it('exits 13 and records nothing when the server rejects the payment', async () => {
		const { server, env, keystore } = await setup({ serverOpts: { rejectPayment: true } });
		const err = await pay({ url: server.url, env, keystore }).then(() => null, (e) => e);
		expect(err.exit).toBe(EXIT.PAYMENT_REJECTED);
		expect(fs.existsSync(ledgerPath(env))).toBe(false);
	});

	it('exits 14 when there is no wallet', async () => {
		const { server, env } = await setup();
		const empty = createKeystore({ env: { ...env, home: `${env.home}/other` }, keyring: async () => Promise.reject(new Error('none')) });
		const err = await pay({ url: server.url, env, keystore: empty }).then(() => null, (e) => e);
		expect(err.exit).toBe(EXIT.WALLET_UNAVAILABLE);
	});

	it('exits 12 when the server offers nothing payable here', async () => {
		const { env } = await setup();
		const fetchImpl = async () =>
			new Response('{}', { status: 402, headers: { 'payment-required': Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '1', asset: '0xabc', payTo: '0xdef' }] })).toString('base64') } });
		const err = await quote({ url: 'http://127.0.0.1:1/x', env, fetchImpl }).then(() => null, (e) => e);
		expect(err.exit).toBe(EXIT.NO_PAYABLE_OPTION);
	});

	it('never follows a redirect with a payment attached', async () => {
		const { env, keystore } = await setup();
		const fetchImpl = async (url, init) => {
			expect(init.redirect).toBe('manual');
			return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
		};
		const result = await pay({ url: 'http://127.0.0.1:1/x', env, keystore, fetchImpl });
		expect(result.paid).toBe(false);
		expect(result.status).toBe(302);
	});
});
