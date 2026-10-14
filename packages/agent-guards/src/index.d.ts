// Type definitions for @three-ws/agent-guards

export declare class ThreeWsError extends Error {
	name: string;
	code: string;
	status: number | null;
	detail?: unknown;
	retryAfter?: number;
	body: unknown;
}

export declare class PaymentRequiredError extends ThreeWsError {
	accepts: unknown | null;
}

export declare const DEFAULT_BASE_URL: string;
export declare const LAMPORTS_PER_SOL: bigint;
export declare const SOL_FEE_HEADROOM_LAMPORTS: bigint;

export type TradeSide = 'buy' | 'sell';
export type SpendCategory = 'trade' | 'snipe' | 'x402' | 'withdraw';

/** Machine codes a blocked trade/spend resolves to — grounded in the server guards. */
export type GuardReason =
	| 'kill_switch'
	| 'wallet_frozen'
	| 'per_trade_cap'
	| 'daily_budget'
	| 'per_tx_exceeded'
	| 'daily_exceeded'
	| 'max_positions'
	| 'price_impact'
	| 'insufficient_sol'
	| 'destination_not_allowed';

// ── policy + local guards ──────────────────────────────────────────────────────

/** A loose policy patch — any subset of these keys; the rest fall back to defaults. */
export interface PolicyInput {
	per_trade_sol?: number | null;
	daily_budget_sol?: number | null;
	max_price_impact_pct?: number;
	max_slippage_bps?: number;
	max_concurrent?: number | null;
	kill_switch?: boolean;
	daily_usd?: number | null;
	per_tx_usd?: number | null;
	withdraw_allowlist?: string[];
	frozen?: boolean;
}

/** A normalized, bounded policy — the output of `policy()`, ready for `guard()`. */
export interface Policy {
	per_trade_sol: number | null;
	daily_budget_sol: number | null;
	max_price_impact_pct: number;
	max_slippage_bps: number;
	max_concurrent: number | null;
	kill_switch: boolean;
	daily_usd: number | null;
	per_tx_usd: number | null;
	withdraw_allowlist: string[];
	frozen: boolean;
}

/** A proposed movement plus the live numbers the guards compare against. */
export interface GuardTx {
	side?: TradeSide;
	category?: SpendCategory;
	amountSol?: number;
	amountLamports?: bigint | number | string;
	priceImpactPct?: number;
	walletLamports?: bigint | number | string;
	spentLamports?: bigint | number | string;
	openCount?: number;
	usdValue?: number;
	spentUsd?: number;
	destination?: string;
}

/** The verdict of a local guard run. */
export interface GuardDecision {
	allow: boolean;
	reason: GuardReason | null;
	message: string | null;
	detail: Record<string, unknown>;
}

/** A blocked predicate result (`null` when the check passes). */
export interface GuardBlock {
	reason: GuardReason;
	detail: Record<string, unknown>;
}

export declare const TRADE_LIMIT_DEFAULTS: Readonly<{
	per_trade_sol: null;
	daily_budget_sol: null;
	max_price_impact_pct: number;
	max_slippage_bps: number;
	max_concurrent: null;
	kill_switch: boolean;
}>;
export declare const SPEND_LIMIT_DEFAULTS: Readonly<{
	daily_usd: null;
	per_tx_usd: null;
	withdraw_allowlist: string[];
	frozen: boolean;
}>;

export declare function policy(raw?: PolicyInput): Policy;
export declare function guard(tx?: GuardTx, pol?: Policy | PolicyInput): GuardDecision;

export declare function checkKillSwitch(killed: boolean): GuardBlock | null;
export declare function checkFrozen(frozen: boolean, category?: SpendCategory): GuardBlock | null;
export declare function checkConcurrency(openCount: number, maxConcurrent: number | null): GuardBlock | null;
export declare function checkPerTradeCap(amountLamports: bigint | number | string, capLamports: bigint | number | string | null): GuardBlock | null;
export declare function checkDailyBudgetLamports(spentLamports: bigint | number | string, amountLamports: bigint | number | string, budgetLamports: bigint | number | string | null): GuardBlock | null;
export declare function checkSolHeadroom(walletLamports: bigint | number | string, spendLamports: bigint | number | string, headroomLamports?: bigint): GuardBlock | null;
export declare function checkPriceImpact(priceImpactPct: number | null, maxPct: number | null): GuardBlock | null;
export declare function checkPerTxUsd(usdValue: number | null, perTxUsd: number | null, category?: SpendCategory): GuardBlock | null;
export declare function checkDailyUsd(spentUsd: number | null, usdValue: number | null, dailyUsd: number | null, category?: SpendCategory): GuardBlock | null;
export declare function checkAllowlist(destination: string | undefined, allowlist: string[]): GuardBlock | null;

// ── HTTP client ────────────────────────────────────────────────────────────────

export interface GuardsClientOptions {
	baseUrl?: string;
	fetch?: typeof fetch;
	/** Owner bearer token attached as Authorization. */
	apiKey?: string;
	/** Owner session cookie. */
	cookie?: string;
	headers?: Record<string, string>;
}

export interface AgentBindingOptions {
	signal?: AbortSignal;
	token?: string;
	apiKey?: string;
	cookie?: string;
	baseUrl?: string;
	fetch?: typeof fetch;
	headers?: Record<string, string>;
}

/** Effective discretionary-trade policy (camelCase) plus a `.raw` escape hatch. */
export interface TradeLimits {
	perTradeSol: number | null;
	dailyBudgetSol: number | null;
	maxPriceImpactPct: number | null;
	maxSlippageBps: number | null;
	maxConcurrent: number | null;
	killSwitch: boolean;
	updatedAt: string | null;
	defaults?: unknown;
	raw: unknown;
}

/** Effective cross-path USD spend policy (camelCase) plus a `.raw` escape hatch. */
export interface SpendLimits {
	dailyUsd: number | null;
	perTxUsd: number | null;
	withdrawAllowlist: string[];
	frozen: boolean;
	updatedAt: string | null;
	spentTodayUsd?: number | null;
	spentTodaySol?: number | null;
	raw: unknown;
}

export interface TradeLimitsPatch {
	per_trade_sol?: number | null;
	daily_budget_sol?: number | null;
	max_price_impact_pct?: number;
	max_slippage_bps?: number;
	max_concurrent?: number | null;
	kill_switch?: boolean;
}

export interface SpendLimitsPatch {
	daily_usd?: number | null;
	per_tx_usd?: number | null;
	withdraw_allowlist?: string[];
	frozen?: boolean;
}

export interface TradeInput {
	side: TradeSide;
	mint: string;
	amount: number | 'max';
	slippageBps?: number;
	network?: string;
	idempotencyKey?: string;
	simulate?: boolean;
}

/** The pre-flight verdict from `checkTrade`. */
export interface Decision {
	allowed: boolean;
	reason: GuardReason | null;
	message: string | null;
	detail: Record<string, unknown>;
	side: string | null;
	mint: string | null;
	venue: string | null;
	priceImpactPct: number | null;
	raw: unknown;
}

export interface TradeResult {
	signature?: string;
	explorer?: string;
	side?: string;
	mint?: string;
	network?: string;
	venue?: string;
	simulated?: boolean;
	raw: unknown;
	[key: string]: unknown;
}

export interface CallOptions {
	signal?: AbortSignal;
	network?: string;
}

export interface AgentGuards {
	id: string;
	getTradeLimits(opts?: { signal?: AbortSignal }): Promise<TradeLimits>;
	setTradeLimits(patch: TradeLimitsPatch, opts?: { signal?: AbortSignal }): Promise<TradeLimits>;
	getSpendLimits(opts?: CallOptions): Promise<SpendLimits>;
	setSpendLimits(patch: SpendLimitsPatch, opts?: CallOptions): Promise<SpendLimits>;
	checkTrade(input: TradeInput, opts?: { signal?: AbortSignal }): Promise<Decision>;
	trade(input: TradeInput, opts?: { signal?: AbortSignal }): Promise<TradeResult>;
}

export interface GuardsClient {
	forAgent(agentId: string, opts?: { signal?: AbortSignal }): AgentGuards;
}

export declare function createGuards(options?: GuardsClientOptions): GuardsClient;
export declare function guards(agentId: string, options?: AgentBindingOptions): AgentGuards;

// ── signed spend delegation ────────────────────────────────────────────────

export interface SpendDelegation {
	agent: string;
	owner: string;
	cap_lamports_per_epoch: string | number | bigint;
	epoch_seconds: string | number;
	not_after: string | number;
	nonce: string;
}

export type DelegationCanonicalFields = Record<
	'agent' | 'owner' | 'cap_lamports_per_epoch' | 'epoch_seconds' | 'not_after' | 'nonce',
	string
>;

export type DelegationCheckCode = 'OK' | 'DELEGATION_EXPIRED' | 'DELEGATION_CAP_EXCEEDED';

export interface DelegationCheckResult {
	allow: boolean;
	code: DelegationCheckCode;
	reason: string | null;
	detail?: { spentLamports: string; debitLamports: string; capLamportsPerEpoch: string };
}

export declare const DELEGATION_DOMAIN: string;
export declare function canonicalDelegationFields(d: SpendDelegation): DelegationCanonicalFields;
export declare function delegationMessage(d: SpendDelegation): string;
export declare function verifyDelegationSignature(delegation: SpendDelegation, signature: string): boolean;
export declare function checkDelegationCap(args: {
	delegation: SpendDelegation;
	nowSec?: number;
	epochSpentLamports: bigint | number | string;
	debitLamports: bigint | number | string;
}): DelegationCheckResult;
