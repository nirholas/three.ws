// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

import { PumpAgent } from "./PumpAgent";
import { PumpAgentOffline, USDC_MINT } from "./PumpAgentOffline";

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

describe("PumpAgent.getAllCurrencyBalances", () => {
  beforeEach(() => {
    PumpAgentOffline._clearCoinQuoteMintCache();
  });

  it("returns SOL + every non-default mint from GlobalConfig, keyed by base58", async () => {
    const agentMint = Keypair.generate().publicKey;
    const otherMint = Keypair.generate().publicKey;

    // Mock connection: provides token-program owner for SPL mints + token
    // balances for ATAs.
    const getMultipleAccountsInfo = vi.fn(async (keys: PublicKey[]) =>
      keys.map((k) =>
        // USDC and otherMint return TOKEN_PROGRAM_ID owner; otherMint
        // returns TOKEN_2022_PROGRAM_ID to exercise that path.
        k.equals(otherMint)
          ? fakeAccountInfo(Buffer.alloc(82), TOKEN_2022_PROGRAM_ID)
          : fakeAccountInfo(Buffer.alloc(82), TOKEN_PROGRAM_ID),
      ),
    );
    const getTokenAccountBalance = vi.fn(async () => ({
      value: { amount: "123", decimals: 6, uiAmount: 0.000123, uiAmountString: "0.000123" },
      context: { slot: 0 },
    }));

    const connection = {
      getMultipleAccountsInfo,
      getTokenAccountBalance,
    } as unknown as import("@solana/web3.js").Connection;

    const agent = new PumpAgent(agentMint, "mainnet", connection);

    // Spy on getGlobalConfig which internally calls program.account.GlobalConfig.fetch.
    vi.spyOn(agent, "getGlobalConfig").mockResolvedValue({
      supportedCurrenciesMint: [
        USDC_MINT,
        otherMint,
        ...Array(8).fill(PublicKey.default),
      ],
    } as never);

    const balances = await agent.getAllCurrencyBalances();

    expect(balances.has(NATIVE_MINT.toBase58())).toBe(true);
    expect(balances.has(USDC_MINT.toBase58())).toBe(true);
    expect(balances.has(otherMint.toBase58())).toBe(true);
    expect(balances.size).toBe(3);

    const sol = balances.get(NATIVE_MINT.toBase58())!;
    expect(sol.quoteMint.equals(NATIVE_MINT)).toBe(true);
    expect(sol.paymentVault.balance).toBe(123n);
    expect(sol.buybackVault.balance).toBe(123n);
    expect(sol.withdrawVault.balance).toBe(123n);

    const usdc = balances.get(USDC_MINT.toBase58())!;
    expect(usdc.quoteMint.equals(USDC_MINT)).toBe(true);

    // 3 SPL ATAs × 3 vaults + 3 SOL ATAs = 9; + 1 batched account fetch for token programs
    expect(getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    // Each currency has 3 vault balance lookups → 9 calls total
    expect(getTokenAccountBalance).toHaveBeenCalledTimes(9);
  });

  it("returns just SOL when GlobalConfig has no SPL currencies", async () => {
    const agentMint = Keypair.generate().publicKey;

    const getMultipleAccountsInfo = vi.fn(async () => []);
    const getTokenAccountBalance = vi.fn(async () => ({
      value: { amount: "0", decimals: 9, uiAmount: 0, uiAmountString: "0" },
      context: { slot: 0 },
    }));

    const connection = {
      getMultipleAccountsInfo,
      getTokenAccountBalance,
    } as unknown as import("@solana/web3.js").Connection;

    const agent = new PumpAgent(agentMint, "mainnet", connection);

    vi.spyOn(agent, "getGlobalConfig").mockResolvedValue({
      supportedCurrenciesMint: Array(10).fill(PublicKey.default),
    } as never);

    const balances = await agent.getAllCurrencyBalances();
    expect(balances.size).toBe(1);
    expect(balances.has(NATIVE_MINT.toBase58())).toBe(true);
    // No SPL mints → no batched RPC for owners.
    expect(getMultipleAccountsInfo).not.toHaveBeenCalled();
  });
});

describe("PumpAgent.getCoinQuoteMint", () => {
  beforeEach(() => {
    PumpAgentOffline._clearCoinQuoteMintCache();
  });

  it("delegates to the static cached helper", async () => {
    const agentMint = Keypair.generate().publicKey;
    const baseMint = Keypair.generate().publicKey;

    // Synthetic bonding-curve buffer with USDC quote.
    const buf = Buffer.alloc(8 + 40 + 1 + 32 + 1 + 1 + 32);
    USDC_MINT.toBuffer().copy(buf, 8 + 40 + 1 + 32 + 1 + 1);

    const connection = {
      getAccountInfo: vi.fn().mockResolvedValue(fakeAccountInfo(buf)),
    } as unknown as import("@solana/web3.js").Connection;

    const agent = new PumpAgent(agentMint, "mainnet", connection);
    const q = await agent.getCoinQuoteMint(baseMint);
    expect(q.equals(USDC_MINT)).toBe(true);
  });
});

describe("PumpAgent.getBalances", () => {
  it("populates the new quoteMint field", async () => {
    const agentMint = Keypair.generate().publicKey;
    const connection = {
      getTokenAccountBalance: vi.fn(async () => ({
        value: { amount: "5", decimals: 6, uiAmount: 0, uiAmountString: "0" },
        context: { slot: 0 },
      })),
    } as unknown as import("@solana/web3.js").Connection;

    const agent = new PumpAgent(agentMint, "mainnet", connection);
    const balances = await agent.getBalances(USDC_MINT);
    expect(balances.quoteMint.equals(USDC_MINT)).toBe(true);
    expect(balances.paymentVault.balance).toBe(5n);
  });
});

// Anchor 0.30+ keys `program.account` by the camelCased IDL name
// (globalConfig, tokenAgentPayments, tokenAgentPaymentInCurrency). Reading
// `program.account.GlobalConfig` is undefined at runtime, so every on-chain
// read below threw "Cannot read properties of undefined (reading 'fetch')"
// and updateBuybackBps could never build. These run the real coder against a
// connection that serves encoded accounts, with no spies on the fetch path.
describe("PumpAgent on-chain account reads", () => {
  const agentMint = Keypair.generate().publicKey;
  const currency = Keypair.generate().publicKey;

  async function agentWith(accounts: Map<string, AccountInfo<Buffer>>) {
    const connection = {
      commitment: "confirmed",
      rpcEndpoint: "stub",
      getAccountInfo: async (key: PublicKey) => accounts.get(key.toBase58()) ?? null,
      getAccountInfoAndContext: async (key: PublicKey) => ({
        context: { slot: 1 },
        value: accounts.get(key.toBase58()) ?? null,
      }),
      getMultipleAccountsInfo: async (keys: PublicKey[]) =>
        keys.map((k) => accounts.get(k.toBase58()) ?? null),
    } as unknown as import("@solana/web3.js").Connection;
    return new PumpAgent(agentMint, "mainnet", connection);
  }

  async function globalConfigFixture() {
    const { getPumpProgram } = await import("./program");
    const { getGlobalConfigPDA } = await import("./pdas");
    const program = getPumpProgram({} as never);
    const supported = Array.from({ length: 10 }, () => PublicKey.default);
    supported[0] = currency;
    const { default: BN } = await import("bn.js");
    const data = await program.coder.accounts.encode("globalConfig", {
      bump: 255,
      protocolAuthority: Keypair.generate().publicKey,
      buybackAuthority: Keypair.generate().publicKey,
      supportedCurrenciesMint: supported,
      tokenizedAgentSequence: new BN(0),
    });
    return {
      program,
      pda: getGlobalConfigPDA()[0],
      info: fakeAccountInfo(data, program.programId),
    };
  }

  it("reads GlobalConfig through the camelCased account namespace", async () => {
    const { pda, info } = await globalConfigFixture();
    const agent = await agentWith(new Map([[pda.toBase58(), info]]));
    const cfg = await agent.getGlobalConfig();
    expect(cfg.supportedCurrenciesMint[0].equals(currency)).toBe(true);
  });

  it("builds updateBuybackBps with every supported currency on its own token program", async () => {
    const { program, pda, info } = await globalConfigFixture();
    const agent = await agentWith(
      new Map([
        [pda.toBase58(), info],
        [currency.toBase58(), fakeAccountInfo(Buffer.alloc(82), TOKEN_2022_PROGRAM_ID)],
      ]),
    );
    const authority = Keypair.generate().publicKey;
    const ix = await agent.updateBuybackBps({ authority, buybackBps: 2500 });
    expect(ix.programId.equals(program.programId)).toBe(true);
    const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
    const { getTokenAgentPaymentsPDA } = await import("./pdas");
    const vault2022 = getAssociatedTokenAddressSync(
      currency,
      getTokenAgentPaymentsPDA(agentMint)[0],
      true,
      TOKEN_2022_PROGRAM_ID,
    );
    expect(ix.keys.some((k) => k.pubkey.equals(vault2022))).toBe(true);
    expect(ix.keys.some((k) => k.pubkey.equals(authority) && k.isSigner)).toBe(true);
  });
});
