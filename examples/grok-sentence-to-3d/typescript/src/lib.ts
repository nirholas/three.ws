// The parts of the example that need no xAI key: argument parsing, the three.ws leg spoken
// directly over MCP, and the helpers that read Grok's answer.

export const MCP_URL = process.env.THREE_WS_MCP_URL || "https://three.ws/api/mcp-studio";
export const MODEL = process.env.XAI_MODEL || "grok-4.7";
// The MCP server's tools that Grok may call. A tool the server adds later stays out until it's listed here.
export const ALLOWED_TOOLS = ["search_catalog", "forge_free", "check_job"];
export const DEFAULT_TASK = "find a chair in the free catalog, and if none fits, make a low-poly wooden chair";
export const MAX_ROUNDS = 8;
export const WAIT_BETWEEN_ROUNDS_MS = 20_000;
export const VIEWER_URL = "https://three.ws/viewer";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_NO_KEY = 2;

const GLB_URL = /https?:\/\/[^\s)"'\]<>]+?\.glb(?:\?[^\s)"'\]<>]*)?/;

export type Env = Record<string, string | undefined>;
export type Args = { check: boolean; task: string };

export function xaiKey(env: Env = process.env): string | undefined {
  return env.XAI_API_KEY || env.GROK_API_KEY || undefined;
}

// `--check` is the only flag; every other word is the request, so quotes are optional.
export function parseArgs(argv: string[]): Args {
  const words = argv.filter((arg) => !arg.startsWith("--"));
  return { check: argv.includes("--check"), task: words.join(" ").trim() || DEFAULT_TASK };
}

export function findGlbUrl(text: string): string | undefined {
  return GLB_URL.exec(text)?.[0];
}

export function viewerLink(glbUrl: string): string {
  return `${VIEWER_URL}?src=${encodeURIComponent(glbUrl)}`;
}

// The prompt for the first round, and the nudge for each later round when a generation is still pending.
export function firstPrompt(task: string): string {
  return (
    `Use three-ws to ${task}. A generation can come back pending with a job_id: collect it with check_job. ` +
    "When you have the model, reply with one line: 'GLB: <url>'."
  );
}
export const COLLECT_PROMPT = "Call check_job on that job again. When it is done, reply with one line: 'GLB: <url>'.";

type JsonRpcReply = { result?: any; error?: { code: number; message: string } };

// A Streamable HTTP server may answer a POST with plain JSON or with a one-message event stream.
export function parseMcpBody(contentType: string, body: string): JsonRpcReply {
  if (!contentType.includes("text/event-stream")) return JSON.parse(body);
  const data = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("");
  return JSON.parse(data);
}

// The three.ws leg, spoken directly: MCP JSON-RPC over HTTP POST.
export async function mcpCall(
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  url: string = MCP_URL,
): Promise<{ result: any; sessionId?: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status} to ${method}: ${body.slice(0, 300)}`);
  const reply = parseMcpBody(res.headers.get("content-type") ?? "", body);
  if (reply.error) throw new Error(`${url} answered ${method} with an error: ${reply.error.message}`);
  return { result: reply.result, sessionId: res.headers.get("mcp-session-id") ?? sessionId };
}

export type CatalogItem = { title: string; url: string };

// Initialize, list the tools, and run one real catalog search. Returns what to print, or throws.
export async function checkThreeWs(url: string = MCP_URL): Promise<{ lines: string[]; missing: string[]; items: CatalogItem[] }> {
  const init = await mcpCall(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "grok-sentence-to-3d-example", version: "1.0.0" } },
    undefined,
    url,
  );
  const listed = await mcpCall("tools/list", {}, init.sessionId, url);
  const names: string[] = listed.result.tools.map((tool: { name: string }) => tool.name);
  const missing = ALLOWED_TOOLS.filter((name) => !names.includes(name));
  const lines = [
    `server   ${init.result.serverInfo.name} (${url})`,
    `tools    ${names.length} offered; this example allows ${ALLOWED_TOOLS.join(", ")}`,
  ];
  if (missing.length) return { lines, missing, items: [] };
  const found = await mcpCall(
    "tools/call",
    { name: "search_catalog", arguments: { q: "chair", kind: "object", limit: 3 } },
    init.sessionId,
    url,
  );
  const items: CatalogItem[] = found.result?.structuredContent?.items ?? [];
  return { lines, missing, items };
}

// xAI's own message for an API error, or the plain message for anything else.
export function describeError(err: unknown, apiError: (err: unknown) => err is Error & { status?: number; code?: string | null }): string {
  if (apiError(err)) return `xAI answered ${err.status ?? "an error"}${err.code ? ` ${err.code}` : ""}: ${err.message}`;
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
