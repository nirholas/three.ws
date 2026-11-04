// payExact builds the x402 "exact" payment: a TransferChecked of the quoted
// amount to the payee, bound to the server's challenge nonce by a memo.

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { AccountInfo, Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { WalletProvider } from "../../src/wallet/types.js";

const mockBuildAndSend = jest.fn<(...args: any[]) => Promise<string>>();
const mockGetMint = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("../../src/tx/build.js", () => ({ buildAndSend: mockBuildAndSend }));
jest.unstable_mockModule("@solana/spl-token", () => {
  const actual = jest.requireActual("@solana/spl-token") as typeof import("@solana/spl-token");
  return { ...(actual as object), getMint: mockGetMint };
});

const { payExact } = await import("../../src/x402-exact/client.js");
const { x402NonceMemo, SOLANA_MAINNET } = await import("../../src/x402-exact/types.js");
const { InvalidInputError, MissingTokenAccountError } = await import("../../src/errors.js");
const { Keypair, PublicKey: PK } = (await import("@solana/web3.js")) as typeof import("@solana/web3.js");
const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } =
  (await import("@solana/spl-token")) as typeof import("@solana/spl-token");
const { MEMO_PROGRAM_ID } = await import("../../src/utils/memo.js");

const THREE_MINT = new PK("FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump");
const CLASSIC_MINT = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
const WALLET = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const PAYEE = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
// A program-derived vault has no private key and sits off the ed25519 curve.
const PDA_PAYEE = PK.findProgramAddressSync([Buffer.from("x402-vault")], ASSOCIATED_TOKEN_PROGRAM_ID)[0];

const ACCOUNT = { data: Buffer.alloc(0), executable: false, lamports: 1 };

function connectionFor(mint: PublicKey, program: PublicKey, payee: PublicKey, opts: { payerAta?: boolean; payeeAta?: boolean } = {}) {
  const payerAta = getAssociatedTokenAddressSync(mint, WALLET, true, program);
  const payeeAta = getAssociatedTokenAddressSync(mint, payee, true, program);
  const getAccountInfo = jest.fn(async (key: PublicKey) => {
    if (key.equals(mint)) return { ...ACCOUNT, owner: program } as unknown as AccountInfo<Buffer>;
    if (key.equals(payerAta)) return (opts.payerAta ?? true) ? ({ ...ACCOUNT, owner: program } as unknown as AccountInfo<Buffer>) : null;
    if (key.equals(payeeAta)) return opts.payeeAta ? ({ ...ACCOUNT, owner: program } as unknown as AccountInfo<Buffer>) : null;
    return null;
  });
  return { connection: { getAccountInfo } as unknown as Connection, payerAta, payeeAta, getAccountInfo };
}

const wallet = { publicKey: WALLET, signTransaction: jest.fn(), signAndSendTransaction: jest.fn() } as unknown as WalletProvider;

const requirements = (mint: PublicKey, payTo: PublicKey, nonce: string | null = "nonce-123") => ({
  scheme: "exact" as const,
  network: SOLANA_MAINNET,
  asset: mint.toBase58(),
  amount: "2500000",
  payTo: payTo.toBase58(),
  maxTimeoutSeconds: 60,
  ...(nonce === null ? {} : { extra: { nonce } }),
});

const sentInstructions = () => mockBuildAndSend.mock.calls[0]![2] as TransactionInstruction[];

beforeEach(() => {
  mockBuildAndSend.mockReset().mockResolvedValue("paidSig");
  mockGetMint.mockReset().mockResolvedValue({ decimals: 6 });
});

describe("payExact", () => {
  it("pays a Token-2022 asset such as $THREE through the Token-2022 program", async () => {
    const { connection, payerAta, payeeAta } = connectionFor(THREE_MINT, TOKEN_2022_PROGRAM_ID, PAYEE, { payeeAta: true });

    const proof = await payExact(wallet, connection, requirements(THREE_MINT, PAYEE));

    expect(proof).toEqual({ signature: "paidSig", network: SOLANA_MAINNET });
    expect(mockGetMint.mock.calls[0]![3]).toEqual(TOKEN_2022_PROGRAM_ID);
    const [transfer, memo] = sentInstructions();
    expect(transfer!.programId).toEqual(TOKEN_2022_PROGRAM_ID);
    expect(transfer!.keys[0]!.pubkey).toEqual(payerAta);
    expect(transfer!.keys[2]!.pubkey).toEqual(payeeAta);
    expect(memo!.programId).toEqual(MEMO_PROGRAM_ID);
    expect(memo!.data.toString("utf8")).toBe(x402NonceMemo("nonce-123"));
  });

  it("pays a classic SPL asset through the classic program and opens the payee account when missing", async () => {
    const { connection, payeeAta } = connectionFor(CLASSIC_MINT, TOKEN_PROGRAM_ID, PAYEE);

    await payExact(wallet, connection, requirements(CLASSIC_MINT, PAYEE));

    const [createAta, transfer, memo] = sentInstructions();
    expect(createAta!.programId).toEqual(ASSOCIATED_TOKEN_PROGRAM_ID);
    expect(createAta!.keys[1]!.pubkey).toEqual(payeeAta);
    expect(transfer!.programId).toEqual(TOKEN_PROGRAM_ID);
    expect(memo!.programId).toEqual(MEMO_PROGRAM_ID);
  });

  it("pays a program-derived payee vault", async () => {
    const { connection, payeeAta } = connectionFor(CLASSIC_MINT, TOKEN_PROGRAM_ID, PDA_PAYEE, { payeeAta: true });

    await payExact(wallet, connection, requirements(CLASSIC_MINT, PDA_PAYEE));

    const [transfer] = sentInstructions();
    expect(transfer!.keys[2]!.pubkey).toEqual(payeeAta);
  });

  it("refuses requirements without a challenge nonce before touching the chain", async () => {
    const { connection, getAccountInfo } = connectionFor(CLASSIC_MINT, TOKEN_PROGRAM_ID, PAYEE);

    const err = await payExact(wallet, connection, requirements(CLASSIC_MINT, PAYEE, null)).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidInputError);
    expect((err as InstanceType<typeof InvalidInputError>).param).toBe("requirements.extra.nonce");
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(mockBuildAndSend).not.toHaveBeenCalled();
  });

  it("refuses a non-integer amount as InvalidInputError", async () => {
    const { connection } = connectionFor(CLASSIC_MINT, TOKEN_PROGRAM_ID, PAYEE);
    const bad = { ...requirements(CLASSIC_MINT, PAYEE), amount: "1.5" };

    const err = await payExact(wallet, connection, bad).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidInputError);
    expect((err as InstanceType<typeof InvalidInputError>).param).toBe("requirements.amount");
    expect(mockBuildAndSend).not.toHaveBeenCalled();
  });

  it("reports a payer with no token account for the asset as MissingTokenAccountError", async () => {
    const { connection } = connectionFor(CLASSIC_MINT, TOKEN_PROGRAM_ID, PAYEE, { payerAta: false });

    const err = await payExact(wallet, connection, requirements(CLASSIC_MINT, PAYEE)).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MissingTokenAccountError);
    expect(mockBuildAndSend).not.toHaveBeenCalled();
  });
});
