/**
 * Static safety check for a Jupiter swap transaction.
 *
 * Jupiter returns a fully-built (and potentially MITM-able) VersionedTransaction.
 * Before signing, we decompile it and assert it matches the quote we displayed:
 *   - it spends no more than `quote.inAmount` of the input from the wallet, and
 *   - it credits the output mint to an account owned by the wallet.
 *
 * This is a deterministic, offline check: no RPC trust beyond resolving the
 * address-lookup tables the transaction itself references.
 */
import {
  PublicKey,
  SystemProgram,
  SystemInstruction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  decodeTransferInstruction,
  decodeTransferCheckedInstruction,
  TokenInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SwapError } from "../errors.js";

const NATIVE_MINT = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()];

export interface SwapGuardParams {
  inputMint: string;
  outputMint: string;
  /** Maximum input the user agreed to spend (quote.inAmount, base units). */
  maxInAmount: bigint;
  /** The wallet that must own the spent input and receive the output. */
  owner: PublicKey;
}

/**
 * Validate a Jupiter swap `VersionedTransaction` against the quoted intent.
 * Throws {@link SwapError} on any mismatch. Returns silently when safe.
 */
export async function assertSwapMatchesQuote(
  connection: Connection,
  tx: VersionedTransaction,
  params: SwapGuardParams,
): Promise<void> {
  const lookupTables = await resolveLookupTables(connection, tx, params);

  let instructions: TransactionInstruction[];
  try {
    instructions = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: lookupTables,
    }).instructions;
  } catch (err) {
    throw new SwapError(
      `Unable to decode swap transaction for validation: ${(err as Error).message}`,
      params.inputMint,
      params.outputMint,
    );
  }

  const ownerAtas = atasForOwner(params.owner, [params.inputMint, params.outputMint]);
  const inputAtas = ownerAtas.get(params.inputMint) ?? new Set<string>();
  const outputAtas = ownerAtas.get(params.outputMint) ?? new Set<string>();

  let spentFromWallet = 0n;
  let creditedToWallet = false;

  for (const ix of instructions) {
    const programId = ix.programId.toBase58();

    // Native SOL inputs are wrapped via a SystemProgram transfer out of the
    // wallet into a temporary WSOL account; count those lamports as input spend.
    if (params.inputMint === NATIVE_MINT && programId === SystemProgram.programId.toBase58()) {
      const lamports = decodeSystemTransferFromOwner(ix, params.owner);
      if (lamports !== null) spentFromWallet += lamports;
      continue;
    }

    if (!TOKEN_PROGRAM_IDS.includes(programId)) continue;

    const decoded = decodeTokenTransfer(ix);
    if (!decoded) continue;

    // Input spend: a transfer authorized by the wallet out of its input ATA.
    if (
      decoded.owner.equals(params.owner) &&
      inputAtas.has(decoded.source.toBase58())
    ) {
      spentFromWallet += decoded.amount;
    }

    // Output credit: a transfer landing in the wallet's output ATA.
    if (outputAtas.has(decoded.destination.toBase58())) {
      creditedToWallet = true;
    }
  }

  if (spentFromWallet > params.maxInAmount) {
    throw new SwapError(
      `Swap transaction spends ${spentFromWallet} of ${params.inputMint} but quote authorized at most ${params.maxInAmount}`,
      params.inputMint,
      params.outputMint,
    );
  }

  if (!creditedToWallet) {
    throw new SwapError(
      `Swap transaction does not credit ${params.outputMint} to the wallet`,
      params.inputMint,
      params.outputMint,
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveLookupTables(
  connection: Connection,
  tx: VersionedTransaction,
  params: SwapGuardParams,
): Promise<AddressLookupTableAccount[]> {
  const lookups =
    "addressTableLookups" in tx.message ? tx.message.addressTableLookups : [];
  if (!lookups.length) return [];

  const accounts = await Promise.all(
    lookups.map((l) => connection.getAddressLookupTable(l.accountKey)),
  );
  const resolved: AddressLookupTableAccount[] = [];
  for (const res of accounts) {
    if (!res.value) {
      throw new SwapError(
        "Swap transaction references an unresolvable address lookup table",
        params.inputMint,
        params.outputMint,
      );
    }
    resolved.push(res.value);
  }
  return resolved;
}

/** All ATAs the owner could legitimately hold for the given mints (classic + token-2022). */
function atasForOwner(owner: PublicKey, mints: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const mint of mints) {
    const mintPk = new PublicKey(mint);
    const set = new Set<string>();
    for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      set.add(
        getAssociatedTokenAddressSync(
          mintPk,
          owner,
          false,
          programId,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ).toBase58(),
      );
    }
    map.set(mint, set);
  }
  return map;
}

interface DecodedTokenTransfer {
  source: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  amount: bigint;
}

function decodeTokenTransfer(ix: TransactionInstruction): DecodedTokenTransfer | null {
  const opcode = ix.data[0];
  try {
    if (opcode === TokenInstruction.TransferChecked) {
      const d = decodeTransferCheckedInstruction(ix, ix.programId);
      return {
        source: d.keys.source.pubkey,
        destination: d.keys.destination.pubkey,
        owner: d.keys.owner.pubkey,
        amount: d.data.amount,
      };
    }
    if (opcode === TokenInstruction.Transfer) {
      const d = decodeTransferInstruction(ix, ix.programId);
      return {
        source: d.keys.source.pubkey,
        destination: d.keys.destination.pubkey,
        owner: d.keys.owner.pubkey,
        amount: d.data.amount,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/** Returns lamports if this is a SystemProgram transfer FROM owner, else null. */
function decodeSystemTransferFromOwner(
  ix: TransactionInstruction,
  owner: PublicKey,
): bigint | null {
  if (!ix.programId.equals(SystemProgram.programId)) return null;
  // SystemProgram.transfer opcode is 2 (little-endian u32 at offset 0).
  if (ix.data.length < 4 || ix.data.readUInt32LE(0) !== 2) return null;
  try {
    const decoded = SystemInstruction.decodeTransfer(ix);
    if (!decoded.fromPubkey.equals(owner)) return null;
    return BigInt(decoded.lamports.toString());
  } catch {
    return null;
  }
}
