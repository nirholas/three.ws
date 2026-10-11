# Awesome Agent Protocols

A curated, community-fed directory of the standards and tools that let AI agents work together: **A2A, MCP, ANP, ACP, AG-UI**, agent discovery and registries, MCP gateways and proxies, orchestration frameworks, and the SDKs and test tools around them.

Agents are most useful when they can talk to tools, to people and to each other across vendors and frameworks. This list is a single, searchable place to find the protocol specs, the reference implementations and the infrastructure that make that interoperability real.

Every entry lives in [`data/entries.json`](data/entries.json), so the list is both human-readable and machine-readable. Pull requests are validated by a dependency-free script, and the tables below are generated from the JSON.

## Add your project

Open a pull request that adds one object to [`data/entries.json`](data/entries.json) and run `npm run check`. The full steps are in [CONTRIBUTING.md](CONTRIBUTING.md), or [open an add-project issue](../../issues/new?template=add-project.md) and a maintainer will add it for you.

## Categories

<!-- INDEX:START -->
- [Protocol Specifications](#protocol-specifications) (15)
- [Agent Payments and Commerce](#agent-payments-and-commerce) (4)
- [Discovery, Identity and Registries](#discovery-identity-and-registries) (10)
- [MCP Gateways and Proxies](#mcp-gateways-and-proxies) (11)
- [Orchestration Frameworks](#orchestration-frameworks) (8)
- [Protocol SDKs](#protocol-sdks) (13)
- [Developer Tools and Bridges](#developer-tools-and-bridges) (8)
- [Directories and Curated Lists](#directories-and-curated-lists) (7)
<!-- INDEX:END -->

## Entries

Status key: **Active** is maintained and in use, **Early** is new or still taking shape, **Archived** is no longer developed but kept for reference (often because it merged into another standard). The Chain column is filled only for projects that run onchain.

<!-- ENTRIES:START -->

### Protocol Specifications

The open standards agents use to talk to tools, to each other and to people: A2A, MCP, ANP, Agent Client Protocol, AG-UI and their neighbors.

| Project | Description | Repo | Chain | Status |
| --- | --- | --- | --- | --- |
| [A2A Protocol](https://a2a-protocol.org) | Open standard, originated by Google and hosted by the Linux Foundation, for agents on different frameworks to discover each other and collaborate. | [repo](https://github.com/a2aproject/A2A) |  | Active |
| [AG-UI](https://docs.ag-ui.com) | Agent-User Interaction Protocol for bringing agents into frontend applications. | [repo](https://github.com/ag-ui-protocol/ag-ui) |  | Active |
| [Agent Client Protocol](https://agentclientprotocol.com) | Protocol for connecting any code editor to any coding agent. | [repo](https://github.com/agentclientprotocol/agent-client-protocol) |  | Active |
| [Agent Communication Protocol (ACP)](https://agentcommunicationprotocol.dev) | Open protocol for communication between agents, applications and humans, now part of A2A under the Linux Foundation. | [repo](https://github.com/i-am-bee/acp) |  | Archived |
| [Agent Connect Protocol (AGNTCY)](https://github.com/agntcy/acp-spec) | Specification of the Agent Connect Protocol from the AGNTCY project. | [repo](https://github.com/agntcy/acp-spec) |  | Early |
| [Agent Network Protocol (ANP)](https://agent-network-protocol.com) | Open source protocol for secure, decentralized communication between AI agents. | [repo](https://github.com/agent-network-protocol/AgentNetworkProtocol) |  | Active |
| [Agent Protocol](https://github.com/agi-inc/agent-protocol) | Common, tech stack agnostic interface for interacting with AI agents, usable with any framework. | [repo](https://github.com/agi-inc/agent-protocol) |  | Active |
| [agents.json](https://github.com/wild-card-ai/agents-json) | Open specification describing contracts for API and agent interactions, built on top of the OpenAPI standard. | [repo](https://github.com/wild-card-ai/agents-json) |  | Early |
| [LangChain Agent Protocol](https://github.com/langchain-ai/agent-protocol) | Framework-agnostic API specification for serving LLM agents in production, with OpenAPI docs and a streaming spec. | [repo](https://github.com/langchain-ai/agent-protocol) |  | Active |
| [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) | Official spec and SDK of the MCP Apps protocol, a standard for UIs embedded in AI chatbots and served by MCP servers. | [repo](https://github.com/modelcontextprotocol/ext-apps) |  | Active |
| [Model Context Protocol](https://modelcontextprotocol.io) | Open standard introduced by Anthropic for connecting AI assistants to the systems where data lives, such as tools, repositories and business apps. | [repo](https://github.com/modelcontextprotocol/modelcontextprotocol) |  | Active |
| [NLWeb](https://github.com/nlweb-ai/NLWeb) | Main reference implementation for NLWeb, implemented in Python. | [repo](https://github.com/nlweb-ai/NLWeb) |  | Active |
| [Open Agent Spec](https://github.com/oracle/agent-spec) | Framework-agnostic declarative language for defining standalone agents and structured agentic workflows. | [repo](https://github.com/oracle/agent-spec) |  | Active |
| [SLIM](https://github.com/agntcy/slim) | Secure Low-Latency Interactive Messaging, a transport layer for agent protocols such as A2A and MCP. | [repo](https://github.com/agntcy/slim) |  | Active |
| [Universal Tool Calling Protocol (UTCP)](https://www.utcp.io) | Specification for the Universal Tool Calling Protocol, with Python, TypeScript and Go implementations. | [repo](https://github.com/universal-tool-calling-protocol/utcp-specification) |  | Active |

### Agent Payments and Commerce

Protocols that let agents pay, get paid and complete purchases on behalf of users.

| Project | Description | Repo | Chain | Status |
| --- | --- | --- | --- | --- |
| [A2A x402 Extension](https://github.com/google-agentic-commerce/a2a-x402) | Extension that brings cryptocurrency payments to the A2A protocol so agents can monetize their services on-chain. | [repo](https://github.com/google-agentic-commerce/a2a-x402) | multi | Active |
| [Agentic Commerce Protocol](https://agentic-commerce-protocol.com) | Open standard for programmatic commerce between buyers, AI agents and businesses, maintained by OpenAI and Stripe. | [repo](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol) |  | Active |
| [AP2 (Agent Payments Protocol)](https://ap2-protocol.org) | Open protocol for secure and interoperable AI-driven payments, from the Google agentic commerce organization. | [repo](https://github.com/google-agentic-commerce/AP2) |  | Active |
| [x402](https://www.x402.org) | Open payments protocol built on HTTP for internet-native, agent-ready payments. | [repo](https://github.com/coinbase/x402) | multi | Active |

### Discovery, Identity and Registries

Agent cards, schemas, directories, identity and trust layers that let one agent find and verify another.

| Project | Description | Repo | Chain | Status |
| --- | --- | --- | --- | --- |
| [AGNTCY](https://agntcy.org) | Open source stack for cross-vendor agent collaboration covering discovery, identity, messaging and observability. |  |  | Active |
| [AGNTCY Directory](https://github.com/agntcy/dir) | Publish, exchange and discover agent records over a distributed peer-to-peer network, built on OASF. | [repo](https://github.com/agntcy/dir) |  | Active |
| [AGNTCY Identity](https://github.com/agntcy/identity) | Onboard, create and verify identities for agents, MCP servers and multi-agent systems. | [repo](https://github.com/agntcy/identity) |  | Active |
| [Docker MCP Registry](https://github.com/docker/mcp-registry) | Official Docker registry of MCP servers. | [repo](https://github.com/docker/mcp-registry) |  | Active |
| [ERC-8004 Contracts](https://github.com/erc-8004/erc-8004-contracts) | Registry contracts curated by the 8004 team. | [repo](https://github.com/erc-8004/erc-8004-contracts) | evm | Early |
| [ERC-8004 Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004) | Ethereum standard to discover agents and establish trust through reputation and validation registries. | [repo](https://github.com/erc-8004/erc-8004-contracts) | evm | Early |
| [MCP Gateway Registry](https://github.com/agentic-community/mcp-gateway-registry) | Unified agent and MCP server registry that doubles as a gateway for AI development tools. | [repo](https://github.com/agentic-community/mcp-gateway-registry) |  | Active |
| [MCP Registry](https://registry.modelcontextprotocol.io) | Community driven registry service for Model Context Protocol servers. | [repo](https://github.com/modelcontextprotocol/registry) |  | Active |
| [Open Agentic Schema Framework (OASF)](https://github.com/agntcy/oasf) | Schema framework from AGNTCY for describing agents so they can be indexed and discovered. | [repo](https://github.com/agntcy/oasf) |  | Active |
| [Project NANDA](https://projectnanda.org) | Foundational layer for an Internet of Agents. |  |  | Early |

### MCP Gateways and Proxies

Gateways, aggregators and transport bridges that put many MCP servers behind one governed endpoint.

| Project | Description | Repo | Chain | Status |
| --- | --- | --- | --- | --- |
| [agentgateway](https://agentgateway.dev) | Open source gateway for AI traffic: LLM, MCP, A2A and HTTP in one data plane. | [repo](https://github.com/agentgateway/agentgateway) |  | Active |
| [Docker MCP Gateway](https://github.com/docker/mcp-gateway) | Docker CLI plugin and gateway for running and connecting MCP servers. | [repo](https://github.com/docker/mcp-gateway) |  | Active |
| [IBM MCP Context Forge](https://github.com/IBM/mcp-context-forge) | AI gateway, registry and proxy in front of MCP, A2A and REST or gRPC APIs with centralized discovery and guardrails. | [repo](https://github.com/IBM/mcp-context-forge) |  | Active |
| [Lasso MCP Gateway](https://github.com/lasso-security/mcp-gateway) | Plugin-based gateway that orchestrates other MCP servers for enterprise-grade agents. | [repo](https://github.com/lasso-security/mcp-gateway) |  | Active |
| [mcp-proxy (punkpeye)](https://github.com/punkpeye/mcp-proxy) | TypeScript streamable HTTP and SSE proxy for MCP servers that use stdio transport. | [repo](https://github.com/punkpeye/mcp-proxy) |  | Active |
| [mcp-proxy (sparfenyuk)](https://github.com/sparfenyuk/mcp-proxy) | Bridge between Streamable HTTP and stdio MCP transports. | [repo](https://github.com/sparfenyuk/mcp-proxy) |  | Active |
| [MCPJungle](https://github.com/mcpjungle/MCPJungle) | Single place to manage and connect to all your MCP servers behind one endpoint. | [repo](https://github.com/mcpjungle/MCPJungle) |  | Active |
| [MetaMCP](https://github.com/metatool-ai/metamcp) | MCP aggregator, orchestrator, middleware and gateway in one Docker deployment. | [repo](https://github.com/metatool-ai/metamcp) |  | Active |
| [Microsoft MCP Gateway](https://github.com/microsoft/mcp-gateway) | Reverse proxy and management layer for MCP servers with session-aware routing and lifecycle management on Kubernetes. | [repo](https://github.com/microsoft/mcp-gateway) |  | Active |
| [Supergateway](https://github.com/supercorp-ai/supergateway) | Run MCP stdio servers over streamable HTTP, SSE, or expose SSE over stdio. | [repo](https://github.com/supercorp-ai/supergateway) |  | Active |
| [Unla](https://github.com/AmoyLab/Unla) | Lightweight Go gateway that turns existing APIs and MCP servers into MCP endpoints through configuration alone. | [repo](https://github.com/AmoyLab/Unla) |  | Active |

### Orchestration Frameworks

Frameworks and platforms for composing multiple agents into working systems.

| Project | Description | Repo | Chain | Status |
| --- | --- | --- | --- | --- |
| [AG2](https://github.com/ag2ai/ag2) | Open source AgentOS, formerly known as AutoGen. | [repo](https://github.com/ag2ai/ag2) |  | Active |
| [Agent Development Kit (Python)](https://github.com/google/adk-python) | Open source, code-first Python toolkit for building, evaluating and deploying AI agents. | [repo](https://github.com/google/adk-python) |  | Active |
| [BeeAI Framework](https://github.com/i-am-bee/beeai-framework) | Build production-ready AI agents in both Python and TypeScript. | [repo](https://github.com/i-am-bee/beeai-framework) |  | Active |
| [CrewAI](https://github.com/crewAIInc/crewAI) | Framework for orchestrating role-playing, autonomous AI agents that work together on tasks. | [repo](https://github.com/crewAIInc/crewAI) |  | Active |
| [Eclipse LMOS](https://eclipse.dev/lmos) | Open source, cloud-native platform for building and running multi-agent systems. | [repo](https://github.com/eclipse-lmos) |  | Active |
| [mcp-agent](https://github.com/lastmile-ai/mcp-agent) | Build effective agents using Model Context Protocol and simple workflow patterns. | [repo](https://github.com/lastmile-ai/mcp-agent) |  | Active |
| [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) | Framework for building, orchestrating and deploying AI agents and multi-agent workflows in Python and .NET. | [repo](https://github.com/microsoft/agent-framework) |  | Active |
| [OpenAI Agents SDK for Python](https://github.com/openai/openai-agents-python) | Lightweight, powerful framework for multi-agent workflows. | [repo](https://github.com/openai/openai-agents-python) |  | Active |

### Protocol SDKs

Official and widely used client and server libraries for A2A and MCP in many languages.

| Project | Description | Repo | Chain | Status |
| --- | --- | --- | --- | --- |
| [A2A .NET SDK](https://github.com/a2aproject/a2a-dotnet) | C# and .NET SDK for the A2A Protocol. | [repo](https://github.com/a2aproject/a2a-dotnet) |  | Active |
| [A2A Go SDK](https://github.com/a2aproject/a2a-go) | Golang SDK for the A2A Protocol. | [repo](https://github.com/a2aproject/a2a-go) |  | Active |
| [A2A Java SDK](https://github.com/a2aproject/a2a-java) | Official Java SDK for the Agent2Agent (A2A) Protocol. | [repo](https://github.com/a2aproject/a2a-java) |  | Active |
| [A2A JavaScript SDK](https://github.com/a2aproject/a2a-js) | Official JavaScript SDK for the Agent2Agent (A2A) Protocol. | [repo](https://github.com/a2aproject/a2a-js) |  | Active |
| [A2A Python SDK](https://github.com/a2aproject/a2a-python) | Official Python SDK for the Agent2Agent (A2A) Protocol. | [repo](https://github.com/a2aproject/a2a-python) |  | Active |
| [A2A Rust SDK](https://github.com/a2aproject/a2a-rs) | Rust workspace for the A2A v1 protocol with async client and server libraries, protobuf definitions and gRPC bindings. | [repo](https://github.com/a2aproject/a2a-rs) |  | Active |
| [FastMCP](https://github.com/PrefectHQ/fastmcp) | Fast, Pythonic way to build MCP servers and clients. | [repo](https://github.com/PrefectHQ/fastmcp) |  | Active |
| [MCP C# SDK](https://github.com/modelcontextprotocol/csharp-sdk) | Official C# SDK for Model Context Protocol servers and clients, maintained in collaboration with Microsoft. | [repo](https://github.com/modelcontextprotocol/csharp-sdk) |  | Active |
| [MCP Go SDK](https://github.com/modelcontextprotocol/go-sdk) | Official Go SDK for Model Context Protocol servers and clients, maintained in collaboration with Google. | [repo](https://github.com/modelcontextprotocol/go-sdk) |  | Active |
| [MCP Java SDK](https://github.com/modelcontextprotocol/java-sdk) | Official Java SDK for Model Context Protocol servers and clients, maintained in collaboration with Spring AI. | [repo](https://github.com/modelcontextprotocol/java-sdk) |  | Active |
| [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk) | Official Python SDK for Model Context Protocol servers and clients. | [repo](https://github.com/modelcontextprotocol/python-sdk) |  | Active |
| [MCP Rust SDK](https://github.com/modelcontextprotocol/rust-sdk) | Official Rust SDK for the Model Context Protocol. | [repo](https://github.com/modelcontextprotocol/rust-sdk) |  | Active |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | Official TypeScript SDK for Model Context Protocol servers and clients. | [repo](https://github.com/modelcontextprotocol/typescript-sdk) |  | Active |

### Developer Tools and Bridges

Inspectors, conformance suites, samples and bridges for building and testing interoperable agents.

| Project | Description | Repo | Chain | Status |
| --- | --- | --- | --- | --- |
| [A2A Inspector](https://github.com/a2aproject/a2a-inspector) | Validation tools for A2A agents. | [repo](https://github.com/a2aproject/a2a-inspector) |  | Active |
| [A2A MCP Server](https://github.com/GongRzhe/A2A-MCP-Server) | MCP server that bridges MCP-compatible assistants with A2A agents. | [repo](https://github.com/GongRzhe/A2A-MCP-Server) |  | Active |
| [A2A Samples](https://github.com/a2aproject/a2a-samples) | Samples using the Agent2Agent (A2A) Protocol. | [repo](https://github.com/a2aproject/a2a-samples) |  | Active |
| [A2A TCK](https://github.com/a2aproject/a2a-tck) | Compatibility test suite that validates A2A implementations across gRPC, JSON-RPC and HTTP+JSON transports. | [repo](https://github.com/a2aproject/a2a-tck) |  | Active |
| [FastAPI-MCP](https://github.com/tadata-org/fastapi_mcp) | Expose FastAPI endpoints as Model Context Protocol tools, with auth. | [repo](https://github.com/tadata-org/fastapi_mcp) |  | Active |
| [MCP Inspector](https://github.com/modelcontextprotocol/inspector) | Visual testing tool for MCP servers. | [repo](https://github.com/modelcontextprotocol/inspector) |  | Active |
| [MCP Reference Servers](https://github.com/modelcontextprotocol/servers) | Reference collection of Model Context Protocol servers maintained alongside the specification. | [repo](https://github.com/modelcontextprotocol/servers) |  | Active |
| [MCP-UI](https://github.com/MCP-UI-Org/mcp-ui) | Model Context Protocol UI SDK with server SDKs for TypeScript, Python and Ruby plus a client package. | [repo](https://github.com/MCP-UI-Org/mcp-ui) |  | Active |

### Directories and Curated Lists

Places to browse and discover servers, agents and protocol resources.

| Project | Description | Repo | Chain | Status |
| --- | --- | --- | --- | --- |
| [Agent2Agent Info](https://agent2agent.info) | Community site about the A2A protocol, an open agent communication standard initiated by Google. |  |  | Active |
| [AgentProtocol.ai](https://agentprotocol.ai) | Independent, vendor-neutral guide to AI agent communication standards including MCP, A2A and Agent Protocol. |  |  | Active |
| [awesome-a2a](https://github.com/ai-boost/awesome-a2a) | Awesome A2A agents, tools, servers and clients in one place. | [repo](https://github.com/ai-boost/awesome-a2a) |  | Active |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Curated collection of MCP servers. | [repo](https://github.com/punkpeye/awesome-mcp-servers) |  | Active |
| [Glama MCP Servers](https://glama.ai/mcp/servers) | Registry of Model Context Protocol servers, clients, tools and integrations. |  |  | Active |
| [mcp.so](https://mcp.so) | Directory to discover MCP servers, clients, agent skills, CLI tools and integrations. |  |  | Active |
| [Smithery](https://smithery.ai) | Platform to connect agents to tools and services, with auth, credentials and sessions handled. |  |  | Active |

<!-- ENTRIES:END -->

## Use the data

`data/entries.json` is validated against [`data/schema.json`](data/schema.json) and categories are defined in [`data/categories.json`](data/categories.json). Fetch the raw file to power your own site, bot or dataset:

```
https://raw.githubusercontent.com/<owner>/awesome-agent-protocols/main/data/entries.json
```

## Maintaining

```
npm run validate   # check required fields, unique ids, URLs, ordering, description length
npm run build      # regenerate the tables in this README from the JSON
```

No dependencies are needed, only Node 18 or newer.

## License

[CC0 1.0 Universal](LICENSE). The directory data is dedicated to the public domain, so you can reuse it freely. Listed projects keep their own licenses and trademarks.
