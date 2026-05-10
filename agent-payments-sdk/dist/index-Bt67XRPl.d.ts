import { Address } from 'viem';

type SupportedEvmChainId = 1 | 8453 | 42161 | 137 | 56 | 43114;

/**
 * x402 payment header encoding for EVM-originated payments.
 *
 * When an agent API returns HTTP 402 with an X-Payment-Required header,
 * this client handles quoting and attaches the payment proof header
 * (X-Payment) to the retry request.
 *
 * Usage:
 *   const fetcher = createEvmX402Fetch({ chainId: 8453, walletClient })
 *   const res = await fetcher("https://agent.example/api/chat", { method: "POST", ... })
 */
interface EvmX402PaymentRequirements {
    scheme: "pump-agent-evm";
    network: string;
    agentMint: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: Address;
    memo: string;
    quoteId?: string;
}
interface EvmWalletClient {
    chainId: SupportedEvmChainId;
    address: Address;
    sendTransaction: (tx: {
        to: Address;
        data: `0x${string}`;
        value: bigint;
        chainId: number;
    }) => Promise<`0x${string}`>;
}
interface EvmX402FetchOptions {
    walletClient: EvmWalletClient;
    /** Called before signing so the UI can show "paying $X..." */
    onPaymentRequired?: (requirements: EvmX402PaymentRequirements) => Promise<boolean>;
    /** Called after the bridge tx is submitted with the tx hash */
    onPaymentSubmitted?: (txHash: `0x${string}`, depositId: string) => void;
}
/**
 * Returns a fetch-compatible function that automatically handles HTTP 402
 * responses by paying via EVM cross-chain and retrying the request.
 */
declare function createEvmX402Fetch(opts: EvmX402FetchOptions): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface EvmPaymentProof {
    scheme: "pump-agent-evm";
    chainId: SupportedEvmChainId;
    txHash: `0x${string}`;
    quoteId: string;
    memo: string;
}
interface VerifyEvmPaymentParams {
    /** Decoded proof from the X-Payment header */
    proof: EvmPaymentProof;
    /** Expected memo / invoice ID */
    expectedMemo: string;
    /** Minimum USDC amount that must arrive on Solana (6 decimals) */
    minAmountUsdc: bigint;
    /** Solana agent mint for this agent */
    agentMint: string;
    /**
     * Whether to wait for Solana arrival before returning.
     * Set to false if you want to verify the EVM tx only and handle
     * Solana arrival asynchronously (webhook / queue).
     */
    waitForSolana?: boolean;
}
interface EvmPaymentVerificationResult {
    valid: boolean;
    /** Deposit ID for status polling */
    depositId?: string;
    /** Solana tx signature (only when waitForSolana: true and arrived) */
    solanaSignature?: string;
    /** Amount confirmed on Solana (6-decimal USDC) */
    confirmedAmountUsdc?: bigint;
    error?: string;
}
/**
 * Server-side facilitator: verify an EVM payment proof from the X-Payment header.
 *
 * Call this from your API route after decoding the X-Payment header:
 *
 *   const proof = JSON.parse(atob(req.headers["x-payment"]))
 *   const result = await verifyEvmPayment({ proof, expectedMemo, minAmountUsdc, agentMint })
 *   if (!result.valid) return res.status(402).json({ error: result.error })
 */
declare function verifyEvmPayment(params: VerifyEvmPaymentParams): Promise<EvmPaymentVerificationResult>;
/**
 * Decode and validate the X-Payment header from an incoming request.
 * Returns null if the header is missing or malformed.
 */
declare function decodePaymentHeader(headerValue: string | null | undefined): EvmPaymentProof | null;
/**
 * Build the X-Payment-Required header value for an agent API endpoint.
 * Include this in HTTP 402 responses so EVM clients know how to pay.
 */
declare function buildPaymentRequiredHeader(opts: {
    agentMint: string;
    maxAmountUsdc: bigint;
    resource: string;
    description: string;
    payTo: Address;
    memo: string;
}): string;

type index_EvmPaymentProof = EvmPaymentProof;
type index_EvmPaymentVerificationResult = EvmPaymentVerificationResult;
type index_EvmWalletClient = EvmWalletClient;
type index_EvmX402FetchOptions = EvmX402FetchOptions;
type index_EvmX402PaymentRequirements = EvmX402PaymentRequirements;
type index_VerifyEvmPaymentParams = VerifyEvmPaymentParams;
declare const index_buildPaymentRequiredHeader: typeof buildPaymentRequiredHeader;
declare const index_createEvmX402Fetch: typeof createEvmX402Fetch;
declare const index_decodePaymentHeader: typeof decodePaymentHeader;
declare const index_verifyEvmPayment: typeof verifyEvmPayment;
declare namespace index {
  export { type index_EvmPaymentProof as EvmPaymentProof, type index_EvmPaymentVerificationResult as EvmPaymentVerificationResult, type index_EvmWalletClient as EvmWalletClient, type index_EvmX402FetchOptions as EvmX402FetchOptions, type index_EvmX402PaymentRequirements as EvmX402PaymentRequirements, type index_VerifyEvmPaymentParams as VerifyEvmPaymentParams, index_buildPaymentRequiredHeader as buildPaymentRequiredHeader, index_createEvmX402Fetch as createEvmX402Fetch, index_decodePaymentHeader as decodePaymentHeader, index_verifyEvmPayment as verifyEvmPayment };
}

export { type EvmPaymentProof as E, type VerifyEvmPaymentParams as V, type EvmPaymentVerificationResult as a, type EvmWalletClient as b, type EvmX402FetchOptions as c, type EvmX402PaymentRequirements as d, buildPaymentRequiredHeader as e, createEvmX402Fetch as f, decodePaymentHeader as g, index as i, verifyEvmPayment as v };
