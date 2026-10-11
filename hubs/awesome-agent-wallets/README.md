# Awesome Agent Wallets

A curated, community-fed directory of wallets and key management for AI agents: MPC and TEE wallets, smart accounts and session keys, spend-limit and policy engines, embedded wallet SDKs, Solana agent wallets, wallet MCP servers, and the custody and signing infrastructure underneath them.

Agents that act onchain need keys they can use but cannot misuse. The projects here are the building blocks for that: scoped permissions, threshold signing, hardware-isolated keys, human approval paths and payment rails. Every entry is a real, linkable project, and the whole list lives in one machine-readable file so tools, agents and humans can all use it.

**Solana comes first.** Solana is the home chain of this list, so the Solana category leads and Solana-native projects are easy to find. EVM and multi-chain projects follow, and every entry is tagged with its chain.

## Add your project

Open a pull request that adds one object to [`data/entries.json`](data/entries.json). It takes two minutes:

1. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the entry format and quality bar.
2. Add your entry in alphabetical order inside its category.
3. Run `npm run check` to validate and regenerate this README.
4. Open the PR. The template walks you through the rest.

Prefer not to edit JSON? [Open an "Add a project" issue](.github/ISSUE_TEMPLATE/add-project.md) and a maintainer will do it for you.

## Machine-readable data

| File | Purpose |
| --- | --- |
| [`data/entries.json`](data/entries.json) | Every project: id, name, url, repo, category, chain, description, status, date added |
| [`data/categories.json`](data/categories.json) | Ordered category list with titles and blurbs |
| [`data/schema.json`](data/schema.json) | JSON Schema for entries |

The tables below are generated from these files. Do not edit them by hand.

## Categories

1. [Solana](#solana)
2. [Embedded Wallets and Wallet Infrastructure](#embedded-wallets-and-wallet-infrastructure)
3. [MPC, TEE and Custody](#mpc-tee-and-custody)
4. [Smart Accounts and Session Keys](#smart-accounts-and-session-keys)
5. [Spend Limits and Policy Engines](#spend-limits-and-policy-engines)
6. [Wallet MCP Servers, Skills and Payments](#wallet-mcp-servers-skills-and-payments)
7. [Agent Toolkits](#agent-toolkits)
8. [Standards and Libraries](#standards-and-libraries)

## Projects

<!-- ENTRIES:START -->
_63 projects across 8 categories._

### Solana

Agent wallets, signing backends, smart accounts, multisigs and MCP servers built for Solana, the first home of this list.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [Botwallet MCP](https://github.com/botwallet-co/mcp) | Solana | Early | Local MCP server that gives an agent a USDC wallet on Solana using FROST 2-of-2 signing and owner-set spending limits. |
| [LazorKit](https://github.com/lazor-kit/lazor-kit) | Solana | Early | Passkey-native smart wallets on Solana with a paymaster and on-chain RBAC and spending limits (pre-audit). |
| [Phantom MCP Server](https://docs.phantom.com/phantom-mcp-server) | Multi-chain | Early | Preview MCP server (@phantom/mcp-server) that lets AI assistants act through a Phantom embedded wallet. |
| [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) | Solana | Active | Open-source toolkit from SendAI that connects AI agents to Solana protocols. |
| [Solana Keychain](https://github.com/solana-foundation/solana-keychain) | Solana | Active | Framework-agnostic Solana transaction signing with multiple backends behind a unified trait interface. |
| [Solana MCP (SendAI)](https://github.com/sendaifun/solana-mcp) | Solana | Active | Model Context Protocol server for interacting with the Solana blockchain, powered by the Solana Agent Kit. |
| [Solana Wallet Adapter](https://github.com/anza-xyz/wallet-adapter) | Solana | Active | Modular TypeScript wallet adapters and components for Solana applications. |
| [Solana Wallet Standard](https://github.com/anza-xyz/wallet-standard) | Solana | Active | Solana extensions to the Wallet Standard for wallet and app interoperability. |
| [Squads Smart Account Program](https://github.com/Squads-Protocol/smart-account-program) | Solana | Early | Solana smart account program with rent-free wallet creation, archivable accounts and onchain policies. |
| [Squads v4](https://github.com/Squads-Protocol/v4) | Solana | Active | Squads v4 multisig program for Solana. |

### Embedded Wallets and Wallet Infrastructure

Wallet-as-a-service and embedded wallet SDKs that give apps and agents programmatic wallets with login, policies and multi-chain support.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [Circle Wallets](https://developers.circle.com/wallets) | Multi-chain | Active | APIs and SDKs for embedded wallets that manage keys, sign transactions and support multiple blockchains. |
| [Crossmint](https://www.crossmint.com/solutions/ai-agents) ([repo](https://github.com/Crossmint/crossmint-sdk)) | Multi-chain | Active | Payments infrastructure for AI agents with wallets, cards and payouts, plus an SDK for client and server integrations. |
| [Dynamic](https://www.dynamic.xyz) | Multi-chain | Active | Wallet infrastructure for fintech, crypto and stablecoin products. |
| [Magic](https://github.com/magiclabs/magic-js) | Multi-chain | Active | Browser and React Native JavaScript SDK for passwordless authentication inside applications. |
| [Openfort](https://www.openfort.io) ([repo](https://github.com/openfort-xyz/openfort-js)) | Multi-chain | Active | Open-source wallet infrastructure for stablecoin products with spending policies and agent wallets. |
| [Para](https://www.getpara.com) | Multi-chain | Active | Non-custodial embedded wallet SDK using MPC with email, phone and social login across EVM, Solana and Cosmos. |
| [Phantom Connect SDK](https://github.com/phantom/phantom-connect-sdk) | Multi-chain | Active | Multi-platform SDKs for integrating Phantom into applications. |
| [Privy](https://docs.privy.io/wallets/overview) | Multi-chain | Active | Wallet infrastructure for transacting on Ethereum, Solana, Base and hundreds of other blockchains. |
| [Reown AppKit](https://github.com/reown-com/appkit) | Multi-chain | Active | Full stack toolkit for building onchain application UX. |
| [thirdweb](https://github.com/thirdweb-dev/js) | Multi-chain | Active | Web3 SDKs for browser, Node and mobile apps. |
| [Turnkey](https://www.turnkey.com) ([repo](https://github.com/tkhq/sdk)) | Multi-chain | Active | Wallet infrastructure for secure, flexible and scalable key management, with a TypeScript SDK. |
| [Web3Auth](https://github.com/web3auth/web3auth-web) | Multi-chain | Active | Infrastructure that lets wallets and apps offer seamless user logins for mainstream and Web3 users. |

### MPC, TEE and Custody

Threshold signing libraries, trusted execution environments and custody SDKs that keep agent keys out of any single machine.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [BNB Chain tss-lib](https://github.com/bnb-chain/tss-lib) | Multi-chain | Active | Threshold Signature Scheme library for ECDSA and EdDSA. |
| [Coinbase CDP SDK](https://github.com/coinbase/cdp-sdk) | Multi-chain | Active | Client libraries for managing EVM and Solana wallets while relying on CDP to secure private keys. |
| [dstack](https://github.com/Dstack-TEE/dstack) | Chain-agnostic | Active | Open framework for confidential AI. |
| [Fireblocks TypeScript SDK](https://github.com/fireblocks/ts-sdk) | Multi-chain | Active | TypeScript SDK for the Fireblocks API. |
| [QuorumOS](https://github.com/tkhq/qos) | Chain-agnostic | Active | Computation layer from Turnkey for running applications inside Trusted Execution Environments. |
| [Silence Laboratories DKLs23](https://github.com/silence-laboratories/dkls23) | Chain-agnostic | Active | Threshold ECDSA signatures implementing the DKLs23 protocol. |
| [ZenGo multi-party-ecdsa](https://github.com/ZenGo-X/multi-party-ecdsa) | Chain-agnostic | Active | Rust implementation of {t,n}-threshold ECDSA. |

### Smart Accounts and Session Keys

ERC-4337 and ERC-7579 accounts, modules and delegation frameworks for scoped, revocable agent permissions on EVM chains.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [Alchemy aa-sdk](https://github.com/alchemyplatform/aa-sdk) | EVM | Active | Alchemy account abstraction SDK for building smart account experiences. |
| [Alchemy Modular Account](https://github.com/alchemyplatform/modular-account) | EVM | Active | Alchemy modular smart account contracts. |
| [Base Account SDK](https://github.com/base/account-sdk) | EVM | Active | SDK for Base Account from the Base team. |
| [Coinbase Smart Wallet](https://github.com/coinbase/smart-wallet) | EVM | Active | Smart wallet contracts from Coinbase. |
| [ERC-4337 Account Abstraction Reference](https://github.com/eth-infinitism/account-abstraction) | EVM | Active | Reference implementation of ERC-4337 account abstraction from eth-infinitism. |
| [ERC-7579 Reference Implementation](https://github.com/erc7579/erc7579-implementation) | EVM | Active | Reference implementation for ERC-7579 modular smart accounts. |
| [MetaMask Delegation Framework](https://github.com/MetaMask/delegation-framework) | EVM | Active | Contracts that power the Delegation Framework for scoped permissions on smart accounts. |
| [MetaMask Smart Accounts Kit](https://github.com/MetaMask/smart-accounts-kit) | EVM | Active | Viem-based toolkit for integrating embedded smart contract wallets into dapps. |
| [Nexus by Biconomy](https://github.com/bcnmy/nexus) | EVM | Active | ERC-7579 modular smart account for enhanced account abstraction. |
| [permissionless.js](https://github.com/pimlicolabs/permissionless.js) | EVM | Active | TypeScript utilities built on viem for ERC-4337 account abstraction. |
| [Rhinestone ModuleKit](https://github.com/rhinestonewtf/modulekit) | EVM | Active | Development kit for building smart account modules. |
| [Safe Core SDK](https://github.com/safe-global/safe-core-sdk) | EVM | Active | Lets builders add account abstraction functionality to their apps. |
| [Safe Modules](https://github.com/safe-global/safe-modules) | EVM | Active | Collection of modules that can be used with the Safe contract. |
| [Safe Smart Account](https://github.com/safe-global/safe-smart-account) | EVM | Active | Safe smart account contracts for secure management of blockchain assets. |
| [Safe7579](https://github.com/rhinestonewtf/safe7579) | EVM | Active | ERC-7579 adapter for Safe accounts, built by Rhinestone and Safe. |
| [SmartSession](https://github.com/erc7579/smartsessions) | EVM | Active | ERC-7579 module for granular session keys with configurable policies, built by Rhinestone and Biconomy. |
| [ZeroDev Kernel](https://github.com/zerodevapp/kernel) | EVM | Active | Kernel smart account contracts from ZeroDev. |
| [ZeroDev SDK](https://github.com/zerodevapp/sdk) | EVM | Active | ZeroDev SDK for smart account development. |

### Spend Limits and Policy Engines

Wallets and toolkits where spend caps, allowlists, approvals and role-based rules decide what an agent can sign.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [TEENet Wallet](https://github.com/TEENet-io/teenet-wallet) | Multi-chain | Early | Alpha wallet for agents with a policy engine and TEE threshold signing; transfer limits, allowlists and daily caps. |
| [WAIaaS](https://github.com/minhoyoo-iotrust/WAIaaS) | Multi-chain | Active | Self-hosted wallet daemon for AI agents with a tiered policy engine and owner approval for large transactions. |
| [Zodiac Roles Modifier](https://github.com/gnosisguild/zodiac-modifier-roles) | EVM | Active | Smart account toolkit for role-based access control. |

### Wallet MCP Servers, Skills and Payments

MCP servers, agent skills and payment protocols that let model clients hold wallets, sign and pay.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [Coinbase Agentic Wallet Skills](https://github.com/coinbase/agentic-wallet-skills) | Multi-chain | Active | Agent skills for authenticating, sending USDC and trading tokens on Base, Polygon and Solana using the awal CLI. |
| [Coinbase Payments MCP](https://github.com/coinbase/payments-mcp) | Multi-chain | Active | MCP server and companion wallet app combining wallets, onramps and x402 payments for agentic commerce. |
| [OKX OnchainOS Skills](https://github.com/okx/onchainos-skills) | Multi-chain | Active | Skills for AI agents to use the OKX OnchainOS API for wallet, token discovery, market data and DEX swaps. |
| [Privy MCP Server](https://github.com/privy-io/privy-mcp-server) | Multi-chain | Active | MCP server that lets Claude and other assistants create wallets, sign transactions and manage onchain operations with Privy. |
| [x402](https://github.com/coinbase/x402) | Multi-chain | Active | Payments protocol for the internet built on HTTP, used by agents to pay for APIs. |

### Agent Toolkits

Toolkits that bundle wallets with onchain actions for agent frameworks.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [Circle Skills](https://github.com/circlefin/skills) | Multi-chain | Active | Circle open-source skills for AI-assisted development. |
| [Coinbase AgentKit](https://github.com/coinbase/agentkit) | Multi-chain | Active | Toolkit that gives every AI agent a wallet. |
| [GOAT SDK](https://github.com/goat-sdk/goat) | Multi-chain | Archived | Archived read-only historical snapshot of the GOAT SDK repository. |

### Standards and Libraries

Wallet standards, ERCs and core libraries the rest of the ecosystem builds on.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [Ethereum ERCs](https://github.com/ethereum/ERCs) | EVM | Active | Ethereum Request for Comment repository, home of account abstraction and wallet standards. |
| [Trust Wallet Core](https://github.com/trustwallet/wallet-core) | Multi-chain | Active | Cross-platform, cross-blockchain wallet library. |
| [viem](https://github.com/wevm/viem) | EVM | Active | TypeScript interface for Ethereum. |
| [wagmi](https://github.com/wevm/wagmi) | EVM | Active | Reactive primitives for Ethereum apps. |
| [Wallet Standard](https://github.com/wallet-standard/wallet-standard) | Multi-chain | Active | Chain-agnostic standard for wallet and application interoperability. |
<!-- ENTRIES:END -->

## Status labels

- **Active**: maintained and usable today.
- **Early**: new, in preview, alpha or pre-audit. Read the project's own warnings before trusting it with funds.
- **Archived**: kept for reference; the project is read-only or no longer developed.

## Safety note

Listing is not an endorsement or an audit. Agent wallets hold real value, so review the code, the custody model and the project's own security guidance before connecting one to funds.

## License

[![CC0](https://licensebuttons.net/p/zero/1.0/88x31.png)](https://creativecommons.org/publicdomain/zero/1.0/)

To the extent possible under law, the contributors have waived all copyright and related rights to this work. See [LICENSE](LICENSE).
