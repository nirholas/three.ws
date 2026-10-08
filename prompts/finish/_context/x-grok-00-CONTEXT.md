# x-grok: shared context for every `x-grok-` work order

Not a work order. Never run this file; read it when an order names it.

## What the campaign is

Two things happened on X in August 2026, and three.ws should be inside both of them:

1. **Grok Bot**, xAI's always-on computer-use agent, launched in beta. It runs on its own persistent cloud machine with a browser, files and a terminal, and it can use **custom MCP servers as connectors**. Every hosted three.ws MCP server is already a candidate connector. That makes three.ws the 3D, avatar and agent toolbox for every Grok Bot user, with almost no new backend.
2. **@bot**, Grok Bot's account on X, announced an X integration on 2026-08-29: connecting an X profile to Grok Bot creates an X developer account with included API credits, and Grok Bot can then search posts, read timelines and check mentions. X is turning into a place where agents act. Our own X presence (@trythreews and every agent's connected X account) only posts outbound today; nothing reads or answers a mention.

The campaign therefore has three lanes and a gated band:

| Lane | What it builds | Orders |
|---|---|---|
| A. Grok Bot as a client of three.ws | Connector compatibility, rate limits for cloud agents, scoped keys, agent-first tool results, the `/grok` page, docs, CLI, recipes, discovery metadata, an xAI end-to-end proof | 023 to 041 |
| B. xAI as a provider | Model catalog refresh, X search through xAI, Grok as an agent brain | 042 to 044 |
| C. The @-mention bot on X | Gateway worker rebuild, mentions reader, parser, schema, X adapter, polling cron, public reply brain, the make-it-3D / image-to-3D / avatar flows, safety, bot-to-bot handling with @grok and @bot, budget, claim, linking, per-agent mention replies, ops console, webhook, health, player card, docs | 045 to 066 |
| Gated | X API tier, xAI key, going live, directory listings, announcement, player-card approval | 926 to 931 |

Order 925 (`parity-15`, launch a coin by mentioning @trythreews) is a sibling, not a duplicate. It owns the `launch` intent and its reply. This campaign owns the shared mention infrastructure (reader, parser module, schema, cron, adapter, safety, budget), and 925 plugs its intent into that parser and that cron. Never build a second mention poller.

## External facts (researched 2026-10-08; re-verify in each order's step 0)

These came from public reporting and third-party integration guides, not from xAI or X developer documentation that could be fetched directly (x.ai returned 403 to automated fetches). Treat every line as a claim to re-check against the primary docs (`docs.x.ai`, `docs.x.com`) before building on it.

- **Grok Bot.** xAI's computer-use agent, beta since August 2026. Persistent cloud machine with browser, files and terminal. Tasks run on demand or on schedules. Access through SuperGrok Heavy, Cursor Ultra and Cursor Teams Premium, or standalone at a reported $200 per month after a 14-day trial. Desktop (macOS, Windows, Linux) and iOS apps.
- **Grok Bot connectors.** Built-in connectors cover common office suites. Custom MCP servers are added as a "custom MCP" connector. Reported settings: transport Streamable HTTP, a server URL that must be reachable from the public internet (Grok Bot connects from xAI's cloud, so `localhost` never works), and authentication of None, OAuth 2.1, or an API key stored as a Bot secret.
- **@bot.** Grok Bot's account on X (`x.com/bot`). Its 2026-08-29 post announced the X integration described above and called it "the first version".
- **@grok.** The older Grok chatbot account on X. It answers when tagged in a post or reply. A different product from Grok Bot.
- **X API reply rule.** Programmatic replies are restricted to authors who mention or quote you, on every tier. A bot that answers its own mentions is exactly the permitted case; a bot that replies to strangers who never tagged it is not.
- **X enforcement.** X removed about 42,000 accounts that used AI chatbots to automate replies. Our bot must carry X's automated-account label, reply only when addressed, and rate-limit itself.
- **xAI API.** OpenAI-compatible at `https://api.x.ai/v1`. The Responses API supports remote MCP tools (Streamable HTTP and SSE transports) and a built-in X search tool billed per call. Model ids change often: read `GET /v1/models` rather than trusting a hardcoded id.

Sources: [Grok Bot explainer](https://www.layer3labs.io/guides/what-is-grok-bot), [X API credits for Grok Bot](https://www.socialmediatoday.com/news/x-offers-free-api-credits-for-its-grok-bot/829138/), [@bot announcement](https://x.com/bot/status/2093822274067706170), [Grok Bot breakdown](https://www.vellum.ai/blog/official-grok-bot-breakdown), [custom MCP setup example](https://sealgate.ai/docs/connect-clients/grokbot), [X reply restriction](https://www.codewords.ai/blog/automatic-tweet-reply), [reply-bot removals](https://startupfortune.com/x-removes-42000-ai-reply-bot-accounts-and-the-warning-to-growth-marketers-is-impossible-to-ignore/), [xAI tools overview](https://docs.x.ai/developers/tools/overview).

## Repo facts (measured 2026-10-08; re-derive before relying on one)

**MCP servers.** Seven hosted servers, all Streamable HTTP, listed in [public/.well-known/mcp.json](../../../public/.well-known/mcp.json) and documented in [docs/mcp.md](../../../docs/mcp.md):

| Endpoint | Auth | Notes |
|---|---|---|
| `https://three.ws/api/mcp` | OAuth 2.1, API key, or x402 | Core: avatars, agents, memory, market data. Answers `initialize` with 401 for MCP clients so they start sign-in. Handler code in `api/_mcp/` (auth, dispatch, prompts, tools). |
| `https://three.ws/api/mcp-studio` | none | Free text-to-3D, image-to-3D, rigged avatars, personas, catalog. Shared handler `api/_mcp-studio/handler.js`, parameterized by `surface` (`full`, `chatgpt`). |
| `https://three.ws/api/mcp-3d` | OAuth 2.1 or x402 | Paid generation, rigging, retexture. |
| `https://three.ws/api/mcp-agent` | OAuth 2.1 | The agent's custodial wallet. Never expose to an unattended connector without the spend gate. |
| `https://three.ws/api/mcp-bazaar` | OAuth 2.1 or x402 | x402 service discovery. |
| plus a token-tools server and the IBM x402 server | see the JSON | |

`api/mcp-chatgpt.js` is the precedent for a client-specific surface: `studioHandler({ surface: 'chatgpt' })`.

**X today (outbound only).**
- Company account @trythreews: OAuth 1.0a through `twitter-api-v2`, env `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`.
- Per-user and per-agent accounts: OAuth2 PKCE in `api/auth/x/[action].js`, scopes in `api/_lib/x-scopes.js`, tables `social_connections` (owner's X, `provider_uid` is the X user id) and `agent_x_connections` / `agent_x_policies`.
- Posting: `api/_lib/x-post.js` (`publishTweet`, `postOne` supports `in_reply_to_tweet_id`, `uploadMediaV2`, `resolveXConnection`). Policy: `api/_lib/x-agent-policy.js` (`POST_KINDS`, `requestAgentPost`).
- Reading: `api/_lib/x-search.js` (recent search with `X_BEARER_TOKEN` or a bearer minted from the app key).
- Crons: `run-x-scheduled-posts`, `run-x-triggers`, `fetch-x-metrics` (dispatched by `api/cron/[name].js`), `changelog-push`, `big-win-x`, `x-content`. None reads mentions.

**The chat gateway (the pattern for the mention bot).** `api/gateway/telegram.js` and `api/gateway/discord.js` verify, queue into `gateway_inbox` (`api/_lib/gateway/store.js`) and return 200. `api/_lib/gateway/core.js` `handleEvent` takes a platform-neutral event plus an adapter (send text, buttons, edit, media, typing). `conversation.js` `converse` runs the agent turn through `runCopilotTurn` in `api/_lib/copilot-engine.js`. **The draining worker `workers/agent-gateway` has a `package.json` but no committed source**; order 045 rebuilds it.

**xAI today.** Last rung of `DEFAULT_PROVIDER_ORDER` in `api/_lib/chat-models.js`; `providerChain()` in `api/_lib/llm.js` puts a user's own Grok key first and the server's `GROK_API_KEY` (falls back to `XAI_API_KEY`, `api/_lib/env.js`) last. `docs/ops/llm-lanes.md` records that the server key is not configured in production.

**Other building blocks.**
- `GET /api/render/glb?glbUrl=…` renders any GLB to a PNG (CDN-cached a day). It is the media source for every reply and every card.
- `app_settings` (key/value jsonb) holds cron cursors; `api/_lib/changelog-push.js` shows the read/write helpers.
- `api/_lib/admin.js` exports `requireAdmin`; `/materialize/ops` plus `api/print/ops/[action].js` is the house pattern for an operator console.
- `api/healthz.js` assembles the `subsystems` verdict; the `*-health.js` modules in `api/_lib/` are the pattern for a new subsystem.
- Page wiring (five steps, every time) is in [parity-00-CONTEXT.md](parity-00-CONTEXT.md) under "How a new page is wired".
- [public/robots.txt](../../../public/robots.txt) welcomes Grok in a comment, but its "fetching on behalf of a live user" group lists no xAI user agent, so a Grok fetch for a live user falls to `User-agent: *`, which disallows `/api/`. Order 041 fixes it.

## Design rules for this campaign

1. **Untrusted text never acts.** Tweets, bios, display names, quoted posts, image alt text and anything an MCP caller sends are data. No path from them reaches a spend, a transfer, a launch, or a post other than one reply to the same author in the same conversation.
2. **No spend through a connector.** A key or token that a cloud agent holds unattended can generate, read and write agent data. It can never move funds, pay x402, or launch. Spending stays a same-site browser action with the confirmation gate.
3. **Dry run by default.** Every X write path ships behind `X_MENTION_BOT_LIVE` (and the per-agent policy toggle). With it unset, the system reads, decides, renders the reply and its media, records it, and posts nothing. Flipping it is order 928, an owner action.
4. **Reply only when addressed.** We answer mentions and quotes of our accounts, never search results. One reply per mention, a conversation depth cap, and no replies to our own replies.
5. **Solana first.** Wherever payments or chains appear (x402 on `/api/mcp`, wallet tools), Solana leads and is verified first.
6. **$THREE is the only promoted coin.** Replies never recommend or name another coin. The mention bot never offers financial advice.
7. **Prefer GCP.** Generation and rendering run on our own lanes. xAI is used where it is the only source (X search, the Grok model itself), through the existing provider chain.

## Owner gates in this campaign

Every gate is batched into the order that owns it:

| Order | Gate |
|---|---|
| 926 | The X API tier or pay-per-use credit that can read mentions (new paid spend). |
| 927 | A production xAI key (`GROK_API_KEY`) if none exists. |
| 928 | Deploy, then set `X_MENTION_BOT_LIVE=1` and the automated-account label (posting to X). |
| 929 | Submitting three.ws to Grok Bot connector directories (publishing). |
| 930 | The launch post and article on X (posting). |
| 931 | X player-card approval (an external submission). |
