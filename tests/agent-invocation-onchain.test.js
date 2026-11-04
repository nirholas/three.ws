import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';

import {
	AGENT_INVOCATION_PROGRAM_ID,
	MAX_PARAMETERS_LEN,
	buildInvokeSkillIx,
	defaultNetwork,
	deriveAgentPda,
	isProgramDeployed,
	recordInvocationReceipt,
	resetDeployedCache,
} from '../api/_lib/agent-invocation-onchain.js';

const AUTH_A = new PublicKey('11111111111111111111111111111112');
const AUTH_B = new PublicKey('SysvarC1ock11111111111111111111111111111111');

function fakeConn(info, calls = { n: 0 }) {
	return {
		calls,
		async getAccountInfo() {
			calls.n += 1;
			if (info instanceof Error) throw info;
			return info;
		},
	};
}

describe('agent-invocation-onchain', () => {
	const saved = process.env.AGENT_INVOCATION_NETWORK;
	beforeEach(() => {
		resetDeployedCache();
		delete process.env.AGENT_INVOCATION_NETWORK;
	});
	afterEach(() => {
		if (saved === undefined) delete process.env.AGENT_INVOCATION_NETWORK;
		else process.env.AGENT_INVOCATION_NETWORK = saved;
	});

	it('derives the agent PDA from seeds ["agent", authority]', () => {
		const expected = PublicKey.findProgramAddressSync(
			[Buffer.from('agent'), AUTH_A.toBuffer()],
			new PublicKey(AGENT_INVOCATION_PROGRAM_ID),
		)[0];
		expect(deriveAgentPda(AUTH_A)[0].toBase58()).toBe(expected.toBase58());
		expect(deriveAgentPda(AUTH_A)[0].toBase58()).not.toBe(deriveAgentPda(AUTH_B)[0].toBase58());
	});

	it('builds invoke_skill with the anchor discriminator and borsh strings', () => {
		const invoker = Keypair.generate().publicKey;
		const { instruction, invokerAgent, targetAgent } = buildInvokeSkillIx({
			invokerAuthority: invoker,
			targetAuthority: AUTH_A,
			skillName: 'greet',
			parameters: '{"a":1}',
		});
		const disc = createHash('sha256').update('global:invoke_skill').digest().subarray(0, 8);
		expect(Buffer.from(instruction.data.subarray(0, 8)).equals(disc)).toBe(true);
		expect(instruction.data.readUInt32LE(8)).toBe(5);
		expect(instruction.data.subarray(12, 17).toString()).toBe('greet');
		expect(instruction.programId.toBase58()).toBe(AGENT_INVOCATION_PROGRAM_ID);
		expect(invokerAgent).toBe(deriveAgentPda(invoker)[0].toBase58());
		expect(targetAgent).toBe(deriveAgentPda(AUTH_A)[0].toBase58());
	});

	it('defaults to devnet and only switches to mainnet when asked', () => {
		expect(defaultNetwork()).toBe('devnet');
		process.env.AGENT_INVOCATION_NETWORK = 'mainnet';
		expect(defaultNetwork()).toBe('mainnet');
		process.env.AGENT_INVOCATION_NETWORK = 'bogus';
		expect(defaultNetwork()).toBe('devnet');
	});

	it('probe: executable account is deployed, missing or non-executable is not', async () => {
		expect(await isProgramDeployed('devnet', AGENT_INVOCATION_PROGRAM_ID, fakeConn({ executable: true }))).toBe(true);
		resetDeployedCache();
		expect(await isProgramDeployed('devnet', AGENT_INVOCATION_PROGRAM_ID, fakeConn(null))).toBe(false);
		resetDeployedCache();
		expect(await isProgramDeployed('devnet', AGENT_INVOCATION_PROGRAM_ID, fakeConn({ executable: false }))).toBe(false);
	});

	it('probe caches results and does not cache RPC failures', async () => {
		const calls = { n: 0 };
		const conn = fakeConn({ executable: true }, calls);
		await isProgramDeployed('devnet', AGENT_INVOCATION_PROGRAM_ID, conn);
		await isProgramDeployed('devnet', AGENT_INVOCATION_PROGRAM_ID, conn);
		expect(calls.n).toBe(1);
		resetDeployedCache();
		const bad = fakeConn(new Error('rpc down'));
		await expect(isProgramDeployed('devnet', AGENT_INVOCATION_PROGRAM_ID, bad)).rejects.toThrow('rpc down');
		await expect(isProgramDeployed('devnet', AGENT_INVOCATION_PROGRAM_ID, bad)).rejects.toThrow('rpc down');
		expect(bad.calls.n).toBe(2);
	});

	it('recordInvocationReceipt reports program_not_deployed instead of a raw cluster error', async () => {
		await expect(
			recordInvocationReceipt({
				invokerKeypair: Keypair.generate(),
				targetAuthority: AUTH_A,
				skillName: 'greet',
				connection: fakeConn(null),
			}),
		).rejects.toMatchObject({ code: 'program_not_deployed', status: 503 });
	});

	it('exposes the parameter limit the program enforces', () => {
		expect(MAX_PARAMETERS_LEN).toBe(512);
	});
});
