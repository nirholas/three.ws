import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { jupiterSwap, getSwapQuote, SOL_MINT } from "../../src/actions/swap.js";
import { SwapError } from "../../src/errors.js";
import type { MetaAwareWallet, WalletProvider } from "../../src/wallet/types.js";

// Deterministic test key
const WALLET_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;

// Minimal valid VersionedTransaction for the mock Jupiter swap response
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

function makeWallet(publicKey = WALLET_PUBKEY): WalletProvider {
  return {
    publicKey,
    signTransaction: jest.fn(),
    signAndSendTransaction: jest.fn().mockResolvedValue("mockSwapSig"),
  };
}

function makeMetaWallet(publicKey = WALLET_PUBKEY): MetaAwareWallet {
  return {
    ...makeWallet(publicKey),
    setNextMeta: jest.fn(),
  };
}

const connection = {} as unknown as Connection;

let mockFetch: jest.Mock;

beforeEach(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("getSwapQuote", () => {
  it("constructs quote URL with inputMint, outputMint, amount, and slippageBps", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => MOCK_QUOTE });

    await getSwapQuote({
      inputMint: SOL_MINT,
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: 1_000_000_000n,
      slippageBps: 100,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("inputMint")).toBe(SOL_MINT);
    expect(url.searchParams.get("outputMint")).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(url.searchParams.get("amount")).toBe("1000000000");
    expect(url.searchParams.get("slippageBps")).toBe("100");
  });

  it("defaults slippageBps to 50 when not provided", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => MOCK_QUOTE });

    await getSwapQuote({ inputMint: SOL_MINT, outputMint: SOL_MINT, amount: 1n });

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("slippageBps")).toBe("50");
  });

  it("throws SwapError when quote API returns non-200", async () => {
    mockFetch.mockResolvedValue({ ok: false, text: async () => "rate limited" });

    await expect(
      getSwapQuote({ inputMint: SOL_MINT, outputMint: SOL_MINT, amount: 1n }),
    ).rejects.toThrow(SwapError);
  });
});

describe("jupiterSwap", () => {
  it("sends correct POST body to swap endpoint", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ swapTransaction: MOCK_TX_BASE64 }) });

    const w = makeWallet();
    await jupiterSwap(w, connection, {
      inputMint: SOL_MINT,
      outputMint: SOL_MINT,
      amount: 1_000_000_000n,
    });

    const [swapUrl, swapInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(swapUrl).toContain("/swap");
    const body = JSON.parse(swapInit.body as string);
    expect(body.quoteResponse).toEqual(MOCK_QUOTE);
    expect(body.userPublicKey).toBe(WALLET_PUBKEY.toBase58());
    expect(body.dynamicComputeUnitLimit).toBe(true);
    expect(body.prioritizationFeeLamports).toBe("auto");
  });

  it("throws SwapError when swap API returns non-200", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE })
      .mockResolvedValueOnce({ ok: false, text: async () => "swap failed" });

    await expect(
      jupiterSwap(makeWallet(), connection, {
        inputMint: SOL_MINT,
        outputMint: SOL_MINT,
        amount: 1n,
      }),
    ).rejects.toThrow(SwapError);
  });

  it("calls setNextMeta on MetaAwareWallet with swap metadata", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ swapTransaction: MOCK_TX_BASE64 }) });

    const w = makeMetaWallet();
    await jupiterSwap(w, connection, {
      inputMint: SOL_MINT,
      outputMint: SOL_MINT,
      amount: 1_000_000_000n,
      inputSymbol: "SOL",
      outputSymbol: "SOL",
    });

    expect(w.setNextMeta).toHaveBeenCalledTimes(1);
    const meta = (w.setNextMeta as jest.Mock).mock.calls[0][0];
    expect(meta.kind).toBe("swap");
    expect(meta.amountIn).toBeDefined();
    expect(meta.amountOut).toBeDefined();
  });

  it("does not throw when wallet does not implement setNextMeta", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_QUOTE })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ swapTransaction: MOCK_TX_BASE64 }) });

    const w = makeWallet(); // no setNextMeta
    await expect(
      jupiterSwap(w, connection, {
        inputMint: SOL_MINT,
        outputMint: SOL_MINT,
        amount: 1n,
      }),
    ).resolves.toBeDefined();
  });
});
