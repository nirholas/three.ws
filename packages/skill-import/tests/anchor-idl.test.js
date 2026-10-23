// Anchor IDL -> skill bundle, using this repo's own program IDLs. Account
// bytes are produced by @coral-xyz/anchor's coders, an independent Borsh
// implementation, so the generated codec is checked against the reference
// rather than against itself.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { BorshAccountsCoder, BorshInstructionCoder } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import BN from 'bn.js';

import { generateAnchorBundle, analyzeInstructionRisk, normalizeIdl, fetchOnchainIdl, AnchorIdlError } from '../src/anchor-idl.js';
import { validateBundle } from '../src/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const idlPath = (n) => resolve(__dirname, `../../../contracts/idl/${n}.json`);
const LICENSE_IDL = JSON.parse(readFileSync(idlPath('skill_license'), 'utf8'));
const INVOKE_IDL = JSON.parse(readFileSync(idlPath('agent_invocation'), 'utf8'));
const PROGRAM = LICENSE_IDL.address;

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function load(bundle) {
	const url = `data:text/javascript;base64,${Buffer.from(bundle.handlersSrc).toString('base64')}`;
	return import(url);
}

function makeCtx(accounts, extra = {}) {
	const calls = [];
	return {
		calls,
		fetch: async (url, init) => {
			const req = JSON.parse(init.body);
			calls.push({ url, req });
			const found = accounts[req.params[0]];
			const body = { jsonrpc: '2.0', id: 1, result: { value: found ? { owner: found.owner, lamports: 1_461_600, data: [b64(found.data), 'base64'] } : null } };
			return { ok: true, status: 200, text: async () => JSON.stringify(body) };
		},
		...extra,
	};
}

describe('skill_license bundle', () => {
	let bundle;
	let mod;
	beforeAll(async () => {
		bundle = generateAnchorBundle(LICENSE_IDL, { sourceUrl: 'file:contracts/idl/skill_license.json' });
		mod = await load(bundle);
	});

	it('passes the bundle validator', () => {
		expect(validateBundle(bundle, { allowAddresses: [PROGRAM] })).toEqual([]);
	});

	it('exposes a read tool per account, preview and send tool per instruction', () => {
		const names = bundle.tools.tools.map((t) => t.name);
		expect(names).toContain('read_marketplace');
		expect(names).toContain('read_skill_license');
		for (const ix of LICENSE_IDL.instructions) {
			expect(names).toContain(`preview_${ix.name}`);
			expect(names).toContain(`send_${ix.name}`);
		}
		expect(bundle.manifest.provides.tools).toEqual(names);
	});

	it('marks send tools destructive and read/preview tools read-only', () => {
		for (const t of bundle.tools.tools) {
			const write = t.name.startsWith('send_');
			expect(t.annotations.destructiveHint).toBe(write);
			expect(t.annotations.readOnlyHint).toBe(!write);
		}
	});

	it('decodes a Marketplace account identically to the Anchor coder', async () => {
		const coder = new BorshAccountsCoder(LICENSE_IDL);
		const authority = Keypair.generate().publicKey;
		const minter = Keypair.generate().publicKey;
		const data = await coder.encode('Marketplace', {
			authority,
			minter,
			licenses_minted: new BN('18446744073709551615'),
			bump: 254,
		});
		const address = Keypair.generate().publicKey.toBase58();
		const out = await mod.read_marketplace({ address, cluster: 'devnet' }, makeCtx({ [address]: { owner: PROGRAM, data } }));
		expect(out.data).toEqual({
			authority: authority.toBase58(),
			minter: minter.toBase58(),
			licenses_minted: '18446744073709551615',
			bump: 254,
		});
		expect(out.program_id).toBe(PROGRAM);
	});

	it('decodes a SkillLicense with signed ints, a fixed array and a string', async () => {
		const coder = new BorshAccountsCoder(LICENSE_IDL);
		const authority = Keypair.generate().publicKey;
		const agentMint = Keypair.generate().publicKey;
		const nftMint = Keypair.generate().publicKey;
		const hash = Array.from({ length: 32 }, (_, i) => i);
		const data = await coder.encode('SkillLicense', {
			authority,
			agent_mint: agentMint,
			nft_mint: nftMint,
			skill_hash: hash,
			purchase_date: new BN(1_700_000_000),
			revoked_at: new BN(-5),
			bump: 3,
			skill_name: 'pump-fun-trading',
		});
		const address = Keypair.generate().publicKey.toBase58();
		const out = await mod.read_skill_license({ address }, makeCtx({ [address]: { owner: PROGRAM, data } }));
		expect(out.data.skill_name).toBe('pump-fun-trading');
		expect(out.data.revoked_at).toBe('-5');
		expect(out.data.purchase_date).toBe('1700000000');
		expect(out.data.skill_hash).toBe(Buffer.from(hash).toString('hex'));
	});

	it('refuses an account owned by another program or of another type', async () => {
		const coder = new BorshAccountsCoder(LICENSE_IDL);
		const k = () => Keypair.generate().publicKey;
		const data = await coder.encode('Marketplace', { authority: k(), minter: k(), licenses_minted: new BN(1), bump: 1 });
		const a = k().toBase58();
		const b = k().toBase58();
		await expect(mod.read_marketplace({ address: a }, makeCtx({ [a]: { owner: k().toBase58(), data } }))).rejects.toThrow(/owned by/);
		await expect(mod.read_skill_license({ address: b }, makeCtx({ [b]: { owner: PROGRAM, data } }))).rejects.toThrow(/is a Marketplace/);
		await expect(mod.read_marketplace({ address: k().toBase58() }, makeCtx({}))).rejects.toThrow(/does not exist/);
		await expect(mod.read_marketplace({ address: 'nope' }, makeCtx({}))).rejects.toThrow();
	});

	it('builds the same instruction bytes as the Anchor coder and never signs', async () => {
		const ixCoder = new BorshInstructionCoder(LICENSE_IDL);
		const keys = Object.fromEntries(
			['minter', 'owner', 'agent_mint', 'skill_license', 'nft_mint', 'owner_token_account'].map((n) => [n, Keypair.generate().publicKey.toBase58()])
		);
		const marketplace = PublicKey.findProgramAddressSync([Buffer.from('marketplace')], new PublicKey(PROGRAM))[0].toBase58();
		const signerSpy = { signTransaction: 0, signMessage: 0, sendTransaction: 0 };
		const ctx = makeCtx(
			{},
			{
				wallet: {
					signTransaction: () => (signerSpy.signTransaction += 1),
					signMessage: () => (signerSpy.signMessage += 1),
					sendTransaction: () => (signerSpy.sendTransaction += 1),
				},
				secrets: new Proxy({}, { get: () => { throw new Error('preview must not read secrets'); } }),
			}
		);
		const input = { accounts: { marketplace, ...keys }, args: { skill_name: 'pump-fun-trading' } };
		const out = await mod.preview_mint_skill_license(input, ctx);

		expect(out.data_hex).toBe(ixCoder.encode('mint_skill_license', { skill_name: 'pump-fun-trading' }).toString('hex'));
		expect(out.signed).toBe(false);
		expect(out.accounts.find((a) => a.name === 'minter')).toMatchObject({ isSigner: true, isWritable: true });
		expect(out.accounts.find((a) => a.name === 'system_program').pubkey).toBe('11111111111111111111111111111111');
		expect(out.risk.flags.map((f) => f.code)).toContain('moves_tokens');
		expect(out.summary).toContain('pump-fun-trading');
		expect(ctx.calls).toHaveLength(0);
		expect(signerSpy).toEqual({ signTransaction: 0, signMessage: 0, sendTransaction: 0 });

		const sent = await mod.send_mint_skill_license(input, ctx);
		expect(sent.status).toBe('confirmation_required');
		expect(sent.signed).toBe(false);
		expect(sent.data_hex).toBe(out.data_hex);
		expect(signerSpy).toEqual({ signTransaction: 0, signMessage: 0, sendTransaction: 0 });
	});

	it('rejects missing accounts, bad addresses and out-of-range args with a clear message', async () => {
		await expect(mod.preview_set_minter({ accounts: {}, args: { new_minter: 'x' } })).rejects.toThrow(/accounts\./);
		const a = Keypair.generate().publicKey.toBase58();
		await expect(mod.preview_set_minter({ accounts: { marketplace: a, authority: a }, args: { new_minter: 'not-a-key' } })).rejects.toThrow(/new_minter/);
	});

	it('flags authority changes and account closure in the risk panel', () => {
		expect(bundle.manifest.risk.set_minter.level).toBe('high');
		expect(bundle.manifest.risk.set_minter.flags.map((f) => f.code)).toContain('changes_authority');
		expect(bundle.manifest.risk.burn_skill_license.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['moves_tokens', 'closes_accounts']));
		expect(bundle.skillMd).toContain('## Risk panel');
		expect(bundle.skillMd).toMatch(/\| `set_minter` \| high \|/);
	});
});

describe('agent_invocation bundle', () => {
	it('generates a valid bundle for an IDL with no accounts section', () => {
		const bundle = generateAnchorBundle(INVOKE_IDL);
		expect(validateBundle(bundle, { allowAddresses: [INVOKE_IDL.address] })).toEqual([]);
		expect(bundle.tools.tools.map((t) => t.name)).toEqual(['preview_invoke_skill', 'send_invoke_skill']);
	});
});

describe('legacy IDL and on-chain fetch', () => {
	it('normalizes a pre-0.30 IDL and computes discriminators like Anchor', () => {
		const idl = normalizeIdl({
			version: '0.1.0',
			name: 'legacy_demo',
			instructions: [{ name: 'doThing', accounts: [{ name: 'payer', isMut: true, isSigner: true }], args: [{ name: 'who', type: 'publicKey' }] }],
			accounts: [{ name: 'Thing', type: { kind: 'struct', fields: [{ name: 'owner', type: 'publicKey' }] } }],
			metadata: { address: PROGRAM },
		});
		expect(idl.instructions[0].name).toBe('do_thing');
		expect(idl.instructions[0].accounts[0]).toEqual({ name: 'payer', writable: true, signer: true });
		const coder = new BorshInstructionCoder({ ...LICENSE_IDL, instructions: [{ name: 'do_thing', discriminator: idl.instructions[0].discriminator, accounts: [], args: [] }] });
		expect(Buffer.from(coder.encode('do_thing', {})).subarray(0, 8)).toEqual(Buffer.from(idl.instructions[0].discriminator));
		expect(idl.accounts[0].discriminator).toHaveLength(8);
	});

	it('rejects a document that is not an IDL', () => {
		expect(() => generateAnchorBundle({ openapi: '3.0.0' })).toThrow(AnchorIdlError);
	});

	it('inflates the IDL Anchor stores at the program IDL account', async () => {
		const program = new PublicKey(PROGRAM);
		const [base] = PublicKey.findProgramAddressSync([], program);
		const idlAddress = (await PublicKey.createWithSeed(base, 'anchor:idl', program)).toBase58();
		const payload = deflateSync(Buffer.from(JSON.stringify(LICENSE_IDL)));
		const header = Buffer.alloc(44);
		header.writeUInt32LE(payload.length, 40);
		const data = Buffer.concat([header, payload]);
		const rpc = async (method, params) => {
			expect(method).toBe('getAccountInfo');
			return { value: params[0] === idlAddress ? { data: [data.toString('base64'), 'base64'] } : null };
		};
		expect(await fetchOnchainIdl(PROGRAM, { rpc })).toEqual(LICENSE_IDL);
		await expect(fetchOnchainIdl(Keypair.generate().publicKey.toBase58(), { rpc })).rejects.toThrow(/no on-chain IDL/);
	});

	it('analyzes risk from instruction shape alone', () => {
		const risk = analyzeInstructionRisk({ name: 'ping', accounts: [{ name: 'caller', signer: true }], args: [] });
		expect(risk).toEqual({ level: 'low', flags: [] });
	});
});
