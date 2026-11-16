// Client for the public three.ws APIs used by this sample, plus the parser
// that recognises three.ws links pasted into a Teams message.
//
// Every endpoint used here is public and needs no key. THREEWS_API_KEY is
// optional: when it is set the key is sent as a Bearer token, which ties the
// requests to your three.ws account for usage reporting.

export const THREEWS_ORIGIN = process.env.THREEWS_ORIGIN || "https://three.ws";

const REQUEST_TIMEOUT_MS = 8000;

export interface ModelItem {
  id: string;
  kind: string;
  title: string;
  license: string;
  categories: string[];
  glbUrl: string;
  thumbnailUrl: string;
}

export interface AgentItem {
  id: string;
  name: string;
  description: string;
  category: string | null;
  skills: string[];
  pageUrl: string;
  avatarModelUrl: string | null;
  thumbnailUrl: string | null;
}

export type ThreewsLink =
  | { type: "model"; glbUrl: string; title: string }
  | { type: "agent"; agentId: string };

export class ThreewsApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ThreewsApiError";
  }
}

async function getJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path, THREEWS_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.THREEWS_API_KEY) headers.Authorization = `Bearer ${process.env.THREEWS_API_KEY}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new ThreewsApiError(`three.ws ${url.pathname} answered ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

interface CatalogResponse {
  items?: Array<{
    id: string;
    kind: string;
    title?: string;
    name?: string;
    license?: string;
    categories?: string[];
    url: string;
    thumb?: string;
  }>;
}

/** Searches the free three.ws catalog of ready-made 3D models. */
export async function searchModels(query: string, limit = 8): Promise<ModelItem[]> {
  const params: Record<string, string> = { kind: "object", limit: String(limit) };
  if (query) params.q = query;
  const data = await getJson<CatalogResponse>("/api/catalog", params);
  return (data.items ?? [])
    .filter((item) => item.url)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title || item.name || item.id,
      license: item.license || "See source",
      categories: item.categories ?? [],
      glbUrl: item.url,
      thumbnailUrl: item.thumb || ogImageUrl(item.title || item.id, "/viewer"),
    }));
}

interface PublicAgentsResponse {
  data?: {
    items?: Array<{
      id: string;
      name: string;
      description?: string;
      category?: string | null;
      skills?: string[];
      url?: string;
    }>;
  };
}

interface AgentDetailResponse {
  agent?: {
    id: string;
    name: string;
    description?: string;
    category?: string | null;
    skills?: string[];
    home_url?: string;
    avatar_model_url?: string | null;
    avatar_thumbnail_url?: string | null;
  };
}

/** Searches the public three.ws agent directory and attaches each agent's 3D body. */
export async function searchAgents(query: string, limit = 6): Promise<AgentItem[]> {
  const params: Record<string, string> = { limit: String(limit) };
  if (query) params.q = query;
  const data = await getJson<PublicAgentsResponse>("/api/v1/marketplace/agents/public", params);
  const items = data.data?.items ?? [];

  // The directory listing has no avatar fields, so each agent's detail is
  // read in parallel. An agent whose detail fails still shows, without a body.
  const details = await Promise.allSettled(items.map((item) => getAgent(item.id)));
  return items.map((item, i) => {
    const detail = details[i].status === "fulfilled" ? details[i].value : null;
    return {
      id: item.id,
      name: item.name,
      description: item.description || "",
      category: item.category ?? null,
      skills: item.skills ?? [],
      pageUrl: new URL(item.url || `/agents/${item.id}`, THREEWS_ORIGIN).toString(),
      avatarModelUrl: detail?.avatarModelUrl ?? null,
      thumbnailUrl: detail?.thumbnailUrl ?? null,
    };
  });
}

/** Reads one public agent, or returns null when it does not exist. */
export async function getAgent(agentId: string): Promise<AgentItem | null> {
  let data: AgentDetailResponse;
  try {
    data = await getJson<AgentDetailResponse>(`/api/agents/${encodeURIComponent(agentId)}`);
  } catch (err) {
    if (err instanceof ThreewsApiError && err.status === 404) return null;
    throw err;
  }
  const agent = data.agent;
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || "",
    category: agent.category ?? null,
    skills: agent.skills ?? [],
    pageUrl: new URL(agent.home_url || `/agents/${agent.id}`, THREEWS_ORIGIN).toString(),
    avatarModelUrl: agent.avatar_model_url || null,
    thumbnailUrl: agent.avatar_thumbnail_url || null,
  };
}

/** The interactive three.ws viewer page for a GLB. It allows framing, so it works in a stage view. */
export function viewerUrl(glbUrl: string, title: string): string {
  const url = new URL("/viewer", THREEWS_ORIGIN);
  url.searchParams.set("src", glbUrl);
  url.searchParams.set("title", title);
  return url.toString();
}

/** A branded preview image for a page that has no thumbnail of its own. */
export function ogImageUrl(title: string, path: string): string {
  const url = new URL("/api/page-og", THREEWS_ORIGIN);
  url.searchParams.set("s", "labs");
  url.searchParams.set("t", title);
  url.searchParams.set("p", path);
  return url.toString();
}

const AGENT_PATH = /^\/agents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

function isThreewsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const origin = new URL(THREEWS_ORIGIN).hostname.toLowerCase();
  return host === origin || host.endsWith(`.${origin}`);
}

function titleFromGlb(glbUrl: string): string {
  const file = decodeURIComponent(new URL(glbUrl).pathname.split("/").pop() || "3D model");
  return file.replace(/\.(glb|gltf)$/i, "").replace(/[_-]+/g, " ").trim() || "3D model";
}

function httpUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Recognises the three.ws links worth unfurling:
 * - /viewer?src=<glb>&title=...  and  /ar/studio?src=<glb>&title=...
 * - /app#model=<glb>&title=...   (the catalog preview link)
 * - /agents/<uuid>               (a public agent page)
 * Anything else returns null so Teams shows its default preview.
 */
export function parseThreewsLink(raw: string): ThreewsLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isThreewsHost(url.hostname)) return null;

  const agent = AGENT_PATH.exec(url.pathname);
  if (agent) return { type: "agent", agentId: agent[1].toLowerCase() };

  let params: URLSearchParams | null = null;
  let modelKey = "src";
  if (url.pathname === "/viewer" || url.pathname === "/ar/studio") {
    params = url.searchParams;
  } else if (url.pathname === "/app" && url.hash.length > 1) {
    params = new URLSearchParams(url.hash.slice(1));
    modelKey = "model";
  }
  const glb = httpUrl(params?.get(modelKey) ?? null);
  if (!params || !glb) return null;

  const title = (params.get("title") || "").trim() || titleFromGlb(glb.toString());
  return { type: "model", glbUrl: glb.toString(), title: title.slice(0, 120) };
}
