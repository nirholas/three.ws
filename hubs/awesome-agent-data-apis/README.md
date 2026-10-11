# Awesome Agent Data APIs

A curated, community-fed directory of the paid and machine-readable data that AI agents consume: pay-per-call API marketplaces, onchain data providers, market and prediction-market APIs, MCP servers, and the metering tools that let you charge for agent traffic.

Agents are becoming real customers of data. They pay per request over HTTP 402, discover services through bazaars and registries, and read prices, odds and wallets directly from APIs. This list collects the providers and tooling that make that work, with **Solana-native projects first**, then multichain and chain-agnostic services.

Every entry is a row in [`data/entries.json`](data/entries.json), so the list is as useful to a program as it is to a person. Load the JSON, filter by `chain`, `pricing` or `category`, and let your agent pick a source.

## Add your project

Open a pull request that adds one object to `data/entries.json`. The full guide is in [CONTRIBUTING.md](CONTRIBUTING.md), or use the [add-project issue template](.github/ISSUE_TEMPLATE/add-project.md) if you would rather we add it.

```sh
npm run check   # validates the data and regenerates the tables below
```

## Categories

<!-- INDEX:START -->
- [Payment Protocols and Facilitators](#payment-protocols-and-facilitators) (5)
- [Paid API Discovery and Marketplaces](#paid-api-discovery-and-marketplaces) (4)
- [Solana Data and Infrastructure](#solana-data-and-infrastructure) (11)
- [Multichain Onchain Data](#multichain-onchain-data) (10)
- [Market Data and Oracles](#market-data-and-oracles) (8)
- [Prediction Market APIs](#prediction-market-apis) (5)
- [Web Data for Agents](#web-data-for-agents) (5)
- [MCP Registries and Hosting](#mcp-registries-and-hosting) (6)
- [Usage Metering and API Monetization](#usage-metering-and-api-monetization) (8)
- [Agent Toolkits](#agent-toolkits) (3)
<!-- INDEX:END -->

## Entries

Columns: chain focus, pricing model (free, freemium, paid, pay-per-call, or unknown when the project does not state it), and status.

<!-- ENTRIES:START -->

### Payment Protocols and Facilitators

_Open standards and settlement services that let an agent pay for an API call over HTTP 402._

| Project | Chain | Pricing | Status | Description |
| --- | --- | --- | --- | --- |
| [Machine Payments Protocol (MPP)](https://mpp.dev) ([repo](https://github.com/wevm/mppx)) | Multi-chain | free | active | HTTP 402 protocol co-developed by Tempo and Stripe for charging API requests, tool calls and content. |
| [Nevermined](https://nevermined.ai) ([repo](https://github.com/nevermined-io/payments)) | Multi-chain | unknown | active | Payments infrastructure for AI agents covering delegated spending, usage metering and settlement across MCP, x402 and A2A. |
| [PayAI](https://payai.network) | Multi-chain | unknown | active | x402 payment facilitator for agents and apps that settles stablecoin payments across supported Solana and EVM networks. |
| [Stripe Machine Payments](https://docs.stripe.com/payments/machine) | Chain-agnostic | paid | active | Stripe documentation for accepting machine-to-machine and agent payments for APIs and services. |
| [x402](https://x402.org) ([repo](https://github.com/coinbase/x402)) | Multi-chain | free | active | Open payments protocol built on HTTP 402 that lets clients pay for API calls with stablecoins, with Solana and EVM support. |

### Paid API Discovery and Marketplaces

_Bazaars, indexes and explorers where agents find pay-per-call services._

| Project | Chain | Pricing | Status | Description |
| --- | --- | --- | --- | --- |
| [402 Index](https://402index.io) | Multi-chain | free | active | Protocol-agnostic directory of paid APIs (L402, x402, MPP) for AI agents, indexed, verified and searchable. |
| [Orthogonal](https://www.orthogonal.com) | Chain-agnostic | pay-per-call | active | One account for agents to reach web search, scraping and enrichment APIs through a unified API, MCP server or CLI, paying per call. |
| [x402 Bazaar](https://docs.cdp.coinbase.com/x402/bazaar) | Multi-chain | free | active | Coinbase Developer Platform discovery layer where buyers and agents find x402-enabled services. |
| [x402scan](https://www.x402scan.com) | Multi-chain | free | active | Explorer for the x402 ecosystem showing transactions, sellers, origins and resources. |

### Solana Data and Infrastructure

_RPC, indexed data, DEX and token APIs built for Solana, the home chain of this list._

| Project | Chain | Pricing | Status | Description |
| --- | --- | --- | --- | --- |
| [Birdeye Data](https://docs.birdeye.so) | Multi-chain | freemium | active | Token, price and wallet data API with strong Solana coverage. |
| [Helius](https://www.helius.dev) | Solana | freemium | active | Solana RPC, APIs, gRPC, webhooks and dedicated infrastructure, with a documented path for agents. |
| [Hello Moon](https://www.hellomoon.io) | Solana | unknown | active | Transaction landing, staking and data infrastructure for Solana teams. |
| [Jupiter Developer Platform](https://dev.jup.ag) | Solana | freemium | active | Developer platform for Jupiter APIs on Solana covering swaps, token data and prices. |
| [PumpPortal](https://pumpportal.fun) | Solana | unknown | active | Third-party API for Pump.fun and Raydium with low-latency data streams and transaction building. |
| [Quicknode](https://www.quicknode.com) | Multi-chain | freemium | active | Blockchain development platform offering RPC and data APIs, with documentation for building with AI. |
| [Shyft](https://shyft.to) | Solana | freemium | active | Solana gRPC streaming and staked RPC services for builders and traders. |
| [Solana Tracker](https://www.solanatracker.io) | Solana | freemium | active | Solana data API with 70+ endpoints and WebSocket streams, plus dedicated RPC nodes. |
| [Syndica](https://www.syndica.io) | Solana | freemium | active | Blockchain infrastructure provider with Solana RPC and streaming services. |
| [Triton One](https://triton.one) | Solana | paid | active | Solana RPC, validator and data infrastructure provider. |
| [Vybe Network](https://vybe.fyi) | Solana | freemium | active | Solana ecosystem metrics API covering DeFi TVL, whale transactions, active wallets and network activity. |

### Multichain Onchain Data

_Indexers, analytics and wallet APIs spanning many chains, many with MCP servers._

| Project | Chain | Pricing | Status | Description |
| --- | --- | --- | --- | --- |
| [Alchemy](https://www.alchemy.com) | Multi-chain | freemium | active | Blockchain infrastructure with node and data APIs across many chains, including Solana. |
| [Allium](https://www.allium.so) | Multi-chain | paid | active | Enterprise blockchain data platform with historical and real-time data across thousands of protocols. |
| [Bitquery](https://bitquery.io) | Multi-chain | freemium | active | Blockchain data APIs and real-time streams for 40+ chains including Solana gRPC, DEX trades and OHLCV. |
| [Chainstack](https://www.chainstack.com) | Multi-chain | freemium | active | Managed blockchain node and RPC infrastructure across many protocols. |
| [Codex](https://www.codex.io) | Multi-chain | freemium | active | API for real-time digital asset prices, charts, holders and onchain analytics across major networks. |
| [Dune](https://docs.dune.com) | Multi-chain | freemium | active | Onchain analytics platform with an API for querying and retrieving blockchain datasets. |
| [GoldRush](https://goldrush.dev) | Multi-chain | freemium | active | Multichain data APIs for builders, traders and teams. |
| [Mobula](https://docs.mobula.io/introduction) | Multi-chain | freemium | active | Real-time onchain trading and wallet data API focused on latency, coverage and consistency. |
| [Nansen API](https://docs.nansen.ai) | Multi-chain | paid | active | API for Nansen labeled-address analytics and Smart Money tracking. |
| [The Graph](https://thegraph.com) | Multi-chain | freemium | active | Indexing protocol that organizes blockchain data and exposes it through GraphQL. |

### Market Data and Oracles

_Prices, DeFi metrics and oracle feeds that agents read for decisions._

| Project | Chain | Pricing | Status | Description |
| --- | --- | --- | --- | --- |
| [Artemis](https://about.artemis.ai) | Multi-chain | unknown | active | AI analyst and data platform for crypto and equities research. |
| [CoinGecko API](https://docs.coingecko.com) | Chain-agnostic | freemium | active | Crypto market data API covering prices, market caps and onchain DEX data. |
| [CoinGlass](https://www.coinglass.com) | Chain-agnostic | unknown | active | Derivatives, futures and market data across crypto and other asset classes. |
| [CoinMarketCap API](https://coinmarketcap.com/api/) | Chain-agnostic | freemium | active | Cryptocurrency market data API for listings, quotes and historical data. |
| [DefiLlama API](https://api-docs.defillama.com) | Multi-chain | freemium | active | API for DeFi TVL, protocol, stablecoin and yield data. |
| [DEX Screener API](https://docs.dexscreener.com) | Multi-chain | free | active | Public API for DEX pair and token data across chains. |
| [Pyth Network](https://docs.pyth.network) | Multi-chain | free | active | Price oracle network with real-time market data feeds available on Solana and many other chains. |
| [Switchboard](https://docs.switchboard.xyz) | Multi-chain | unknown | active | Oracle network offering customizable data feeds, with strong Solana support. |

### Prediction Market APIs

_Public APIs for market odds, order books and forecasts._

| Project | Chain | Pricing | Status | Description |
| --- | --- | --- | --- | --- |
| [DFlow](https://pond.dflow.net) | Solana | unknown | active | Solana trade execution infrastructure with documentation for building on onchain markets. |
| [Kalshi API](https://docs.kalshi.com) | Chain-agnostic | free | active | API documentation for accessing Kalshi markets, prices and trading. |
| [Manifold Markets API](https://docs.manifold.markets/api) ([repo](https://github.com/manifoldmarkets/manifold)) | Chain-agnostic | free | active | Open API for reading and creating prediction markets on Manifold. |
| [Metaculus API](https://www.metaculus.com/api/) | Chain-agnostic | free | active | API for Metaculus forecasting questions and community predictions. |
| [Polymarket API](https://docs.polymarket.com) ([repo](https://github.com/Polymarket/clob-client)) | EVM | free | active | Polymarket API for real-time market data, order books and trading integrations. |

### Web Data for Agents

_Search, crawl and scrape APIs designed for LLM and agent consumption._

| Project | Chain | Pricing | Status | Description |
| --- | --- | --- | --- | --- |
| [Apify](https://apify.com) | Chain-agnostic | freemium | active | Marketplace of ready-to-run scraping and automation tools, reachable by agents through an MCP server. |
| [Brave Search API](https://brave.com/search/api/) | Chain-agnostic | paid | active | Independent web search API suitable for grounding AI agents. |
| [Exa](https://exa.ai) ([repo](https://github.com/exa-labs/exa-mcp-server)) | Chain-agnostic | freemium | active | Search API for AI agents needing real-time web data and structured content, with an MCP server. |
| [Firecrawl](https://www.firecrawl.dev) ([repo](https://github.com/firecrawl/firecrawl-mcp-server)) | Chain-agnostic | freemium | active | Web data API that crawls and scrapes sites into LLM-ready content, with an MCP server. |
| [Tavily](https://tavily.com) ([repo](https://github.com/tavily-ai/tavily-mcp)) | Chain-agnostic | freemium | active | Search and extraction API built for AI agents, with an MCP server. |

### MCP Registries and Hosting

_Directories and hosts for MCP servers that expose data and tools to agents._

| Project | Chain | Pricing | Status | Description |
| --- | --- | --- | --- | --- |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) ([repo](https://github.com/punkpeye/awesome-mcp-servers)) | Chain-agnostic | free | active | Curated list of MCP servers that inspired the format of this directory. |
| [Glama](https://glama.ai/mcp/servers) | Chain-agnostic | free | active | Large searchable registry of open-source MCP servers. |
| [mcp.so](https://mcp.so) | Chain-agnostic | free | active | Community directory of MCP servers and clients. |
| [Model Context Protocol Registry](https://registry.modelcontextprotocol.io) | Chain-agnostic | free | active | Official registry for publishing and discovering MCP servers. |
| [Model Context Protocol Servers](https://github.com/modelcontextprotocol/servers) ([repo](https://github.com/modelcontextprotocol/servers)) | Chain-agnostic | free | active | Reference collection of MCP server implementations maintained by the MCP project. |
| [Smithery](https://smithery.ai) | Chain-agnostic | freemium | active | Platform to discover and connect agents to MCP servers with auth and sessions handled. |

### Usage Metering and API Monetization

_Gateways, billing and metering tools for charging agent traffic._

| Project | Chain | Pricing | Status | Description |
| --- | --- | --- | --- | --- |
| [Amberflo](https://www.amberflo.io) | Chain-agnostic | paid | active | Monetization platform for metering and billing AI and API usage. |
| [Cloudflare AI Crawl Control](https://developers.cloudflare.com/ai-crawl-control/) | Chain-agnostic | unknown | active | Cloudflare tooling to see, control and monetize how AI crawlers and agents access a site. |
| [Lago](https://www.getlago.com) ([repo](https://github.com/getlago/lago)) | Chain-agnostic | freemium | active | Open-source billing and usage-based pricing platform for AI products. |
| [Metronome](https://metronome.com) | Chain-agnostic | paid | active | Usage-based billing platform for metered products. |
| [Moesif](https://www.moesif.com) | Chain-agnostic | freemium | active | API analytics and monetization platform for understanding and charging for API usage. |
| [OpenMeter](https://openmeter.io) ([repo](https://github.com/openmeterio/openmeter)) | Chain-agnostic | freemium | active | Open-source metering and billing for AI and API usage, with entitlements and flexible pricing. |
| [Orb](https://withorb.com) | Chain-agnostic | paid | active | Usage-based billing and pricing platform. |
| [Zuplo](https://zuplo.com) | Chain-agnostic | freemium | active | API, LLM and MCP gateway with a programmable policy engine for securing and governing traffic. |

### Agent Toolkits

_SDKs that give agents wallets and data access to pay for and consume these services._

| Project | Chain | Pricing | Status | Description |
| --- | --- | --- | --- | --- |
| [Coinbase AgentKit](https://github.com/coinbase/agentkit) ([repo](https://github.com/coinbase/agentkit)) | Multi-chain | free | active | Toolkit that gives AI agents wallets and onchain actions. |
| [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) ([repo](https://github.com/sendaifun/solana-agent-kit)) | Solana | free | active | Open-source toolkit connecting AI agents to Solana protocols. |
| [Solana MCP](https://github.com/solana-foundation/solana-mcp) ([repo](https://github.com/solana-foundation/solana-mcp)) | Solana | free | active | Solana Foundation MCP server for Solana developer resources. |

<!-- ENTRIES:END -->

## Using the data

```js
import entries from './data/entries.json' with { type: 'json' };
const solanaPayPerCall = entries.filter((e) => e.chain === 'solana' && e.pricing === 'pay-per-call');
```

The shape is defined in [`data/schema.json`](data/schema.json).

## License

[CC0 1.0 Universal](LICENSE). Use the list and the data however you like.
