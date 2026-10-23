// Real local servers for the pay tests: a JSON-RPC node that answers the one
// account lookup the signer needs (the USDC mint), and a paid HTTP resource that
// speaks x402 v2, x402 v1 or MPP and checks the transaction it is handed.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
	generateKeyPairSigner,
	getBase64Encoder,
	getTransactionDecoder,
	getPublicKeyFromAddress,
	verifySignature,
} from '@solana/kit';
import { b64urlDecodeJson, b64urlEncode, canonicalJson } from '../src/pay/encoding.js';
import { SOLANA_DEVNET, USDC_DEVNET } from '../src/pay/permissions.js';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
// A real recent blockhash is not needed offline: any 32-byte base58 value compiles.
export const FIXED_BLOCKHASH = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi';

export function tempEnv(vars = {}) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'three-ws-pay-'));
	return { home, platform: 'linux', cwd: home, vars: { ...vars } };
}

/** SPL Token mint account bytes: initialized, 6 decimals, no authorities. */
function mintAccountBase64(decimals) {
	const data = Buffer.alloc(82);
	data.writeUInt32LE(0, 0); // no mint authority
	data.writeBigUInt64LE(1_000_000_000n, 36); // supply
	data.writeUInt8(decimals, 44);
	data.writeUInt8(1, 45); // initialized
	data.writeUInt32LE(0, 46); // no freeze authority
	return data.toString('base64');
}

function listen(server) {
	return new Promise((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
	});
}

const close = (server) => () => new Promise((resolve) => server.close(resolve));

export async function startRpc({ decimals = 6 } = {}) {
	const calls = [];
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (d) => (body += d));
		req.on('end', () => {
			const rpc = JSON.parse(body);
			calls.push(rpc.method);
			let result;
			if (rpc.method === 'getAccountInfo') {
				result = {
					context: { slot: 1 },
					value: { data: [mintAccountBase64(decimals), 'base64'], executable: false, lamports: 1461600, owner: TOKEN_PROGRAM, rentEpoch: 0, space: 82 },
				};
			}
			if (rpc.method === 'getLatestBlockhash') {
				result = { context: { slot: 1 }, value: { blockhash: FIXED_BLOCKHASH, lastValidBlockHeight: 100 } };
			}
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify(result === undefined ? { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `unexpected ${rpc.method}` } } : { jsonrpc: '2.0', id: rpc.id, result }));
		});
	});
	const url = await listen(server);
	return { url, calls, close: close(server) };
}

/** Decode a base64 wire transaction and check the payer's signature really covers the message. */
export async function inspectTransaction(base64, payerAddress) {
	const bytes = getBase64Encoder().encode(base64);
	const tx = getTransactionDecoder().decode(bytes);
	const signature = tx.signatures[payerAddress];
	const key = await getPublicKeyFromAddress(payerAddress);
	const verified = signature ? await verifySignature(key, signature, tx.messageBytes) : false;
	return { tx, signedByPayer: Boolean(signature), signatureValid: verified, size: bytes.length, message: Buffer.from(tx.messageBytes) };
}

/**
 * A paid resource on a random port.
 * mode: 'x402v2' | 'x402v1' | 'mpp'. `price` is atomic units of the devnet USDC mint.
 * Every request is recorded in `seen`; a request carrying valid payment gets a 200.
 */
export async function startPaidServer({ mode = 'x402v2', price = '10000', payTo, network = SOLANA_DEVNET, asset = USDC_DEVNET, rejectPayment = false } = {}) {
	const feePayer = (await generateKeyPairSigner()).address;
	const seen = [];
	const paid = [];
	let baseUrl = '';
	const server = http.createServer(async (req, res) => {
		seen.push({ method: req.method, url: req.url, headers: req.headers });
		let body = '';
		for await (const chunk of req) body += chunk;
		const send = (status, headers, text) => {
			res.writeHead(status, headers);
			res.end(text);
		};
		const challenge402 = () => {
			if (mode === 'x402v2') {
				const required = {
					x402Version: 2,
					error: 'PAYMENT-SIGNATURE header is required',
					resource: { url: `${baseUrl}${req.url}`, description: 'fixture', mimeType: 'application/json' },
					accepts: [{ scheme: 'exact', network, amount: price, asset, payTo, maxTimeoutSeconds: 60, extra: { feePayer, recentBlockhash: FIXED_BLOCKHASH } }],
				};
				return send(402, { 'content-type': 'application/json', 'payment-required': Buffer.from(JSON.stringify(required)).toString('base64') }, '{}');
			}
			if (mode === 'x402v1') {
				const required = {
					x402Version: 1,
					error: 'X-PAYMENT header is required',
					accepts: [{ scheme: 'exact', network: 'solana-devnet', maxAmountRequired: price, resource: `${baseUrl}${req.url}`, description: 'fixture', mimeType: 'application/json', payTo, maxTimeoutSeconds: 60, asset, extra: { feePayer, recentBlockhash: FIXED_BLOCKHASH } }],
				};
				return send(402, { 'content-type': 'application/json' }, JSON.stringify(required));
			}
			const request = {
				amount: price,
				currency: asset,
				recipient: payTo,
				description: 'fixture',
				methodDetails: { network: 'devnet', decimals: 6, tokenProgram: TOKEN_PROGRAM, feePayer: true, feePayerKey: feePayer, recentBlockhash: FIXED_BLOCKHASH },
			};
			const auth = `Payment id="test-challenge-1", realm="127.0.0.1", method="solana", intent="charge", request="${b64urlEncode(canonicalJson(request))}", expires="2999-01-01T00:00:00Z"`;
			return send(402, { 'www-authenticate': auth, 'content-type': 'application/problem+json' }, '{"type":"payment-required"}');
		};

		if (rejectPayment) return challenge402();

		if (mode === 'x402v2' || mode === 'x402v1') {
			const header = req.headers[mode === 'x402v2' ? 'payment-signature' : 'x-payment'];
			if (!header) return challenge402();
			const payload = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
			paid.push({ payload, body });
			const receipt = { success: true, transaction: 'fixture-signature', network };
			return send(200, { 'content-type': 'application/json', ...(mode === 'x402v2' ? { 'payment-response': Buffer.from(JSON.stringify(receipt)).toString('base64') } : { 'x-payment-response': Buffer.from(JSON.stringify(receipt)).toString('base64') }) }, JSON.stringify({ data: 'paid content', echoed: body }));
		}

		const authorization = req.headers.authorization;
		if (!authorization?.startsWith('Payment ')) return challenge402();
		const credential = b64urlDecodeJson(authorization.slice('Payment '.length));
		paid.push({ credential, body });
		const receipt = { method: 'solana', challengeId: credential.challenge.id, reference: 'fixture-signature', status: 'success', timestamp: new Date().toISOString() };
		return send(200, { 'content-type': 'application/json', 'payment-receipt': b64urlEncode(JSON.stringify(receipt)) }, JSON.stringify({ data: 'paid content' }));
	});
	baseUrl = await listen(server);
	return { url: `${baseUrl}/api/paid`, origin: baseUrl, feePayer, seen, paid, close: close(server) };
}

export function writePermissions(env, perms) {
	const file = env.vars.THREE_WS_PAY_PERMISSIONS ?? path.join(env.home, '.config', 'three-ws', 'pay-permissions.json');
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(perms));
	return file;
}
