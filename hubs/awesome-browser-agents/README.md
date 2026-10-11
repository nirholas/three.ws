# Awesome Browser Agents

A curated, community-fed directory of the projects, standards, and infrastructure that let AI agents use the web: WebMCP and in-page tool standards, browser-use and computer-use frameworks, agent-readable web conventions such as `llms.txt`, MCP servers for browsers, and headless browser infrastructure.

The web is becoming a place where agents work alongside people. This list exists so that builders can find the right building block quickly, and so that every good project in the space has one neutral, well-organized place to be discovered.

Every entry lives in [`data/entries.json`](data/entries.json), so the list is machine-readable as well as human-readable. The tables below are generated from that file.

## Add your project

Open a pull request that adds one object to [`data/entries.json`](data/entries.json). The short version:

1. Copy an existing entry and edit it. Keep entries sorted alphabetically by name within their category.
2. Run `npm run check` (Node 18+, no dependencies). It validates your entry and regenerates this README.
3. Open the PR using the template. See [CONTRIBUTING.md](CONTRIBUTING.md) for the inclusion bar and field reference.

Prefer not to edit JSON? [Open an "Add a project" issue](.github/ISSUE_TEMPLATE/add-project.md) and a maintainer will add it.

## Machine-readable data

- [`data/entries.json`](data/entries.json): all entries.
- [`data/categories.json`](data/categories.json): ordered categories.
- [`data/schema.json`](data/schema.json): JSON Schema for entries.

## Projects

<!-- ENTRIES:START -->

**71 projects** across 9 categories.

- [Standards and Proposals](#standards-and-proposals) (11)
- [WebMCP and In-Page Agent Tools](#webmcp-and-in-page-agent-tools) (6)
- [Browser-Use Frameworks](#browser-use-frameworks) (12)
- [Browser MCP Servers](#browser-mcp-servers) (8)
- [Computer-Use Agents](#computer-use-agents) (13)
- [Automation Foundations](#automation-foundations) (5)
- [Headless Browser Infrastructure](#headless-browser-infrastructure) (6)
- [Web Data for Agents](#web-data-for-agents) (4)
- [Benchmarks and Research](#benchmarks-and-research) (6)

### Standards and Proposals

Specifications, protocols, and conventions that let agents discover, read, and act on the web.

| Project | Description | Repo | Status |
| --- | --- | --- | --- |
| [A2A Protocol](https://a2a-protocol.org/) | Agent2Agent, an open protocol for communication and interoperability between opaque agentic applications. | [repo](https://github.com/a2aproject/A2A) | active |
| [Agent Skills](https://agentskills.io/) | An open format for packaging reusable skills that agents can discover and load on demand. | - | active |
| [AGENTS.md](https://agents.md/) | A simple, open format of project instructions that gives coding agents context about a repository. | - | active |
| [ai.robots.txt](https://github.com/ai-robots-txt/ai.robots.txt) | A maintained list of AI agents and crawlers, with ready-made robots.txt rules for sites that want to manage them. | [repo](https://github.com/ai-robots-txt/ai.robots.txt) | active |
| [llms.txt](https://llmstxt.org/) | A proposal from Jeremy Howard to publish a Markdown file at a site root that gives LLMs a curated guide to its content. | [repo](https://github.com/AnswerDotAI/llms-txt) | active |
| [Model Context Protocol](https://modelcontextprotocol.io/) | The open protocol for connecting AI applications to tools, data sources, and workflows. | [repo](https://github.com/modelcontextprotocol/modelcontextprotocol) | active |
| [NLWeb](https://github.com/nlweb-ai/NLWeb) | The reference implementation of NLWeb, which lets sites offer natural language interfaces to their own content. | [repo](https://github.com/nlweb-ai/NLWeb) | active |
| [Robots Exclusion Protocol (RFC 9309)](https://www.rfc-editor.org/info/rfc9309/) | The IETF standard that formalizes robots.txt rules for crawlers and automated clients. | - | active |
| [Web Bot Auth](https://www.webbotauth.org/) | A neutral directory and signing scheme for authenticated bots, built on signed HTTP requests. | [repo](https://github.com/cloudflare/web-bot-auth) | early |
| [WebMCP in Chrome](https://developer.chrome.com/docs/ai/webmcp) | Chrome documentation for WebMCP, covering imperative and declarative tools and the origin trial. | - | early |
| [WebMCP Specification](https://webmachinelearning.github.io/webmcp/) | A draft Web Machine Learning Community Group API that lets web apps offer JavaScript tools to AI agents. | [repo](https://github.com/webmachinelearning/webmcp) | early |

### WebMCP and In-Page Agent Tools

Libraries and demos that let a web page expose tools to agents, and MCP running in or alongside the browser.

| Project | Description | Repo | Status |
| --- | --- | --- | --- |
| [Early WebMCP Proposal](https://github.com/jasonjmcghee/WebMCP) | An early WebMCP proposal and implementation that later fed into the W3C community group work. | [repo](https://github.com/jasonjmcghee/WebMCP) | archived |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | The official TypeScript SDK for building Model Context Protocol servers and clients. | [repo](https://github.com/modelcontextprotocol/typescript-sdk) | active |
| [MCP-B](https://mcp-b.ai/) | Open-source WebMCP packages and a browser extension for publishing and calling tools on the web. | [repo](https://github.com/WebMCP-org/npm-packages) | active |
| [mcp-use](https://github.com/mcp-use/mcp-use) | A full-stack MCP framework for building MCP apps for ChatGPT and Claude and MCP servers for agents. | [repo](https://github.com/mcp-use/mcp-use) | active |
| [WebLLM](https://github.com/mlc-ai/web-llm) | A high-performance in-browser LLM inference engine for running models locally inside a web page. | [repo](https://github.com/mlc-ai/web-llm) | active |
| [WebMCP Tools](https://github.com/GoogleChromeLabs/webmcp-tools) | Developer utilities and demos from Chrome Labs that support adoption of the WebMCP API. | [repo](https://github.com/GoogleChromeLabs/webmcp-tools) | active |

### Browser-Use Frameworks

Open-source libraries and SDKs that let LLMs drive a browser to complete tasks.

| Project | Description | Repo | Status |
| --- | --- | --- | --- |
| [agent-browser](https://agent-browser.dev/) | A browser automation CLI built for AI agents. | [repo](https://github.com/vercel-labs/agent-browser) | active |
| [AgentQL](https://www.agentql.com/) | A query language and Playwright integration for locating elements and extracting data from any page. | [repo](https://github.com/tinyfish-io/agentql) | active |
| [Browser Use](https://browser-use.com/) | An open-source library that lets AI agents use the browser. | [repo](https://github.com/browser-use/browser-use) | active |
| [Browser Use Web UI](https://github.com/browser-use/web-ui) | A web interface for running Browser Use agents in your browser. | [repo](https://github.com/browser-use/web-ui) | active |
| [HyperAgent](https://github.com/hyperbrowserai/HyperAgent) | An AI browser automation framework from the Hyperbrowser team. | [repo](https://github.com/hyperbrowserai/HyperAgent) | active |
| [LaVague](https://github.com/lavague-ai/LaVague) | A Large Action Model framework for developing AI web agents. | [repo](https://github.com/lavague-ai/LaVague) | active |
| [Midscene.js](https://github.com/web-infra-dev/midscene) | A vision-driven framework that lets you control web and other interfaces in natural language. | [repo](https://github.com/web-infra-dev/midscene) | active |
| [Nanobrowser](https://github.com/nanobrowser/nanobrowser) | An open-source Chrome extension that runs multi-agent web automation workflows with your own LLM API key. | [repo](https://github.com/nanobrowser/nanobrowser) | active |
| [Open Operator](https://github.com/browserbase/open-operator) | A template for building web agents with Stagehand on Browserbase. | [repo](https://github.com/browserbase/open-operator) | archived |
| [Skyvern](https://www.skyvern.com/) | Automates browser-based workflows with AI. | [repo](https://github.com/Skyvern-AI/skyvern) | active |
| [Stagehand](https://www.stagehand.dev/) | An SDK for browser agents to extract data and interact with any site on the web. | [repo](https://github.com/browserbase/stagehand) | active |
| [Workflow Use](https://github.com/browser-use/workflow-use) | Create and run repeatable browser workflows, described by its authors as RPA 2.0. | [repo](https://github.com/browser-use/workflow-use) | early |

### Browser MCP Servers

MCP servers that give assistants control of, or insight into, a real browser.

| Project | Description | Repo | Status |
| --- | --- | --- | --- |
| [Browser MCP](https://browsermcp.io/) | An MCP server and extension that lets AI applications control your own browser. | [repo](https://github.com/BrowserMCP/mcp) | active |
| [Browser Tools MCP](https://github.com/AgentDeskAI/browser-tools-mcp) | An MCP server and Chrome extension that surfaces browser logs to Cursor and other MCP-compatible IDEs. | [repo](https://github.com/AgentDeskAI/browser-tools-mcp) | active |
| [Browserbase MCP Server](https://github.com/browserbase/mcp-server-browserbase) | An MCP server that lets LLMs control a browser with Browserbase and Stagehand. | [repo](https://github.com/browserbase/mcp-server-browserbase) | archived |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Chrome DevTools for coding agents, exposed as an MCP server. | [repo](https://github.com/ChromeDevTools/chrome-devtools-mcp) | active |
| [Firecrawl MCP Server](https://github.com/firecrawl/firecrawl-mcp-server) | The official Firecrawl MCP server, adding web scraping and search to Cursor, Claude, and other clients. | [repo](https://github.com/firecrawl/firecrawl-mcp-server) | active |
| [mcp-chrome](https://github.com/hangwin/mcp-chrome) | A Chrome extension based MCP server that exposes browser functionality to AI assistants. | [repo](https://github.com/hangwin/mcp-chrome) | active |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | The Playwright MCP server from Microsoft, giving agents structured browser control. | [repo](https://github.com/microsoft/playwright-mcp) | active |
| [Playwright MCP Server (ExecuteAutomation)](https://github.com/executeautomation/mcp-playwright) | A Playwright MCP server for automating browsers and APIs in Claude Desktop, Cline, Cursor, and more. | [repo](https://github.com/executeautomation/mcp-playwright) | active |

### Computer-Use Agents

Agents, sandboxes, and tooling that operate full graphical desktops from screenshots and actions.

| Project | Description | Repo | Status |
| --- | --- | --- | --- |
| [Agent S](https://github.com/simular-ai/Agent-S) | An open agentic framework that uses computers like a human. | [repo](https://github.com/simular-ai/Agent-S) | active |
| [All-in-One Sandbox](https://github.com/agent-infra/sandbox) | An all-in-one sandbox for AI agents that combines browser and related tools in a single environment. | [repo](https://github.com/agent-infra/sandbox) | active |
| [Anthropic Computer Use Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) | Claude API documentation for the computer use tool that controls a desktop through screenshots and actions. | - | active |
| [Claude Quickstarts](https://github.com/anthropics/claude-quickstarts) | A collection of starter projects for building deployable applications with the Claude API. | [repo](https://github.com/anthropics/claude-quickstarts) | active |
| [Cua](https://cua.ai/) | Open-source drivers, cross-OS fleets, and benchmarks for computer-use agents. | [repo](https://github.com/trycua/cua) | active |
| [E2B Desktop](https://github.com/e2b-dev/desktop) | An E2B sandbox with a desktop graphical environment that you can connect to any LLM for secure computer use. | [repo](https://github.com/e2b-dev/desktop) | active |
| [Gemini Computer Use](https://ai.google.dev/gemini-api/docs/computer-use) | Gemini API documentation for the computer use capability that lets models operate user interfaces. | - | active |
| [Magentic-UI](https://github.com/microsoft/magentic-ui) | An experimental Microsoft agent that works across the browser and the local file system. | [repo](https://github.com/microsoft/magentic-ui) | early |
| [OmniParser](https://github.com/microsoft/OmniParser) | A screen parsing tool for pure vision based GUI agents. | [repo](https://github.com/microsoft/OmniParser) | active |
| [OpenAI Computer Use Guide](https://developers.openai.com/api/docs/guides/tools-computer-use) | OpenAI API documentation for the computer use tool. | - | active |
| [OpenAI CUA Sample App](https://github.com/openai/openai-cua-sample-app) | Shows how to use OpenAI Computer Using Agent via the API across multiple computer environments. | [repo](https://github.com/openai/openai-cua-sample-app) | active |
| [Surf](https://github.com/e2b-dev/surf) | A computer-use agent powered by OpenAI that drives an E2B virtual desktop through natural language. | [repo](https://github.com/e2b-dev/surf) | active |
| [UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop) | An open-source multimodal AI agent stack that connects cutting-edge models with agent infrastructure. | [repo](https://github.com/bytedance/UI-TARS-desktop) | active |

### Automation Foundations

The browser automation engines and headless browsers that agent frameworks build on.

| Project | Description | Repo | Status |
| --- | --- | --- | --- |
| [Chrome DevTools](https://developer.chrome.com/docs/devtools/) | The documentation hub for Chrome DevTools, the debugging surface that agent tooling builds on. | - | active |
| [Lightpanda](https://lightpanda.io/) | A headless browser designed for AI and automation. | [repo](https://github.com/lightpanda-io/browser) | active |
| [Playwright](https://playwright.dev/) | A framework for web testing and automation across Chromium, Firefox, and WebKit with a single API. | [repo](https://github.com/microsoft/playwright) | active |
| [Puppeteer](https://pptr.dev/) | A JavaScript API for controlling Chrome and Firefox. | [repo](https://github.com/puppeteer/puppeteer) | active |
| [Puppeteer for Cloudflare](https://github.com/cloudflare/puppeteer) | A Puppeteer Core fork that works with Cloudflare Browser Workers. | [repo](https://github.com/cloudflare/puppeteer) | active |

### Headless Browser Infrastructure

Self-hostable and hosted browser fleets built for agent workloads.

| Project | Description | Repo | Status |
| --- | --- | --- | --- |
| [Anchor Browser](https://anchorbrowser.io/) | Secure browser infrastructure for computer-use agents. | - | active |
| [Browserbase](https://www.browserbase.com/) | Cloud headless browsers for AI agents and the company behind Stagehand. | - | active |
| [Browserless](https://www.browserless.io/) | Headless browsers deployable in Docker or in the cloud, reachable over MCP, Puppeteer, or Playwright. | [repo](https://github.com/browserless/browserless) | active |
| [Hyperbrowser](https://www.hyperbrowser.ai/) | Cloud browsers for AI agents and apps. | - | active |
| [Kernel](https://www.kernel.sh/) | Browser infrastructure for web agents and automations. | - | active |
| [Steel Browser](https://steel.dev/) | An open-source browser API and sandbox for AI agents and apps. | [repo](https://github.com/steel-dev/steel-browser) | active |

### Web Data for Agents

Crawlers, readers, and extraction tools that turn pages into agent-ready content.

| Project | Description | Repo | Status |
| --- | --- | --- | --- |
| [Crawl4AI](https://crawl4ai.com/) | An open-source crawler and scraper that turns websites into clean, LLM-ready Markdown. | [repo](https://github.com/unclecode/crawl4ai) | active |
| [Crawlee](https://github.com/apify/crawlee) | A web scraping and browser automation library for Node.js that works with Puppeteer, Playwright, Cheerio, and JSDOM. | [repo](https://github.com/apify/crawlee) | active |
| [Firecrawl](https://www.firecrawl.dev/) | A web data API that gives AI agents clean data from the web. | [repo](https://github.com/firecrawl/firecrawl) | active |
| [Jina Reader](https://github.com/jina-ai/reader) | Converts any URL into LLM-friendly input by prefixing it with r.jina.ai. | [repo](https://github.com/jina-ai/reader) | active |

### Benchmarks and Research

Datasets, environments, and research agents for measuring and improving web agents.

| Project | Description | Repo | Status |
| --- | --- | --- | --- |
| [AutoWebGLM](https://github.com/THUDM/AutoWebGLM) | An LLM-based web navigating agent from KDD 2024. | [repo](https://github.com/THUDM/AutoWebGLM) | active |
| [BrowserGym](https://github.com/ServiceNow/BrowserGym) | A Gym environment for web task automation. | [repo](https://github.com/ServiceNow/BrowserGym) | active |
| [Mind2Web](https://osu-nlp-group.github.io/Mind2Web/) | A NeurIPS 2023 dataset and benchmark for generalist agents for the web. | [repo](https://github.com/OSU-NLP-Group/Mind2Web) | active |
| [SeeAct](https://github.com/OSU-NLP-Group/SeeAct) | An ICML 2024 system for generalist web agents that complete tasks on any website using large multimodal models. | [repo](https://github.com/OSU-NLP-Group/SeeAct) | active |
| [WebArena](https://webarena.dev/) | A realistic web environment and suite of benchmarks for building autonomous web agents. | [repo](https://github.com/web-arena-x/webarena) | active |
| [WebVoyager](https://github.com/MinorJerry/WebVoyager) | Code for WebVoyager, an end-to-end web agent built with large multimodal models. | [repo](https://github.com/MinorJerry/WebVoyager) | active |

<!-- ENTRIES:END -->

## License

[CC0 1.0 Universal](LICENSE). The list is dedicated to the public domain: use it, fork it, and build on it freely. Listed projects keep their own licenses and trademarks.
