// MPP (Machine Payments Protocol) charge on Solana, end to end.
//
// Real: a paidEndpoint() served over a local HTTP server, mppx challenge and
// credential encoding, the @x402/svm client building and ed25519-signing the SPL
// TransferChecked transaction (against a local JSON-RPC stub for the blockhash
// and mint), the buyer (buyerFetch) with its spending caps. Test-controlled: the
// facilitator, which keeps the cryptographic checks (the buyer signed, the
// sponsor fee-payer slot is empty, the amount is in the transfer) and replaces
// only the chain with an in-memory ledger.

import http from 'node:http';

import { generateKeyPairSigner, getBase64Encoder, getTransactionDecoder } from '@solana/kit';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOLANA_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const PRICE = '1000'; // 0.001 USDC

const { ledger } = vi.hoisted(() => ({ ledger: { verified: [], settled: [] } }));

vi.mock('@coinbase/x402', () => ({ createCdpAuthHeaders: vi.fn(async () => ({})) }));

vi.mock('../api/_lib/x402-spec.js', async (importActual) => {
	const actual = await importActual();
	const { getBase64Encoder: b64, getTransactionDecoder: decoder } = await import('@solana/kit');
	return {
		...actual,
		verifyPayment: vi.fn(async ({ paymentHeader, requirements }) => {
			const payment = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
			const all = Array.isArray(requirements) ? requirements : [requirements];
			const requirement = all.find(
				(r) => r.network === payment.accepted?.network && r.payTo === payment.accepted?.payTo && r.amount === payment.accepted?.amount,
			);
			if (!requirement) throw new actual.X402Error('requirement_mismatch', 'payment does not match an advertised requirement', 402);
			const tx = decoder().decode(b64().encode(payment.payload.transaction));
			const signed = Object.entries(tx.signatures).filter(([, sig]) => sig);
			const unsigned = Object.entries(tx.signatures).filter(([, sig]) => !sig);
			if (signed.length !== 1 || unsigned.length !== 1) {
				throw new actual.X402Error('bad_signatures', 'expected the payer signed and the sponsor slot empty', 402);
			}
			if (unsigned[0][0] !== requirement.extra.feePayer) {
				throw new actual.X402Error('bad_fee_payer', 'sponsor slot is not the advertised fee payer', 402);
			}
			ledger.verified.push({ payer: signed[0][0], requirement, signature: signed[0][1] });
			return { payer: signed[0][0], requirement, paymentPayload: payment };
		}),
		settlePayment: vi.fn(async ({ verified }) => {
			const transaction = `sig${ledger.settled.length + 1}${'x'.repeat(40)}`;
			ledger.settled.push({ transaction, payer: verified.payer, requirement: verified.requirement });
			return { transaction, network: verified.requirement.network, payer: verified.payer };
		}),
	};
});

let server;
let origin;
let rpcServer;
let rpcUrl;
let blockhashSeq = 0;
let payer;
let payTo;
let feePayer;
let freshBlockhashes = [];
let challengeLog = [];

function startRpcStub() {
	return new Promise((resolve) => {
		rpcServer = http.createServer((req, res) => {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				const call = JSON.parse(body);
				let result = null;
				if (call.method === 'getLatestBlockhash') {
					result = {
						context: { slot: 1 },
						value: { blockhash: freshBlockhashes[blockhashSeq++ % freshBlockhashes.length], lastValidBlockHeight: 100 },
					};
				} else if (call.method === 'getAccountInfo') {
					const mint = Buffer.alloc(82);
					mint[44] = 6; // decimals
					mint[45] = 1; // initialized
					result = {
						context: { slot: 1 },
						value: {
							data: [mint.toString('base64'), 'base64'],
							executable: false,
							lamports: 1,
							owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
							rentEpoch: 0,
						},
					};
				}
				res.setHeader('content-type', 'application/json');
				res.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }));
			});
		});
		rpcServer.listen(0, '127.0.0.1', () => {
			rpcUrl = `http://127.0.0.1:${rpcServer.address().port}`;
			resolve();
		});
	});
}

beforeAll(async () => {
	process.env.X402_ALLOW_MEMORY_FALLBACK = '1';
	process.env.A2A_MANDATE_SECRET = 'mpp-solana-test-secret-0123456789abcdef';
	delete process.env.DATABASE_URL;
	delete process.env.X402_BUILDER_CODE_APP;

	payer = await generateKeyPairSigner();
	feePayer = await generateKeyPairSigner();
	payTo = (await generateKeyPairSigner()).address;
	freshBlockhashes = await Promise.all(Array.from({ length: 24 }, async () => (await generateKeyPairSigner()).address));

	process.env.X402_PAY_TO_SOLANA = payTo;
	process.env.X402_ASSET_MINT_SOLANA = USDC_MAINNET;
	process.env.X402_FEE_PAYER_SOLANA = feePayer.address;

	await startRpcStub();

	const { paidEndpoint } = await import('../api/_lib/x402-paid-endpoint.js');
	const endpoint = paidEndpoint({
		route: '/api/x402/mpp-test',
		method: 'GET',
		networks: ['solana'],
		priceAtomics: PRICE,
		description: 'MPP on Solana integration test',
		mpp: true,
		bazaar: {
			discoverable: true,
			info: { input: { type: 'object', properties: {}, required: [] }, output: { type: 'object', properties: { ok: { type: 'boolean' } } } },
			schema: { type: 'object' },
		},
		handler: async () => ({ ok: true }),
	});
	const plain = paidEndpoint({
		route: '/api/x402/mpp-off',
		method: 'GET',
		networks: ['solana'],
		priceAtomics: PRICE,
		description: 'x402 only control',
		bazaar: {
			discoverable: true,
			info: { input: { type: 'object', properties: {}, required: [] }, output: { type: 'object', properties: { ok: { type: 'boolean' } } } },
			schema: { type: 'object' },
		},
		handler: async () => ({ ok: true }),
	});
	server = http.createServer((req, res) => (req.url.startsWith('/api/x402/mpp-off') ? plain(req, res) : endpoint(req, res)));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
	await new Promise((resolve) => server?.close(resolve));
	await new Promise((resolve) => rpcServer?.close(resolve));
});

beforeEach(() => {
	ledger.verified.length = 0;
	ledger.settled.length = 0;
	challengeLog = [];
});

const url = () => `${origin}/api/x402/mpp-test`;

async function signPayment({ requirement }) {
	const { buildSolanaExactPayload } = await import('../api/_lib/x402/a2a-client.js');
	return buildSolanaExactPayload({ accept: requirement, signer: payer, resource: url(), rpcUrl });
}

describe('one URL, two challenge formats', () => {
	it('answers 402 with the x402 accepts list AND an MPP Payment challenge at the same price', async () => {
		const res = await fetch(url());
		expect(res.status).toBe(402);
		const www = res.headers.get('www-authenticate');
		const body = await res.json();
		console.log(`HTTP 402\nwww-authenticate: ${www}\nx402 accepts[0]: ${JSON.stringify(body.accepts[0])}`);

		const { Challenge } = await import('mppx');
		const [challenge] = Challenge.fromHeadersList(res.headers);
		expect(challenge.method).toBe('solana');
		expect(challenge.intent).toBe('charge');
		expect(challenge.request.amount).toBe(PRICE);
		expect(challenge.request.currency).toBe(USDC_MAINNET);
		expect(challenge.request.recipient).toBe(payTo);
		expect(challenge.request.methodDetails).toMatchObject({ network: 'mainnet', decimals: 6, feePayer: true, feePayerKey: feePayer.address });

		const x402 = body.accepts.find((a) => a.network === SOLANA_MAINNET);
		expect(x402.amount).toBe(challenge.request.amount);
		expect(x402.payTo).toBe(challenge.request.recipient);
		expect(x402.asset).toBe(challenge.request.currency);
	});

	it('does not offer MPP on an endpoint that did not opt in', async () => {
		const res = await fetch(`${origin}/api/x402/mpp-off`);
		expect(res.status).toBe(402);
		expect(res.headers.get('www-authenticate')).toBeNull();
	});
});

describe('the agent payer', () => {
	it('completes an MPP quote in dry run: reads the charge, checks the cap, signs and pays nothing', async () => {
		const { buyerFetch } = await import('../api/_lib/x402-buyer-fetch.js');
		const signer = vi.fn();
		const result = await buyerFetch(url(), {
			preferProtocol: 'mpp',
			dryRun: true,
			caps: { address: 'dry-run-agent', maxPerCall: '5000' },
			signPayment: signer,
		});
		console.log(`dry-run transcript:\n${JSON.stringify({ ok: result.ok, protocol: result.protocol, quote: result.quote, mppOffers: result.offers.mpp.length }, null, 2)}`);
		expect(result.ok).toBe(true);
		expect(result.dryRun).toBe(true);
		expect(result.protocol).toBe('mpp');
		expect(result.quote).toMatchObject({ scheme: 'exact', network: SOLANA_MAINNET, asset: USDC_MAINNET, payTo, amount: PRICE });
		expect(result.offers.mpp).toHaveLength(1);
		expect(signer).not.toHaveBeenCalled();
		expect(ledger.verified).toHaveLength(0);
	});

	it('pays an MPP charge with a really signed transaction and reads the Payment-Receipt', async () => {
		const { buyerFetch } = await import('../api/_lib/x402-buyer-fetch.js');
		const result = await buyerFetch(url(), { preferProtocol: 'mpp', signPayment, caps: { address: 'mpp-agent', maxPerCall: '5000' } });
		expect(result.ok, JSON.stringify(result.result)).toBe(true);
		expect(result.protocol).toBe('mpp');
		expect(result.result).toEqual({ ok: true });
		expect(ledger.settled).toHaveLength(1);
		expect(ledger.verified[0].payer).toBe(payer.address);
		expect(result.settled).toMatchObject({ success: true, transaction: ledger.settled[0].transaction, payer: payer.address });
		expect(result.response.headers.get('payment-receipt')).toBeTruthy();
	});

	it('still pays the same endpoint over x402 when MPP is not preferred', async () => {
		const { buyerFetch } = await import('../api/_lib/x402-buyer-fetch.js');
		const result = await buyerFetch(url(), { signPayment });
		expect(result.ok, JSON.stringify(result.result)).toBe(true);
		expect(result.protocol).toBe('x402');
		expect(result.response.headers.get('x-payment-response')).toBeTruthy();
		expect(ledger.settled).toHaveLength(1);
	});

	it('pays an MPP-only server (no x402 body at all)', async () => {
		const { buyerFetch } = await import('../api/_lib/x402-buyer-fetch.js');
		const mppOnly = async (input, init) => {
			const res = await fetch(input, init);
			if (res.status !== 402) return res;
			const headers = new Headers(res.headers);
			headers.delete('payment-required');
			return new Response('payment required', { status: 402, headers });
		};
		const result = await buyerFetch(url(), { signPayment, fetchImpl: mppOnly });
		expect(result.ok, JSON.stringify(result.result)).toBe(true);
		expect(result.protocol).toBe('mpp');
		expect(ledger.settled).toHaveLength(1);
	});
});

describe('interop with the three-ws CLI payer', () => {
	it('parses the challenge, signs a credential and redeems it for a Payment-Receipt', async () => {
		const { readChallenge } = await import('../packages/three-ws-cli/src/pay/challenge.js');
		const { signMpp, readMppReceipt } = await import('../packages/three-ws-cli/src/pay/mpp.js');
		const probe = await fetch(url());
		const { offers } = await readChallenge(probe);
		const offer = offers.find((o) => o.protocol === 'mpp');
		expect(offer.unsupported).toBeUndefined();
		expect(offer.amountAtomic).toBe(BigInt(PRICE));
		const { authorization } = await signMpp({ offer, signer: payer, rpcUrl });
		const paid = await fetch(url(), { headers: { authorization } });
		expect(paid.status, await paid.clone().text()).toBe(200);
		expect(readMppReceipt(paid)).toMatchObject({ method: 'solana', status: 'success', reference: ledger.settled[0].transaction });
	});
});

describe('guard layers on an MPP challenge', () => {
	it('blocks a charge above the per-call cap before anything is signed', async () => {
		const { buyerFetch } = await import('../api/_lib/x402-buyer-fetch.js');
		const signer = vi.fn();
		const result = await buyerFetch(url(), {
			preferProtocol: 'mpp',
			signPayment: signer,
			caps: { address: 'capped-agent', maxPerCall: '999' },
		});
		expect(result.ok).toBe(false);
		expect(result.abort).toBe(true);
		expect(result.protocol).toBe('mpp');
		expect(result.reason).toMatch(/per-call cap/);
		expect(signer).not.toHaveBeenCalled();
		expect(ledger.settled).toHaveLength(0);
	});

	it('blocks the same charge in dry run so a quote never promises what a payment would refuse', async () => {
		const { buyerFetch } = await import('../api/_lib/x402-buyer-fetch.js');
		const result = await buyerFetch(url(), { preferProtocol: 'mpp', dryRun: true, signPayment: vi.fn(), caps: { address: 'capped-agent', maxPerCall: '999' } });
		expect(result.ok).toBe(false);
		expect(result.abort).toBe(true);
		expect(result.dryRun).toBe(true);
	});
});

describe('the server refuses what it did not issue', () => {
	async function challengeFor() {
		const res = await fetch(url());
		const { Challenge } = await import('mppx');
		return Challenge.fromHeadersList(res.headers)[0];
	}

	it('rejects a credential whose terms were edited after issue', async () => {
		const { solanaChargeAuthorization, chargeToRequirement } = await import('../api/_lib/mpp-solana.js');
		const challenge = await challengeFor();
		const payload = await signPayment({ requirement: chargeToRequirement(challenge) });
		const forged = { ...challenge, request: { ...challenge.request, amount: '1' } };
		const res = await fetch(url(), { headers: { authorization: solanaChargeAuthorization({ challenge: forged, transaction: payload.payload.transaction }) } });
		expect(res.status).toBe(401);
		expect((await res.json()).error).toBe('challenge_mismatch');
		expect(ledger.settled).toHaveLength(0);
	});

	it('rejects a malformed Payment credential', async () => {
		const res = await fetch(url(), { headers: { authorization: 'Payment not-a-credential' } });
		expect(res.status).toBe(401);
		expect(ledger.settled).toHaveLength(0);
	});

	it('answers payment required again, with a fresh challenge, for an expired one', async () => {
		const { buildSolanaChargeChallenge, solanaChargeAuthorization, chargeToRequirement } = await import('../api/_lib/mpp-solana.js');
		const live = await challengeFor();
		const requirement = chargeToRequirement(live);
		const stale = buildSolanaChargeChallenge({
			requirement: { ...requirement, extra: { ...requirement.extra } },
			nowSec: Math.floor(Date.now() / 1000) - 3600,
		});
		const payload = await signPayment({ requirement });
		const res = await fetch(url(), { headers: { authorization: solanaChargeAuthorization({ challenge: stale.challenge, transaction: payload.payload.transaction }) } });
		expect(res.status).toBe(402);
		expect(res.headers.get('www-authenticate')).toMatch(/^Payment /);
		expect(ledger.settled).toHaveLength(0);
	});

	it('settles one signed transaction once and answers a replay from the original result', async () => {
		const { solanaChargeAuthorization, chargeToRequirement } = await import('../api/_lib/mpp-solana.js');
		const challenge = await challengeFor();
		const payload = await signPayment({ requirement: chargeToRequirement(challenge) });
		const authorization = solanaChargeAuthorization({ challenge, transaction: payload.payload.transaction });
		const first = await fetch(url(), { headers: { authorization } });
		expect(first.status).toBe(200);
		const second = await fetch(url(), { headers: { authorization } });
		expect(second.headers.get('x-x402-idempotent')).toBe('replay');
		expect(second.headers.get('payment-receipt')).toBe(first.headers.get('payment-receipt'));
		expect(ledger.settled).toHaveLength(1);
	});
});

describe('what a pull-mode charge cannot do', () => {
	it('declines native SOL, split and confidential charges instead of mispaying them', async () => {
		const { chargeToRequirement } = await import('../api/_lib/mpp-solana.js');
		const base = { amount: '1000', currency: USDC_MAINNET, recipient: payTo, methodDetails: { network: 'mainnet', decimals: 6 } };
		expect(chargeToRequirement({ request: base })).toMatchObject({ scheme: 'exact', amount: '1000' });
		expect(chargeToRequirement({ request: { ...base, currency: 'sol' } })).toBeNull();
		expect(chargeToRequirement({ request: { ...base, methodDetails: { ...base.methodDetails, splits: [{ recipient: payTo, amount: '1' }] } } })).toBeNull();
		expect(chargeToRequirement({ request: { ...base, methodDetails: { ...base.methodDetails, confidential: true } } })).toBeNull();
		expect(chargeToRequirement({ request: { ...base, amount: '1.5' } })).toBeNull();
	});

	it('keeps the decoded transaction a plain two-slot partial signature', async () => {
		const challenge = await (async () => {
			const res = await fetch(url());
			const { Challenge } = await import('mppx');
			return Challenge.fromHeadersList(res.headers)[0];
		})();
		const { chargeToRequirement } = await import('../api/_lib/mpp-solana.js');
		const payload = await signPayment({ requirement: chargeToRequirement(challenge) });
		const tx = getTransactionDecoder().decode(getBase64Encoder().encode(payload.payload.transaction));
		expect(Object.keys(tx.signatures)).toContain(feePayer.address);
		expect(tx.signatures[feePayer.address]).toBeNull();
		expect(tx.signatures[payer.address]).toBeTruthy();
	});
});
