import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { WalletProvider, MetaAwareWallet } from "../../src/wallet/types.js";

let mockFetch = jest.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const { jupiterSwap, getSwapQuote, SOL_MINT } = await import("../../src/actions/swap.js");
const { SwapError } = await import("../../src/errors.js");
const { Keypair, PublicKey, TransactionMessage, VersionedTransaction } =
  await import("@solana/web3.js") as typeof import("@solana/web3.js");
const {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  MintLayout,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = await import("@solana/spl-token") as typeof import("@solana/spl-token");

const WALLET_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;

const INPUT_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
const OUTPUT_MINT = "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"; // $THREE
const COUNTERPARTY = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;

// A synthetic Token-2022 mint with 9 decimals: the case a classic-only decimals
// lookup gets wrong by 1000x in the approval prompt.
const T22_NINE_MINT = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey.toBase58();

function ata(mint: string, owner = WALLET_PUBKEY, program = TOKEN_PROGRAM_ID) {
  return getAssociatedTokenAddressSync(
    new PublicKey(mint), owner, false, program, ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

// A realistic Jupiter swap tx: spend INPUT from the wallet's ATA, credit OUTPUT
// back to the wallet's ATA. The new swap-guard validates exactly this shape.
function buildSwapTx(inAmount: bigint, outputMint = OUTPUT_MINT, outputProgram = TOKEN_PROGRAM_ID): string {
  const counterpartyOut = ata(outputMint, COUNTERPARTY, outputProgram);
  const msg = new TransactionMessage({
    payerKey: WALLET_PUBKEY,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [
      createTransferCheckedInstruction(
        ata(INPUT_MINT), new PublicKey(INPUT_MINT), ata(INPUT_MINT, COUNTERPARTY),
        WALLET_PUBKEY, inAmount, 6, [], TOKEN_PROGRAM_ID,
      ),
      createTransferCheckedInstruction(
        counterpartyOut, new PublicKey(outputMint), ata(outputMint, WALLET_PUBKEY, outputProgram),
        COUNTERPARTY, 990_000_000n, 6, [], outputProgram,
      ),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

const MOCK_TX_BASE64 = buildSwapTx(1_000_000_000n);

const MOCK_QUOTE = {
  inputMint: INPUT_MINT,
  outputMint: OUTPUT_MINT,
  inAmount: "1000000000",
  outAmount: "990000000",
  priceImpactPct: "0.01",
};

function makeWallet(): WalletProvider {
  return {
    publicKey: WALLET_PUBKEY,
    signTransaction: jest.fn(),
    signAndSendTransaction: jest.fn<() => Promise<string>>().mockResolvedValue("mockSwapSig"),
  } as unknown as WalletProvider;
}

function makeMetaWallet(): MetaAwareWallet {
  return { ...makeWallet(), setNextMeta: jest.fn() } as unknown as MetaAwareWallet;
}

const connection = {} as never;

/** A connection whose mint accounts carry real SPL mint data under their owning program. */
function mintConnection(mints: Record<string, { program: PublicKey; decimals: number }>) {
  const getAccountInfo = jest.fn(async (key: InstanceType<typeof PublicKey>) => {
    const m = mints[key.toBase58()];
    if (!m) return null;
    const data = Buffer.alloc(MINT_SIZE);
    MintLayout.encode(
      {
        mintAuthorityOption: 0,
        mintAuthority: PublicKey.default,
        supply: 0n,
        decimals: m.decimals,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data,
    );
    return { data, owner: m.program, lamports: 1, executable: false };
  });
  return { getAccountInfo } as never;
}

const KNOWN_MINTS = {
  [INPUT_MINT]: { program: TOKEN_PROGRAM_ID, decimals: 6 },
  [OUTPUT_MINT]: { program: TOKEN_2022_PROGRAM_ID, decimals: 6 },
  [T22_NINE_MINT]: { program: TOKEN_2022_PROGRAM_ID, decimals: 9 },
};

beforeEach(() => {
  mockFetch = jest.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("getSwapQuote", () => {
  it("constructs quote URL with inputMint, outputMint, amount, and slippageBps", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => MOCK_QUOTE } as unknown as Response);

    await getSwapQuote({
      inputMint: SOL_MINT,
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: 1_000_000_000n,
      slippageBps: 100,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0]!;
    const url = new URL(call[0] as string);
    expect(url.searchParams.get("inputMint")).toBe(SOL_MINT);
    expect(url.searchParams.get("outputMint")).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(url.searchParams.get("amount")).toBe("1000000000");
    expect(url.searchParams.get("slippageBps")).toBe("100");
  });

  it("defaults slippageBps to 50 when not provided", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => MOCK_QUOTE } as unknown as Response);

    await getSwapQuote({ inputMint: SOL_MINT, outputMint: SOL_MINT, amount: 1n });

    const url = new URL(mockFetch.mock.calls[0]![0] as string);
    expect(url.searchParams.get("slippageBps")).toBe("50");
  });

  it("throws SwapError when quote API returns non-200", async () => {
    mockFetch.mockResolvedValue({ ok: false, text: async () => "rate limited" } as unknown as Response);

    await expect(
      getSwapQuote({ inputMint: SOL_MINT, outputMint: SOL_MINT, amount: 1n }),
    ).rejects.toThrow(SwapError);
  });
});

describe("jupiterSwap", () => {
  it("sends correct POST body to swap endpoint", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ swapTransaction: MOCK_TX_BASE64 }) } as unknown as Response);

    await jupiterSwap(makeWallet(), connection, {
      inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: 1_000_000_000n,
    });

    const swapCall = mockFetch.mock.calls[1]!;
    const swapUrl = swapCall[0] as string;
    const swapInit = swapCall[1] as RequestInit;
    expect(swapUrl).toContain("/swap");
    const body = JSON.parse(swapInit.body as string) as Record<string, unknown>;
    expect(body["quoteResponse"]).toEqual(MOCK_QUOTE);
    expect(body["userPublicKey"]).toBe(WALLET_PUBKEY.toBase58());
    expect(body["dynamicComputeUnitLimit"]).toBe(true);
    expect(body["prioritizationFeeLamports"]).toBe("auto");
  });

  it("hands Jupiter's lastValidBlockHeight to the wallet so confirmation stops at blockhash expiry", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ swapTransaction: MOCK_TX_BASE64, lastValidBlockHeight: 279_000_123 }),
      } as unknown as Response);

    const w = makeWallet();
    await jupiterSwap(w, connection, { inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: 1n });

    const call = (w.signAndSendTransaction as jest.Mock).mock.calls[0]!;
    expect(call[2]).toEqual({ lastValidBlockHeight: 279_000_123 });
  });

  it("omits the expiry height when Jupiter does not return one", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ swapTransaction: MOCK_TX_BASE64 }) } as unknown as Response);

    const w = makeWallet();
    await jupiterSwap(w, connection, { inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: 1n });

    const call = (w.signAndSendTransaction as jest.Mock).mock.calls[0]!;
    expect(call[2]).toEqual({});
  });

  it("throws SwapError when swap API returns non-200", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, text: async () => "swap failed" } as unknown as Response);

    await expect(
      jupiterSwap(makeWallet(), connection, {
        inputMint: SOL_MINT, outputMint: SOL_MINT, amount: 1n,
      }),
    ).rejects.toThrow(SwapError);
  });

  it("calls setNextMeta on MetaAwareWallet with swap metadata including kind: 'swap'", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ swapTransaction: MOCK_TX_BASE64 }) } as unknown as Response);

    const w = makeMetaWallet();
    await jupiterSwap(w, mintConnection(KNOWN_MINTS), {
      inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: 1_000_000_000n,
    });

    expect(w.setNextMeta).toHaveBeenCalledTimes(1);
    const meta = (w.setNextMeta as jest.Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(meta["kind"]).toBe("swap");
    expect(meta["amountIn"]).toBeDefined();
    expect(meta["amountOut"]).toBeDefined();
  });

  it("shows a Token-2022 output amount with the mint's real decimals", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...MOCK_QUOTE, outputMint: T22_NINE_MINT }) } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ swapTransaction: buildSwapTx(1_000_000_000n, T22_NINE_MINT, TOKEN_2022_PROGRAM_ID) }),
      } as unknown as Response);

    const w = makeMetaWallet();
    await jupiterSwap(w, mintConnection(KNOWN_MINTS), {
      inputMint: INPUT_MINT, outputMint: T22_NINE_MINT, amount: 1_000_000_000n,
    });

    const meta = (w.setNextMeta as jest.Mock).mock.calls[0]![0] as {
      amountIn: { uiAmount: string };
      amountOut: { uiAmount: string };
    };
    expect(meta.amountIn.uiAmount).toBe("1000");
    expect(meta.amountOut.uiAmount).toBe("0.99");
  });

  it("refuses to describe a swap with guessed decimals when the mint cannot be read", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE } as unknown as Response);
    const unreadable = { getAccountInfo: jest.fn(async () => { throw new Error("429 Too Many Requests"); }) } as never;
    const freshInput = Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey.toBase58();

    const w = makeMetaWallet();
    await expect(
      jupiterSwap(w, unreadable, { inputMint: freshInput, outputMint: OUTPUT_MINT, amount: 1n }),
    ).rejects.toThrow("429");
    expect(w.setNextMeta).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not throw when wallet does not implement setNextMeta", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ swapTransaction: MOCK_TX_BASE64 }) } as unknown as Response);

    await expect(
      jupiterSwap(makeWallet(), connection, {
        inputMint: INPUT_MINT, outputMint: OUTPUT_MINT, amount: 1n,
      }),
    ).resolves.toBeDefined();
  });
});
