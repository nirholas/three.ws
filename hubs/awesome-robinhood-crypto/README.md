# Awesome Robinhood Crypto

> A curated, machine-readable directory for developers and AI agents building on Robinhood Crypto and Robinhood Chain.

Robinhood opened two doors for builders. The **Robinhood Crypto Trading API** lets you read market data, check holdings and place orders with signed requests. **Robinhood Chain** is an Arbitrum Orbit L2 on Ethereum, live on mainnet (chain ID 4663) with a public testnet (chain ID 46630), where anyone can deploy contracts. Around both, a community is shipping API clients, MCP servers for agents, trading bots, SDKs, alert tools and infrastructure.

This list is the one place to find all of it. Every entry was checked against its live page or repository before it was added, and every entry lives in one JSON file so tools and agents can consume the directory as easily as people can read it.

## Why this list

- **Verified.** Each project exists, its link resolves, and its one-line description matches what it does.
- **Machine-readable.** [`data/entries.json`](data/entries.json) is the source of truth, with a [JSON Schema](data/schema.json). Load it from your own app, bot or agent.
- **Easy to join.** Add one JSON object in a pull request. The tables below are generated, so you never touch markdown.
- **Crypto focused.** Robinhood Crypto API, Robinhood Chain, and the agent and developer tooling around them.

## Add your project

Built something for Robinhood Crypto or Robinhood Chain? It belongs here. Read [CONTRIBUTING.md](CONTRIBUTING.md), add an object to `data/entries.json` in the right category and alphabetical position, run `npm run check`, and open a pull request. Prefer to suggest a project without editing JSON? Open an issue with the [Add a project template](.github/ISSUE_TEMPLATE/add-project.md).

## Use the data

```js
import entries from './data/entries.json' with { type: 'json' };

const mcpServers = entries.filter((e) => e.category === 'mcp-servers' && e.status === 'active');
```

Each entry has `id`, `name`, `url`, `repo`, `category`, `chain`, `description`, `status` (`active`, `early` or `archived`) and `added`. Status meanings: **active** has had commits in the last six months, **early** is young or experimental, **archived** is archived upstream or has had no commits for a year but remains useful as a reference.

## Directory

<!-- ENTRIES:START -->

_56 projects across 9 categories. Generated from [data/entries.json](data/entries.json), do not edit by hand._

**Categories**

- [Official Documentation](#official-documentation) (13): First-party references from Robinhood for the Crypto Trading API and Robinhood Chain.
- [Robinhood Crypto API Clients](#robinhood-crypto-api-clients) (5): Libraries that wrap the Robinhood Crypto Trading API, including Ed25519 request signing, in the language of your choice.
- [MCP Servers](#mcp-servers) (7): Model Context Protocol servers that give AI agents access to Robinhood Crypto and Robinhood Chain.
- [Trading Bots and CLI Tools](#trading-bots-and-cli-tools) (6): Bots, strategies and terminal tools for portfolios, holdings and order flow on Robinhood Crypto and Robinhood Chain.
- [Agent Integrations and Payments](#agent-integrations-and-payments) (2): Agent runtimes, plugins and payment rails that let autonomous software operate on Robinhood Chain.
- [Robinhood Chain SDKs and Toolkits](#robinhood-chain-sdks-and-toolkits) (7): Typed SDKs, example projects and parsers for building on Robinhood Chain (mainnet chain ID 4663).
- [Chain Infrastructure and Data APIs](#chain-infrastructure-and-data-apis) (11): RPC providers, explorers, indexers, oracles and faucets that serve Robinhood Chain.
- [Market Data, Analytics and Alerts](#market-data-analytics-and-alerts) (3): Real-time alerts, wallet intelligence and market-data clients for Robinhood Chain.
- [Security and Risk Tools](#security-and-risk-tools) (2): Token scanners and transaction checks that help developers and agents avoid bad trades.

### Official Documentation

First-party references from Robinhood for the Crypto Trading API and Robinhood Chain.

| Project | Description | Chain | Status | Source |
| --- | --- | --- | --- | --- |
| [Connecting to Robinhood Chain](https://docs.robinhood.com/chain/connecting) | Official network configuration for mainnet (chain ID 4663) and testnet (46630), RPC providers, public endpoints and explorers. | Robinhood Chain | Active | docs |
| [Robinhood Chain Account Abstraction](https://docs.robinhood.com/chain/account-abstraction) | Official documentation for account abstraction on Robinhood Chain. | Robinhood Chain | Active | docs |
| [Robinhood Chain Bridging Guide](https://docs.robinhood.com/chain/bridging) | Official guide to bridging assets to and from Robinhood Chain. | Robinhood Chain | Active | docs |
| [Robinhood Chain Contracts Reference](https://docs.robinhood.com/chain/protocol-contracts) | Official reference of token and protocol contract addresses on Robinhood Chain. | Robinhood Chain | Active | docs |
| [Robinhood Chain Cross-Chain Messaging](https://docs.robinhood.com/chain/cross-chain-messaging) | Official documentation for cross-chain messaging on Robinhood Chain. | Robinhood Chain | Active | docs |
| [Robinhood Chain Data Streams](https://docs.robinhood.com/chain/data-streams) | Official documentation for Data Streams on Robinhood Chain. | Robinhood Chain | Active | docs |
| [Robinhood Chain Deploy a Contract](https://docs.robinhood.com/chain/deploy-smart-contracts) | Official walkthrough for deploying smart contracts to Robinhood Chain. | Robinhood Chain | Active | docs |
| [Robinhood Chain Documentation](https://docs.robinhood.com/chain) | Official developer documentation for Robinhood Chain, the Arbitrum Orbit L2 on Ethereum with ETH gas. | Robinhood Chain | Active | docs |
| [Robinhood Chain Oracles and Price Feeds](https://docs.robinhood.com/chain/oracles-and-price-feeds) | Official guide to the oracles and price feeds available to contracts on Robinhood Chain. | Robinhood Chain | Active | docs |
| [Robinhood Chain Public Testnet Announcement](https://robinhood.com/us/en/newsroom/robinhood-chain-launches-public-testnet) | Robinhood newsroom post announcing the Robinhood Chain public testnet and pointing developers to the docs. | Robinhood Chain | Active | docs |
| [Robinhood Crypto Trading API Docs](https://docs.robinhood.com/crypto/trading/) | Official reference for the Robinhood Crypto Trading API: accounts, holdings, market data, quotes and orders with Ed25519 request signing. | Off-chain API | Active | docs |
| [Robinhood Crypto Trading API Support Guide](https://robinhood.com/us/en/support/articles/crypto-api) | Official guide to creating Crypto Trading API keys, choosing key permissions and the differences between the v1 and v2 order endpoints. | Off-chain API | Active | docs |
| [Run a Robinhood Chain Full Node](https://docs.robinhood.com/chain/run-a-full-node) | Official instructions for running your own Robinhood Chain full node. | Robinhood Chain | Active | docs |

### Robinhood Crypto API Clients

Libraries that wrap the Robinhood Crypto Trading API, including Ed25519 request signing, in the language of your choice.

| Project | Description | Chain | Status | Source |
| --- | --- | --- | --- | --- |
| [hood](https://github.com/Jayson-Fong/hood) | Unofficial typed Python client for the Robinhood Crypto Trading API with pagination helpers and order configuration types. | Off-chain API | Active | [repo](https://github.com/Jayson-Fong/hood) |
| [robinhood-crypto-api](https://github.com/KuchikiRenji/robinhood-crypto-api) | Unofficial Node.js and TypeScript client for the Robinhood Crypto API covering market data, accounts, holdings and orders. | Off-chain API | Active | [repo](https://github.com/KuchikiRenji/robinhood-crypto-api) |
| [robinhood-crypto-client](https://github.com/albedosehen/robinhood-crypto-client) | TypeScript client for the Robinhood Crypto API built with Deno, with Ed25519 signing and token bucket rate limiting. | Off-chain API | Archived | [repo](https://github.com/albedosehen/robinhood-crypto-client) |
| [Robinhood-CryptoTrading](https://github.com/masters274/Robinhood-CryptoTrading) | PowerShell module covering the Robinhood Crypto Trading API routes, with Ed25519 request signing via BouncyCastle. | Off-chain API | Archived | [repo](https://github.com/masters274/Robinhood-CryptoTrading) |
| [robinhood-official-crypto-api](https://github.com/hackingthemarkets/robinhood-official-crypto-api) | Python demo of the official Robinhood Crypto Trading API, including Ed25519 key generation and signed requests. | Off-chain API | Archived | [repo](https://github.com/hackingthemarkets/robinhood-official-crypto-api) |

### MCP Servers

Model Context Protocol servers that give AI agents access to Robinhood Crypto and Robinhood Chain.

| Project | Description | Chain | Status | Source |
| --- | --- | --- | --- | --- |
| [FinAgent MCP](https://github.com/Harshaan-Chugh/FinAgent-MCP) | MCP server that gives LLMs structured access to Plaid banking data and Robinhood cryptocurrency trading, with evidence tracking. | Off-chain API | Early | [repo](https://github.com/Harshaan-Chugh/FinAgent-MCP) |
| [Hood Domains MCP](https://github.com/Hooddomains/hoodmcp) | MCP server that gives agents tools to resolve, look up and register .hood names on Robinhood Chain, with no backend to host. | Robinhood Chain | Active | [repo](https://github.com/Hooddomains/hoodmcp) |
| [hood-mcp](https://github.com/nirholas/robinhood-chain-mcp) | Two MCP servers for Robinhood Chain: a zero-config data server and an opt-in trading server with hard spend caps and confirm gates. | Robinhood Chain | Active | [repo](https://github.com/nirholas/robinhood-chain-mcp) |
| [Robinhood MCP Server](https://github.com/rohitsingh-iitd/robinhood-mcp-server) | MCP server for the Robinhood Crypto API covering authentication, account management, market data and trading over REST and WebSocket. | Off-chain API | Archived | [repo](https://github.com/rohitsingh-iitd/robinhood-mcp-server) |
| [robinhood-mcp](https://github.com/nirholas/robinhood-mcp) | MCP execution toolkit for the official Robinhood Crypto Trading API, with an interactive Ed25519 signing bench. | Off-chain API | Active | [repo](https://github.com/nirholas/robinhood-mcp) |
| [robinscan-mcp](https://github.com/robinscan/robinscan-mcp) | MCP server for Robinhood Chain data: network stats, activity charts and address transaction history. | Robinhood Chain | Early | [repo](https://github.com/robinscan/robinscan-mcp) |
| [VEYA MCP](https://github.com/veyanet/veya-mcp) | MCP server for VEYA on Robinhood Chain: post-quantum agent tools, chain verification and protocol settlement over Streamable HTTP. | Robinhood Chain | Early | [repo](https://github.com/veyanet/veya-mcp) |

### Trading Bots and CLI Tools

Bots, strategies and terminal tools for portfolios, holdings and order flow on Robinhood Crypto and Robinhood Chain.

| Project | Description | Chain | Status | Source |
| --- | --- | --- | --- | --- |
| [bitcoin-swing-trading-robinhood](https://github.com/max-glass/bitcoin-swing-trading-robinhood) | Bitcoin swing trading bot built on the official Robinhood Crypto API. | Off-chain API | Archived | [repo](https://github.com/max-glass/bitcoin-swing-trading-robinhood) |
| [Coinhood](https://github.com/anirudh-arunkumar/Coinhood) | Trading tool that uses the Robinhood Crypto API to execute manually defined strategies on popular cryptocurrencies. | Off-chain API | Archived | [repo](https://github.com/anirudh-arunkumar/Coinhood) |
| [market](https://github.com/seanebones-lang/market) | Spot BTC trader with a broker-adapter design targeting the official Robinhood Crypto Trading API, with live trading gated off by default. | Off-chain API | Early | [repo](https://github.com/seanebones-lang/market) |
| [OpenCatz AI Robinhood Chain Edition](https://github.com/muratmula/ai-robinhood-chain) | Multi-agent crypto intelligence and trading system for Robinhood Chain, operated through Discord, a terminal UI, a REST API and Telegram. | Robinhood Chain | Active | [repo](https://github.com/muratmula/ai-robinhood-chain) |
| [Robinhood Crypto Trading CLI](https://github.com/sachinchhetri202/robinhood_api_trading) | Command-line tool to view your Robinhood crypto portfolio and holdings, check prices and place trades from the terminal. | Off-chain API | Early | [repo](https://github.com/sachinchhetri202/robinhood_api_trading) |
| [robinhood-trading-bot](https://github.com/nirholas/robinhood-trading-bot) | Robinhood Chain bot with parameter trading on new launches and wallet copy trading, a web dashboard, a CLI and paper mode by default. | Robinhood Chain | Active | [repo](https://github.com/nirholas/robinhood-trading-bot) |

### Agent Integrations and Payments

Agent runtimes, plugins and payment rails that let autonomous software operate on Robinhood Chain.

| Project | Description | Chain | Status | Source |
| --- | --- | --- | --- | --- |
| [merrymen](https://github.com/millw14/merrymen) | Autonomous trading agents for Robinhood Chain that operate inside hard on-chain limits, usable from Claude through MCP. | Robinhood Chain | Active | [repo](https://github.com/millw14/merrymen) |
| [r0x](https://github.com/nhevers/project-r0x) | SDK, Claude Code and MCP plugin and docs for r0x, the x402 facilitator that lets agents pay in USDG on Robinhood Chain. | Robinhood Chain | Active | [repo](https://github.com/nhevers/project-r0x) |

### Robinhood Chain SDKs and Toolkits

Typed SDKs, example projects and parsers for building on Robinhood Chain (mainnet chain ID 4663).

| Project | Description | Chain | Status | Source |
| --- | --- | --- | --- | --- |
| [hoodchain](https://github.com/nirholas/robinhood-chain-sdk) | Typed, viem-native TypeScript SDK for Robinhood Chain with Chainlink quotes, Uniswap v3 swaps, USDG, launchpad watchers and a sequencer firehose. | Robinhood Chain | Active | [repo](https://github.com/nirholas/robinhood-chain-sdk) |
| [hoodkit](https://github.com/nirholas/robinhood-chain-kit) | Power-user toolkit on top of hoodchain: reconnecting streams, read-through caching, multicall batching and a local SQLite indexer. | Robinhood Chain | Active | [repo](https://github.com/nirholas/robinhood-chain-kit) |
| [OrbitFlare Robinhood SDK](https://github.com/orbitflare/orbitflare-robinhood-sdk-rs) | Rust SDK for Robinhood Chain with alloy types, RPC and WebSocket clients, retry with backoff and endpoint failover. | Robinhood Chain | Active | [repo](https://github.com/orbitflare/orbitflare-robinhood-sdk-rs) |
| [RBH Parser SDK](https://github.com/0xfnzero/rbh-parser-sdk) | Low-latency Go parser for Robinhood Chain events, receipts and calldata across launchpads and Uniswap v4. | Robinhood Chain | Early | [repo](https://github.com/0xfnzero/rbh-parser-sdk) |
| [RBH Trade SDK](https://github.com/0xfnzero/rbh-trade-sdk) | Low-latency Go SDK with typed calldata builders for Robinhood Chain launchpads, Permit2 and Uniswap v4 trading. | Robinhood Chain | Early | [repo](https://github.com/0xfnzero/rbh-trade-sdk) |
| [Robinhood Chain Examples](https://github.com/nirholas/robinhood-chain-examples) | Runnable example projects for Robinhood Chain, from a raw viem read to a live dashboard, a Telegram bot and a paper-trading loop. | Robinhood Chain | Active | [repo](https://github.com/nirholas/robinhood-chain-examples) |
| [robinhood-toolkit](https://github.com/nirholas/robinhood-toolkit) | Verified network constants, runnable examples and 64 build prompts for Robinhood Chain and the Robinhood Crypto REST API. | Robinhood Chain | Active | [repo](https://github.com/nirholas/robinhood-toolkit) |

### Chain Infrastructure and Data APIs

RPC providers, explorers, indexers, oracles and faucets that serve Robinhood Chain.

| Project | Description | Chain | Status | Source |
| --- | --- | --- | --- | --- |
| [Alchemy Robinhood Chain API Quickstart](https://docs.alchemy.com/reference/robinhood-chain-api-quickstart) | Alchemy guide to getting started with the Robinhood Chain JSON-RPC API. | Robinhood Chain | Active | docs |
| [BitGo Robinhood Chain Guide](https://developers.bitgo.com/docs/robinhood-chain) | BitGo developer docs for Robinhood Chain: supported wallet types, ticker symbols, explorers and the testnet faucet. | Robinhood Chain | Active | docs |
| [Bitquery Robinhood Chain API](https://docs.bitquery.io/docs/blockchain/robinhood/) | Bitquery GraphQL and WebSocket API for Robinhood Chain trades, transfers, balances, holders, liquidity and events. | Robinhood Chain | Active | docs |
| [Blockscout Robinhood Chain API](https://docs.blockscout.com/robinhood-api) | Blockscout explorer API docs for Robinhood Chain with a free plan, covering transactions, batches, addresses and gas. | Robinhood Chain | Active | docs |
| [Chainlink Price Feed Addresses](https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood) | Chainlink directory of price feed contract addresses, filterable to Robinhood Chain. | Robinhood Chain | Active | docs |
| [Chainstack Robinhood Chain API Reference](https://docs.chainstack.com/reference/robinhood-getting-started) | Chainstack JSON-RPC quickstart for Robinhood Chain with full and archive nodes, debug and trace on mainnet and testnet. | Robinhood Chain | Active | docs |
| [Chainstack Robinhood Chain Sequencer Feed](https://github.com/chainstacklabs/robinhood-chain-sequencer-feed) | Chainstack Labs example that decodes the Robinhood Chain sequencer feed to see transactions before they execute. | Robinhood Chain | Active | [repo](https://github.com/chainstacklabs/robinhood-chain-sequencer-feed) |
| [QuickNode Robinhood Chain Docs](https://www.quicknode.com/docs/robinhood) | QuickNode documentation for Robinhood Chain RPC endpoints. | Robinhood Chain | Active | docs |
| [Robinhood Chain Explorer](https://robinhoodchain.blockscout.com) | Blockscout block explorer for Robinhood Chain mainnet (chain ID 4663). | Robinhood Chain | Active | docs |
| [Robinhood Chain Testnet Explorer](https://explorer.testnet.chain.robinhood.com) | Official block explorer for the Robinhood Chain testnet (chain ID 46630). | Robinhood Chain | Active | docs |
| [Robinhood Chain Testnet Faucet](https://faucet.testnet.chain.robinhood.com) | Faucet that issues free testnet ETH for developing and testing on the Robinhood Chain testnet. | Robinhood Chain | Active | docs |

### Market Data, Analytics and Alerts

Real-time alerts, wallet intelligence and market-data clients for Robinhood Chain.

| Project | Description | Chain | Status | Source |
| --- | --- | --- | --- | --- |
| [hood-alerts](https://github.com/nirholas/robinhood-chain-alert-bot) | Telegram, Discord and X alert bots for Robinhood Chain launches, graduations, whale trades, holder milestones and liquidity-pull warnings. | Robinhood Chain | Active | [repo](https://github.com/nirholas/robinhood-chain-alert-bot) |
| [MadeOnSol Robinhood Chain SDK](https://github.com/MadeOnSol/robinhood-chain-sdk) | Zero-dependency TypeScript client for the MadeOnSol Robinhood Chain API: KOL trades, token discovery, wallet data and streams. | Robinhood Chain | Active | [repo](https://github.com/MadeOnSol/robinhood-chain-sdk) |
| [robinhood-volume-alerts](https://github.com/nirholas/robinhood-volume-alerts) | Telegram bot that learns each Robinhood Chain token's normal per-minute volume and alerts when a token trades a multiple of it. | Robinhood Chain | Active | [repo](https://github.com/nirholas/robinhood-volume-alerts) |

### Security and Risk Tools

Token scanners and transaction checks that help developers and agents avoid bad trades.

| Project | Description | Chain | Status | Source |
| --- | --- | --- | --- | --- |
| [jevscan](https://github.com/jevbook/jevscan) | Typed onchain verdicts for EVM tokens with rug risk and liquidity scores as a library, CLI and MCP server, Robinhood Chain first. | Multi-chain | Early | [repo](https://github.com/jevbook/jevscan) |
| [ShieldBot](https://github.com/Ridwannurudeen/shieldbot) | Transaction security for EVM chains that checks tokens, approvals and signatures, including honeypot simulation on Robinhood Chain. | Multi-chain | Active | [repo](https://github.com/Ridwannurudeen/shieldbot) |

<!-- ENTRIES:END -->

## Maintaining

```sh
npm run validate   # check data/entries.json
npm run build      # regenerate the tables above
npm run check      # both
```

The scripts need only Node 18 or newer and have no dependencies.

## License

The list and its data are dedicated to the public domain under [CC0 1.0](LICENSE). Each listed project keeps its own license. Descriptions are written to be factual, and listing a project is not an endorsement or a security audit, so review any code that handles API keys or signs transactions before you run it.
