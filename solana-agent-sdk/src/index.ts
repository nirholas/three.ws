// Agent
export { SolanaAgent } from "./agent.js";
export type { SolanaAgentConfig } from "./agent.js";

// Wallet providers
export { KeypairWalletProvider } from "./wallet/keypair.js";
export { BrowserWalletProvider } from "./wallet/browser-server.js";
export { BrowserWalletClient } from "./wallet/browser-client.js";
export type { WalletProvider, TxMetadata, MetaAwareWallet } from "./wallet/types.js";
export { isMetaAware } from "./wallet/types.js";
export type { BrowserWalletOptions, PendingTx } from "./wallet/browser-server.js";
export type { SignerFn, ApprovalHandler, BrowserWalletClientOptions } from "./wallet/browser-client.js";

// Actions
export { transferSol } from "./actions/transfer-sol.js";
export type { TransferSolParams } from "./actions/transfer-sol.js";
export { transferSpl } from "./actions/transfer-spl.js";
export type { TransferSplParams } from "./actions/transfer-spl.js";
export { jupiterSwap, getSwapQuote, SOL_MINT } from "./actions/swap.js";
export type { SwapParams, JupiterQuote } from "./actions/swap.js";
export { getOrCreateAta } from "./actions/ata.js";
export type { GetOrCreateAtaParams, GetOrCreateAtaResult } from "./actions/ata.js";

// TX utilities
export { buildAndSend, estimatePriorityFee, estimateComputeUnits } from "./tx/index.js";
export type { BuildAndSendOptions } from "./tx/build.js";
