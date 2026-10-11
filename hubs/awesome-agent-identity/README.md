# Awesome Agent Identity

A curated, community-fed directory of on-chain **agent identity, registries and reputation**: ERC-8004 Trustless Agents, Solana agent registries, agent name services, attestations such as EAS and the Solana Attestation Service, and DIDs and verifiable credentials for AI agents.

## Why this matters

AI agents are starting to hold wallets, call paid APIs and hire each other. Before one agent trusts another it needs answers to three questions: who is this agent, what has it done before, and who stands behind it? A growing set of open standards and programs now answers them on public chains:

- **Identity:** a portable, resolvable record for an agent, such as an ERC-8004 Identity Registry entry, a Metaplex agent identity bound to an MPL Core asset, or a DID.
- **Reputation and validation:** feedback signals and independent checks tied to that identity, so trust can be earned and verified instead of assumed.
- **Names and attestations:** human-readable handles (ENS, `.sol`) and signed claims (EAS, Solana Attestation Service) that link an agent to a developer, an organization or a person.

The space is young and moves quickly. This list collects the real, public projects and specifications in one place, with Solana listed first, so builders can compare approaches and find the pieces they need.

## Who it is for

- Agent developers who want their agents to be discoverable and trustworthy across platforms.
- Protocol and wallet teams choosing a registry, naming or attestation standard to integrate.
- Researchers and standards authors tracking how ERCs, W3C, DIF and IETF work fits together.

## How to add your project

Open a pull request that adds one object to [`data/entries.json`](data/entries.json). The exact format and the two commands to run are in [CONTRIBUTING.md](CONTRIBUTING.md). Prefer to suggest one without editing JSON? [Open an issue](../../issues/new?template=add-project.md).

Every entry is machine-readable (see [`data/schema.json`](data/schema.json)), so the same data can feed explorers, agents and other directories.

## Directory

<!-- ENTRIES:START -->

### Category index

- [Solana](#solana) (13)
- [Standards and Proposals](#standards-and-proposals) (9)
- [ERC-8004 Implementations and SDKs](#erc-8004-implementations-and-sdks) (7)
- [Explorers and Marketplaces](#explorers-and-marketplaces) (3)
- [Attestations](#attestations) (3)
- [Agent Names and Directories](#agent-names-and-directories) (3)
- [DIDs and Verifiable Credentials](#dids-and-verifiable-credentials) (3)
- [Proof of Human and Know Your Agent](#proof-of-human-and-know-your-agent) (3)
- [Agent Protocols and Networks](#agent-protocols-and-networks) (5)
- [Docs, Guides and Lists](#docs-guides-and-lists) (5)

### Solana

Agent identity, registries, naming and attestations on Solana, the home chain of this hub. Includes ERC-8004 ports and native designs.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [8004-Solana](https://github.com/QuantuLabs/8004-solana) | solana | Active | Port of the ERC-8004 agent registry standard to Solana with identity and reputation modules. |
| [8004-Solana API](https://github.com/QuantuLabs/8004-solana-api) | solana | Early | Query API for the 8004 agent registry on Solana covering agents, reputation scores and validations. |
| [8004-Solana Registry Site](https://8004.qnt.sh) | solana | Active | Browse ERC-8004 agent registrations, feedback and metadata on Solana, with links to the SDK and MCP server. |
| [8004-Solana TypeScript SDK](https://github.com/QuantuLabs/8004-solana-ts) | solana | Active | TypeScript SDK for agent portability, discovery and trust on Solana, based on ERC-8004 and agent0-ts. |
| [Metaplex Agent Registry](https://www.metaplex.com/docs/smart-contracts/mpl-agent) ([repo](https://github.com/metaplex-foundation/mpl-agent)) | solana | Active | Solana programs that bind an identity record to an MPL Core asset and manage executive delegation for agents. |
| [s8004](https://github.com/Woody4618/s8004) | solana | Early | Proof of concept for an ERC-8004 style agent registry and reputation system on Solana. |
| [SAID Protocol](https://www.saidprotocol.com) | solana | Active | Onchain identity infrastructure for autonomous AI agents on Solana: register, verify and build reputation. |
| [SATI](https://github.com/cascade-protocol/sati) | solana | Active | Solana Agent Trust Infrastructure: identity, reputation and validation designed for continuous feedback at scale. |
| [SATI Dashboard](https://sati.cascade.fyi) ([repo](https://github.com/cascade-protocol/sati)) | solana | Active | Dashboard to register and manage AI agents on Solana, powered by SATI. |
| [SATI sRFC](https://github.com/solana-foundation/SRFCs/discussions/7) | solana | Early | Draft Solana request for comments proposing Solana Agent Trust Infrastructure (SATI). |
| [Solana Agent Registry](https://solana.com/agent-registry) | solana | Active | Open onchain protocol for agent identity, portable reputation and validation on Solana, interoperable with ERC-8004. |
| [Solana Attestation Service](https://solana.com/docs/tools/attestations) ([repo](https://github.com/solana-foundation/solana-attestation-service)) | solana | Active | Solana Foundation public-good program for credentials, schemas and attestations linking offchain data to onchain accounts. |
| [Solana Name Service](https://www.sns.id) | solana | Active | Human-readable .sol names on Solana that map to wallet addresses and other onchain data. |

### Standards and Proposals

ERCs, ENSIPs, W3C Recommendations and IETF drafts that define how agents are identified, named and trusted.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [did:web Method Specification](https://w3c-ccg.github.io/did-method-web/) | none | Active | DID method that resolves identifiers through existing web domains and their HTTPS hosting. |
| [ENSIP-25: Verifiable AI Agent Identity](https://docs.ens.domains/ensip/25) | ethereum | Active | ENS standard that verifies an ENS name's association with an onchain agent registry entry through a text record. |
| [ENSIP-26: Agent Text Records](https://docs.ens.domains/ensip/26) | ethereum | Early | Standardized ENS text records for multichain agent identity, context and endpoint discovery. |
| [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004) ([repo](https://github.com/ethereum/ERCs)) | ethereum | Active | Draft ERC that lets agents from different organizations discover and interact through pluggable reputation and validation. |
| [ERC-8183: Agentic Commerce](https://eips.ethereum.org/EIPS/eip-8183) ([repo](https://github.com/ethereum/ERCs)) | ethereum | Early | Draft ERC for job escrow with evaluator attestation, designed for agent commerce alongside agent identity. |
| [ERC-8217: Agent NFT Identity Bindings](https://eips.ethereum.org/EIPS/eip-8217) ([repo](https://github.com/ethereum/ERCs)) | ethereum | Early | Per-chain singleton protocol that binds ERC-8004 agents to external NFT or token controllers. |
| [IETF AIMS: AI Identity Management System](https://datatracker.ietf.org/doc/html/draft-ietf-wimse-aims) | none | Early | WIMSE working group Internet-Draft on AI agent identity built from SPIFFE, WIMSE and OAuth 2.0. |
| [W3C Decentralized Identifiers (DIDs)](https://www.w3.org/TR/did-core/) | none | Active | W3C Recommendation defining DIDs and DID documents, the base identifier format for many agent identity systems. |
| [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/) | none | Active | W3C Recommendation for expressing cryptographically verifiable credentials and presentations. |

### ERC-8004 Implementations and SDKs

Reference contracts, SDKs and scaffolding tools for building on the Trustless Agents registries.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [8004.org](https://www.8004.org) | multi | Active | Community hub for builders creating self-sovereign AI agents on open protocols. |
| [Agent0 Python SDK](https://github.com/agent0lab/agent0-py) | multi | Active | Python SDK for open agent discovery and trust: register agents, publish endpoints and exchange feedback via ERC-8004. |
| [Agent0 TypeScript SDK](https://github.com/agent0lab/agent0-ts) | multi | Active | TypeScript SDK for agent portability, discovery and trust based on ERC-8004. |
| [Agentory CLI](https://github.com/AxLabs/agentory-cli) | multi | Active | npx CLI that scaffolds agents with ERC-8004 identity, A2A, MCP tool serving and optional USDC payments on EVM and Solana. |
| [ChaosChain Genesis Studio](https://github.com/ChaosChain/chaoschain-genesis-studio) | multi | Early | End-to-end ERC-8004 prototype covering agent identity, verifiable work and direct USDC payments. |
| [ERC-8004 Contracts](https://github.com/erc-8004/erc-8004-contracts) | multi | Active | Reference Identity, Reputation and Validation registry contracts for ERC-8004, deployed on many EVM networks. |
| [erc8004 Rust SDK](https://github.com/qntx/erc8004) | multi | Active | Rust SDK for ERC-8004, the onchain AI agent registry standard. |

### Explorers and Marketplaces

Index, search and discovery surfaces for registered agents, reputation and feedback.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [8004market](https://8004market.io) | multi | Active | Marketplace for 8004 assets to discover and deploy AI agents on multiple blockchains. |
| [8004scan](https://8004scan.io) | multi | Active | Explorer to discover agents, submit feedback and track leaderboards across ERC-8004 deployments. |
| [QuickNode ERC-8004 Explorer](https://erc-8004.quicknode.com) | multi | Active | Public explorer to search ERC-8004 agents by ID or address, with reputation scores, feedback and validations. |

### Attestations

Signed claims about agents, from general attestation services to proposals that gate agent actions.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [Attestix](https://github.com/VibeTensor/attestix) | none | Active | Attestation infrastructure for AI agents: DID identity, W3C credentials, delegation chains and reputation via 47 MCP tools. |
| [ERC-8273: Attestation-Gated Agentic Actions](https://eips.ethereum.org/EIPS/eip-8273) ([repo](https://github.com/ethereum/ERCs)) | ethereum | Early | Draft ERC for an onchain registry where attestors issue scoped attestations that gate agent-initiated actions. |
| [Ethereum Attestation Service](https://attest.org) ([repo](https://github.com/ethereum-attestation-service/eas-contracts)) | multi | Active | Open-source infrastructure for signing and verifying onchain and offchain attestations, aimed at developers and AI agents. |

### Agent Names and Directories

Naming, resolution and discovery systems that map agents to human-readable or verifiable handles.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [Agent Name Service v2 (IETF draft)](https://datatracker.ietf.org/doc/draft-narajala-courtney-ansv2/) | none | Early | Internet-Draft that ties agent identity to DNS names using dual certificates and an append-only transparency log. |
| [Fetch.ai Almanac](https://network.fetch.ai/docs/introduction/almanac/introduction) | fetch | Active | Onchain registry of agents on the Fetch network that gives registered agents a verifiable address for discovery. |
| [NANDA](https://projectnanda.org) | none | Early | MIT-led Internet of Agents effort whose index resolves agent handles to verifiable AgentFacts. |

### DIDs and Verifiable Credentials

Decentralized identifiers and verifiable credentials applied to AI agents, plus the working groups shaping them.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [cheqd AI Agent Trust Registry](https://docs.cheqd.io/product/getting-started/ai-agents/trust-registry) ([repo](https://github.com/cheqd/did-resolver)) | multi | Active | Guide to building trust registries where AI agents hold DIDs and verifiable credentials on the cheqd network. |
| [DIF Trusted AI Agents Working Group](https://identity.foundation/working-groups/trusted-agents) | none | Active | Decentralized Identity Foundation group building specifications for identity, delegation and governance of AI agents. |
| [KYA-OS](https://blog.identity.foundation/kya-os/) | none | Active | Know Your Agent Operating System, an open trust layer stewarded by DIF that uses W3C DIDs for agent identity. |

### Proof of Human and Know Your Agent

Systems that tie an agent to an accountable human or organization, or let services verify who is acting.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [Billions](https://billions.network) | multi | Active | Identity and trust layer for the agent economy that verifies humans and agents without exposing private data. |
| [Visa Trusted Agent Protocol](https://github.com/visa/trusted-agent-protocol) | none | Active | Open standard of trust between AI agents and merchants for the next phase of agentic commerce. |
| [World AgentKit](https://docs.world.org/agents) ([repo](https://github.com/worldcoin/agentkit)) | multi | Early | Beta toolkit extending x402 so websites can tell human-backed agents from bots and scripts. |

### Agent Protocols and Networks

Agent communication and discovery stacks with identity built in.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [Agent Network Protocol](https://github.com/agent-network-protocol/anp) | none | Active | Open protocol and SDK for secure agent-to-agent communication with a DID-based identity layer. |
| [Agent2Agent (A2A) Protocol](https://a2a-protocol.org) ([repo](https://github.com/a2aproject/A2A)) | none | Active | Open protocol for communication and interoperability between opaque agentic applications, with agent cards for discovery. |
| [AGNTCY Directory](https://github.com/agntcy/dir) | none | Active | Distributed announce and discovery of multi-agent systems, part of the AGNTCY Internet of Agents stack. |
| [AGNTCY Identity](https://github.com/agntcy/identity) | none | Active | Onboard, create and verify identities for agents, MCP servers and multi-agent systems. |
| [Olas](https://docs.olas.network) | multi | Active | Protocol for co-owned AI agents with ERC-721 registries for agent components, agents and services. |

### Docs, Guides and Lists

Documentation and curated lists for learning and building in this space.

| Project | Chain | Status | Description |
| --- | --- | --- | --- |
| [8004 on Solana Technical Documentation](https://quantulabs.github.io/8004-solana/) | solana | Active | Technical documentation for the 8004 agent registry port on Solana. |
| [Agent0 SDK Docs](https://sdk.ag0.xyz) | multi | Active | Documentation for the Agent0 SDK used to register and discover ERC-8004 agents. |
| [awesome-erc8004](https://github.com/sudeepb02/awesome-erc8004) | multi | Active | Curated list of resources for ERC-8004: Trustless Agents. |
| [Metaplex: Register an Agent on Solana](https://www.metaplex.com/docs/agents/register-agent) | solana | Active | Guide to registering an agent identity by binding an identity record to an MPL Core asset. |
| [Solana: What is the Agent Registry?](https://solana.com/agent-registry/what-is-agent-registry) | solana | Active | Overview of the Solana Agent Registry covering verifiable identity, portable reputation and trust infrastructure. |

_54 projects across 10 categories. This section is generated from `data/entries.json` by `npm run build`; edit the JSON, not the tables._

<!-- ENTRIES:END -->

## License

Released under [CC0 1.0 Universal](LICENSE). Use, copy and build on the list and its data without restriction.
