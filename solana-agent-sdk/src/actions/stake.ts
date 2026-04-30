import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  StakeProgram,
  Authorized,
  Lockup,
  Transaction,
} from "@solana/web3.js";
import { isMetaAware, type WalletProvider } from "../wallet/types.js";
import {
  estimatePriorityFee,
  estimateComputeUnits,
  priorityFeeIx,
  computeUnitIx,
} from "../tx/fees.js";
import { buildAndSend, type BuildAndSendOptions } from "../tx/build.js";

const U64_MAX = BigInt("18446744073709551615");

export interface StakeSolParams {
  /** Amount of SOL to stake (not lamports) */
  amount: number;
  /** Validator vote account address */
  voteAccount: PublicKey | string;
}

export interface StakeSolResult {
  signature: string;
  /** The new stake account address */
  stakeAccount: string;
}

export async function stakeSOL(
  wallet: WalletProvider,
  connection: Connection,
  params: StakeSolParams,
  opts?: BuildAndSendOptions,
): Promise<StakeSolResult> {
  const voteAccount =
    typeof params.voteAccount === "string"
      ? new PublicKey(params.voteAccount)
      : params.voteAccount;

  const stakeKp = Keypair.generate();
  const lamports = Math.round(params.amount * LAMPORTS_PER_SOL);
  const rentExempt = await connection.getMinimumBalanceForRentExemption(StakeProgram.space);
  const totalLamports = lamports + rentExempt;

  const createAccountTx = StakeProgram.createAccount({
    fromPubkey: wallet.publicKey,
    stakePubkey: stakeKp.publicKey,
    authorized: new Authorized(wallet.publicKey, wallet.publicKey),
    lockup: new Lockup(0, 0, wallet.publicKey),
    lamports: totalLamports,
  });

  const delegateTx = StakeProgram.delegate({
    stakePubkey: stakeKp.publicKey,
    authorizedPubkey: wallet.publicKey,
    votePubkey: voteAccount,
  });

  const allInstructions = [
    ...createAccountTx.instructions,
    ...delegateTx.instructions,
  ];

  if (isMetaAware(wallet)) {
    wallet.setNextMeta({
      label: `Stake ${params.amount} SOL`,
      kind: "custom",
      amountIn: {
        amount: totalLamports.toString(),
        symbol: "SOL",
        uiAmount: params.amount.toString(),
      },
    });
  }

  const [fee, cuLimit] = await Promise.all([
    opts?.priorityFee !== undefined
      ? Promise.resolve(opts.priorityFee)
      : estimatePriorityFee(connection),
    opts?.cuLimit !== undefined
      ? Promise.resolve(opts.cuLimit)
      : estimateComputeUnits(connection, allInstructions, wallet.publicKey),
  ]);

  const budgetIxs = [priorityFeeIx(fee), computeUnitIx(cuLimit)];
  const maxRetries = opts?.maxRetries ?? 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = wallet.publicKey;
    tx.add(...budgetIxs, ...allInstructions);

    // Stake account must co-sign its own creation
    tx.partialSign(stakeKp);

    try {
      const signature = await wallet.signAndSendTransaction(tx, connection);
      return { signature, stakeAccount: stakeKp.publicKey.toBase58() };
    } catch (err) {
      const isExpired =
        err instanceof Error &&
        (err.message.includes("Blockhash not found") ||
          err.message.includes("block height exceeded"));

      if (!isExpired || attempt === maxRetries - 1) throw err;

      const slot = await connection.getSlot();
      if (slot > lastValidBlockHeight) continue;
      throw err;
    }
  }

  throw new Error("stakeSOL: exhausted retries");
}

export interface UnstakeSolParams {
  /** Stake account address to deactivate */
  stakeAccount: PublicKey | string;
}

/** Deactivate a stake account. SOL is withdrawable after ~1 epoch (2-3 days). */
export async function unstakeSOL(
  wallet: WalletProvider,
  connection: Connection,
  params: UnstakeSolParams,
  opts?: BuildAndSendOptions,
): Promise<string> {
  const stakeAccount =
    typeof params.stakeAccount === "string"
      ? new PublicKey(params.stakeAccount)
      : params.stakeAccount;

  const deactivateTx = StakeProgram.deactivate({
    stakePubkey: stakeAccount,
    authorizedPubkey: wallet.publicKey,
  });

  const short =
    stakeAccount.toBase58().slice(0, 4) + "…" + stakeAccount.toBase58().slice(-4);

  return buildAndSend(wallet, connection, deactivateTx.instructions, {
    ...opts,
    meta: opts?.meta ?? {
      label: "Deactivate Stake",
      description: `Deactivate stake account ${short}`,
      kind: "custom",
    },
  });
}

export interface StakeAccountInfo {
  address: string;
  lamports: number;
  state: "initialized" | "delegated" | "deactivating" | "inactive";
  voteAccount?: string;
  activationEpoch?: number;
  deactivationEpoch?: number;
}

export async function getStakeAccounts(
  connection: Connection,
  owner: PublicKey,
): Promise<StakeAccountInfo[]> {
  const [accounts, epochInfo] = await Promise.all([
    connection.getProgramAccounts(StakeProgram.programId, {
      filters: [{ memcmp: { offset: 44, bytes: owner.toBase58() } }],
    }),
    connection.getEpochInfo(),
  ]);

  const currentEpoch = BigInt(epochInfo.epoch);

  const results: StakeAccountInfo[] = accounts
    .flatMap(({ pubkey, account }) => {
      const data = account.data as Buffer;
      const discriminant = data.readUInt32LE(0);

      if (discriminant === 1) {
        return [
          {
            address: pubkey.toBase58(),
            lamports: account.lamports,
            state: "initialized" as StakeAccountInfo["state"],
          },
        ];
      }

      if (discriminant === 2) {
        const voteAccount = new PublicKey(data.slice(124, 156)).toBase58();
        const activationEpoch = data.readBigUInt64LE(164);
        const deactivationEpoch = data.readBigUInt64LE(172);

        let state: StakeAccountInfo["state"];
        if (deactivationEpoch === U64_MAX) {
          state = "delegated";
        } else if (deactivationEpoch > currentEpoch) {
          state = "deactivating";
        } else {
          state = "inactive";
        }

        return [
          {
            address: pubkey.toBase58(),
            lamports: account.lamports,
            state,
            voteAccount,
            activationEpoch: Number(activationEpoch),
            deactivationEpoch:
              deactivationEpoch === U64_MAX ? undefined : Number(deactivationEpoch),
          },
        ];
      }

      return [];
    });

  return results.sort((a, b) => b.lamports - a.lamports);
}
