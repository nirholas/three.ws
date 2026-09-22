// ThreeAgents: the typed client for the three.ws v1 agents API.

import { ConfirmationRequiredError, ThreeAgentsError, ValidationError } from "./errors";
import { parseSse } from "./sse";
import { Transport, type FetchLike, type RequestSpec } from "./transport";
import { VERSION } from "./version";
import type {
  Agent,
  Automation,
  BuiltinSkill,
  ChatMessage,
  CommunitySkill,
  CommunitySkillSearch,
  CreateAgentParams,
  CreateAutomationParams,
  CreateCustomSkillParams,
  CreateRunParams,
  CreatedAgent,
  CustomSkillList,
  CustomSkillResult,
  DeletedAutomation,
  DeletedResource,
  ExternalWalletParams,
  GetMessagesParams,
  IndicatorsParams,
  IntegrationParams,
  Json,
  LinkCodeParams,
  MessageReply,
  Network,
  Page,
  PageParams,
  RequestOptions,
  Run,
  RunEvent,
  RunStep,
  SendMessageParams,
  SwapExecuteParams,
  SwapQuote,
  SwapQuoteParams,
  SwapResult,
  TopMoversParams,
  TransferParams,
  TransferQuote,
  TransferQuoteParams,
  TransferResult,
  UpdateAgentParams,
  UpdateCustomSkillParams,
  UpdateRunParams,
  Wallet,
  WalletHistoryParams,
  WalletLedgerEntry,
} from "./types";

export const DEFAULT_BASE_URL = "https://three.ws/api/v1";

export interface ThreeAgentsOptions {
  /** A three.ws API key (`sk_live_…`). Create one with `npx three-ws setup` or at /dashboard/api. */
  apiKey: string;
  /** Defaults to https://three.ws/api/v1. */
  baseUrl?: string;
  /** Per-attempt timeout in ms. Default 30000. */
  timeout?: number;
  /** Retries after the first attempt on 5xx, network errors and timeouts. Default 2. */
  retries?: number;
  /** Base backoff in ms; retry n waits retryDelay * 2^n plus up to 20% jitter. Default 1000. */
  retryDelay?: number;
  /** A fetch implementation. Defaults to the global fetch (Node 20+). */
  fetch?: FetchLike;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
}

type Query = RequestSpec["query"];
type Method = RequestSpec["method"];

/** Encode one path segment; an empty id is a caller bug, reported before any request. */
function seg(value: string, name = "id"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${name} is required.`, {
      code: "missing_parameter",
      fields: [{ field: name, message: "required" }],
    });
  }
  return encodeURIComponent(value);
}

/** Refuse a fund-moving call client-side unless its confirm flag is literally `true`. */
function requireConfirm(params: unknown, flag: string, previewMethod: string, method: string): void {
  const value = params && typeof params === "object" ? (params as Record<string, unknown>)[flag] : undefined;
  if (value === true) return;
  throw new ConfirmationRequiredError(
    `${method}() moves funds or changes where they can go, so it needs { ${flag}: true }. Call ${previewMethod}() first and review the result.`,
    { confirmFlag: flag, previewMethod },
  );
}

export class ThreeAgents {
  readonly baseUrl: string;
  private readonly http: Transport;

  constructor(options: ThreeAgentsOptions) {
    if (!options || typeof options.apiKey !== "string" || !options.apiKey.trim()) {
      throw new ThreeAgentsError(
        "apiKey is required. Run `npx three-ws setup` or create a key at https://three.ws/dashboard/api.",
        { code: "missing_api_key" },
      );
    }
    const f = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (typeof f !== "function") {
      throw new ThreeAgentsError("No fetch implementation found. Use Node 20+ or pass options.fetch.", {
        code: "no_fetch",
      });
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.http = new Transport({
      apiKey: options.apiKey.trim(),
      baseUrl: this.baseUrl,
      timeout: options.timeout ?? 30_000,
      retries: Math.max(0, options.retries ?? 2),
      retryDelay: Math.max(0, options.retryDelay ?? 1_000),
      fetch: (input, init) => f(input, init),
      userAgent: `@three-ws/agents/${VERSION}`,
      defaultHeaders: options.headers ?? {},
    });
  }

  // ── transport helpers ─────────────────────────────────────────────────────

  private spec(method: Method, path: string, query: Query, body: unknown, opts?: RequestOptions): RequestSpec {
    return {
      method,
      path,
      query,
      body,
      // Every write carries an Idempotency-Key that is reused across retries,
      // so a retried create, transfer or swap acts at most once.
      idempotencyKey: method === "GET" ? undefined : (opts?.idempotencyKey ?? true),
      timeout: opts?.timeout,
      retries: opts?.retries,
      signal: opts?.signal,
    };
  }

  private async call<T>(method: Method, path: string, o: { query?: Query; body?: unknown; opts?: RequestOptions } = {}): Promise<T> {
    const { data } = await this.http.request<T>(this.spec(method, path, o.query, o.body, o.opts));
    return data;
  }

  private async list<T>(path: string, query: Query, opts?: RequestOptions): Promise<Page<T>> {
    const { data, meta } = await this.http.request<T[]>(this.spec("GET", path, query, undefined, opts));
    return {
      data: Array.isArray(data) ? data : [],
      hasMore: Boolean(meta.hasMore),
      nextCursor: meta.nextCursor ?? null,
      requestId: meta.requestId,
    };
  }

  /**
   * Walk every page of a list method.
   *
   * ```ts
   * for await (const agent of client.paginate((cursor) => client.listAgents({ cursor }))) console.log(agent.name);
   * ```
   */
  async *paginate<T>(fetchPage: (cursor: string | undefined) => Promise<Page<T>>): AsyncGenerator<T> {
    let cursor: string | undefined;
    for (;;) {
      const page = await fetchPage(cursor);
      for (const item of page.data) yield item;
      if (!page.hasMore || !page.nextCursor) return;
      cursor = page.nextCursor;
    }
  }

  // ── agents ────────────────────────────────────────────────────────────────

  /** Create an agent. A `strategy` preset fills skills, persona and default automations you leave out. */
  async createAgent(params: CreateAgentParams, opts?: RequestOptions): Promise<CreatedAgent> {
    const res = await this.call<{ agent: Agent; automations?: Automation[] }>("POST", "/agents", { body: params, opts });
    return { ...res.agent, automations: res.automations ?? [] };
  }

  getAgent(agentId: string, opts?: RequestOptions): Promise<Agent> {
    return this.call("GET", `/agents/${seg(agentId, "agentId")}`, { opts });
  }

  listAgents(params: PageParams = {}, opts?: RequestOptions): Promise<Page<Agent>> {
    return this.list("/agents", { limit: params.limit, cursor: params.cursor }, opts);
  }

  updateAgent(agentId: string, patch: UpdateAgentParams, opts?: RequestOptions): Promise<Agent> {
    return this.call("PATCH", `/agents/${seg(agentId, "agentId")}`, { body: patch, opts });
  }

  /** Status `running`: scheduled automations, intents and runs may execute. */
  startAgent(agentId: string, opts?: RequestOptions): Promise<Agent> {
    return this.call("POST", `/agents/${seg(agentId, "agentId")}/start`, { opts });
  }

  /** Status `stopped`: pauses automations, intents and runs without deleting anything. */
  stopAgent(agentId: string, opts?: RequestOptions): Promise<Agent> {
    return this.call("POST", `/agents/${seg(agentId, "agentId")}/stop`, { opts });
  }

  /** Delete an agent. Its automations stop and its open runs are cancelled. */
  deleteAgent(agentId: string, opts?: RequestOptions): Promise<DeletedResource> {
    return this.call("DELETE", `/agents/${seg(agentId, "agentId")}`, { opts });
  }

  // ── chat ──────────────────────────────────────────────────────────────────

  /** Send one message and wait for the reply, with usage, cost, tool calls and any signatures. */
  sendMessage(agentId: string, params: SendMessageParams, opts?: RequestOptions): Promise<MessageReply> {
    return this.call("POST", `/agents/${seg(agentId, "agentId")}/messages`, { body: params, opts });
  }

  /** Conversation history, newest first. Page older messages with `before: page.nextCursor`. */
  getMessages(agentId: string, params: GetMessagesParams = {}, opts?: RequestOptions): Promise<Page<ChatMessage>> {
    return this.list(`/agents/${seg(agentId, "agentId")}/messages`, { limit: params.limit, before: params.before }, opts);
  }

  // ── runs ──────────────────────────────────────────────────────────────────

  /** Start a goal-driven run through the server-side tool loop, bounded by budget and steps. */
  createRun(agentId: string, params: CreateRunParams, opts?: RequestOptions): Promise<Run> {
    return this.call("POST", `/agents/${seg(agentId, "agentId")}/runs`, { body: params, opts });
  }

  listRuns(agentId: string, params: PageParams = {}, opts?: RequestOptions): Promise<Page<Run>> {
    return this.list(`/agents/${seg(agentId, "agentId")}/runs`, { limit: params.limit, cursor: params.cursor }, opts);
  }

  getRun(runId: string, opts?: RequestOptions): Promise<Run> {
    return this.call("GET", `/runs/${seg(runId, "runId")}`, { opts });
  }

  /** Pause, resume, or raise a run's budget or step limit. */
  updateRun(runId: string, params: UpdateRunParams, opts?: RequestOptions): Promise<Run> {
    return this.call("PATCH", `/runs/${seg(runId, "runId")}`, { body: params, opts });
  }

  /** Cancel a run. The loop stops within one step. */
  cancelRun(runId: string, opts?: RequestOptions): Promise<Run> {
    return this.call("POST", `/runs/${seg(runId, "runId")}/cancel`, { opts });
  }

  /** Every model call, tool call, result and cost the run has recorded, in order. */
  getRunSteps(runId: string, params: PageParams = {}, opts?: RequestOptions): Promise<Page<RunStep>> {
    return this.list(`/runs/${seg(runId, "runId")}/steps`, { limit: params.limit, cursor: params.cursor }, opts);
  }

  /**
   * Stream a run's events as they happen (Server-Sent Events). Ends when the
   * server closes the stream. A connection that drops mid-stream is resumed
   * from the last event id, up to `retries` times.
   *
   * ```ts
   * for await (const ev of client.streamRun(run.id)) console.log(ev.event, ev.data);
   * ```
   */
  async *streamRun<T = Json>(runId: string, opts: RequestOptions = {}): AsyncGenerator<RunEvent<T>> {
    const path = `/runs/${seg(runId, "runId")}/events`;
    const maxReconnects = opts.retries ?? this.http.opts.retries;
    let lastId: string | null = null;
    let reconnects = 0;
    for (;;) {
      const transport: Transport = lastId
        ? new Transport({ ...this.http.opts, defaultHeaders: { ...this.http.opts.defaultHeaders, "last-event-id": lastId } })
        : this.http;
      const opened: { res: Response; clear: () => void } = await transport.open(
        { method: "GET", path, timeout: opts.timeout, retries: opts.retries, signal: opts.signal },
        true,
      );
      const { res, clear } = opened;
      try {
        if (!res.body) return;
        for await (const msg of parseSse(res.body)) {
          if (msg.id) lastId = msg.id;
          yield { event: msg.event, data: parseEventData(msg.data) as T, id: msg.id };
        }
        return;
      } catch (err) {
        if (opts.signal?.aborted) throw opts.signal.reason ?? err;
        if (err instanceof ThreeAgentsError || reconnects >= maxReconnects) throw err;
        reconnects++;
      } finally {
        clear();
      }
    }
  }

  // ── skills ────────────────────────────────────────────────────────────────

  /** Built-in skill ids an agent's `skills` accepts. */
  async listSkills(opts?: RequestOptions): Promise<BuiltinSkill[]> {
    const res = await this.call<{ skills: BuiltinSkill[] }>("GET", "/skills", { opts });
    return res.skills;
  }

  /** Search the public community skills registry. */
  listCommunitySkills(
    params: { q?: string; tag?: string; author?: string; limit?: number } = {},
    opts?: RequestOptions,
  ): Promise<CommunitySkillSearch> {
    return this.call("GET", "/skills/community", { query: params, opts });
  }

  /** One community skill with its SKILL.md instructions. */
  async getCommunitySkill(slug: string, opts?: RequestOptions): Promise<CommunitySkill> {
    const res = await this.call<{ skill: CommunitySkill }>("GET", `/skills/community/${seg(slug, "slug")}`, { opts });
    return res.skill;
  }

  /** The agent's custom skills and how much of the prompt budget they use. */
  listCustomSkills(agentId: string, opts?: RequestOptions): Promise<CustomSkillList> {
    return this.call("GET", `/agents/${seg(agentId, "agentId")}/skills/custom`, { opts });
  }

  getCustomSkill(agentId: string, skillId: string, opts?: RequestOptions): Promise<CustomSkillResult> {
    return this.call("GET", `/agents/${seg(agentId, "agentId")}/skills/custom/${seg(skillId, "skillId")}`, { opts });
  }

  /** Write a custom skill: instructions injected into the agent's system prompt. */
  createCustomSkill(agentId: string, params: CreateCustomSkillParams, opts?: RequestOptions): Promise<CustomSkillResult> {
    return this.call("POST", `/agents/${seg(agentId, "agentId")}/skills/custom`, { body: params, opts });
  }

  updateCustomSkill(
    agentId: string,
    skillId: string,
    patch: UpdateCustomSkillParams,
    opts?: RequestOptions,
  ): Promise<CustomSkillResult> {
    return this.call("PATCH", `/agents/${seg(agentId, "agentId")}/skills/custom/${seg(skillId, "skillId")}`, {
      body: patch,
      opts,
    });
  }

  deleteCustomSkill(
    agentId: string,
    skillId: string,
    opts?: RequestOptions,
  ): Promise<CustomSkillList & DeletedResource & { slug: string }> {
    return this.call("DELETE", `/agents/${seg(agentId, "agentId")}/skills/custom/${seg(skillId, "skillId")}`, { opts });
  }

  /** Install a community registry skill on the agent as an editable custom skill. */
  importCommunitySkill(
    agentId: string,
    slug: string,
    params: { enabled?: boolean } = {},
    opts?: RequestOptions,
  ): Promise<CustomSkillResult> {
    return this.call("POST", `/agents/${seg(agentId, "agentId")}/skills/custom/import`, {
      body: { slug: seg(slug, "slug") && slug, ...params },
      opts,
    });
  }

  // ── automations ───────────────────────────────────────────────────────────

  /** One trigger, one action. Swap and transfer actions run under the wallet's spend policy. */
  createAutomation(params: CreateAutomationParams, opts?: RequestOptions): Promise<Automation> {
    return this.call("POST", "/automations", { body: params, opts });
  }

  /** Automations, wallet intents and alert rules on an agent, as one list. */
  listAutomations(agentId: string, params: PageParams = {}, opts?: RequestOptions): Promise<Page<Automation>> {
    return this.list(`/agents/${seg(agentId, "agentId")}/automations`, { limit: params.limit, cursor: params.cursor }, opts);
  }

  deleteAutomation(automationId: string, opts?: RequestOptions): Promise<DeletedAutomation> {
    return this.call("DELETE", `/automations/${seg(automationId, "automationId")}`, { opts });
  }

  // ── intelligence ──────────────────────────────────────────────────────────

  getPrice(mint: string, opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/intel/price", { query: { mint: seg(mint, "mint") && mint }, opts });
  }

  getTopMovers(params: TopMoversParams = {}, opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/intel/top-movers", { query: { ...params }, opts });
  }

  /** RSI, EMA, SMA and MACD computed server-side from OHLCV. */
  getIndicators(params: IndicatorsParams, opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/intel/indicators", {
      query: { mint: seg(params?.mint, "mint") && params.mint, indicators: params.indicators, interval: params.interval },
      opts,
    });
  }

  getSignals(mint: string, opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/intel/signals", { query: { mint: seg(mint, "mint") && mint }, opts });
  }

  getAnomalies(opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/intel/anomalies", { opts });
  }

  getMacro(opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/intel/macro", { opts });
  }

  // ── catalog and account ───────────────────────────────────────────────────

  /** Every model with input and output price, context window, and whether it is free-tier. */
  getModels(opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/models", { opts });
  }

  /** Remaining free messages and when they reset. */
  getFreeTierStatus(opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/me/free-tier", { opts });
  }

  getUsage(opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/me/usage", { opts });
  }

  getBudget(opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/me/budget", { opts });
  }

  getTransactions(params: PageParams = {}, opts?: RequestOptions): Promise<Page<Json>> {
    return this.list("/me/transactions", { limit: params.limit, cursor: params.cursor }, opts);
  }

  listIntegrations(opts?: RequestOptions): Promise<Json> {
    return this.call("GET", "/me/integrations", { opts });
  }

  saveIntegration(provider: string, params: IntegrationParams, opts?: RequestOptions): Promise<Json> {
    return this.call("PUT", `/me/integrations/${seg(provider, "provider")}`, { body: params, opts });
  }

  removeIntegration(provider: string, opts?: RequestOptions): Promise<Json> {
    return this.call("DELETE", `/me/integrations/${seg(provider, "provider")}`, { opts });
  }

  /** An eight-character code that pairs a device or chat gateway to your account for ten minutes. */
  generateLinkCode(params: LinkCodeParams = {}, opts?: RequestOptions): Promise<Json> {
    return this.call("POST", "/me/link-code", { body: params, opts });
  }

  redeemLinkCode(params: { code: string; [key: string]: unknown }, opts?: RequestOptions): Promise<Json> {
    return this.call("POST", "/me/link-code/redeem", { body: params, opts });
  }

  /** Set the address withdrawals from this agent may go to. Requires `confirm: true`. */
  setExternalWallet(agentId: string, params: ExternalWalletParams, opts?: RequestOptions): Promise<Json> {
    requireConfirm(params, "confirm", "getWallet", "setExternalWallet");
    return this.call("PUT", `/agents/${seg(agentId, "agentId")}/external-wallet`, { body: params, opts });
  }

  // ── wallet ────────────────────────────────────────────────────────────────

  getWallet(agentId: string, params: { network?: Network } = {}, opts?: RequestOptions): Promise<Wallet> {
    return this.call("GET", `/agents/${seg(agentId, "agentId")}/wallet`, { query: { network: params.network }, opts });
  }

  /** The custody ledger: every spend, receipt and withdrawal the platform signed, newest first. */
  getWalletHistory(agentId: string, params: WalletHistoryParams = {}, opts?: RequestOptions): Promise<Page<WalletLedgerEntry>> {
    return this.list(
      `/agents/${seg(agentId, "agentId")}/wallet/history`,
      { limit: params.limit, before: params.cursor, network: params.network, category: params.category },
      opts,
    );
  }

  /** Simulate a transfer out of the agent wallet. Returns a quoteId valid for five minutes. */
  transferQuote(agentId: string, params: TransferQuoteParams, opts?: RequestOptions): Promise<TransferQuote> {
    return this.call("POST", `/agents/${seg(agentId, "agentId")}/wallet/transfer/quote`, { body: params, opts });
  }

  /**
   * Send a quoted transfer. Refuses before any request unless `confirm` is
   * literally `true`: call transferQuote() first and show the preview.
   */
  transfer(agentId: string, params: TransferParams, opts?: RequestOptions): Promise<TransferResult> {
    requireConfirm(params, "confirm", "transferQuote", "transfer");
    return this.call("POST", `/agents/${seg(agentId, "agentId")}/wallet/transfer`, {
      body: { quoteId: params.quoteId, confirm: true },
      opts,
    });
  }

  // ── swap ──────────────────────────────────────────────────────────────────

  /** Price a swap. With `agentId` it trades from the agent wallet; without, it builds for your own wallet. */
  swapQuote(params: SwapQuoteParams, opts?: RequestOptions): Promise<SwapQuote> {
    return this.call("POST", "/swap/quote", { body: params, opts });
  }

  /**
   * Act on a swap quote. A non-custodial quote returns an unsigned base64
   * transaction for you to sign. An agent-wallet quote needs `confirm: true`
   * and is signed and sent server-side.
   */
  swapExecute(params: SwapExecuteParams, opts?: RequestOptions): Promise<SwapResult> {
    return this.call("POST", "/swap/execute", { body: params, opts });
  }
}

function parseEventData(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
