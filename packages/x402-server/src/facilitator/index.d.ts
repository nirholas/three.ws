import type { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

export interface Signer {
	publicKey: PublicKey;
	signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> | T;
}

type Lazy<T> = T | (() => T);

export interface FacilitatorGuards {
	/** Refuse sponsored settles when the fee wallet would fall below this. Default 20_000_000. */
	sponsorSolFloorLamports?: Lazy<number>;
	/** Smallest atomic amount a sponsored settle must move. Default 1000. */
	minSponsoredSettleAtomic?: Lazy<number>;
	maxCuLimit?: Lazy<number>;
	maxCuPriceMicroLamports?: Lazy<number>;
	maxPriorityLamports?: Lazy<number>;
	confirmTimeoutMs?: Lazy<number>;
	/** Rolling cap on lamports the sponsor may burn. */
	feeBudget?: { lamports: number; windowMs: number };
}

export interface PendingStore {
	get(key: string): Promise<unknown> | unknown;
	set(key: string, value: unknown): Promise<boolean | void> | boolean | void;
	delete(key: string): Promise<void> | void;
}

export interface DecisionEntry {
	at: number;
	action: 'verify' | 'settle';
	ok: boolean;
	reason: string | null;
	payer?: string | null;
	transaction?: string | null;
	feeLamports?: number;
}

export interface DecisionLog {
	log(entry: DecisionEntry): void;
	recent(limit?: number): DecisionEntry[];
	summary(): Record<string, unknown>;
}

export interface FacilitatorOptions {
	connection?: Lazy<Connection>;
	rpcUrls?: string[];
	feePayer?: Lazy<Keypair | Signer>;
	sponsorAddress?: Lazy<string | null>;
	payToAllowlist: Lazy<Iterable<string>>;
	settleableMints?: Lazy<Iterable<string>>;
	guards?: FacilitatorGuards;
	/** Omit for an in-memory store; pass null to supply `pendingStore` per settle. */
	store?: PendingStore | null;
	decisionLog?: DecisionLog | null;
	feeMeter?: unknown;
	tokenPrograms?: { known(mint: string): string | null; resolve(conn: Connection, mint: string): Promise<string> };
	clock?: { now(): number };
	onDecision?: (entry: DecisionEntry) => void;
}

export interface VerifyInput {
	paymentPayload: unknown;
	requirement: Record<string, unknown>;
	feePayerPubkey?: string;
	conn?: Connection;
}

export interface VerifyResult {
	isValid: boolean;
	invalidReason?: string;
	payer?: string;
	network?: string;
	asset?: string;
}

export interface SettleResult {
	success: boolean;
	pending?: boolean;
	reason?: string;
	transaction?: string;
	payer?: string;
	network?: string;
	replayed?: boolean;
	reconciled?: boolean;
}

export interface Facilitator {
	verifyRingPayment(input: VerifyInput): Promise<VerifyResult>;
	settleRingPayment(input: VerifyInput & { pendingStore?: PendingStore | null; idempotencyKey?: string }): Promise<SettleResult>;
	probeSettlementSignature(input: Record<string, unknown>): Promise<unknown>;
	validateRingTransaction(input: Record<string, unknown>): { ok: boolean; reason?: string; decoded?: Record<string, any> };
	decisionLog: DecisionLog | null;
	feeBudget: { lamports: number; windowMs: number; used(): number; allows(n: number): boolean; record(n: number): void } | null;
	sponsorAddress(): string | null;
	payToAllowlist(): Set<string>;
	settleableMints(): Set<string>;
	sponsorKnownBelowFloor(now?: number): boolean;
	noteSponsorRentFailure(simErr: unknown, feePayer: string, now?: number): boolean;
	isFeePayerRentFailure(simErr: unknown): boolean;
	[k: string]: unknown;
}

export function createFacilitator(options: FacilitatorOptions): Facilitator;
export function createFacilitatorHandler(
	facilitator: Facilitator,
	opts: { network: string; name?: string; version?: string | null; basePath?: string },
): (req: any, res: any) => Promise<void>;
export function createFeeBudget(opts: { lamports: number; windowMs: number; clock?: { now(): number } }): NonNullable<Facilitator['feeBudget']>;
export function createFailoverConnection(rpcUrls: string[]): Connection;

export class MemoryPendingStore implements PendingStore {
	get(key: string): unknown;
	set(key: string, value: unknown): boolean;
	delete(key: string): void;
}
export class MemoryDecisionLog implements DecisionLog {
	log(entry: DecisionEntry): void;
	recent(limit?: number): DecisionEntry[];
	summary(): Record<string, unknown>;
}

export const USDC_MAINNET: string;
export const USDC_DEVNET: string;
export const THREE_MINT: string;
export const SETTLEMENT_PENDING_REASON: 'settlement_pending';
export function isSupportedTokenProgram(programId: string): boolean;
export function isFeePayerRentFailure(simErr: unknown): boolean;
export function blockhashIsLive(conn: Connection, blockhash: string): Promise<boolean>;
export function txBase64FromPayload(payload: unknown): string | null;
export function verifyBuyerSignatures(tx: VersionedTransaction, requiredSigners: string[]): { ok: boolean; reason?: string };
