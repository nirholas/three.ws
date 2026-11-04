import { describe, it, expect, jest } from "@jest/globals";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  StakeInstruction,
  StakeProgram,
  SystemInstruction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { stakeSOL, unstakeSOL, getStakeAccounts } from "../../src/actions/stake.js";
import { KeypairWalletProvider } from "../../src/wallet/keypair.js";
import { InvalidInputError } from "../../src/errors.js";

const owner = Keypair.fromSeed(new Uint8Array(32).fill(21));
const vote = Keypair.fromSeed(new Uint8Array(32).fill(22)).publicKey;
const RENT = 2_282_880;
const MIN_DELEGATION = LAMPORTS_PER_SOL;
const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";

/**
 * A real web3.js Connection with its network methods replaced, so the real
 * signing and serialization paths run (including Connection.sendTransaction)
 * while nothing leaves the process.
 */
function offlineConnection() {
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const sentRaw: Buffer[] = [];
  Object.assign(connection, {
    getLatestBlockhash: jest.fn(async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 500 })),
    getMinimumBalanceForRentExemption: jest.fn(async () => RENT),
    getStakeMinimumDelegation: jest.fn(async () => ({ context: { slot: 1 }, value: MIN_DELEGATION })),
    getBlockHeight: jest.fn(async () => 10),
    sendRawTransaction: jest.fn(async (raw: Buffer | Uint8Array | number[]) => {
      sentRaw.push(Buffer.from(raw as Uint8Array));
      return "stakeSig";
    }),
    getSignatureStatuses: jest.fn(async () => ({
      context: { slot: 1 },
      value: [{ slot: 2, confirmations: 1, err: null, confirmationStatus: "confirmed" }],
    })),
    confirmTransaction: jest.fn(async () => ({ context: { slot: 2 }, value: { err: null } })),
  });
  return { connection, sentRaw };
}

const fees = { priorityFee: 1_000, cuLimit: 20_000 };

describe("stakeSOL", () => {
  it("creates and delegates a stake account, signed by both the owner and the new stake account", async () => {
    const { connection, sentRaw } = offlineConnection();
    const wallet = new KeypairWalletProvider(owner.secretKey);

    const result = await stakeSOL(wallet, connection, { amount: 1.5, voteAccount: vote }, fees);

    expect(result.signature).toBe("stakeSig");
    expect(sentRaw).toHaveLength(1);
    const tx = Transaction.from(sentRaw[0]!);
    expect(tx.verifySignatures()).toBe(true);
    const signers = tx.signatures.map((s) => s.publicKey.toBase58());
    expect(signers).toContain(owner.publicKey.toBase58());
    expect(signers).toContain(result.stakeAccount);

    const create = tx.instructions.find((ix) => ix.programId.equals(SystemProgram.programId))!;
    const created = SystemInstruction.decodeCreateAccount(create);
    expect(created.newAccountPubkey.toBase58()).toBe(result.stakeAccount);
    expect(created.lamports).toBe(1.5 * LAMPORTS_PER_SOL + RENT);
    expect(created.space).toBe(StakeProgram.space);

    const stakeIxs = tx.instructions.filter((ix) => ix.programId.equals(StakeProgram.programId));
    expect(stakeIxs.map((ix) => StakeInstruction.decodeInstructionType(ix))).toEqual(["Initialize", "Delegate"]);
    const delegate = StakeInstruction.decodeDelegate(stakeIxs[1]!);
    expect(delegate.votePubkey.equals(vote)).toBe(true);
    expect(delegate.authorizedPubkey.equals(owner.publicKey)).toBe(true);
  });

  it("accepts the vote account as a base58 string", async () => {
    const { connection, sentRaw } = offlineConnection();
    await stakeSOL(new KeypairWalletProvider(owner.secretKey), connection, { amount: 1, voteAccount: vote.toBase58() }, fees);
    const tx = Transaction.from(sentRaw[0]!);
    const delegateIx = tx.instructions.filter((ix) => ix.programId.equals(StakeProgram.programId))[1]!;
    expect(StakeInstruction.decodeDelegate(delegateIx).votePubkey.equals(vote)).toBe(true);
  });

  it("attaches a stake label to a meta-aware wallet", async () => {
    const { connection } = offlineConnection();
    const wallet = Object.assign(new KeypairWalletProvider(owner.secretKey), { setNextMeta: jest.fn() });
    await stakeSOL(wallet, connection, { amount: 2, voteAccount: vote }, fees);
    expect(wallet.setNextMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Stake 2 SOL",
        amountIn: { amount: String(2 * LAMPORTS_PER_SOL + RENT), symbol: "SOL", uiAmount: "2" },
      }),
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects a non-positive or non-finite amount (%p)", async (amount) => {
    const { connection, sentRaw } = offlineConnection();
    const err = await stakeSOL(new KeypairWalletProvider(owner.secretKey), connection, { amount, voteAccount: vote }, fees).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvalidInputError);
    expect((err as InvalidInputError).param).toBe("amount");
    expect(sentRaw).toHaveLength(0);
  });

  it("rejects an amount below the cluster's minimum delegation before sending", async () => {
    const { connection, sentRaw } = offlineConnection();
    const err = await stakeSOL(new KeypairWalletProvider(owner.secretKey), connection, { amount: 0.5, voteAccount: vote }, fees).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvalidInputError);
    expect((err as InvalidInputError).message).toContain("minimum delegation of 1 SOL");
    expect(sentRaw).toHaveLength(0);
  });

  it("still stakes when the RPC does not serve getStakeMinimumDelegation", async () => {
    const { connection, sentRaw } = offlineConnection();
    Object.assign(connection, {
      getStakeMinimumDelegation: jest.fn(async () => {
        throw new Error("Method not found");
      }),
    });
    await stakeSOL(new KeypairWalletProvider(owner.secretKey), connection, { amount: 0.5, voteAccount: vote }, fees);
    expect(sentRaw).toHaveLength(1);
  });
});

describe("unstakeSOL", () => {
  it("builds a deactivate instruction authorized by the wallet", async () => {
    const { connection, sentRaw } = offlineConnection();
    const stakeAccount = Keypair.fromSeed(new Uint8Array(32).fill(23)).publicKey;
    await expect(
      unstakeSOL(new KeypairWalletProvider(owner.secretKey), connection, { stakeAccount: stakeAccount.toBase58() }, fees),
    ).resolves.toBe("stakeSig");
    const tx = Transaction.from(sentRaw[0]!);
    const ix = tx.instructions.find((i) => i.programId.equals(StakeProgram.programId))!;
    expect(StakeInstruction.decodeInstructionType(ix)).toBe("Deactivate");
    const decoded = StakeInstruction.decodeDeactivate(ix);
    expect(decoded.stakePubkey.equals(stakeAccount)).toBe(true);
    expect(decoded.authorizedPubkey.equals(owner.publicKey)).toBe(true);
  });
});

describe("getStakeAccounts", () => {
  const U64_MAX = BigInt("18446744073709551615");

  function stakeData(discriminant: number, opts: { activation?: bigint; deactivation?: bigint } = {}): Buffer {
    const data = Buffer.alloc(StakeProgram.space);
    data.writeUInt32LE(discriminant, 0);
    if (discriminant === 2) {
      vote.toBuffer().copy(data, 124);
      data.writeBigUInt64LE(opts.activation ?? 100n, 164);
      data.writeBigUInt64LE(opts.deactivation ?? U64_MAX, 172);
    }
    return data;
  }

  function account(seed: number, lamports: number, data: Buffer) {
    return { pubkey: Keypair.fromSeed(new Uint8Array(32).fill(seed)).publicKey, account: { lamports, data } };
  }

  it("decodes each stake state and sorts by lamports descending", async () => {
    const getProgramAccounts = jest.fn(async () => [
      account(31, 3, stakeData(1)),
      account(32, 50, stakeData(2)),
      account(33, 20, stakeData(2, { deactivation: 600n })),
      account(34, 10, stakeData(2, { deactivation: 400n })),
      account(35, 99, stakeData(0)),
    ]);
    const connection = {
      getProgramAccounts,
      getEpochInfo: jest.fn(async () => ({ epoch: 500 })),
    } as unknown as Connection;

    const result = await getStakeAccounts(connection, owner.publicKey);

    expect(result.map((r) => [r.lamports, r.state])).toEqual([
      [50, "delegated"],
      [20, "deactivating"],
      [10, "inactive"],
      [3, "initialized"],
    ]);
    expect(result[0]).toMatchObject({ voteAccount: vote.toBase58(), activationEpoch: 100, deactivationEpoch: undefined });
    expect(result[1]!.deactivationEpoch).toBe(600);
    const [, filterOpts] = getProgramAccounts.mock.calls[0]! as unknown as [PublicKey, { filters: unknown[] }];
    expect(filterOpts.filters).toEqual([{ memcmp: { offset: 44, bytes: owner.publicKey.toBase58() } }]);
  });

  it("reports stake deactivated in the current epoch as still deactivating, not withdrawable", async () => {
    // StakeProgram.deactivate sets deactivation_epoch to the epoch it ran in;
    // the stake cools down from there, so it is not inactive until a later epoch.
    const connection = {
      getProgramAccounts: jest.fn(async () => [account(36, 5, stakeData(2, { deactivation: 500n }))]),
      getEpochInfo: jest.fn(async () => ({ epoch: 500 })),
    } as unknown as Connection;
    const [acct] = await getStakeAccounts(connection, owner.publicKey);
    expect(acct!.state).toBe("deactivating");
    expect(acct!.deactivationEpoch).toBe(500);
  });
});
