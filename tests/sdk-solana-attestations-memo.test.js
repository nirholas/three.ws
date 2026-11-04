// The SDK's wallet-signed attestations (sdk/src/solana-attestations.js) must be
// accepted by SPL Memo v2 and stay discoverable by agent address.
//
// The memo instruction used to list the agent asset as its only account, as a
// non-signer. SPL Memo v2 requires every account passed to it to sign, so every
// feedback, validation, task, accept, revoke and dispute a user submitted
// through the SDK failed with MissingRequiredSignature. The fake wallet below
// applies the program's real rule before "sending".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const user = Keypair.generate();
const agentAsset = Keypair.generate().publicKey.toBase58();
const sent = [];

vi.mock('@solana/web3.js', async (orig) => {
	const real = await orig();
	class Connection {
		async getLatestBlockhash() {
			return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 };
		}
		async confirmTransaction() {
			return { value: { err: null } };
		}
	}
	return { ...real, Connection };
});

vi.mock('../sdk/src/solana.js', () => ({
	detectSolanaProvider: () => ({
		publicKey: user.publicKey,
		connect: async () => ({ publicKey: user.publicKey }),
		signAndSendTransaction: async (tx) => {
			const signers = new Set([tx.feePayer.toBase58()]);
			for (const ix of tx.instructions) {
				if (ix.programId.toBase58() !== MEMO) continue;
				for (const k of ix.keys) {
					if (!k.isSigner || !signers.has(k.pubkey.toBase58())) {
						throw new Error('Simulation failed: missing required signature for instruction');
					}
				}
			}
			sent.push(tx);
			return { signature: `sig${sent.length}` };
		},
	}),
}));

const sdk = await import('../sdk/src/solana-attestations.js');

beforeEach(() => {
	sent.length = 0;
});

function expectIndexedByAgent() {
	const tx = sent.at(-1);
	expect(tx).toBeTruthy();
	expect(tx.instructions.some((ix) => ix.programId.toBase58() === MEMO)).toBe(true);
	expect(tx.compileMessage().accountKeys.map((k) => k.toBase58())).toContain(agentAsset);
}

describe('SDK attestation memos satisfy SPL Memo v2', () => {
	it('feedback lands and is indexed under the agent', async () => {
		const out = await sdk.attestFeedback({ agentAsset, score: 5 });
		expect(out.signature).toBe('sig1');
		expectIndexedByAgent();
	});

	it('task creation lands and is indexed under the agent', async () => {
		const out = await sdk.createTask({ agentAsset, taskId: 'job-1', scopeHash: 'ab'.repeat(32) });
		expect(out.signature).toBe('sig1');
		expectIndexedByAgent();
	});
});
