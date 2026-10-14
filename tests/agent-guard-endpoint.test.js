import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

// The endpoint is pure policy evaluation over the request body; the only
// impure edges are the rate limiter, the env-backed http helpers, and (since
// the signed spend delegation is opt-in persisted state) the database.
const agentGuardIp = vi.fn();
vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => ({
	...(await importOriginal()),
	limits: { agentGuardIp: (...a) => agentGuardIp(...a) },
	clientIp: (req) => req.socket?.remoteAddress || '0.0.0.0',
}));
vi.mock('../api/_lib/env.js', () => ({
	env: { APP_ORIGIN: 'http://localhost:3000', ISSUER: 'http://t', MCP_RESOURCE: 'http://t' },
}));
const solUsdPrice = vi.fn();
vi.mock('../api/_lib/avatar-wallet.js', () => ({
	solUsdPrice: (...a) => solUsdPrice(...a),
}));

// A minimal fake database, keyed on query substrings, in the same style as
// tests/agent-custody-guards.test.js: enough to exercise the real
// registerDelegation / checkDelegationSpend logic (not a mock of those
// functions themselves) without a live Postgres connection.
const dbState = { owners: new Map(), wallets: new Map(), active: new Map(), nonces: new Set(), custodySpentLamports: 0n };
vi.mock('../api/_lib/db.js', () => ({
	sql: (strings, ...values) => {
		const query = strings.join('?');
		if (query.includes('INSERT INTO agent_spend_delegations')) {
			const [agentId, owner, cap, epochSeconds, notAfterSec, nonce, signature] = values;
			const key = `${agentId}:${nonce}`;
			if (dbState.nonces.has(key)) {
				throw new Error('duplicate key value violates unique constraint "agent_spend_delegations_nonce_unique"');
			}
			dbState.nonces.add(key);
			const row = {
				id: `deleg-${dbState.nonces.size}`,
				agent_id: agentId,
				owner_wallet: owner,
				cap_lamports_per_epoch: String(cap),
				epoch_seconds: Number(epochSeconds),
				not_after: new Date(Number(notAfterSec) * 1000).toISOString(),
				nonce,
				signature,
				status: 'active',
				created_at: new Date().toISOString(),
			};
			dbState.active.set(agentId, row);
			return [row];
		}
		if (query.includes('FROM agent_spend_delegations')) {
			const [agentId] = values;
			const row = dbState.active.get(agentId);
			return row ? [row] : [];
		}
		if (query.includes('FROM agent_identities')) {
			const [agentId] = values;
			const userId = dbState.owners.get(agentId);
			return userId ? [{ user_id: userId }] : [];
		}
		if (query.includes('FROM user_wallets')) {
			const [userId] = values;
			const address = dbState.wallets.get(userId);
			return address ? [{ address }] : [];
		}
		if (query.includes('FROM agent_custody_events')) {
			return [{ lamports: String(dbState.custodySpentLamports) }];
		}
		return [];
	},
}));

const { default: guardHandler } = await import('../api/agent/guard.js');
const { delegationMessage } = await import('../packages/agent-guards/src/delegation.js');

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(buf) {
	let num = 0n;
	for (const b of buf) num = num * 256n + BigInt(b);
	let out = '';
	while (num > 0n) {
		out = B58[Number(num % 58n)] + out;
		num /= 58n;
	}
	let leadingZeros = 0;
	for (const b of buf) {
		if (b === 0) leadingZeros++;
		else break;
	}
	return B58[0].repeat(leadingZeros) + (out || '');
}
function makeSigner() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
	return { address: b58encode(raw), sign: (msg) => cryptoSign(null, Buffer.from(msg, 'utf8'), privateKey) };
}
function baseDelegation(agent, owner, overrides = {}) {
	return {
		agent,
		owner,
		cap_lamports_per_epoch: '1000000000', // 1 SOL per epoch
		epoch_seconds: '86400',
		not_after: String(Math.floor(Date.now() / 1000) + 3600),
		nonce: 'nonce-' + Math.random().toString(36).slice(2),
		...overrides,
	};
}
function signDelegation(signer, delegation) {
	return signer.sign(delegationMessage(delegation)).toString('base64');
}

function mkReq({ method = 'POST', url = '/api/agent/guard', headers = {}, body = null } = {}) {
	return {
		method,
		url,
		headers: { ...(body != null ? { 'content-type': 'application/json' } : {}), ...headers },
		socket: { remoteAddress: '127.0.0.1' },
		on(event, cb) {
			if (event === 'data' && body != null) {
				const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
				queueMicrotask(() => {
					cb(buf);
					this._endCb?.();
				});
			} else if (event === 'end') {
				if (body == null) queueMicrotask(() => cb());
				else this._endCb = cb;
			}
		},
		destroy() {},
	};
}
function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		writableEnded: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		end(b) {
			this.body = b;
			this.writableEnded = true;
		},
	};
}
const parse = (res) => (res.body ? JSON.parse(res.body) : undefined);

beforeEach(() => {
	agentGuardIp.mockReset().mockResolvedValue({ success: true, limit: 300, remaining: 299, reset: Date.now() + 1000 });
	solUsdPrice.mockReset().mockResolvedValue(200);
	dbState.owners.clear();
	dbState.wallets.clear();
	dbState.active.clear();
	dbState.nonces.clear();
	dbState.custodySpentLamports = 0n;
});

describe('POST /api/agent/guard', () => {
	it('rejects non-POST', async () => {
		const res = mkRes();
		await guardHandler(mkReq({ method: 'GET' }), res);
		expect(res.statusCode).toBe(405);
	});

	it('400 when no calls are supplied', async () => {
		const res = mkRes();
		await guardHandler(mkReq({ body: {} }), res);
		expect(res.statusCode).toBe(400);
		expect(parse(res).error).toBe('no_calls');
	});

	it('blocks a free-tier transfer above the tier cap at the trade-guard layer', async () => {
		const res = mkRes();
		await guardHandler(
			mkReq({
				body: {
					calls: [{ identifier: 'solana_transfer', apiName: 'solana_transfer', valueUsd: 50_000 }],
				},
			}),
			res,
		);
		expect(res.statusCode).toBe(200);
		const { verdicts } = parse(res);
		expect(verdicts).toHaveLength(1);
		expect(verdicts[0].verdict.decision).toBe('block');
		expect(verdicts[0].verdict.blockedBy).toBe('defi_guard');
	});

	it('reports an unscoped outflow as a critical blind spot when no spend envelope is sent', async () => {
		const res = mkRes();
		await guardHandler(
			mkReq({
				body: { calls: [{ identifier: 'solana_transfer', valueUsd: 500 }] },
			}),
			res,
		);
		const { verdicts } = parse(res);
		const spots = verdicts[0].verdict.blindSpots.map((s) => s.code);
		expect(spots).toContain('SPEND_UNSCOPED');
	});

	it('enforces a caller-supplied spend envelope', async () => {
		const res = mkRes();
		await guardHandler(
			mkReq({
				body: {
					agentId: 'agent-1',
					calls: [{ identifier: 'solana_transfer', valueUsd: 500 }],
					spend: { perTxMaxUsd: 100 },
				},
			}),
			res,
		);
		const { verdicts } = parse(res);
		expect(verdicts[0].verdict.decision).toBe('block');
		expect(verdicts[0].verdict.blockedBy).toBe('spend_guard');
		expect(verdicts[0].verdict.code).toBe('CAP_PER_TX');
	});

	it('clamps oversized slippage on a large swap and requires approval above the ceiling', async () => {
		const res = mkRes();
		await guardHandler(
			mkReq({
				body: {
					userTier: 'pro',
					calls: [
						{
							identifier: 'solana_swap',
							arguments: { inputMint: 'So11111111111111111111111111111111111111112', slippageBps: 300 },
							valueUsd: 20_000,
						},
					],
				},
			}),
			res,
		);
		const { verdicts } = parse(res);
		expect(verdicts[0].verdict.decision).toBe('require_approval');
		expect(verdicts[0].verdict.modifiedArguments).toMatchObject({ slippageBps: 100 });
	});

	it('resolves a SOL notional server-side and blocks a transfer above the tier cap', async () => {
		const res = mkRes();
		await guardHandler(
			mkReq({
				// 250 SOL x $200 = $50,000 > the free-tier $10,000 cap.
				body: {
					calls: [{ identifier: 'solana_transfer', arguments: { recipient: 'abc', amount: 250 } }],
				},
			}),
			res,
		);
		const { verdicts } = parse(res);
		expect(solUsdPrice).toHaveBeenCalled();
		expect(verdicts[0].verdict.decision).toBe('block');
		expect(verdicts[0].verdict.blockedBy).toBe('defi_guard');
	});

	it('leaves the notional unresolved when the price source is down', async () => {
		solUsdPrice.mockRejectedValue(new Error('price unavailable'));
		const res = mkRes();
		await guardHandler(
			mkReq({
				body: {
					calls: [{ identifier: 'solana_transfer', arguments: { recipient: 'abc', amount: 250 } }],
				},
			}),
			res,
		);
		const { verdicts } = parse(res);
		expect(verdicts[0].verdict.decision).not.toBe('block');
		expect(verdicts[0].verdict.blindSpots.some((s) => s.code === 'VALUE_UNRESOLVED')).toBe(true);
	});

	it('flags batched dispatch as bypassing the decorator guards', async () => {
		const res = mkRes();
		await guardHandler(
			mkReq({
				body: { calls: [{ identifier: 'solana_swap', valueUsd: 100, executionPath: 'batch' }] },
			}),
			res,
		);
		const { verdicts } = parse(res);
		expect(verdicts[0].verdict.blindSpots.some((s) => s.code === 'BATCH_BYPASS')).toBe(true);
	});

	it('429s when the limiter says no', async () => {
		agentGuardIp.mockResolvedValue({ success: false, limit: 300, remaining: 0, reset: Date.now() + 1000 });
		const res = mkRes();
		await guardHandler(mkReq({ body: { calls: [{ identifier: 'solana_swap' }] } }), res);
		expect(res.statusCode).toBe(429);
	});
});

describe('POST /api/agent/guard - signed spend delegation', () => {
	const agentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
	const userId = 'owner-user-1';

	function linkOwner(owner) {
		dbState.owners.set(agentId, userId);
		dbState.wallets.set(userId, owner.address);
	}

	it('stores a valid owner-signed delegation', async () => {
		const owner = makeSigner();
		linkOwner(owner);
		const delegation = baseDelegation(agentId, owner.address);
		const signature = signDelegation(owner, delegation);
		const res = mkRes();
		await guardHandler(mkReq({ body: { agentId, calls: [], delegation, delegationSignature: signature } }), res);
		expect(res.statusCode).toBe(200);
		const body = parse(res);
		expect(body.delegationRegistration.ok).toBe(true);
		expect(body.delegationRegistration.capLamportsPerEpoch).toBe('1000000000');
	});

	it('rejects a wrong signer (claims an owner it was not signed by)', async () => {
		const owner = makeSigner();
		const impostor = makeSigner();
		linkOwner(owner);
		const delegation = baseDelegation(agentId, owner.address);
		const signature = signDelegation(impostor, delegation);
		const res = mkRes();
		await guardHandler(mkReq({ body: { agentId, calls: [], delegation, delegationSignature: signature } }), res);
		const body = parse(res);
		expect(body.delegationRegistration.ok).toBe(false);
		expect(body.delegationRegistration.code).toBe('wrong_signer');
	});

	it('rejects an already-expired delegation at registration time', async () => {
		const owner = makeSigner();
		linkOwner(owner);
		const delegation = baseDelegation(agentId, owner.address, { not_after: String(Math.floor(Date.now() / 1000) - 10) });
		const signature = signDelegation(owner, delegation);
		const res = mkRes();
		await guardHandler(mkReq({ body: { agentId, calls: [], delegation, delegationSignature: signature } }), res);
		const body = parse(res);
		expect(body.delegationRegistration.ok).toBe(false);
		expect(body.delegationRegistration.code).toBe('expired_delegation');
	});

	it('rejects a replayed nonce (the exact same signed envelope resubmitted)', async () => {
		const owner = makeSigner();
		linkOwner(owner);
		const delegation = baseDelegation(agentId, owner.address);
		const signature = signDelegation(owner, delegation);
		const first = mkRes();
		await guardHandler(mkReq({ body: { agentId, calls: [], delegation, delegationSignature: signature } }), first);
		expect(parse(first).delegationRegistration.ok).toBe(true);

		const second = mkRes();
		await guardHandler(mkReq({ body: { agentId, calls: [], delegation, delegationSignature: signature } }), second);
		const body = parse(second);
		expect(body.delegationRegistration.ok).toBe(false);
		expect(body.delegationRegistration.code).toBe('replayed_nonce');
	});

	it('blocks a call whose realized-plus-proposed epoch spend would exceed the signed cap', async () => {
		const owner = makeSigner();
		linkOwner(owner);
		// 1 SOL/epoch cap; 0.9 SOL already realized this epoch from the custody
		// ledger (not a self-reported amount) leaves 0.1 SOL of headroom.
		const delegation = baseDelegation(agentId, owner.address, { cap_lamports_per_epoch: '1000000000' });
		const signature = signDelegation(owner, delegation);
		const register = mkRes();
		await guardHandler(mkReq({ body: { agentId, calls: [], delegation, delegationSignature: signature } }), register);
		expect(parse(register).delegationRegistration.ok).toBe(true);

		dbState.custodySpentLamports = 900_000_000n;
		const res = mkRes();
		await guardHandler(
			mkReq({
				body: { agentId, calls: [{ identifier: 'solana_transfer', arguments: { token: 'SOL', amount: 0.2 } }] },
			}),
			res,
		);
		const { verdicts } = parse(res);
		expect(verdicts[0].delegation.allow).toBe(false);
		expect(verdicts[0].delegation.code).toBe('DELEGATION_CAP_EXCEEDED');
		expect(verdicts[0].verdict.decision).toBe('block');
		expect(verdicts[0].verdict.blockedBy).toBe('spend_delegation');
	});

	it('allows a call within the signed cap and remaining realized headroom', async () => {
		const owner = makeSigner();
		linkOwner(owner);
		const delegation = baseDelegation(agentId, owner.address, { cap_lamports_per_epoch: '1000000000' });
		const signature = signDelegation(owner, delegation);
		const register = mkRes();
		await guardHandler(mkReq({ body: { agentId, calls: [], delegation, delegationSignature: signature } }), register);
		expect(parse(register).delegationRegistration.ok).toBe(true);

		dbState.custodySpentLamports = 0n;
		const res = mkRes();
		await guardHandler(
			mkReq({
				body: { agentId, calls: [{ identifier: 'solana_transfer', arguments: { token: 'SOL', amount: 0.1 } }] },
			}),
			res,
		);
		const { verdicts } = parse(res);
		expect(verdicts[0].delegation.allow).toBe(true);
		expect(verdicts[0].verdict.decision).not.toBe('block');
	});

	it('rejects a call against a delegation whose not_after has since passed', async () => {
		const owner = makeSigner();
		linkOwner(owner);
		// Seeded directly as "on file", bypassing registration, to model a
		// delegation that was valid when signed and has since lapsed: the DB
		// row is still `status = 'active'` (nothing flips it), so the cap check
		// at call time is what has to catch the expiry, not the registration path.
		dbState.active.set(agentId, {
			id: 'deleg-lapsed',
			agent_id: agentId,
			owner_wallet: owner.address,
			cap_lamports_per_epoch: '1000000000',
			epoch_seconds: 86400,
			not_after: new Date(Date.now() - 1000).toISOString(),
			nonce: 'lapsed-nonce',
			status: 'active',
			created_at: new Date().toISOString(),
		});
		const res = mkRes();
		await guardHandler(
			mkReq({
				body: { agentId, calls: [{ identifier: 'solana_transfer', arguments: { token: 'SOL', amount: 0.01 } }] },
			}),
			res,
		);
		const { verdicts } = parse(res);
		expect(verdicts[0].delegation.allow).toBe(false);
		expect(verdicts[0].delegation.code).toBe('DELEGATION_EXPIRED');
		expect(verdicts[0].verdict.decision).toBe('block');
		expect(verdicts[0].verdict.blockedBy).toBe('spend_delegation');
	});
});
