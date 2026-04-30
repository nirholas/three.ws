import { Connection, PublicKey } from "@solana/web3.js";
import { KeypairWalletProvider } from "./wallet/keypair.js";
import { BrowserWalletProvider } from "./wallet/browser-server.js";
import type { WalletProvider } from "./wallet/types.js";
import type { BrowserWalletOptions } from "./wallet/browser-server.js";
import { transferSol } from "./actions/transfer-sol.js";
import { transferSpl } from "./actions/transfer-spl.js";
import { jupiterSwap, getSwapQuote, type SwapParams } from "./actions/swap.js";
import { getOrCreateAta, type GetOrCreateAtaParams, type GetOrCreateAtaResult } from "./actions/ata.js";
import { getTokenBalance, type TokenBalanceResult } from "./actions/get-token-balance.js";
import { getTokenAccounts, type TokenAccount } from "./actions/get-token-accounts.js";
import { stakeSOL, unstakeSOL, getStakeAccounts, type StakeSolResult, type StakeAccountInfo } from "./actions/stake.js";
import type { BuildAndSendOptions } from "./tx/build.js";

export interface SolanaAgentConfig {
  wallet: WalletProvider;
  connection: Connection;
}

export class SolanaAgent {
  readonly wallet: WalletProvider;
  readonly connection: Connection;

  constructor(config: SolanaAgentConfig) {
    this.wallet = config.wallet;
    this.connection = config.connection;
  }

  get publicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  // ─── Factory constructors ─────────────────────────────────────────────────

  /** Agent holds the private key — signs and sends autonomously. */
  static fromKeypair(privateKey: string | Uint8Array | number[], rpcUrl: string): SolanaAgent {
    return new SolanaAgent({
      wallet: new KeypairWalletProvider(privateKey),
      connection: new Connection(rpcUrl, "confirmed"),
    });
  }

  /**
   * Agent defers signing to the user's browser wallet.
   * Returns both the agent and the wallet provider so you can mount
   * walletProvider.createHandler() on your HTTP server.
   */
  static fromBrowserWallet(
    publicKey: PublicKey | string,
    rpcUrl: string,
    opts?: Partial<BrowserWalletOptions>,
  ): { agent: SolanaAgent; walletProvider: BrowserWalletProvider } {
    const walletProvider = new BrowserWalletProvider({
      publicKey,
      ...opts,
    });
    return {
      agent: new SolanaAgent({
        wallet: walletProvider,
        connection: new Connection(rpcUrl, "confirmed"),
      }),
      walletProvider,
    };
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  /** Send native SOL. Amount is in SOL (not lamports). */
  transferSol(to: PublicKey | string, amount: number, opts?: BuildAndSendOptions): Promise<string> {
    return transferSol(this.wallet, this.connection, { to, amount }, opts);
  }

  /** Send SPL tokens. Amount is in base units (not human-readable). */
  transferSpl(mint: PublicKey | string, to: PublicKey | string, amount: bigint, opts?: BuildAndSendOptions): Promise<string> {
    return transferSpl(this.wallet, this.connection, { mint, to, amount }, opts);
  }

  /** Swap tokens via Jupiter. */
  swap(params: SwapParams): Promise<string> {
    return jupiterSwap(this.wallet, this.connection, params);
  }

  /** Get a swap quote without executing. */
  getSwapQuote(params: SwapParams) {
    return getSwapQuote(params);
  }

  /** Get or create an associated token account. */
  getOrCreateAta(params: GetOrCreateAtaParams, opts?: BuildAndSendOptions): Promise<GetOrCreateAtaResult> {
    return getOrCreateAta(this.wallet, this.connection, params, opts);
  }

  /** Current SOL balance in lamports. */
  getBalance(): Promise<number> {
    return this.connection.getBalance(this.wallet.publicKey);
  }

  /** Get SPL token balance. Returns null if the wallet has no account for that mint. */
  getTokenBalance(mint: PublicKey | string): Promise<TokenBalanceResult | null> {
    return getTokenBalance(this.connection, this.wallet.publicKey, mint);
  }

  /** List all SPL token accounts with non-zero balance. */
  getTokenAccounts(): Promise<TokenAccount[]> {
    return getTokenAccounts(this.connection, this.wallet.publicKey);
  }

  /** Stake SOL with a validator. Amount is in SOL (not lamports). */
  stakeSOL(voteAccount: PublicKey | string, amount: number, opts?: BuildAndSendOptions): Promise<StakeSolResult> {
    return stakeSOL(this.wallet, this.connection, { voteAccount, amount }, opts);
  }

  /** Deactivate a stake account. SOL is withdrawable after ~1 epoch (~2-3 days). */
  unstakeSOL(stakeAccount: PublicKey | string, opts?: BuildAndSendOptions): Promise<string> {
    return unstakeSOL(this.wallet, this.connection, { stakeAccount }, opts);
  }

  /** List all stake accounts owned by the wallet. */
  getStakeAccounts(): Promise<StakeAccountInfo[]> {
    return getStakeAccounts(this.connection, this.wallet.publicKey);
  }
}
