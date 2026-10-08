# @three-ws/mcp-policy

**One tool policy for every three.ws MCP server: read-only by default, money behind a named confirm flag and a fresh preview.**

Every tool on every three.ws MCP server, hosted or stdio, is classified here by
**group** (what it is about) and **tier** (what it can do to the caller). A
session sees the read and write tiers by default. Financial tools, the ones that
move funds or cannot be undone, stay hidden until the person opts in, and even
then each call must carry a named confirm flag (`confirm_payment: true`,
`confirm_swap: true`, ...) plus a preview id issued by the matching preview tool
within the last ten minutes, bound to the same arguments.

The hosted servers (through [api/_mcp/policy.js](../../api/_mcp/policy.js)),
the [/api/mcp-policy](../../api/mcp-policy.js) allowlist builder, and the stdio
packages all read the same table, so a rule changes in one place.

## Install

The package is a workspace of this monorepo (`packages/mcp-policy`) and is not
on the npm registry yet. A root `npm install` links it, after which
`import '@three-ws/mcp-policy'` resolves from any file in the repo:

```bash
npm install
node -e "import('@three-ws/mcp-policy').then((p) => console.log(Object.keys(p.POLICY).length, 'servers'))"
```

Zero runtime dependencies. Node 20+. ESM only. Its `package.json` is already
set for a public release (`publishConfig.access: public`, `files: src, README.md,
LICENSE`), so publishing is `npm publish -w packages/mcp-policy`, an
owner-approved step.

## The model

### Tiers

| Tier | Meaning | Default |
|---|---|---|
| `read` | Changes nothing. | on |
| `write` | Changes account state, and a follow-up call can undo it. | on |
| `financial` | Moves funds or cannot be undone. | off; every call needs its confirm flag and a fresh preview id |

### Groups

`agents`, `chat`, `runs`, `skills`, `trading`, `orders`, `perps`, `lending`,
`predictions`, `launch`, `marketplace`, `cards`, `mail`, `x402`, `wallet`,
`billing`, `intelligence`, `integrations`, `account`, `allowlist`, `assets`,
`gateway`, `sandbox`, `utility`. Each has a label and a one-line summary in
`GROUPS` (exported), written for the person deciding whether to turn it on.

### Financial tools

A financial row names three things:

- **the confirm flag** the call must set to literally `true` (one of
  `CONFIRM_FLAGS`, e.g. `confirm_transfer`, `confirm_payment`, `confirm_run`);
- **the preview tool** that must run first (e.g. `inspect_endpoint` before
  `pay_and_call`);
- **the bound arguments** that must be identical between preview and call, so a
  quote for one destination can never authorize a payment to another.

The preview id is `quote_id` when the preview tool is a quote, `preview_id`
otherwise. It lives for `PREVIEW_TTL_MS` (10 minutes), belongs to the caller who
previewed, and is burned the moment the financial call it authorized succeeds.

A tool with **no** row in the table is treated as financial with no group: it is
hidden unless named explicitly, so an unclassified tool can never slip into a
default session.

### The spec grammar

One grammar is read from the `X-Three-Tools` header, the `tools` query
parameter, the `THREE_WS_TOOLS` env var of a stdio server, and the saved
settings. Tokens are comma- or space-separated and applied left to right:

| Token | Effect |
|---|---|
| `default` | read + write on, financial off (the implicit base) |
| `all` / `none` / `readonly` | every tier / nothing / only read |
| `financial`, `-write` | turn a tier on or off |
| `trading`, `-chat` | turn a whole group on (every tier) or off |
| `swap_execute`, `-forget` | turn one tool on or off |

Precedence is tool over group over tier: `-trading,swap_quote` hides the trading
group except `swap_quote`. A spec made only of plain tool names is an **exact
allow list**; to add a tool to the defaults instead, lead with a base:
`default,pay_and_call`.

Hosted servers resolve a session in this order, first present wins: the client's
`X-Three-Allowed-Tools` list, `X-Three-Tools`, the `tools` query parameter, the
per-key setting layered over the account setting, then the default. A stdio
process resolves `THREE_WS_ALLOWED_TOOLS`, then `THREE_WS_TOOLS`, then the
selection `npx three-ws tools` saved under `tools["three-ws-<name>"]` in
`~/.config/three-ws/credentials.json`, then the default.

## Quick start

The full preview, confirm, burn cycle against the real `x402-mcp` table:

```js
import { createPolicy, enablementFromSpec, describeEnablement } from '@three-ws/mcp-policy';

const policy = createPolicy({ serverId: 'x402-mcp' });
const en = enablementFromSpec('default,x402', 'example'); // the whole x402 group, financial tier included
console.log(describeEnablement(en));

const call = { url: 'https://three.ws/api/x402/example', method: 'GET' };

// 1. A financial call with no confirm flag is refused with a tool result the model can read.
const refused = await policy.beforeCall({ name: 'pay_and_call', args: call, en, principal: 'me' });
console.log(refused.ok, refused.result.structuredContent.reason); // false confirmation_required

// 2. The preview tool runs; afterCall stamps a preview id onto its result.
const preview = await policy.afterCall({
	name: 'inspect_endpoint',
	args: call,
	principal: 'me',
	result: { content: [{ type: 'text', text: 'price: $0.01 per call' }] },
});
const previewId = preview._meta['three.ws/preview'].preview_id;

// 3. The confirmed call with the fresh preview id passes, policy-only arguments stripped.
const gate = await policy.beforeCall({
	name: 'pay_and_call',
	args: { ...call, preview_id: previewId, confirm_payment: true },
	en,
	principal: 'me',
});
console.log(gate.ok, gate.args); // true { url: ..., method: 'GET' }

// 4. After it succeeds the preview id is burned, so it can never authorize a second payment.
await policy.afterCall({ name: 'pay_and_call', args: call, principal: 'me', result: { content: [] }, preview: gate.preview });
const replay = await policy.beforeCall({ name: 'pay_and_call', args: { ...call, preview_id: previewId, confirm_payment: true }, en, principal: 'me' });
console.log(replay.ok, replay.result.structuredContent.reason); // false preview_unknown
```

Refusals are MCP tool results with `isError: true` and a `structuredContent`
reason (`tool_disabled`, `confirmation_required`, `preview_required`,
`preview_unknown`, `preview_stale`, `preview_mismatch`), never JSON-RPC errors:
a model reads a tool result and acts on it, while most clients show a protocol
error only to the person.

## Wiring a stdio server

### High-level `McpServer`

Call `applyPolicy` before the `registerTool` loop. It wraps `registerTool`, so a
disabled tool is never registered (calling it anyway explains how to turn it
on), a financial tool gains its confirm flag and preview-id arguments in its zod
schema, and a preview tool stamps a preview id onto its result.

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { applyPolicy } from '@three-ws/mcp-policy/stdio';

const server = new McpServer({ name: 'x402-mcp', version: '1.0.0' });
const { enablement, hidden } = applyPolicy(server, { serverId: 'x402-mcp', z });

server.registerTool(
	'inspect_endpoint',
	{ description: 'Price an x402 endpoint without paying.', inputSchema: { url: z.string().url(), method: z.string().default('GET') } },
	async ({ url, method }) => ({ content: [{ type: 'text', text: `${method} ${url}: $0.01 per call` }] }),
);
server.registerTool(
	'pay_and_call',
	{ description: 'Pay an x402 endpoint and return its response.', inputSchema: { url: z.string().url(), method: z.string().default('GET') } },
	async ({ url }) => ({ content: [{ type: 'text', text: `paid ${url}` }] }),
);

console.error(`policy source: ${enablement.source}; hidden: ${[...hidden].join(', ') || 'none'}`);
if (process.argv.includes('--serve')) await server.connect(new StdioServerTransport());
```

Run it bare and it prints `policy source: default; hidden: pay_and_call`. Run it
with `THREE_WS_TOOLS=default,x402` and it prints `policy source: env; hidden: none`.
Pass the package's own `z` so the added arguments match its zod version.

### Low-level `Server` with JSON-Schema tools

```js
import { createStdioPolicy } from '@three-ws/mcp-policy/stdio';

const gate = createStdioPolicy('x402-mcp');
// ListTools handler:  return { tools: gate.listTools(TOOLS) };
// CallTool handler:   return gate.callTool(name, args, (cleanArgs) => runTool(name, cleanArgs));
```

`listTools` drops disabled tools, appends the financial rule to each financial
tool's description, adds the confirm and preview arguments to its schema, and
stamps `_meta['three.ws/policy']` (group, tier, confirm flag, preview tool,
preview argument) on every tool.

## API

### `@three-ws/mcp-policy`

| Export | What it is |
|---|---|
| `GROUPS`, `GROUP_IDS` | Every group `{ id, label, summary }`, in settings-page order, and just the ids. |
| `TIERS`, `DEFAULT_TIERS` | `['read', 'write', 'financial']` and the tiers a fresh key sees (`['read', 'write']`). |
| `CONFIRM_FLAGS`, `PREVIEW_ARGS`, `PREVIEW_TTL_MS` | The confirm flag vocabulary, `['quote_id', 'preview_id']`, and the 10-minute preview lifetime. |
| `POLICY` | The table: `{ [serverId]: { [toolName]: { group, tier, confirmFlag?, previewTool?, bind?, ownsPreview? } } }`. The single source of truth. |
| `SERVERS` | Human names, endpoints and transport (`remote` or `stdio`) for every server id in `POLICY`. |
| `createPolicy({ serverId, table?, store?, settingsUrl?, now? })` | The runtime for one server: `listTools(tools, en)`, `beforeCall({ name, args, en, principal, ownArgs })`, `afterCall({ name, args, principal, result, preview })`, `enabled(name, en)`, `entry(name)`, `disabledResult`, `policyMeta`, `financialNote`. Throws when `serverId` has no table. |
| `createMemoryPreviewStore()` | An in-process `{ put, get, del }` preview store, right for a single stdio process. The hosted servers pass a Redis-backed store instead so a quote issued on one instance is honored on another. |
| `normalizeEntry(name, row)` | Expand a terse table row into the shape every consumer reads. |
| `parseSpec(spec)` | Spec string or array to `{ tokens, invalid }`; a typo lands in `invalid` instead of being silently dropped. |
| `enablementFromSpec(spec, source)` | A spec to an enablement, honoring the exact-allow-list rule. |
| `enablementFromTokens(tokens, source)`, `defaultEnablement()`, `allowListEnablement(names, source?)` | Build an enablement directly. |
| `settingsToTokens(settings)` | Saved `{ groups: { id: bool }, tools: { name: bool } }` settings to tokens; unknown groups are dropped. |
| `resolveEnablement({ allowedTools, headerSpec, querySpec, keySettings, accountSettings })` | The hosted resolution order above, in one call. |
| `enablementFromSelection(sel, source?)`, `selectionToTokens(sel)`, `specFromSelection(sel)` | Convert a `three-ws tools` selection (`{ tiers, allow, deny }`) to an enablement, tokens, or an `X-Three-Tools` spec. |
| `isToolEnabled(name, entry, en)` | Is this tool on for the session. |
| `describeEnablement(en)` | A compact, serializable view for logs and the settings API. |
| `SETTINGS_URL`, `CLI_COMMAND` | `https://three.ws/settings/mcp-tools` and `npx three-ws tools`, quoted in every refusal. |

### `@three-ws/mcp-policy/stdio`

| Export | What it is |
|---|---|
| `applyPolicy(server, { serverId, z, env?, enablement?, store? })` | Put the policy in front of every tool an `McpServer` registers from now on. Returns `{ policy, enablement, hidden }`. |
| `createStdioPolicy(serverId, { env?, enablement?, store? })` | The same policy for a low-level `Server`: `{ policy, enablement, listTools(tools), callTool(name, args, run, ownArgs?) }`. |
| `resolveStdioEnablement(serverId, env?)` | The stdio resolution order above. |
| `cliSlug(serverId)` | The CLI's config key for a package: `x402-mcp` becomes `three-ws-x402`. |

## Adding a tool

Add a row for it under its server in [src/table.js](src/table.js) with the row
helpers at the top of the file: `r(group)`, `w(group)`,
`f(group, flag, previewTool, bind)`, or `own(group, flag, previewTool)` for a
tool that verifies its own preview id. A financial tool must name the preview
tool a person sees before it runs. The audit that checks each tool's annotations
against its handler is `npm run audit:mcp-safety`
([docs/mcp-safety.md](../../docs/mcp-safety.md)).

## Related

- [docs/mcp.md](../../docs/mcp.md): every three.ws MCP server.
- [/mcp-tools](https://three.ws/mcp-tools): the searchable tool index and the allowlist builder.
- [packages/three-ws-cli](../three-ws-cli): `npx three-ws tools` writes the stdio selection this package reads.

## License

Apache-2.0. See [LICENSE](LICENSE).
