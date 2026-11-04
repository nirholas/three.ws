// POST /api/pump/governance-prep builds the agentUpdateBuybackBps transaction the
// agent authority signs to change its buyback split.
//
// The handler called PumpAgentOffline.updateBuybackBps(params, {}). The offline
// builder iterates options.supportedCurrencies to attach every supported
// currency's payment vault as a remaining account, so an empty options object
// threw "supportedCurrencies is not iterable" and no owner could ever change the
// split. The program also needs each vault derived on that currency's own token
// program: $THREE is Token-2022, so a classic-derived vault is the wrong account.
//
// This runs the real handler and the real SDK over a fake chain that serves an
// encoded GlobalConfig listing $THREE, and decodes the transaction it returns.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, PublicKey, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import BN from 'bn.js';
import { getGlobalConfigPDA, getPumpProgram, getTokenAgentPaymentsPDA } from '@three-ws/agent-payments';

const THREE_MINT = new PublicKey('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');

const state = vi.hoisted(() => ({
	user: { id: 'user-1' },
	row: null,
	accounts: new Map(),
	rpcDown: false,
}));

vi.mock('../api/_lib/solana/connection.js', async (importOriginal) => ({
	...(await importOriginal()),
	solanaConnection: () => {
		const get = (pk) => {
			if (state.rpcDown) throw Object.assign(new Error('fetch failed'), { status: 503 });
			return state.accounts.get(pk.toBase58()) ?? null;
		};
		return {
			rpcEndpoint: 'http://fake-rpc.invalid',
			commitment: 'confirmed',
			async getAccountInfo(pk) {
				return get(pk);
			},
			async getAccountInfoAndContext(pk) {
				return { context: { slot: 1 }, value: get(pk) };
			},
			async getMultipleAccountsInfo(keys) {
				return keys.map(get);
			},
			async getLatestBlockhash() {
				return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 };
			},
		};
	},
}));

vi.mock('../api/_lib/auth.js', async (importOriginal) => ({
	...(await importOriginal()),
	getSessionUser: async () => state.user,
}));

vi.mock('../api/_lib/rate-limit.js', () => {
	const ok = async () => ({ success: true });
	return { limits: new Proxy({}, { get: () => ok }), clientIp: () => '127.0.0.1' };
});

vi.mock('../api/_lib/db.js', async (importOriginal) => ({
	...(await importOriginal()),
	sql: (strings) => {
		const q = strings.join('?');
		if (/from pump_agent_mints/i.test(q)) return Promise.resolve(state.row ? [state.row] : []);
		return Promise.resolve([]);
	},
}));

const { default: handler } = await import('../api/pump/[action].js');

function makeRes() {
	const r = { statusCode: 200, _h: {}, _b: null };
	r.setHeader = (k, v) => {
		r._h[k.toLowerCase()] = v;
	};
	r.getHeader = (k) => r._h[k.toLowerCase()];
	r.end = (b) => {
		r._b = b;
	};
	return r;
}

async function call(body) {
	const res = makeRes();
	await handler(
		{
			method: 'POST',
			url: '/api/pump/governance-prep',
			query: { action: 'governance-prep' },
			headers: { origin: 'https://three.ws', 'content-type': 'application/json' },
			socket: { remoteAddress: '127.0.0.1' },
			body,
		},
		res,
	);
	return { status: res.statusCode, body: res._b ? JSON.parse(res._b) : null };
}

async function globalConfigAccount(currencies) {
	const program = getPumpProgram({});
	const supported = Array.from({ length: 10 }, () => PublicKey.default);
	currencies.forEach((m, i) => {
		supported[i] = m;
	});
	const data = await program.coder.accounts.encode('globalConfig', {
		bump: 255,
		protocolAuthority: Keypair.generate().publicKey,
		buybackAuthority: Keypair.generate().publicKey,
		supportedCurrenciesMint: supported,
		tokenizedAgentSequence: new BN(0),
	});
	return { owner: program.programId, data, lamports: 1, executable: false };
}

const mintAccount = (program) => ({ owner: program, data: Buffer.alloc(82), lamports: 1, executable: false });

let agentMint;
let authority;

beforeEach(async () => {
	agentMint = Keypair.generate().publicKey;
	authority = Keypair.generate().publicKey;
	state.row = { id: 'row-1', user_id: state.user.id, agent_authority: authority.toBase58() };
	state.accounts = new Map();
});

describe('governance-prep', () => {
	it('builds the buyback update with the $THREE vault derived on Token-2022', async () => {
		const classic = Keypair.generate().publicKey;
		state.accounts.set(getGlobalConfigPDA()[0].toBase58(), await globalConfigAccount([THREE_MINT, classic]));
		state.accounts.set(THREE_MINT.toBase58(), mintAccount(TOKEN_2022_PROGRAM_ID));
		state.accounts.set(classic.toBase58(), mintAccount(TOKEN_PROGRAM_ID));

		const { status, body } = await call({
			mint: agentMint.toBase58(),
			authority_wallet: authority.toBase58(),
			new_buyback_bps: 2500,
		});

		expect(status).toBe(201);
		expect(body.new_buyback_bps).toBe(2500);
		const tx = VersionedTransaction.deserialize(Buffer.from(body.tx_base64, 'base64'));
		const [ix] = TransactionMessage.decompile(tx.message).instructions;
		const [agentPda] = getTokenAgentPaymentsPDA(agentMint);
		const keys = ix.keys.map((k) => k.pubkey.toBase58());
		expect(keys).toContain(getAssociatedTokenAddressSync(THREE_MINT, agentPda, true, TOKEN_2022_PROGRAM_ID).toBase58());
		expect(keys).not.toContain(getAssociatedTokenAddressSync(THREE_MINT, agentPda, true, TOKEN_PROGRAM_ID).toBase58());
		expect(keys).toContain(getAssociatedTokenAddressSync(classic, agentPda, true, TOKEN_PROGRAM_ID).toBase58());
		expect(ix.keys.find((k) => k.pubkey.equals(authority)).isSigner).toBe(true);
	});

	it('explains a cluster with no GlobalConfig instead of failing opaquely', async () => {
		const { status, body } = await call({
			mint: agentMint.toBase58(),
			authority_wallet: authority.toBase58(),
			new_buyback_bps: 100,
		});
		expect(status).toBe(502);
		expect(body.error).toBe('payments_config_missing');
	});

	it('answers 503 rpc_unavailable when the RPC is down', async () => {
		state.rpcDown = true;
		try {
			const { status, body } = await call({
				mint: agentMint.toBase58(),
				authority_wallet: authority.toBase58(),
				new_buyback_bps: 100,
			});
			expect(status).toBe(503);
			expect(body.error).toBe('rpc_unavailable');
		} finally {
			state.rpcDown = false;
		}
	});

	it('refuses an authority that does not match the registered one', async () => {
		const { status } = await call({
			mint: agentMint.toBase58(),
			authority_wallet: Keypair.generate().publicKey.toBase58(),
			new_buyback_bps: 100,
		});
		expect(status).toBe(403);
	});
});
