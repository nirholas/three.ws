// ExactFacilitator verifies an x402 "exact" payment against the chain: the
// issued single-use nonce memo, the cluster, and a TransferChecked of the exact
// amount into the payee's token account. settle() consumes it exactly once.

import { jest, describe, it, expect } from "@jest/globals";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ExactFacilitator } from "../../src/x402-exact/facilitator.js";
import {
  SOLANA_DEVNET,
  SOLANA_MAINNET,
  SOLANA_MAINNET_GENESIS,
  x402NonceMemo,
  type ExactPaymentRequirements,
} from "../../src/x402-exact/types.js";
import { MEMO_PROGRAM_ID } from "../../src/utils/memo.js";

const THREE_MINT = new PublicKey("FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump");
const CLASSIC_MINT = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
const PAYER = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const PAYEE = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const PDA_PAYEE = PublicKey.findProgramAddressSync([Buffer.from("x402-vault")], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
const SIG = "paidSignature111";

const ata = (mint: PublicKey, owner: PublicKey, program: PublicKey) =>
  getAssociatedTokenAddressSync(mint, owner, true, program, ASSOCIATED_TOKEN_PROGRAM_ID).toBase58();

interface TxShape {
  program?: PublicKey;
  mint?: PublicKey;
  payTo?: PublicKey;
  destination?: string;
  amount?: string;
  memo?: string | null;
  err?: unknown;
  inner?: boolean;
}

function parsedTx(nonce: string, shape: TxShape = {}) {
  const program = shape.program ?? TOKEN_PROGRAM_ID;
  const mint = shape.mint ?? CLASSIC_MINT;
  const payTo = shape.payTo ?? PAYEE;
  const transfer = {
    program: program.equals(TOKEN_2022_PROGRAM_ID) ? "spl-token-2022" : "spl-token",
    programId: program,
    parsed: {
      type: "transferChecked",
      info: {
        source: ata(mint, PAYER, program),
        destination: shape.destination ?? ata(mint, payTo, program),
        mint: mint.toBase58(),
        authority: PAYER.toBase58(),
        tokenAmount: { amount: shape.amount ?? "2500000", decimals: 6 },
      },
    },
  };
  const memo = { program: "spl-memo", programId: MEMO_PROGRAM_ID, parsed: shape.memo === undefined ? x402NonceMemo(nonce) : shape.memo };
  const top = shape.memo === null ? [] : [memo];
  return {
    meta: {
      err: shape.err ?? null,
      innerInstructions: shape.inner ? [{ index: 0, instructions: [transfer] }] : [],
    },
    transaction: { message: { instructions: shape.inner ? top : [transfer, ...top] } },
  };
}

function facilitatorWith(chain: { tx: unknown }, genesis = SOLANA_MAINNET_GENESIS) {
  const f = new ExactFacilitator("http://127.0.0.1:8899");
  const connection = {
    getGenesisHash: jest.fn(async () => genesis),
    getParsedTransaction: jest.fn(async () => chain.tx),
    getSignatureStatus: jest.fn(async () => ({ value: { confirmationStatus: "confirmed", err: null } })),
  };
  Object.defineProperty(f, "connection", { value: connection as unknown as Connection });
  return f;
}

async function issued(f: ExactFacilitator, mint: PublicKey, payTo: PublicKey): Promise<ExactPaymentRequirements> {
  const c = await f.issueChallenge({ resource: "/api/x", asset: mint.toBase58(), amount: "2500000", payTo: payTo.toBase58() });
  return {
    scheme: "exact",
    network: SOLANA_MAINNET,
    asset: c.asset,
    amount: c.amount,
    payTo: c.payTo,
    maxTimeoutSeconds: 5,
    resource: c.resource,
    extra: { nonce: c.nonce },
  };
}

/** Build a facilitator whose chain holds a tx paying the challenge it issues. */
async function scenario(shape: TxShape = {}, genesis?: string) {
  // The on-chain tx has to embed the nonce the facilitator issues, so it is
  // filled in after the challenge and read lazily by getParsedTransaction.
  const chain: { tx: unknown } = { tx: null };
  const f = facilitatorWith(chain, genesis);
  const req = await issued(f, shape.mint ?? CLASSIC_MINT, shape.payTo ?? PAYEE);
  chain.tx = parsedTx(req.extra!.nonce!, shape);
  return { f, req, proof: { signature: SIG, network: SOLANA_MAINNET } };
}

describe("ExactFacilitator.verify", () => {
  it("accepts a classic SPL payment of the exact amount to the payee", async () => {
    const { f, req, proof } = await scenario();
    await expect(f.verify(proof, req)).resolves.toEqual({ isValid: true, payer: PAYER.toBase58() });
  });

  it("accepts a Token-2022 payment such as $THREE", async () => {
    const { f, req, proof } = await scenario({ program: TOKEN_2022_PROGRAM_ID, mint: THREE_MINT });
    await expect(f.verify(proof, req)).resolves.toEqual({ isValid: true, payer: PAYER.toBase58() });
  });

  it("accepts a payment into a program-derived payee vault", async () => {
    const { f, req, proof } = await scenario({ payTo: PDA_PAYEE });
    await expect(f.verify(proof, req)).resolves.toMatchObject({ isValid: true });
  });

  it("accepts a transfer made through an inner (CPI) instruction", async () => {
    const { f, req, proof } = await scenario({ inner: true });
    await expect(f.verify(proof, req)).resolves.toMatchObject({ isValid: true });
  });

  it("rejects a Token-2022 mint paid into the classic-program account address", async () => {
    const { f, req, proof } = await scenario({
      program: TOKEN_2022_PROGRAM_ID,
      mint: THREE_MINT,
      destination: ata(THREE_MINT, PAYEE, TOKEN_PROGRAM_ID),
    });
    await expect(f.verify(proof, req)).resolves.toMatchObject({ isValid: false });
  });

  it("rejects a payment to someone else's account", async () => {
    const { f, req, proof } = await scenario({ destination: ata(CLASSIC_MINT, PAYER, TOKEN_PROGRAM_ID) });
    const res = await f.verify(proof, req);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toContain("No matching transferChecked");
  });

  it("rejects an underpayment", async () => {
    const { f, req, proof } = await scenario({ amount: "2499999" });
    await expect(f.verify(proof, req)).resolves.toMatchObject({ isValid: false });
  });

  it("rejects a payment without the issued nonce memo", async () => {
    const { f, req, proof } = await scenario({ memo: null });
    await expect(f.verify(proof, req)).resolves.toEqual({
      isValid: false,
      invalidReason: "Transaction does not carry the issued challenge nonce",
    });
  });

  it("rejects a transaction that failed on-chain", async () => {
    const { f, req, proof } = await scenario({ err: { InstructionError: [0, "Custom"] } });
    await expect(f.verify(proof, req)).resolves.toEqual({ isValid: false, invalidReason: "Transaction failed on-chain" });
  });

  it("rejects requirements declaring a different cluster than the RPC serves", async () => {
    const { f, req, proof } = await scenario();
    const devnet = { ...req, network: SOLANA_DEVNET };
    const res = await f.verify({ ...proof, network: SOLANA_DEVNET }, devnet);
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toContain("Network mismatch");
  });

  it("rejects requirements that were altered after the challenge was issued", async () => {
    const { f, req, proof } = await scenario();
    await expect(f.verify(proof, { ...req, amount: "1" })).resolves.toEqual({
      isValid: false,
      invalidReason: "Challenge does not match requirements",
    });
  });

  it("rejects an unknown nonce", async () => {
    const { f, req, proof } = await scenario();
    await expect(f.verify(proof, { ...req, extra: { nonce: "forged" } })).resolves.toEqual({
      isValid: false,
      invalidReason: "Unknown or expired challenge",
    });
  });
});

describe("ExactFacilitator.settle", () => {
  it("settles a valid Token-2022 payment once and refuses to settle it again", async () => {
    const { f, req, proof } = await scenario({ program: TOKEN_2022_PROGRAM_ID, mint: THREE_MINT });

    await expect(f.settle(proof, req)).resolves.toEqual({
      success: true,
      transaction: SIG,
      network: SOLANA_MAINNET,
      payer: PAYER.toBase58(),
    });
    await expect(f.settle(proof, req)).resolves.toEqual({
      success: false,
      errorReason: "Payment signature already consumed",
    });
  });

  it("does not consume the challenge when verification fails", async () => {
    const { f, req, proof } = await scenario({ amount: "1" });
    const res = await f.settle(proof, req);
    expect(res.success).toBe(false);
    // Still "no matching transfer", not "challenge consumed": the nonce stays live.
    await expect(f.verify(proof, req)).resolves.toMatchObject({
      isValid: false,
      invalidReason: expect.stringContaining("No matching transferChecked"),
    });
  });
});
