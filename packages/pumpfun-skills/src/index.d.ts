// Type definitions for @three-ws/pumpfun-skills

export declare class ThreeWsError extends Error {
	name: string;
	code: string;
	status: number | null;
	detail?: string;
	retryAfter?: number;
	body: unknown;
}

export declare class PaymentRequiredError extends ThreeWsError {
	accepts: unknown | null;
}

export declare const DEFAULT_BASE_URL: string;
export declare const AGENT_API_BASE: string;
export declare const COINS_V2_BASE: string;
export declare const NATIVE_MINT: string;
export declare const FEE_DESTINATIONS: FeeDestination[];
/** Metaplex's maintained MPL-404 / hybrid swap program. */
export declare const MPL_HYBRID_PROGRAM_ID: string;
export declare const MPL_HYBRID_INSTRUCTION_VERSION: 'V1';
export declare const MPL_HYBRID_ASSET_STANDARD: 'metaplex-core';
export declare const MPL_HYBRID_DOCS_URL: string;

export type FeeDestination = 'creator' | 'cashback' | 'sharing_config';
export type SharingConfigMode = 'create' | 'update';

/** A built Solana transaction the caller signs and broadcasts. */
export interface BuiltTx {
	/** Base64-encoded VersionedTransaction. */
	transaction: string;
	/** Encoding of `transaction` (always `'base64'`). */
	encoding: string;
	/** True when the tx was routed through Jito with a tip instruction. */
	frontRunningProtection: boolean;
	/** Raw upstream response. */
	raw: unknown;
}

/** A built create-coin transaction, partial-signed with the new mint keypair. */
export interface CreateCoinResult extends BuiltTx {
	/** The new coin's mint address. */
	mint: string | null;
	/** three.ws brand mark, when the builder stamped one. */
	brandMark?: string;
}

export interface CreateCoinInput {
	/** Creator wallet public key. */
	user: string;
	/** Token name. */
	name: string;
	/** Token symbol. */
	symbol: string;
	/** Metadata URI (IPFS or HTTPS JSON). */
	uri: string;
	/** Initial buy in lamports (`'0'` for none). */
	solLamports: string;
	mayhemMode?: boolean;
	cashback?: boolean;
	tokenizedAgent?: boolean;
	/** Buyback basis points when `tokenizedAgent`, e.g. 5000 = 50%. */
	buybackBps?: number;
	/** Route via Jito for MEV protection (needs `tipAmount`). */
	frontRunningProtection?: boolean;
	/** Jito tip in SOL, e.g. 0.0001. */
	tipAmount?: number;
	/** Fee payer public key. Defaults to `user`. */
	feePayer?: string;
	/** Creator public key. Defaults to `user`. */
	creator?: string;
}

export interface SwapInput {
	/** Mint to spend. `NATIVE_MINT` for SOL buys. */
	inputMint: string;
	/** Mint to receive. `NATIVE_MINT` for SOL sells. */
	outputMint: string;
	/** Lamports for SOL, or token smallest units (6 decimals). */
	amount: string;
	/** User wallet public key (signer). */
	user: string;
	/** Slippage tolerance, percent. Default 2. */
	slippagePct?: number;
	feePayer?: string;
	frontRunningProtection?: boolean;
	tipAmount?: number;
}

export interface CollectFeesInput {
	/** Token mint. */
	mint: string;
	/** Creator wallet public key. */
	user: string;
	frontRunningProtection?: boolean;
	tipAmount?: number;
}

export interface Shareholder {
	address: string;
	/** Basis points share. All shareholders' bps must sum to 10000. */
	bps: number;
}

export interface SharingConfigInput {
	/** Token mint. */
	mint: string;
	/** Creator wallet public key. */
	user: string;
	/** Up to 10 shareholders; `bps` must total exactly 10000. */
	shareholders: Shareholder[];
	/** Auto-detected if omitted. */
	mode?: SharingConfigMode;
	frontRunningProtection?: boolean;
	tipAmount?: number;
}

export interface SharingConfigInfo {
	address: string | null;
	admin: string | null;
	adminRevoked: boolean;
	shareholders: Shareholder[];
}

export interface FeeInfo {
	mint: string;
	bondingCurve: string | null;
	pool: string | null;
	isGraduated: boolean;
	isCashbackCoin: boolean;
	hasSharingConfig: boolean;
	creator: string | null;
	creatorVaultLamports: string;
	sharingConfig: SharingConfigInfo | null;
	feeDestination: FeeDestination;
	raw: unknown;
}

export interface RequestOptions {
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

export interface ReadOptions {
	signal?: AbortSignal;
}

export interface PumpfunSkillsOptions {
	/** Agent build API origin (default fun-block.pump.fun/agents). */
	agentBaseUrl?: string;
	/** coins-v2 read origin (default frontend-api-v3, or PUMP_COINS_V2_BASE). */
	coinsV2Base?: string;
	fetch?: typeof fetch;
	apiKey?: string;
	headers?: Record<string, string>;
}

export interface PumpfunSkillsClient {
	createCoin(input: CreateCoinInput, opts?: RequestOptions): Promise<CreateCoinResult>;
	swap(input: SwapInput, opts?: RequestOptions): Promise<BuiltTx>;
	collectFees(input: CollectFeesInput, opts?: RequestOptions): Promise<BuiltTx>;
	sharingConfig(input: SharingConfigInput, opts?: RequestOptions): Promise<BuiltTx>;
	coinFees(mint: string, opts?: ReadOptions): Promise<FeeInfo>;
}

export interface Mpl404PlanInput {
	/** The Pump.fun (or another SPL Token) mint that backs each hybrid asset. */
	tokenMint: string;
	/** Metaplex Core collection address. Token Metadata/pNFT collections are not supported by MPL-Hybrid. */
	collection: string;
	/** Wallet that administers the V1 escrow. */
	authority: string;
	/** Fee recipient; defaults to authority. */
	feeLocation?: string;
	name: string;
	uri: string;
	/** Smallest fungible units required to release one Core NFT. */
	amount: string | number | bigint;
	min?: string | number | bigint;
	max?: string | number | bigint;
	feeAmount?: string | number | bigint;
	solFeeAmount?: string | number | bigint;
	path?: number;
}

export interface Mpl404Plan {
	standard: 'mpl-404';
	instructionVersion: 'V1';
	programId: string;
	assetStandard: 'metaplex-core';
	backing: { kind: 'spl-fungible-token'; mint: string };
	collection: string;
	authority: string;
	feeLocation: string;
	initEscrowV1: Record<string, string | number>;
	feeNotice: string;
	docsUrl: string;
	requiredTransactions: ['initEscrowV1', 'captureV1', 'releaseV1'];
}

/** Create a validated, user-signed V1 MPL-404 escrow plan for a Pump.fun mint. */
export declare function createMpl404Plan(input: Mpl404PlanInput): Mpl404Plan;
export declare function isMpl404Compatible(input: { tokenMint?: string; assetStandard?: string }): boolean;

export declare function createPumpfunSkills(options?: PumpfunSkillsOptions): PumpfunSkillsClient;
export declare function createCoin(input: CreateCoinInput, opts?: RequestOptions): Promise<CreateCoinResult>;
export declare function swap(input: SwapInput, opts?: RequestOptions): Promise<BuiltTx>;
export declare function collectFees(input: CollectFeesInput, opts?: RequestOptions): Promise<BuiltTx>;
export declare function sharingConfig(input: SharingConfigInput, opts?: RequestOptions): Promise<BuiltTx>;
export declare function coinFees(mint: string, opts?: ReadOptions): Promise<FeeInfo>;
