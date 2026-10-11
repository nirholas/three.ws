# Awesome Solana Agents

A curated, community-fed directory of the tools that AI agents use on Solana: agent kits and frameworks, MCP servers, skills, wallets, payment rails, onchain identity, data and RPC, and launch infrastructure.

Every entry is a small JSON record in [`data/entries.json`](data/entries.json), so people can browse it here and software can consume it directly. Each listing was checked against its official page or repository.

**Add your project:** see [CONTRIBUTING.md](CONTRIBUTING.md) or open an [Add a project issue](../../issues/new?template=add-project.md).

## Categories

- [Agent Frameworks and Kits](#agent-frameworks-and-kits)
- [MCP Servers](#mcp-servers)
- [Skills](#skills)
- [Agent Wallets and Signing](#agent-wallets-and-signing)
- [Payments](#payments)
- [Identity and Registries](#identity-and-registries)
- [Data, RPC and Transaction Tooling](#data-rpc-and-transaction-tooling)
- [Launch and Protocol Infrastructure](#launch-and-protocol-infrastructure)
- [Developer Tooling](#developer-tooling)
- [Resources](#resources)

## Entries

<!-- ENTRIES:START -->

### Agent Frameworks and Kits

Frameworks, SDKs and platforms for building AI agents that act on Solana.

| Project | Description | Chain | Status |
| --- | --- | --- | --- |
| [AgentiPy](https://github.com/niceberginc/agentipy) | MIT-licensed Python toolkit for connecting AI agents to onchain apps on Solana and Base. | Multi-chain | Active |
| [Coinbase AgentKit](https://github.com/coinbase/agentkit) | Coinbase Developer Platform toolkit that gives AI agents a crypto wallet, with Solana examples in TypeScript and Python. | Multi-chain | Active |
| [ElizaOS](https://github.com/elizaOS/eliza) | Open-source TypeScript framework for autonomous AI agents, with non-custodial EVM and Solana wallet operations. | Multi-chain | Active |
| [GOAT](https://github.com/goat-sdk/goat) | MIT toolkit giving AI agents wallets and onchain tools, with a Solana wallet package and Jupiter and Orca plugins. Now a read-only archive. | Multi-chain | Archived |
| [rig-onchain-kit](https://github.com/0xPlaygrounds/rig-onchain-kit) | Rust companion crate for the rig framework for building AI agents that perform blockchain operations on Solana and EVM networks. | Multi-chain | Active |
| [solagent.rs](https://github.com/zTgx/solagent.rs) | Rust library for building AI agents that operate on the Solana blockchain. | Solana | Active |
| [Solana Agent (Python)](https://github.com/truemagic-coder/solana-agent) | Python SDK for the hosted Solana Agent platform. | Solana | Active |
| [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) | Apache-2.0 toolkit from SendAI for connecting AI agents to Solana protocols. | Solana | Active |
| [three.ws](https://three.ws) | Platform for creating, embedding and monetizing 3D AI agents, with native Solana agent identities and USDC payments. | Multi-chain | Active |
| [ZerePy](https://github.com/blorm-network/ZerePy) | Python framework for running AI agents on X, with Solana SOL and SPL transfers, Jupiter swaps and staking. | Multi-chain | Active |

### MCP Servers

Model Context Protocol servers that give agents Solana docs, data and wallet tools.

| Project | Description | Chain | Status |
| --- | --- | --- | --- |
| [Helius MCP and Skills](https://github.com/helius-labs/core-ai) | Official Helius AI tooling repository with an MCP server, Claude Code skills, a CLI and plugin packages for Solana. | Solana | Active |
| [Phantom MCP Server](https://docs.phantom.com/phantom-mcp-server) | Phantom MCP server (@phantom/mcp-server) that lets AI assistants operate their own wallet to sign transactions on Solana and EVM networks. | Multi-chain | Early |
| [Solana Debug MCP](https://github.com/biccsdev/solana_debug_mcp) | MCP server for inspecting Solana transactions, accounts, Anchor IDLs, errors and Program Derived Addresses. | Solana | Early |
| [Solana Developer MCP](https://mcp.solana.com) | Remote MCP server for coding agents with Solana docs lookup, semantic search and a Rust checker for Anchor and Pinocchio programs. | Solana | Active |
| [Solana MCP (SendAI)](https://github.com/sendaifun/solana-mcp) | Model Context Protocol server that gives Claude onchain Solana tools, built on the Solana Agent Kit. | Solana | Active |

### Skills

Agent Skills and skill collections that teach coding agents Solana protocols and workflows.

| Project | Description | Chain | Status |
| --- | --- | --- | --- |
| [Jupiter Agent Skills](https://github.com/jup-ag/agent-skills) | Agent Skills and plugins that help AI coding assistants integrate with Jupiter APIs and protocols. | Solana | Active |
| [Metaplex Skill](https://github.com/metaplex-foundation/skill) | Apache-2.0 Agent Skill with reference material on Metaplex programs, CLI commands and SDK patterns. | Solana | Active |
| [PayAI x402 Skill](https://github.com/PayAINetwork/payai-x402-skill) | AI coding skill for the PayAI x402 facilitator on Solana, covering middleware, client libraries and protocol reference. | Solana | Active |
| [SendAI Skills](https://github.com/sendaifun/skills) | Apache-2.0 collection of AI agent skills for Solana development covering DeFi, infrastructure, security and DevOps. | Solana | Active |
| [Solana Agent Skills Directory](https://solana.com/skills) | Solana Foundation page listing foundation-maintained agent skills and a separate list of community-contributed skills. | Solana | Active |
| [Solana Dev Skill](https://github.com/solana-foundation/solana-dev-skill) | Solana Foundation Agent Skill for agentic development on Solana. | Solana | Active |
| [solana.new](https://github.com/sendaifun/solana-new) | Open-source platform behind solanaskills.com with agent skills, catalogs and Solana knowledge for builders. | Solana | Active |

### Agent Wallets and Signing

Wallets, signers and smart account infrastructure agents can use with policy controls.

| Project | Description | Chain | Status |
| --- | --- | --- | --- |
| [Coinbase CDP Server Wallets](https://docs.cdp.coinbase.com/server-wallets/v2/introduction/welcome) | Server-controlled wallets from Coinbase Developer Platform, created programmatically, with Solana on mainnet and devnet. | Multi-chain | Active |
| [Crossmint Agent Wallets](https://docs.crossmint.com/wallets/quickstarts/agent-wallets) | Crossmint wallets for AI agents, created from a backend with the Node.js SDK and supported across multiple chains. | Multi-chain | Active |
| [Kora](https://github.com/solana-foundation/kora) | Solana signing infrastructure from the Solana Foundation that enables gasless transactions and other trusted-signer flows. | Solana | Active |
| [Privy](https://docs.privy.io/wallets/overview) | Wallet infrastructure including Solana, with wallets inside apps for users or managed by your servers through an API. | Multi-chain | Active |
| [solana-keychain](https://github.com/sendaifun/solana-keychain) | Solana transaction signing across backends including Vault, Privy, Turnkey, AWS KMS, Fireblocks and Crossmint, in Rust and TypeScript. | Solana | Active |
| [Squads Protocol v4](https://github.com/Squads-Protocol/v4) | Squads Protocol v4 Solana multisig program with TypeScript and Rust SDKs. | Solana | Active |
| [Turnkey](https://docs.turnkey.com/networks/solana) | Secure-enclave signing with a Solana transaction parser so policies can be enforced before a transaction is signed. | Multi-chain | Active |

### Payments

x402, MPP and related rails for agents that pay for and get paid for services.

| Project | Description | Chain | Status |
| --- | --- | --- | --- |
| [Faremeter](https://github.com/faremeter/faremeter) | Payment toolkit whose Solana package ships flex, exact and MPP charge payment schemes. | Multi-chain | Active |
| [Metaplex x402 Client](https://github.com/metaplex-foundation/x402) | Apache-2.0 TypeScript x402 client from Metaplex. | Solana | Active |
| [PayAI x402-solana](https://github.com/PayAINetwork/x402-solana) | PayAI TypeScript library for x402 payments on Solana, from the team behind the PayAI facilitator. | Solana | Active |
| [Solana Foundation pay](https://github.com/solana-foundation/pay) | Solana Foundation CLI that handles HTTP 402 challenges for x402 and MPP, with a local wallet approving stablecoin payments. | Solana | Active |
| [solana-mpp](https://github.com/sendaifun/solana-mpp) | TypeScript library adding Solana SPL token payments to the Machine Payments Protocol for 402 flows. | Solana | Active |
| [x402](https://github.com/coinbase/x402) | Open standard for internet native payments over HTTP 402, with an @x402/svm package for Solana. | Multi-chain | Active |
| [x402 on Solana](https://solana.com/x402/what-is-x402) | Solana.com overview of x402, the HTTP 402 payment protocol, with Solana as the settlement layer. | Solana | Active |

### Identity and Registries

Onchain identity, reputation and discovery for agents.

| Project | Description | Chain | Status |
| --- | --- | --- | --- |
| [8004-solana](https://github.com/QuantuLabs/8004-solana) | Solana port of the ERC-8004 agent registry standard for onchain agent identity and reputation. | Solana | Active |
| [8004.org](https://8004.org) | Home of the 8004 standard for autonomous agents that operate without needing to be trusted over open networks. | Multi-chain | Active |
| [Metaplex mpl-agent](https://github.com/metaplex-foundation/mpl-agent) | Solana program that registers verifiable agent identities on MPL Core NFTs using a PDA and an AppData plugin. | Solana | Active |
| [Solana Agent Registry](https://solana.com/agent-registry) | Open onchain system giving AI agents verifiable identities and portable reputation, compatible with ERC-8004. | Solana | Active |

### Data, RPC and Transaction Tooling

RPC, streaming, market data and transaction landing tools agents depend on.

| Project | Description | Chain | Status |
| --- | --- | --- | --- |
| [Alchemy Solana](https://www.alchemy.com/docs/solana) | Alchemy Solana endpoints compatible with the @solana/web3.js Connection class. | Multi-chain | Active |
| [Birdeye Data API](https://data.birdeye.so/docs/getting-started) | Token, pool and market data API with Solana coverage. | Multi-chain | Active |
| [DEX Screener API](https://docs.dexscreener.com/api/reference) | API for token profiles, trading pairs, search and trending data across DEXes. | Multi-chain | Active |
| [Helius](https://www.helius.dev/docs) | Solana RPC, LaserStream gRPC, DAS APIs and webhooks, plus Helius for Agents with an MCP server, CLI, skills and SDKs. | Solana | Active |
| [Jito TypeScript SDK](https://github.com/jito-labs/jito-ts) | TypeScript SDK from Jito Labs for the Jito block engine and relayer APIs. | Solana | Active |
| [Jupiter CLI](https://github.com/jup-ag/cli) | Command-line tool for Jupiter Solana products including swaps, perps, lending, prediction markets and token verification. | Solana | Active |
| [Jupiter Developer Platform](https://developers.jup.ag/) | Developer platform and documentation for Jupiter APIs on Solana. | Solana | Active |
| [Orca tx-sender](https://github.com/orca-so/tx-sender) | TypeScript and Rust libraries for building and sending Solana transactions with priority fees, Jito tips and retries. | Solana | Active |
| [QuickNode Solana](https://www.quicknode.com/docs/solana) | Solana RPC endpoints for mainnet-beta, devnet and testnet. | Multi-chain | Active |
| [Triton One](https://docs.triton.one) | Blockchain RPC provider with Solana guides and gRPC data streaming. | Multi-chain | Active |
| [Yellowstone gRPC](https://github.com/rpcpool/yellowstone-grpc) | Triton One Geyser gRPC plugin and clients that stream Solana slots, blocks, transactions and account updates. | Solana | Active |

### Launch and Protocol Infrastructure

Launch tooling, DEX SDKs and compute networks agents build on.

| Project | Description | Chain | Status |
| --- | --- | --- | --- |
| [Bags Developer API](https://docs.bags.fm) | API-key developer API for integrating Bags into applications, including launching Solana tokens. | Solana | Active |
| [Meteora Dynamic Bonding Curve SDK](https://github.com/MeteoraAg/dynamic-bonding-curve-sdk) | TypeScript SDK for customizable bonding curves on Meteora. | Solana | Active |
| [Meteora Invent](https://github.com/MeteoraAg/meteora-invent) | Meteora toolkit for launching on Meteora and running onchain actions through configurable commands. | Solana | Active |
| [Nosana Kit](https://github.com/nosana-ci/nosana-kit) | Monorepo of TypeScript packages for building on the Nosana GPU network on Solana, centered on @nosana/kit. | Solana | Active |
| [Orca Whirlpools](https://github.com/orca-so/whirlpools) | Open-source concentrated liquidity AMM on Solana with a Rust contract and SDKs. | Solana | Active |
| [pump.fun Public Docs](https://github.com/pump-fun/pump-public-docs) | Public documentation, IDLs and TypeScript types for pump.fun onchain programs including bonding curve and PumpSwap. | Solana | Active |
| [Raydium SDK V2](https://github.com/Raydium-io/raydium-sdk-V2) | TypeScript toolkit for building applications on Raydium. | Solana | Active |

### Developer Tooling

SDKs and local environments for building and testing Solana agent code.

| Project | Description | Chain | Status |
| --- | --- | --- | --- |
| [gill](https://github.com/solana-foundation/gill) | JavaScript and TypeScript SDK for building Solana apps, built on Anza @solana/kit. | Solana | Active |
| [Solana Kit](https://github.com/anza-xyz/kit) | Solana JavaScript SDK for Node, web and React Native, published as @solana/kit. | Solana | Active |
| [Surfpool](https://github.com/txtx/surfpool) | Local Solana development tool that replaces solana-test-validator using real mainnet state. | Solana | Active |

### Resources

Curated lists and learning material for Solana AI builders.

| Project | Description | Chain | Status |
| --- | --- | --- | --- |
| [awesome-solana-ai](https://github.com/solana-foundation/awesome-solana-ai) | Community directory of AI tools, coding skills, agents and learning resources for building on Solana. | Solana | Active |
| [awesome-solana-ai-hackathon](https://github.com/tkorkmazeth/awesome-solana-ai-hackathon) | Hackathon-oriented resource list for building autonomous AI agents on Solana. | Solana | Early |

<!-- ENTRIES:END -->

## Use the data

```js
import entries from './data/entries.json' with { type: 'json' };
const mcp = entries.filter((e) => e.category === 'mcp-servers' && e.chain === 'solana');
```

The shape is described by [`data/schema.json`](data/schema.json). Run `npm run validate` to check changes and `npm run build` to regenerate the tables above.

## License

[CC0 1.0 Universal](LICENSE). Use the list however you like.
