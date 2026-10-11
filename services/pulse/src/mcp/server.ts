// MCP server: read-only tools over a running Pulse API, so an agent can ask
// what is running, what died, who bought early and what the last newsletter said.
// Transport is stdio. PULSE_URL points at the API (default http://localhost:8787).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const base = (process.env.PULSE_URL || 'http://localhost:8787').replace(/\/$/, '');
const chain = z.enum(['solana', 'robinhood']);

async function get(path: string, query: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const url = `${base}/api${path}${qs.size ? `?${qs}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    return fail(`Cannot reach Pulse at ${base} (${(err as Error).message}). Start it with "npx pulse-trenches" or set PULSE_URL.`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return fail(`Pulse answered ${res.status}: ${(body as { error?: string } | null)?.error ?? 'request failed'}`);
  return { content: [{ type: 'text' as const, text: JSON.stringify(body) }] };
}

const fail = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] });
const readOnly = { readOnlyHint: true, openWorldHint: false };

const server = new McpServer({ name: 'pulse', version: '0.1.0' });

server.registerTool('pulse_overview', {
  title: 'Market overview',
  description: 'Chain-wide totals for Solana and Robinhood Chain: market cap, 24h volume, launches, graduations, lifecycle status counts, sector volume, 7-day series, and the hottest tokens in the live trade stream.',
  inputSchema: {},
  annotations: readOnly,
}, () => get('/overview'));

server.registerTool('pulse_tokens', {
  title: 'Search tokens',
  description: 'List tokens from the archive with lifecycle status, sector, tech score, market cap, volume, liquidity, holders and ATH. Sort: mcap, volume, change, new, tech, holders, ath. Status: new, running, graduated, dying, dead. Set tech=true for tokens classified as tech rather than meme.',
  inputSchema: {
    chain: chain.optional(),
    status: z.enum(['new', 'running', 'graduated', 'dying', 'dead']).optional(),
    sort: z.enum(['mcap', 'volume', 'change', 'new', 'tech', 'holders', 'ath']).default('volume'),
    category: z.string().optional().describe('Sector such as ai, agents, defi, infra, depin, gaming, payments, meme'),
    launchpad: z.string().optional(),
    tech: z.boolean().optional(),
    minMcap: z.number().optional(),
    minVolume: z.number().optional(),
    q: z.string().optional().describe('Match symbol, name or address'),
    limit: z.number().int().min(1).max(200).default(25),
    offset: z.number().int().min(0).default(0),
  },
  annotations: readOnly,
}, ({ tech, ...rest }) => get('/tokens', { ...rest, tech: tech ? '1' : undefined }));

server.registerTool('pulse_token', {
  title: 'Token detail',
  description: 'Everything recorded about one token: metadata, pools, snapshot history, discovery lists, launch events, notable trades, and tracked wallet positions.',
  inputSchema: { chain, address: z.string().min(20) },
  annotations: readOnly,
}, ({ chain: c, address }) => get(`/tokens/${c}/${encodeURIComponent(address)}`));

server.registerTool('pulse_launches', {
  title: 'Recent launches',
  description: 'Recent launch and graduation events with the token current market cap, volume and status.',
  inputSchema: { chain: chain.optional(), kind: z.enum(['launch', 'graduation']).optional(), limit: z.number().int().min(1).max(500).default(100) },
  annotations: readOnly,
}, (a) => get('/launches', a));

server.registerTool('pulse_wallets', {
  title: 'Ranked wallets',
  description: 'KOL and smart-money wallets ranked by Pulse score (win rate, PnL, early hits, best multiple) with trades in the last 24 hours.',
  inputSchema: { kind: z.enum(['kol', 'smart']).optional() },
  annotations: readOnly,
}, (a) => get('/wallets', a));

server.registerTool('pulse_wallet', {
  title: 'Wallet detail',
  description: 'One wallet: label, score, positions and recent trades.',
  inputSchema: { address: z.string().min(20) },
  annotations: readOnly,
}, ({ address }) => get(`/wallets/${encodeURIComponent(address)}`));

server.registerTool('pulse_report', {
  title: 'Daily newsletter',
  description: 'The stored newsletter for a day (YYYY-MM-DD) as data and markdown. Omit day to list the available issues.',
  inputSchema: { day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
  annotations: readOnly,
}, ({ day }) => get(day ? `/reports/${day}` : '/reports'));

server.registerTool('pulse_export', {
  title: 'Export archive table',
  description: 'Raw rows from an archive table for analysis or model training. Tables: tokens, token_snapshots, trades, launch_events, wallets, wallet_scores, wallet_positions, market_snapshots, list_appearances.',
  inputSchema: {
    table: z.enum(['tokens', 'token_snapshots', 'trades', 'launch_events', 'wallets', 'wallet_scores', 'wallet_positions', 'market_snapshots', 'list_appearances']),
    limit: z.number().int().min(1).max(5000).default(500),
  },
  annotations: readOnly,
}, ({ table, limit }) => get(`/export/${table}`, { limit }));

await server.connect(new StdioServerTransport());
