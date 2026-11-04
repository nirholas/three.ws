// Agent
export { SolanaAgent } from "./agent.js";
export type { SolanaAgentConfig } from "./agent.js";

// Wallet providers
export { KeypairWalletProvider } from "./wallet/keypair.js";
export { BrowserWalletProvider } from "./wallet/browser-server.js";
export { BrowserWalletClient } from "./wallet/browser-client.js";
export { WalletAdapterProvider } from "./wallet/wallet-adapter.js";
export type { WalletProvider, TxMetadata, MetaAwareWallet } from "./wallet/types.js";
export { isMetaAware } from "./wallet/types.js";
export type { BrowserWalletOptions, PendingTx, SignOutcome } from "./wallet/browser-server.js";
export type { KeypairWalletOptions } from "./wallet/keypair.js";
export type { SignerFn, ApprovalHandler, BrowserWalletClientOptions } from "./wallet/browser-client.js";
export type { WalletAdapterLike } from "./wallet/wallet-adapter.js";

// Actions
export { transferSol } from "./actions/transfer-sol.js";
export type { TransferSolParams } from "./actions/transfer-sol.js";
export { transferSpl } from "./actions/transfer-spl.js";
export type { TransferSplParams } from "./actions/transfer-spl.js";
export { jupiterSwap, getSwapQuote, SOL_MINT } from "./actions/swap.js";
export type { SwapParams, JupiterQuote } from "./actions/swap.js";
export { getOrCreateAta } from "./actions/ata.js";
export type { GetOrCreateAtaParams, GetOrCreateAtaResult } from "./actions/ata.js";
export { getTokenBalance } from "./actions/get-token-balance.js";
export type { TokenBalanceResult } from "./actions/get-token-balance.js";
export { getTokenAccounts } from "./actions/get-token-accounts.js";
export type { TokenAccount } from "./actions/get-token-accounts.js";
export { stakeSOL, unstakeSOL, getStakeAccounts } from "./actions/stake.js";
export type { StakeSolParams, StakeSolResult, UnstakeSolParams, StakeAccountInfo } from "./actions/stake.js";

// Errors
export {
  SolanaAgentError,
  TransactionRejectedError,
  WalletNotConnectedError,
  WalletCapabilityError,
  MissingTokenAccountError,
  SwapError,
  SimulationError,
  ConfirmationTimeoutError,
  TransactionFailedError,
  RetriesExhaustedError,
  LookupTableNotFoundError,
  MintNotFoundError,
  NotATokenMintError,
  InvalidInputError,
  RequestFailedError,
  ReceiptVerificationError,
} from "./errors.js";

// TX utilities
export { buildAndSend, fetchLookupTables, estimatePriorityFee, estimateComputeUnits, priorityFeeIx, computeUnitIx, confirmSignature, DEFAULT_CONFIRM_TIMEOUT_MS } from "./tx/index.js";
export type { BuildAndSendOptions } from "./tx/build.js";
export type { ConfirmOptions, ConfirmCommitment } from "./tx/confirm.js";

// Memo
export { memoInstruction, MEMO_PROGRAM_ID } from "./utils/memo.js";

// Token-2022 detection: resolve whether a mint is classic SPL Token or Token-2022
// so consumers building their own instructions target the correct program.
export { resolveTokenProgramId } from "./utils/token-program.js";

// Format utilities
export { toUiAmount } from "./utils/format.js";

// AgenC adapter: read + write the AgenC coordination protocol (agenc.tech).
export * from "./actions/agenc/index.js";

// Provably-fair vanity grinding: verify a three.ws vanity receipt entirely
// client-side, open the sealed key, or run the whole request→open→verify flow
// in one call. Proves the key was generated fresh and never kept.
export * from "./vanity/index.js";
