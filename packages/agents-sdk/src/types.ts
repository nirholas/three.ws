// Public resource and request types for the three.ws v1 agents API.
//
// Field names match the JSON the server returns (camelCase throughout). The
// path table in ./generated/openapi.ts is generated from the server's route
// table, and the client is type-checked against it, so a method can never point
// at a route that does not exist.

// ── shared ──────────────────────────────────────────────────────────────────

/** A page of results. Pass `nextCursor` back as `cursor` / `before` for the next page. */
export interface Page<T> {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
  requestId: string | null;
}

export interface PageParams {
  /** Items per page. */
  limit?: number;
  /** `nextCursor` from the previous page. */
  cursor?: string;
}

/** Per-call options every method accepts as its last argument. */
export interface RequestOptions {
  /** Override the client timeout for this call, in ms. */
  timeout?: number;
  /** Override the client retry count for this call. */
  retries?: number;
  /** Supply your own Idempotency-Key for a POST instead of a generated one. */
  idempotencyKey?: string;
  /** Abort the call. */
  signal?: AbortSignal;
}

export type Network = "mainnet" | "devnet";

// ── agents ──────────────────────────────────────────────────────────────────

export type StrategyPreset = "momentum" | "sniper" | "defi-yield" | "macro-hedge" | "monitor-exit" | "conservative";

export type AgentStatus = "running" | "stopped";

export interface Agent {
  id: string;
  name: string;
  persona: string | null;
  systemPrompt: string | null;
  model: string | null;
  temperature: number | null;
  strategy: StrategyPreset | string | null;
  skills: string[];
  /** `running` lets automations, intents and runs execute; `stopped` pauses them all. */
  status: AgentStatus;
  statusChangedAt: string | null;
  wallet: { solana: string | null; evm: string | null };
  avatarId: string | null;
  isPublic: boolean;
  /** The agent's public page. */
  url: string;
  createdAt: string;
  updatedAt: string | null;
}

/** createAgent returns the agent plus the default automations its strategy preset installed. */
export interface CreatedAgent extends Agent {
  automations: Automation[];
}

export interface CreateAgentParams {
  name: string;
  /** Short public description of the agent. */
  persona?: string;
  /** Full system prompt. A strategy preset supplies one when omitted. */
  systemPrompt?: string;
  /** Model id from getModels(). Must support tool calling. */
  model?: string;
  temperature?: number;
  /** Built-in skill ids from listSkills(). */
  skills?: string[];
  /** A preset bundle of skills, persona and default automations. */
  strategy?: StrategyPreset;
}

export type UpdateAgentParams = Partial<CreateAgentParams> & { strategy?: StrategyPreset | null };

export interface DeletedResource {
  id: string;
  deleted: true;
}

// ── chat ────────────────────────────────────────────────────────────────────

export interface SendMessageParams {
  message: string;
  /** Override the agent's model for this message. */
  model?: string;
  /** Override the agent's temperature for this message. */
  temperature?: number;
}

export interface ToolCallRecord {
  name: string;
  arguments?: unknown;
  result?: unknown;
  ok?: boolean;
  [key: string]: unknown;
}

export interface MessageUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  [key: string]: unknown;
}

export interface MessageReply {
  id?: string | number;
  /** The agent's reply text. */
  content: string;
  model: string | null;
  provider?: string | null;
  usage: MessageUsage | null;
  /** Credits charged in USD. Zero when the message was covered by the free tier. */
  costCredits: number | null;
  freeTier?: boolean;
  toolCalls: ToolCallRecord[];
  /** Signatures of any on-chain transactions the agent made while answering. */
  signatures: string[];
  createdAt?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  createdAt: string;
  toolCalls?: ToolCallRecord[];
  signatures?: string[];
  [key: string]: unknown;
}

export interface GetMessagesParams {
  limit?: number;
  /** `nextCursor` from the previous page: returns older messages. */
  before?: string;
}

// ── runs ────────────────────────────────────────────────────────────────────

export type RunStatus =
  | "scheduled"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "budget_exhausted";

export interface CreateRunParams {
  /** What the agent should accomplish. */
  goal: string;
  /** Ceiling on model spend from your credits, in USD. */
  budgetCreditsUsd?: number;
  /** Ceiling on on-chain spend from the agent wallet, in USD. */
  budgetUsd?: number;
  /** 1 to 60 model/tool steps. */
  maxSteps?: number;
  /** Restrict the run to these tool names. */
  toolsAllowed?: string[];
  model?: string;
  temperature?: number;
  /** 5-field UTC cron to repeat the run, or omit to start immediately. */
  schedule?: string;
  /** ISO time to start a one-off run later. */
  scheduledFor?: string;
}

export interface Run {
  id: string;
  agentId: string;
  goal: string;
  status: RunStatus;
  [key: string]: unknown;
}

export interface UpdateRunParams {
  /** Pause or resume a run. */
  action?: "pause" | "resume";
  budgetCreditsUsd?: number;
  budgetUsd?: number;
  maxSteps?: number;
}

export type RunStepKind = "status" | "model_call" | "tool_call" | "tool_result" | "tool_blocked" | "final" | "error";

export interface RunStep {
  seq: number;
  kind: RunStepKind;
  [key: string]: unknown;
}

/** One server-sent event from streamRun(). `data` is the parsed JSON payload. */
export interface RunEvent<T = unknown> {
  event: string;
  data: T;
  id: string | null;
}

// ── automations ─────────────────────────────────────────────────────────────

export type AutomationTrigger =
  | { type: "price_threshold"; mint: string; operator: "above" | "below"; priceUsd: number; cooldownMinutes?: number }
  | { type: "schedule"; cron: string; cooldownMinutes?: number }
  | { type: "balance_below"; thresholdSol: number; cooldownMinutes?: number }
  | { type: "tip_received"; minSol?: number; cooldownMinutes?: number }
  | { type: "launch_matching"; creator?: string; maxMcapUsd?: number; minMcapUsd?: number; cooldownMinutes?: number }
  | { type: "graduation"; mint?: string; cooldownMinutes?: number }
  | { type: "whale_buy"; mint: string; minSol: number; cooldownMinutes?: number };

export type AutomationAction =
  | { type: "agent_prompt"; prompt: string; maxSteps?: number; budgetCreditsUsd?: number }
  | { type: "swap"; mint?: string; amountSol: number; slippagePct?: number }
  | { type: "transfer"; destination: string; amountSol: number }
  | { type: "notify"; message?: string };

export interface CreateAutomationParams {
  agentId: string;
  title?: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  /** Fire once, then disable. */
  triggerOnce?: boolean;
  /** Spend ceilings for swap and transfer actions, in USD. */
  limits?: { perActionUsd?: number; dailyUsd?: number; totalUsd?: number };
}

export interface Automation {
  id: string;
  agentId: string | null;
  /** `automation` rows are native; wallet intents and alert rules are listed as the same object. */
  source: "automation" | "wallet_intent" | "alert_rule";
  title: string | null;
  trigger: Record<string, unknown> & { type: string };
  action: Record<string, unknown> & { type: string };
  triggerOnce: boolean;
  enabled: boolean;
  intentId: string | null;
  stats: {
    fireCount: number | null;
    lastFiredAt: string | null;
    lastCheckedAt: string | null;
    lastStatus: string | null;
    lastNote: string | null;
  };
  createdAt: string;
  updatedAt: string | null;
}

export interface DeletedAutomation {
  id: string;
  source: Automation["source"];
  deleted: true;
}

// ── skills ──────────────────────────────────────────────────────────────────

export interface BuiltinSkill {
  id: string;
  name: string;
  description: string;
  /** Core skills are always on; optional skills are toggled per agent. */
  kind: "core" | "optional";
  sellable: boolean;
}

export interface CommunitySkill {
  slug: string;
  name: string;
  description: string;
  author: string | null;
  tags: string[];
  version: string;
  sha256: string | null;
  page: string;
  /** The SKILL.md instructions (getCommunitySkill only). */
  content?: string;
}

export interface CommunitySkillSearch {
  skills: CommunitySkill[];
  count: number;
  total: number;
  tags: string[];
}

export interface CustomSkill {
  id: string;
  agentId: string;
  slug: string;
  name: string;
  description: string;
  author: string | null;
  tags: string[];
  version: string;
  content: string;
  source: "custom" | "community";
  sourceSlug: string | null;
  sourceVersion: string | null;
  enabled: boolean;
  /** Estimated prompt tokens. */
  tokens: number | null;
  /** Whether it fits in the prompt budget and is injected. */
  injected: boolean | null;
  skipReason: string | null;
  registry: { slug: string; latestVersion: string | null; updateAvailable: boolean; removed: boolean } | null;
  installedAt: string;
  updatedAt: string;
}

export interface SkillBudget {
  capTokens: number;
  usedTokens: number;
  enabledTokens: number;
  remainingTokens: number;
  injectedCount: number;
  skippedOverBudget: number;
}

export interface CustomSkillList {
  skills: CustomSkill[];
  budget: SkillBudget;
}

export interface CustomSkillResult {
  skill: CustomSkill;
  budget: SkillBudget;
}

export interface CreateCustomSkillParams {
  name: string;
  /** The instructions, as markdown. */
  content: string;
  description?: string;
  slug?: string;
  tags?: string[];
  version?: string;
  enabled?: boolean;
}

export type UpdateCustomSkillParams = Partial<Omit<CreateCustomSkillParams, "slug">> & {
  /** Pull the latest registry version of an imported skill. */
  resync?: true;
};

// ── wallet ──────────────────────────────────────────────────────────────────

export interface Wallet {
  agentId: string;
  chain: "solana";
  network: Network;
  address: string | null;
  lamports: string | null;
  sol: number | null;
  /** Whether the platform can sign for this wallet. */
  signable: boolean | null;
  depositsEnabled: boolean | null;
  snsDomain: string | null;
}

export interface WalletLedgerEntry {
  id: string;
  type: string;
  category: string | null;
  network: Network;
  asset: string | null;
  amountLamports: string | null;
  amountRaw: string | null;
  usd: number | null;
  destination: string | null;
  signature: string | null;
  explorer: string | null;
  status: string;
  reason: string | null;
  createdAt: string;
}

export interface WalletHistoryParams {
  limit?: number;
  cursor?: string;
  network?: Network;
  /** One spend category, e.g. `withdraw`, `trade`, `x402`. */
  category?: string;
}

export interface TransferQuoteParams {
  destination: string;
  /** Whole units (SOL, or the token's UI amount), or `"max"`. */
  amount: number | "max";
  /** `"SOL"` (default) or an SPL mint. */
  asset?: string;
  network?: Network;
}

export interface TransferQuote {
  quoteId: string;
  expiresAt: string;
  preview: {
    asset: string;
    network: Network;
    destination: string;
    amount: number;
    lamports: string | null;
    amountRaw: string | null;
    usd: number | null;
    note: string | null;
    simulation: { ok: boolean; error: unknown; unitsConsumed: number | null };
  };
}

export interface TransferParams {
  quoteId: string;
  /** Must be `true`. The client refuses to send without it. */
  confirm: true;
}

export interface TransferResult {
  status: "confirmed" | "submitted";
  confirmed: boolean;
  replayed: boolean;
  signature: string | null;
  explorer: string | null;
  asset: string;
  network: Network;
  destination: string;
  amount: number;
  usd: number | null;
  newBalanceSol: number | null;
  newTokenBalance: number | null;
}

// ── swap ────────────────────────────────────────────────────────────────────

export interface SwapQuoteParams {
  /** Mint to sell, or `"SOL"`. */
  inputMint: string;
  /** Mint to buy, or `"SOL"`. */
  outputMint: string;
  /** Input amount in the smallest unit (lamports for SOL), as an integer string. */
  amount: string;
  slippageBps?: number;
  /** Swap from this agent's custodial wallet. Omit for a non-custodial swap. */
  agentId?: string;
  /** Your wallet for a non-custodial swap (can also be given to swapExecute). */
  userPublicKey?: string;
}

export interface SwapQuote {
  quoteId: string;
  expiresAt: string;
  mode: "custodial" | "non_custodial";
  agentId: string | null;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string | null;
  minOutAmount: string | null;
  priceImpactPct: number | null;
  slippageBps: number;
  venue: string | null;
  route: string[];
  usd: number | null;
  platformFeeBps: number | null;
  warnings: Array<{ code: string; message: string }>;
  firewall: unknown;
}

export interface SwapExecuteParams {
  quoteId: string;
  /** Required (`true`) for an agent-wallet swap. */
  confirm?: boolean;
  /** Signer for a non-custodial swap, when not given at quote time. */
  userPublicKey?: string;
}

export interface UnsignedSwap extends Omit<SwapQuote, "quoteId" | "expiresAt"> {
  mode: "non_custodial";
  status: "unsigned";
  /** Base64 VersionedTransaction. Deserialize, sign with `signer`, send. */
  transaction: string;
  encoding: "base64";
  signer: string;
}

export interface CustodialSwap extends Omit<SwapQuote, "quoteId" | "expiresAt"> {
  mode: "custodial";
  status: "confirmed";
  replayed: boolean;
  signature: string | null;
  explorer: string | null;
  newBalanceSol: number | null;
}

export type SwapResult = UnsignedSwap | CustodialSwap;

// ── catalog, intel and account ──────────────────────────────────────────────

/** Loosely typed server objects whose full shape is documented in docs/api-reference.md. */
export type Json = Record<string, unknown>;

export interface TopMoversParams {
  timeframe?: string;
  sortBy?: string;
  minLiquidity?: number;
  limit?: number;
}

export interface IndicatorsParams {
  mint: string;
  /** Any of `rsi`, `ema`, `sma`, `macd`. */
  indicators?: Array<"rsi" | "ema" | "sma" | "macd"> | string;
  interval?: string;
}

export interface IntegrationParams {
  [key: string]: unknown;
}

export interface LinkCodeParams {
  /** Pair the code to one agent. */
  agentId?: string;
  /** A label for the device or gateway, shown in your account. */
  label?: string;
  /** Space-separated scopes the paired device receives. */
  scopes?: string;
}

export interface ExternalWalletParams {
  /** Solana address withdrawals may be sent to. */
  address: string;
  /** Must be `true`: this changes where funds can leave to. */
  confirm: true;
}
