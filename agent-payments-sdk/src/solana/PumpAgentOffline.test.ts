// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import {
  PumpAgentOffline,
  USDC_MINT,
  decodeBondingCurveQuoteMint,
} from "./PumpAgentOffline";
import { JupiterUnavailableError } from "./errors";
import { getBondingCurvePDA } from "./pdas";

function buildBondingCurveBuffer(quoteMint: PublicKey): Buffer {
  const buf = Buffer.alloc(8 + 40 + 1 + 32 + 1 + 1 + 32);
  buf.writeUInt8(23, 0);
  quoteMint.toBuffer().copy(buf, 8 + 40 + 1 + 32 + 1 + 1);
  return buf;
}

function fakeAccountInfo(
  data: Buffer,
  owner = TOKEN_PROGRAM_ID,
): AccountInfo<Buffer> {
  return {
    executable: false,
    lamports: 1_000_000,
    owner,
    data,
    rentEpoch: 0,
  };
}

function makeMockProgram(supportedMints: PublicKey[]) {
  return {
    account: {
      GlobalConfig: {
        fetch: vi
          .fn()
          .mockResolvedValue({ supportedCurrenciesMint: supportedMints }),
      },
    },
  } as never;
}

describe("decodeBondingCurveQuoteMint", () => {
  it("returns NATIVE_MINT for legacy buffers shorter than the post-multi-quote layout", () => {
    expect(decodeBondingCurveQuoteMint(Buffer.alloc(50))).toEqual(NATIVE_MINT);
  });

  it("returns the embedded quote mint for full buffers", () => {
    const usdcBuf = buildBondingCurveBuffer(USDC_MINT);
    expect(decodeBondingCurveQuoteMint(usdcBuf).equals(USDC_MINT)).toBe(true);
  });

  it("returns NATIVE_MINT when quote_mint is the all-zero default", () => {
    const buf = buildBondingCurveBuffer(PublicKey.default);
    expect(decodeBondingCurveQuoteMint(buf).equals(NATIVE_MINT)).toBe(true);
  });
});

describe("PumpAgentOffline.getCoinQuoteMint", () => {
  const baseMint = Keypair.generate().publicKey;

  beforeEach(() => {
    PumpAgentOffline._clearCoinQuoteMintCache();
  });

  it("decodes USDC from the bonding-curve account and caches the result", async () => {
    const buf = buildBondingCurveBuffer(USDC_MINT);
    const getAccountInfo = vi.fn().mockResolvedValue(fakeAccountInfo(buf));
    const connection = {
      getAccountInfo,
    } as unknown as import("@solana/web3.js").Connection;

    const quote = await PumpAgentOffline.getCoinQuoteMint(connection, baseMint);
    expect(quote.equals(USDC_MINT)).toBe(true);
    expect(getAccountInfo).toHaveBeenCalledTimes(1);

    const quote2 = await PumpAgentOffline.getCoinQuoteMint(
      connection,
      baseMint,
    );
    expect(quote2.equals(USDC_MINT)).toBe(true);
    expect(getAccountInfo).toHaveBeenCalledTimes(1);

    const [bcPda] = getBondingCurvePDA(baseMint);
    expect(getAccountInfo.mock.calls[0]?.[0].equals(bcPda)).toBe(true);
  });

  it("throws when the bonding curve account does not exist", async () => {
    const connection = {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    } as unknown as import("@solana/web3.js").Connection;

    await expect(
      PumpAgentOffline.getCoinQuoteMint(connection, baseMint),
    ).rejects.toThrow(/Bonding curve account not found/);
  });
});

describe("PumpAgentOffline.acceptPaymentForCoin", () => {
  beforeEach(() => {
    PumpAgentOffline._clearCoinQuoteMintCache();
  });

  it("resolves quoteMint via bonding curve and forwards it as currencyMint", async () => {
    const baseMint = Keypair.generate().publicKey;
    const user = Keypair.generate().publicKey;
    const userAta = Keypair.generate().publicKey;

    const bcBuf = buildBondingCurveBuffer(USDC_MINT);
    const connection = {
      getAccountInfo: vi
        .fn()
        .mockResolvedValueOnce(fakeAccountInfo(bcBuf))
        .mockResolvedValue(fakeAccountInfo(Buffer.alloc(82), TOKEN_PROGRAM_ID)),
    } as unknown as import("@solana/web3.js").Connection;

    const agent = PumpAgentOffline.load(Keypair.generate().publicKey);
    const acceptSpy = vi.spyOn(agent, "acceptPayment");

    await agent.acceptPaymentForCoin({
      connection,
      user,
      userTokenAccount: userAta,
      baseMint,
      amount: new BN(1_000_000),
      memo: new BN(42),
      startTime: new BN(0),
      endTime: new BN(9999999999),
    });

    expect(acceptSpy).toHaveBeenCalledTimes(1);
    const fwd = acceptSpy.mock.calls[0]?.[0];
    expect(fwd?.currencyMint.equals(USDC_MINT)).toBe(true);
    expect(fwd?.tokenProgram?.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(fwd?.user.equals(user)).toBe(true);
    expect(fwd?.amount.toString()).toBe("1000000");
  });
});

describe("PumpAgentOffline.validateCurrencySupport", () => {
  beforeEach(() => {
    PumpAgentOffline._clearCoinQuoteMintCache();
  });

  it("returns supported=false when quote mint is not in GlobalConfig", async () => {
    const baseMint = Keypair.generate().publicKey;
    const bcBuf = buildBondingCurveBuffer(USDC_MINT);
    const connection = {
      getAccountInfo: vi.fn().mockResolvedValue(fakeAccountInfo(bcBuf)),
    } as unknown as import("@solana/web3.js").Connection;

    const otherMint = Keypair.generate().publicKey;
    const agent = new PumpAgentOffline(
      Keypair.generate().publicKey,
      makeMockProgram([otherMint, PublicKey.default]),
    );

    await expect(
      agent.validateCurrencySupport({ connection, baseMint }),
    ).resolves.toMatchObject({ supported: false });
  });

  it("returns supported=true for SOL (NATIVE_MINT) coins regardless of GlobalConfig", async () => {
    const baseMint = Keypair.generate().publicKey;
    const bcBuf = buildBondingCurveBuffer(PublicKey.default);
    const connection = {
      getAccountInfo: vi.fn().mockResolvedValue(fakeAccountInfo(bcBuf)),
    } as unknown as import("@solana/web3.js").Connection;

    const agent = new PumpAgentOffline(
      Keypair.generate().publicKey,
      makeMockProgram([]),
    );

    await expect(
      agent.validateCurrencySupport({ connection, baseMint }),
    ).resolves.toMatchObject({ supported: true });
  });

  it("returns supported=true when quote mint IS in GlobalConfig", async () => {
    const baseMint = Keypair.generate().publicKey;
    const bcBuf = buildBondingCurveBuffer(USDC_MINT);
    const connection = {
      getAccountInfo: vi.fn().mockResolvedValue(fakeAccountInfo(bcBuf)),
    } as unknown as import("@solana/web3.js").Connection;

    const agent = new PumpAgentOffline(
      Keypair.generate().publicKey,
      makeMockProgram([USDC_MINT, PublicKey.default]),
    );

    await expect(
      agent.validateCurrencySupport({ connection, baseMint }),
    ).resolves.toMatchObject({ supported: true });
  });
});

describe("PumpAgentOffline.buildJupiterSwapData (static)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns a non-empty Buffer with SOL as inputMint", async () => {
    const outputMint = Keypair.generate().publicKey;
    const sampleData = Buffer.from([1, 2, 3, 4, 5]).toString("base64");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/quote?")) {
        expect(url).toContain(`inputMint=${NATIVE_MINT.toBase58()}`);
        expect(url).toContain(`outputMint=${outputMint.toBase58()}`);
        expect(url).toContain("slippageBps=50");
        return new Response(JSON.stringify({ outAmount: "100" }), { status: 200 });
      }
      if (url.includes("/swap-instructions")) {
        return new Response(
          JSON.stringify({ swapInstruction: { data: sampleData } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await PumpAgentOffline.buildJupiterSwapData({
      inputMint: NATIVE_MINT,
      outputMint,
      amount: new BN(1_000_000_000),
    });

    expect(Buffer.isBuffer(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(Array.from(data)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a non-empty Buffer with USDC as inputMint", async () => {
    const outputMint = Keypair.generate().publicKey;
    const sampleData = Buffer.from([9, 8, 7]).toString("base64");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/quote?")) {
        expect(url).toContain(`inputMint=${USDC_MINT.toBase58()}`);
        return new Response(JSON.stringify({ outAmount: "1" }), { status: 200 });
      }
      if (url.includes("/swap-instructions")) {
        return new Response(
          JSON.stringify({ swapInstruction: { data: sampleData } }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await PumpAgentOffline.buildJupiterSwapData({
      inputMint: USDC_MINT,
      outputMint,
      amount: new BN(1_000_000),
    });
    expect(data.length).toBe(3);
  });

  it("throws JupiterUnavailableError when /quote returns 5xx after 3 retries", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const outputMint = Keypair.generate().publicKey;
    await expect(
      PumpAgentOffline.buildJupiterSwapData({
        inputMint: USDC_MINT,
        outputMint,
        amount: new BN(1),
      }),
    ).rejects.toBeInstanceOf(JupiterUnavailableError);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
