import { Address, Hex, Hash, Log } from 'viem';

type EvmChainId = 1 | 8453 | 42161 | 137 | 56 | 43114;
interface EvmChainConfig {
    id: EvmChainId;
    name: string;
    rpcUrl: string;
    blockExplorer: string;
    nativeCurrency: {
        name: string;
        symbol: string;
        decimals: number;
    };
    /** USDC token address on this chain */
    usdc: Address;
    /** WETH/wrapped native address */
    wrappedNative: Address;
    /** Deployed AgentPayments contract — set after deployment */
    agentPayments: Address;
}
declare const EVM_CHAINS: Record<EvmChainId, EvmChainConfig>;
declare const SUPPORTED_CHAIN_IDS: EvmChainId[];
declare function getEvmChain(chainId: EvmChainId): EvmChainConfig;
declare function isEvmChainSupported(chainId: number): chainId is EvmChainId;
/** Native ETH/BNB/AVAX sentinel address (matches EIP-7528) */
declare const NATIVE_TOKEN_ADDRESS: Address;

/** Mirrors Solana's TokenAgentPayments account */
interface EvmAgentConfig {
    agentToken: Address;
    authority: Address;
    buybackBps: number;
    exists: boolean;
}
/** Mirrors Solana's AgentBalances */
interface EvmAgentBalances {
    agentToken: Address;
    currencyToken: Address;
    paymentVault: bigint;
    buybackVault: bigint;
    withdrawVault: bigint;
}
/** Mirrors Solana's TokenAgentPaymentInCurrency */
interface EvmPaymentStats {
    agentToken: Address;
    currencyToken: Address;
    totalPayments: bigint;
    totalBuybacks: bigint;
    totalWithdrawn: bigint;
    tokensBurned: bigint;
}
/** Mirrors Solana's CreateParams */
interface EvmCreateParams {
    agentToken: Address;
    agentAuthority: Address;
    buybackBps: number;
}
/** Mirrors Solana's AcceptPaymentSimpleParams */
interface EvmAcceptPaymentParams {
    agentToken: Address;
    currencyToken: Address | "native";
    amount: bigint;
    memo: bigint;
    startTime: bigint;
    endTime: bigint;
}
/** Mirrors Solana's DistributePaymentsParams */
interface EvmDistributePaymentsParams {
    agentToken: Address;
    currencyToken: Address;
}
/** Mirrors Solana's BuybackTriggerParams */
interface EvmBuybackTriggerParams {
    agentToken: Address;
    currencyToken: Address;
    swapRouter: Address;
    swapData: Hex;
}
/** Mirrors Solana's WithdrawParams */
interface EvmWithdrawParams {
    agentToken: Address;
    currencyToken: Address;
    receiver: Address;
}
interface EvmUpdateBuybackBpsParams {
    agentToken: Address;
    buybackBps: number;
}
interface EvmUpdateAuthorityParams {
    agentToken: Address;
    newAuthority: Address;
}
/** A built unsigned EVM transaction ready for the user's wallet to sign */
interface EvmUnsignedTx {
    to: Address;
    data: Hex;
    value: bigint;
    chainId: EvmChainId;
}
/** An optional ERC-20 approval + main transaction pair */
interface EvmTxBundle {
    /** ERC-20 approval — present when paying with an ERC-20 token */
    approval?: EvmUnsignedTx;
    /** The main contract call */
    tx: EvmUnsignedTx;
}
/** Mirrors Solana's invoice validation result */
interface EvmInvoiceValidationResult {
    paid: boolean;
    invoiceId: Hash;
    txHash?: Hash;
    blockNumber?: bigint;
}
interface EvmAgentCreatedEvent {
    name: "AgentCreated";
    agentToken: Address;
    authority: Address;
    buybackBps: number;
    txHash: Hash;
    blockNumber: bigint;
}
interface EvmPaymentAcceptedEvent {
    name: "PaymentAccepted";
    agentToken: Address;
    payer: Address;
    currencyToken: Address;
    amount: bigint;
    memo: bigint;
    invoiceId: Hash;
    txHash: Hash;
    blockNumber: bigint;
}
interface EvmPaymentsDistributedEvent {
    name: "PaymentsDistributed";
    agentToken: Address;
    currencyToken: Address;
    buybackAmount: bigint;
    withdrawAmount: bigint;
    txHash: Hash;
    blockNumber: bigint;
}
interface EvmBuybackTriggeredEvent {
    name: "BuybackTriggered";
    agentToken: Address;
    currencyToken: Address;
    currencySpent: bigint;
    tokensBurned: bigint;
    txHash: Hash;
    blockNumber: bigint;
}
interface EvmWithdrawnEvent {
    name: "Withdrawn";
    agentToken: Address;
    authority: Address;
    currencyToken: Address;
    amount: bigint;
    receiver: Address;
    txHash: Hash;
    blockNumber: bigint;
}
type EvmAgentEvent = EvmAgentCreatedEvent | EvmPaymentAcceptedEvent | EvmPaymentsDistributedEvent | EvmBuybackTriggeredEvent | EvmWithdrawnEvent;

/**
 * EvmAgentOffline — builds unsigned EVM transactions for the Agent Payments contract.
 * No RPC connection required. Mirrors PumpAgentOffline from the Solana SDK.
 *
 * Usage:
 *   const agent = new EvmAgentOffline("0xYourAgentToken", 8453);
 *   const bundle = agent.buildAcceptPaymentTx({ ... });
 *   // send bundle.approval then bundle.tx via user's wallet
 */
declare class EvmAgentOffline {
    readonly agentToken: Address;
    readonly chainId: EvmChainId;
    readonly contractAddress: Address;
    constructor(agentToken: Address, chainId: EvmChainId);
    /** Build the createAgent transaction (one-time agent registration). */
    buildCreateAgentTx(params: EvmCreateParams): EvmUnsignedTx;
    /**
     * Build the acceptPayment transaction bundle.
     * Returns an optional ERC-20 approval + the main payment tx.
     *
     * For native currency (ETH/BNB/AVAX), pass currencyToken as "native".
     * The value field on the tx will be set to the payment amount.
     */
    buildAcceptPaymentTx(params: EvmAcceptPaymentParams, _payer: Address): EvmTxBundle;
    /**
     * Convenience wrapper: auto-generates memo + time window.
     * Mirrors PumpAgentOffline.buildAcceptPaymentInstructions().
     */
    buildAcceptPaymentInstructions(opts: {
        agentToken: Address;
        currencyToken: Address | "native";
        amount: bigint;
        payer: Address;
        windowSeconds?: number;
    }): {
        bundle: EvmTxBundle;
        memo: bigint;
        invoiceId: Hex;
    };
    /** Build the distributePayments transaction. Permissionless. */
    buildDistributePaymentsTx(params: EvmDistributePaymentsParams): EvmUnsignedTx;
    /** Build the buybackTrigger transaction. Caller must be global buyback authority. */
    buildBuybackTriggerTx(params: EvmBuybackTriggerParams): EvmUnsignedTx;
    /** Build the withdraw transaction. Caller must be agent authority. */
    buildWithdrawTx(params: EvmWithdrawParams): EvmUnsignedTx;
    buildUpdateBuybackBpsTx(params: EvmUpdateBuybackBpsParams): EvmUnsignedTx;
    buildUpdateAuthorityTx(params: EvmUpdateAuthorityParams): EvmUnsignedTx;
    /** Compute the invoice ID for a payment without sending anything. */
    computeInvoiceId(currencyToken: Address | "native", amount: bigint, memo: bigint, startTime: bigint, endTime: bigint): Hex;
}

/**
 * EvmAgent — extends EvmAgentOffline with RPC reads and invoice validation.
 * Mirrors PumpAgent from the Solana SDK.
 *
 * Usage:
 *   const agent = new EvmAgent("0xYourAgentToken", 8453);
 *   const config = await agent.getAgentConfig();
 *   const balances = await agent.getBalances("0xUSDC...");
 *   const valid = await agent.validateInvoicePayment({ invoiceId, payer, amount, ... });
 */
declare class EvmAgent extends EvmAgentOffline {
    private readonly client;
    constructor(agentToken: Address, chainId: EvmChainId, rpcUrl?: string);
    /** Fetch the agent's on-chain config. Mirrors PumpAgent.getAgentConfig(). */
    getAgentConfig(): Promise<EvmAgentConfig>;
    /** Fetch vault balances for a given currency. Mirrors PumpAgent.getAgentBalances(). */
    getBalances(currencyToken: Address): Promise<EvmAgentBalances>;
    /** Fetch cumulative payment stats. Mirrors PumpAgent.getPaymentStats(). */
    getPaymentStats(currencyToken: Address): Promise<EvmPaymentStats>;
    /** Check if an invoice has already been paid. */
    isInvoicePaid(invoiceId: Hash): Promise<boolean>;
    /**
     * Validate that a specific invoice has been paid on-chain.
     * Mirrors PumpAgent.validateInvoicePayment().
     *
     * Primary path: checks the isInvoicePaid mapping directly.
     * Fallback: scans PaymentAccepted events for matching parameters.
     */
    validateInvoicePayment(params: {
        currencyToken: Address | "native";
        amount: bigint;
        memo: bigint;
        startTime: bigint;
        endTime: bigint;
        payer?: Address;
    }): Promise<EvmInvoiceValidationResult>;
    /**
     * Get recent PaymentAccepted events for this agent.
     * Mirrors PumpAgent payment history queries.
     */
    getPaymentHistory(opts?: {
        currencyToken?: Address;
        payer?: Address;
        fromBlock?: bigint;
        toBlock?: bigint;
    }): Promise<EvmPaymentAcceptedEvent[]>;
}

/**
 * ABI for the EVM Agent Payments contract.
 * Mirrors the Solana pump_agent_payments program interface.
 *
 * Functions:
 *   createAgent       — register an agent (mirrors agentInitialize)
 *   acceptPayment     — user pays agent (mirrors agentAcceptPayment)
 *   distributePayments— split vault to buyback + withdraw (mirrors agentDistributePayments)
 *   buybackTrigger    — swap + burn agent token (mirrors agentBuybackTrigger)
 *   withdraw          — owner pulls from withdraw vault (mirrors agentWithdraw)
 *   updateBuybackBps  — change buyback split
 *   updateAuthority   — transfer agent authority
 */
declare const AGENT_PAYMENTS_ABI: readonly [{
    readonly name: "createAgent";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }, {
        readonly name: "agentAuthority";
        readonly type: "address";
    }, {
        readonly name: "buybackBps";
        readonly type: "uint16";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "acceptPayment";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }, {
        readonly name: "currencyToken";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }, {
        readonly name: "memo";
        readonly type: "uint64";
    }, {
        readonly name: "startTime";
        readonly type: "int64";
    }, {
        readonly name: "endTime";
        readonly type: "int64";
    }];
    readonly outputs: readonly [{
        readonly name: "invoiceId";
        readonly type: "bytes32";
    }];
}, {
    readonly name: "acceptPaymentNative";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }, {
        readonly name: "memo";
        readonly type: "uint64";
    }, {
        readonly name: "startTime";
        readonly type: "int64";
    }, {
        readonly name: "endTime";
        readonly type: "int64";
    }];
    readonly outputs: readonly [{
        readonly name: "invoiceId";
        readonly type: "bytes32";
    }];
}, {
    readonly name: "distributePayments";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }, {
        readonly name: "currencyToken";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "buybackTrigger";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }, {
        readonly name: "currencyToken";
        readonly type: "address";
    }, {
        readonly name: "swapRouter";
        readonly type: "address";
    }, {
        readonly name: "swapData";
        readonly type: "bytes";
    }];
    readonly outputs: readonly [{
        readonly name: "tokensBurned";
        readonly type: "uint256";
    }];
}, {
    readonly name: "withdraw";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }, {
        readonly name: "currencyToken";
        readonly type: "address";
    }, {
        readonly name: "receiver";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "amount";
        readonly type: "uint256";
    }];
}, {
    readonly name: "updateBuybackBps";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }, {
        readonly name: "buybackBps";
        readonly type: "uint16";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "updateAuthority";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }, {
        readonly name: "newAuthority";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly name: "getAgentConfig";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "authority";
        readonly type: "address";
    }, {
        readonly name: "buybackBps";
        readonly type: "uint16";
    }, {
        readonly name: "exists";
        readonly type: "bool";
    }];
}, {
    readonly name: "getBalances";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }, {
        readonly name: "currencyToken";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "paymentVault";
        readonly type: "uint256";
    }, {
        readonly name: "buybackVault";
        readonly type: "uint256";
    }, {
        readonly name: "withdrawVault";
        readonly type: "uint256";
    }];
}, {
    readonly name: "getPaymentStats";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
    }, {
        readonly name: "currencyToken";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "totalPayments";
        readonly type: "uint256";
    }, {
        readonly name: "totalBuybacks";
        readonly type: "uint256";
    }, {
        readonly name: "totalWithdrawn";
        readonly type: "uint256";
    }, {
        readonly name: "tokensBurned";
        readonly type: "uint256";
    }];
}, {
    readonly name: "isInvoicePaid";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "invoiceId";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "AgentCreated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "authority";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "buybackBps";
        readonly type: "uint16";
        readonly indexed: false;
    }];
}, {
    readonly name: "PaymentAccepted";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "payer";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "currencyToken";
        readonly type: "address";
        readonly indexed: false;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "memo";
        readonly type: "uint64";
        readonly indexed: false;
    }, {
        readonly name: "invoiceId";
        readonly type: "bytes32";
        readonly indexed: false;
    }];
}, {
    readonly name: "PaymentsDistributed";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "currencyToken";
        readonly type: "address";
        readonly indexed: false;
    }, {
        readonly name: "buybackAmount";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "withdrawAmount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "BuybackTriggered";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "currencyToken";
        readonly type: "address";
        readonly indexed: false;
    }, {
        readonly name: "currencySpent";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "tokensBurned";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly name: "Withdrawn";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "authority";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "currencyToken";
        readonly type: "address";
        readonly indexed: false;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "receiver";
        readonly type: "address";
        readonly indexed: false;
    }];
}, {
    readonly name: "AuthorityUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "oldAuthority";
        readonly type: "address";
        readonly indexed: false;
    }, {
        readonly name: "newAuthority";
        readonly type: "address";
        readonly indexed: false;
    }];
}, {
    readonly name: "BuybackBpsUpdated";
    readonly type: "event";
    readonly inputs: readonly [{
        readonly name: "agentToken";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "oldBps";
        readonly type: "uint16";
        readonly indexed: false;
    }, {
        readonly name: "newBps";
        readonly type: "uint16";
        readonly indexed: false;
    }];
}];
declare const ERC20_ABI: readonly [{
    readonly name: "approve";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "spender";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "bool";
    }];
}, {
    readonly name: "allowance";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "owner";
        readonly type: "address";
    }, {
        readonly name: "spender";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "balanceOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "account";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly name: "decimals";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint8";
    }];
}];

/**
 * Derives a deterministic invoice ID — the EVM equivalent of the Solana InvoiceId PDA.
 *
 * Mirrors PDA seeds: ["invoice-id", tokenMint, currencyMint, amount, memo, startTime, endTime]
 *
 * On-chain the contract computes:
 *   keccak256(abi.encode(agentToken, currencyToken, amount, memo, startTime, endTime))
 */
declare function getInvoiceId(agentToken: Address, currencyToken: Address, amount: bigint, memo: bigint, startTime: bigint, endTime: bigint): `0x${string}`;
/**
 * Build a time-bounded invoice window matching the Solana SDK's convention.
 * Returns startTime and endTime as unix timestamps (seconds).
 *
 * @param windowSeconds  How long the invoice is valid (default: 5 minutes)
 */
declare function buildInvoiceWindow(windowSeconds?: number): {
    startTime: bigint;
    endTime: bigint;
};
/**
 * Generate a random memo ID — same helper pattern as the Solana SDK.
 * Returns a random u64 as bigint.
 */
declare function generateMemo(): bigint;

type RawLog = Log & {
    args?: Record<string, unknown>;
    eventName?: string;
};
/**
 * Parse raw viem event logs into typed EvmAgentEvent objects.
 * Mirrors parseAgentEvents() from the Solana SDK.
 */
declare function parseEvmAgentEvents(logs: RawLog[]): EvmAgentEvent[];

declare const index_AGENT_PAYMENTS_ABI: typeof AGENT_PAYMENTS_ABI;
declare const index_ERC20_ABI: typeof ERC20_ABI;
declare const index_EVM_CHAINS: typeof EVM_CHAINS;
type index_EvmAcceptPaymentParams = EvmAcceptPaymentParams;
type index_EvmAgent = EvmAgent;
declare const index_EvmAgent: typeof EvmAgent;
type index_EvmAgentBalances = EvmAgentBalances;
type index_EvmAgentConfig = EvmAgentConfig;
type index_EvmAgentCreatedEvent = EvmAgentCreatedEvent;
type index_EvmAgentEvent = EvmAgentEvent;
type index_EvmAgentOffline = EvmAgentOffline;
declare const index_EvmAgentOffline: typeof EvmAgentOffline;
type index_EvmBuybackTriggerParams = EvmBuybackTriggerParams;
type index_EvmBuybackTriggeredEvent = EvmBuybackTriggeredEvent;
type index_EvmChainConfig = EvmChainConfig;
type index_EvmChainId = EvmChainId;
type index_EvmCreateParams = EvmCreateParams;
type index_EvmDistributePaymentsParams = EvmDistributePaymentsParams;
type index_EvmInvoiceValidationResult = EvmInvoiceValidationResult;
type index_EvmPaymentAcceptedEvent = EvmPaymentAcceptedEvent;
type index_EvmPaymentStats = EvmPaymentStats;
type index_EvmPaymentsDistributedEvent = EvmPaymentsDistributedEvent;
type index_EvmTxBundle = EvmTxBundle;
type index_EvmUnsignedTx = EvmUnsignedTx;
type index_EvmUpdateAuthorityParams = EvmUpdateAuthorityParams;
type index_EvmUpdateBuybackBpsParams = EvmUpdateBuybackBpsParams;
type index_EvmWithdrawParams = EvmWithdrawParams;
type index_EvmWithdrawnEvent = EvmWithdrawnEvent;
declare const index_NATIVE_TOKEN_ADDRESS: typeof NATIVE_TOKEN_ADDRESS;
declare const index_SUPPORTED_CHAIN_IDS: typeof SUPPORTED_CHAIN_IDS;
declare const index_buildInvoiceWindow: typeof buildInvoiceWindow;
declare const index_generateMemo: typeof generateMemo;
declare const index_getEvmChain: typeof getEvmChain;
declare const index_getInvoiceId: typeof getInvoiceId;
declare const index_isEvmChainSupported: typeof isEvmChainSupported;
declare const index_parseEvmAgentEvents: typeof parseEvmAgentEvents;
declare namespace index {
  export { index_AGENT_PAYMENTS_ABI as AGENT_PAYMENTS_ABI, index_ERC20_ABI as ERC20_ABI, index_EVM_CHAINS as EVM_CHAINS, type index_EvmAcceptPaymentParams as EvmAcceptPaymentParams, index_EvmAgent as EvmAgent, type index_EvmAgentBalances as EvmAgentBalances, type index_EvmAgentConfig as EvmAgentConfig, type index_EvmAgentCreatedEvent as EvmAgentCreatedEvent, type index_EvmAgentEvent as EvmAgentEvent, index_EvmAgentOffline as EvmAgentOffline, type index_EvmBuybackTriggerParams as EvmBuybackTriggerParams, type index_EvmBuybackTriggeredEvent as EvmBuybackTriggeredEvent, type index_EvmChainConfig as EvmChainConfig, type index_EvmChainId as EvmChainId, type index_EvmCreateParams as EvmCreateParams, type index_EvmDistributePaymentsParams as EvmDistributePaymentsParams, type index_EvmInvoiceValidationResult as EvmInvoiceValidationResult, type index_EvmPaymentAcceptedEvent as EvmPaymentAcceptedEvent, type index_EvmPaymentStats as EvmPaymentStats, type index_EvmPaymentsDistributedEvent as EvmPaymentsDistributedEvent, type index_EvmTxBundle as EvmTxBundle, type index_EvmUnsignedTx as EvmUnsignedTx, type index_EvmUpdateAuthorityParams as EvmUpdateAuthorityParams, type index_EvmUpdateBuybackBpsParams as EvmUpdateBuybackBpsParams, type index_EvmWithdrawParams as EvmWithdrawParams, type index_EvmWithdrawnEvent as EvmWithdrawnEvent, index_NATIVE_TOKEN_ADDRESS as NATIVE_TOKEN_ADDRESS, index_SUPPORTED_CHAIN_IDS as SUPPORTED_CHAIN_IDS, index_buildInvoiceWindow as buildInvoiceWindow, index_generateMemo as generateMemo, index_getEvmChain as getEvmChain, index_getInvoiceId as getInvoiceId, index_isEvmChainSupported as isEvmChainSupported, index_parseEvmAgentEvents as parseEvmAgentEvents };
}

export { AGENT_PAYMENTS_ABI as A, generateMemo as B, getEvmChain as C, getInvoiceId as D, ERC20_ABI as E, isEvmChainSupported as F, parseEvmAgentEvents as G, NATIVE_TOKEN_ADDRESS as N, SUPPORTED_CHAIN_IDS as S, EVM_CHAINS as a, type EvmAcceptPaymentParams as b, EvmAgent as c, type EvmAgentBalances as d, type EvmAgentConfig as e, type EvmAgentCreatedEvent as f, type EvmAgentEvent as g, EvmAgentOffline as h, type EvmBuybackTriggerParams as i, type EvmBuybackTriggeredEvent as j, type EvmChainConfig as k, type EvmChainId as l, type EvmCreateParams as m, type EvmDistributePaymentsParams as n, type EvmInvoiceValidationResult as o, type EvmPaymentAcceptedEvent as p, type EvmPaymentStats as q, type EvmPaymentsDistributedEvent as r, type EvmTxBundle as s, type EvmUnsignedTx as t, type EvmUpdateAuthorityParams as u, type EvmUpdateBuybackBpsParams as v, type EvmWithdrawParams as w, type EvmWithdrawnEvent as x, buildInvoiceWindow as y, index as z };
