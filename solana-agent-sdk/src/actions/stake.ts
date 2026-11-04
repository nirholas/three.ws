import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  StakeProgram,
  Authorized,
  Lockup,
} from "@solana/web3.js";
import type { WalletProvider } from "../wallet/types.js";
import { buildAndSend, type BuildAndSendOptions } from "../tx/build.js";
import { InvalidInputError } from "../errors.js";
import { toUiAmount } from "../utils/format.js";

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

/**
 * Create a stake account funded with `amount` SOL (plus its rent-exempt
 * reserve) and delegate it to `voteAccount`, in one transaction co-signed by
 * the new stake account.
 *
 * @throws InvalidInputError("amount") when the amount is not a positive, finite
 *   number or is below the cluster's minimum delegation.
 * @throws RetriesExhaustedError, TransactionFailedError, ConfirmationTimeoutError
 *   from {@link buildAndSend}.
 */
export async function stakeSOL(
  wallet: WalletProvider,
  connection: Connection,
  params: StakeSolParams,
  opts?: BuildAndSendOptions,
): Promise<StakeSolResult> {
  if (typeof params.amount !== "number" || !Number.isFinite(params.amount) || params.amount <= 0) {
    throw new InvalidInputError("amount", `Stake amount must be a positive number of SOL (got ${params.amount})`);
  }
  const lamports = Math.round(params.amount * LAMPORTS_PER_SOL);
  if (lamports < 1) {
    throw new InvalidInputError("amount", `Stake amount ${params.amount} SOL is less than one lamport`);
  }

  const voteAccount =
    typeof params.voteAccount === "string"
      ? new PublicKey(params.voteAccount)
      : params.voteAccount;

  const [rentExempt, minimumDelegation] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(StakeProgram.space),
    fetchMinimumDelegation(connection),
  ]);
  if (minimumDelegation !== null && lamports < minimumDelegation) {
    throw new InvalidInputError(
      "amount",
      `Stake amount ${params.amount} SOL is below the cluster's minimum delegation of ${toUiAmount(String(minimumDelegation), 9)} SOL`,
    );
  }
  const totalLamports = lamports + rentExempt;

  const stakeKp = Keypair.generate();
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

  const signature = await buildAndSend(
    wallet,
    connection,
    [...createAccountTx.instructions, ...delegateTx.instructions],
    {
      ...opts,
      // The stake account must co-sign its own creation on every attempt.
      signers: [...(opts?.signers ?? []), stakeKp],
      meta: opts?.meta ?? {
        label: `Stake ${params.amount} SOL`,
        kind: "custom",
        amountIn: {
          amount: totalLamports.toString(),
          symbol: "SOL",
          uiAmount: params.amount.toString(),
        },
      },
    },
  );
  return { signature, stakeAccount: stakeKp.publicKey.toBase58() };
}

/**
 * The cluster's minimum stake delegation in lamports, or null when the RPC does
 * not serve getStakeMinimumDelegation (older nodes and some providers). The
 * stake program still enforces the minimum on-chain; this only fails fast.
 */
async function fetchMinimumDelegation(connection: Connection): Promise<number | null> {
  try {
    const { value } = await connection.getStakeMinimumDelegation();
    return value;
  } catch {
    return null;
  }
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
        } else if (deactivationEpoch >= currentEpoch) {
          // Deactivation takes effect at the end of deactivation_epoch, so the
          // stake is still cooling down (not withdrawable) during that epoch.
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
