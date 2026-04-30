import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { WalletProvider, MetaAwareWallet } from "../../src/wallet/types.js";

let mockFetch = jest.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const { jupiterSwap, getSwapQuote, SOL_MINT } = await import("../../src/actions/swap.js");
const { SwapError } = await import("../../src/errors.js");
const { Keypair, TransactionMessage, VersionedTransaction } =
  await import("@solana/web3.js") as typeof import("@solana/web3.js");

const WALLET_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;

// Minimal valid VersionedTransaction for mock Jupiter swap response
const MOCK_TX_BASE64 = (() => {
  const msg = new TransactionMessage({
    payerKey: WALLET_PUBKEY,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
})();

const MOCK_QUOTE = {
  inputMint: SOL_MINT,
  outputMint: SOL_MINT,
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
      inputMint: SOL_MINT, outputMint: SOL_MINT, amount: 1_000_000_000n,
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
    await jupiterSwap(w, connection, {
      inputMint: SOL_MINT, outputMint: SOL_MINT, amount: 1_000_000_000n,
    });

    expect(w.setNextMeta).toHaveBeenCalledTimes(1);
    const meta = (w.setNextMeta as jest.Mock).mock.calls[0]![0] as Record<string, unknown>;
    expect(meta["kind"]).toBe("swap");
    expect(meta["amountIn"]).toBeDefined();
    expect(meta["amountOut"]).toBeDefined();
  });

  it("does not throw when wallet does not implement setNextMeta", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ swapTransaction: MOCK_TX_BASE64 }) } as unknown as Response);

    await expect(
      jupiterSwap(makeWallet(), connection, {
        inputMint: SOL_MINT, outputMint: SOL_MINT, amount: 1n,
      }),
    ).resolves.toBeDefined();
  });
});
