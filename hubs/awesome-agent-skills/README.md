# Awesome Agent Skills

A curated, community-fed directory of everything around **agent skills**: SKILL.md bundles that teach coding and general-purpose agents new abilities, the registries and marketplaces that distribute them, the tools that author and install them, and the scanners that keep them safe.

Skills are folders of instructions, scripts and resources that an agent loads on demand. The format is now shared across many agents, which makes a single well-organized map of the ecosystem useful to everyone building on it.

Every entry lives in [`data/entries.json`](data/entries.json), so the list is machine-readable as well as human-readable. The tables below are generated from that file.

## Add your project

Open a pull request that adds one object to `data/entries.json`. The full steps take about two minutes and are in [CONTRIBUTING.md](CONTRIBUTING.md). Short version:

1. Add your entry to `data/entries.json`, in alphabetical order within its category.
2. Run `npm run check` (Node 18 or newer, no dependencies).
3. Commit the regenerated `README.md` along with your change.

Prefer an issue? Use the [add a project](.github/ISSUE_TEMPLATE/add-project.md) template and a maintainer will help.

## Categories

- [Specs and Documentation](#specs-and-documentation)
- [Official Skill Libraries](#official-skill-libraries)
- [Community Collections](#community-collections)
- [Domain Skills and Methodologies](#domain-skills-and-methodologies)
- [Registries and Marketplaces](#registries-and-marketplaces)
- [Installers and Authoring Tools](#installers-and-authoring-tools)
- [Security and Scanning](#security-and-scanning)
- [Agent Runtimes with Skills](#agent-runtimes-with-skills)

## Entries

<!-- ENTRIES:START -->

### Specs and Documentation

The open Agent Skills format and the official guides that explain how skills are written, discovered and loaded.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [Agent Skills Overview](https://agentskills.io/home) | Home of the Agent Skills standard, a standardized way to give AI agents new capabilities and expertise. | - | active |
| [Agent Skills Specification](https://agentskills.io/specification) | The open format for skills: a folder with a SKILL.md file plus optional scripts and resources that give agents new capabilities. | [repo](https://github.com/agentskills/agentskills) | active |
| [Claude Agent Skills Documentation](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) | Anthropic platform documentation explaining what Agent Skills are and how Claude discovers and loads them. | - | active |
| [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills) | Claude Code guide to creating, managing and sharing skills, including custom commands and bundled skills. | - | active |
| [Codex Skills Documentation](https://learn.chatgpt.com/docs/build-skills) | OpenAI guide to building skills that give ChatGPT and Codex new capabilities and expertise. | - | active |
| [Gemini CLI Agent Skills Documentation](https://geminicli.com/docs/cli/skills/) | Gemini CLI documentation for Agent Skills. | - | active |
| [KDnuggets: Top 5 Agent Skill Marketplaces](https://www.kdnuggets.com/top-5-agent-skill-marketplaces-for-building-powerful-ai-agents) | Overview article comparing marketplaces for discovering and installing agent skills. | - | active |
| [three.ws Agent Skills](https://three.ws) | A 3D agent platform with its own skill bundle format (manifest, SKILL.md, tools, handlers) for adding capabilities to embeddable agents. | - | active |

### Official Skill Libraries

Skill bundles published by the teams who build the platforms, frameworks and services they teach agents to use.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [Anthropic Knowledge Work Plugins](https://github.com/anthropics/knowledge-work-plugins) | Open source plugins primarily intended for knowledge workers to use in Claude Cowork. | [repo](https://github.com/anthropics/knowledge-work-plugins) | active |
| [Anthropic Skills](https://github.com/anthropics/skills) | Anthropic public repository for Agent Skills. | [repo](https://github.com/anthropics/skills) | active |
| [Better Auth Skills](https://github.com/better-auth/skills) | Agent skills from the Better Auth project. | [repo](https://github.com/better-auth/skills) | active |
| [Callstack Agent Skills](https://github.com/callstackincubator/agent-skills) | A collection of agent-optimized React Native skills for AI coding assistants. | [repo](https://github.com/callstackincubator/agent-skills) | active |
| [Cloudflare Skills](https://github.com/cloudflare/skills) | Skills for teaching agents how to build on Cloudflare. | [repo](https://github.com/cloudflare/skills) | active |
| [ElevenLabs Skills](https://github.com/elevenlabs/skills) | Collections of skills for building with ElevenLabs. | [repo](https://github.com/elevenlabs/skills) | active |
| [Expo Skills](https://github.com/expo/skills) | A collection of AI agent skills for working with Expo projects and Expo Application Services. | [repo](https://github.com/expo/skills) | active |
| [Firecrawl Skills](https://github.com/firecrawl/skills) | Firecrawl agent skills for Claude Code, Codex and Cursor: web search, scraping, crawling and browser interaction. | [repo](https://github.com/firecrawl/skills) | active |
| [GitHub Awesome Copilot](https://github.com/github/awesome-copilot) | Community-contributed instructions, agents, skills and configurations for GitHub Copilot. | [repo](https://github.com/github/awesome-copilot) | active |
| [HashiCorp Agent Skills](https://github.com/hashicorp/agent-skills) | A collection of agent skills and Claude Code plugins for HashiCorp products. | [repo](https://github.com/hashicorp/agent-skills) | active |
| [Hugging Face Skills](https://github.com/huggingface/skills) | Skills that give agents the power of the Hugging Face ecosystem. | [repo](https://github.com/huggingface/skills) | active |
| [Microsoft Skills](https://github.com/microsoft/skills) | Skills, MCP servers, custom agents and AGENTS.md files for Microsoft SDKs to ground coding agents. | [repo](https://github.com/microsoft/skills) | active |
| [Neon Agent Skills](https://github.com/neondatabase/agent-skills) | Agent skills for Neon serverless Postgres. | [repo](https://github.com/neondatabase/agent-skills) | active |
| [OpenAI Skills Catalog](https://github.com/openai/skills) | Skills catalog for Codex published by OpenAI. | [repo](https://github.com/openai/skills) | active |
| [Prisma Skills](https://github.com/prisma/skills) | Agent skills from the Prisma team. | [repo](https://github.com/prisma/skills) | active |
| [Remotion Skills](https://github.com/remotion-dev/skills) | Agent skills from the Remotion team. | [repo](https://github.com/remotion-dev/skills) | active |
| [Sanity Agent Toolkit](https://github.com/sanity-io/agent-toolkit) | Collection of resources to help AI agents build better with Sanity. | [repo](https://github.com/sanity-io/agent-toolkit) | active |
| [Sentry Skills](https://github.com/getsentry/skills) | Agent skills used by the Sentry team for development. | [repo](https://github.com/getsentry/skills) | active |
| [Stripe AI](https://github.com/stripe/ai) | Stripe repository for building AI-powered products and businesses with Stripe. | [repo](https://github.com/stripe/ai) | active |
| [Supabase Agent Skills](https://github.com/supabase/agent-skills) | Agent skills to help developers using AI agents with Supabase. | [repo](https://github.com/supabase/agent-skills) | active |
| [Trail of Bits Skills](https://github.com/trailofbits/skills) | Trail of Bits Claude Code skills for security research, vulnerability detection and audit workflows. | [repo](https://github.com/trailofbits/skills) | active |
| [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills) | Vercel's official collection of agent skills. | [repo](https://github.com/vercel-labs/agent-skills) | active |

### Community Collections

Curated lists and large community catalogs of skills, a good place to browse what exists.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [Antigravity Awesome Skills](https://github.com/sickn33/antigravity-awesome-skills) | A local, agent-first catalog of agentic skills with a CLI and local MCP for discovery, selection and planning. | [repo](https://github.com/sickn33/antigravity-awesome-skills) | active |
| [Awesome Agent Skills (skillcreatorai)](https://github.com/skillcreatorai/Awesome-Agent-Skills) | A curated list of Claude Skills, resources and tools for customizing Claude AI workflows. | [repo](https://github.com/skillcreatorai/Awesome-Agent-Skills) | active |
| [Awesome Claude Code](https://github.com/hesreallyhim/awesome-claude-code) | A hand-picked collection of resources for Claude Code, including skills, agents, status lines, tooling and plugins. | [repo](https://github.com/hesreallyhim/awesome-claude-code) | active |
| [Awesome Claude Code Toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | A toolkit of agents, curated skills, commands, plugins, hooks, rules, templates and MCP configs for Claude Code. | [repo](https://github.com/rohitg00/awesome-claude-code-toolkit) | active |
| [Awesome Claude Skills (BehiSecc)](https://github.com/BehiSecc/awesome-claude-skills) | A curated list of Claude Skills. | [repo](https://github.com/BehiSecc/awesome-claude-skills) | active |
| [Awesome Claude Skills (ComposioHQ)](https://github.com/ComposioHQ/awesome-claude-skills) | A curated list of Claude Skills, resources and tools for customizing Claude AI workflows. | [repo](https://github.com/ComposioHQ/awesome-claude-skills) | active |
| [Awesome Claude Skills (travisvn)](https://github.com/travisvn/awesome-claude-skills) | A curated list of Claude Skills, resources and tools for customizing Claude workflows, particularly Claude Code. | [repo](https://github.com/travisvn/awesome-claude-skills) | active |
| [Claude Skills (alirezarezvani)](https://github.com/alirezarezvani/claude-skills) | Hundreds of Claude Code skills, agents and plugins for Claude Code, Codex, Gemini CLI, Cursor and more coding agents. | [repo](https://github.com/alirezarezvani/claude-skills) | active |
| [Jezweb Claude Skills](https://github.com/jezweb/claude-skills) | Skills for Claude Code CLI covering full stack development with Cloudflare, React, Tailwind v4 and AI integrations. | [repo](https://github.com/jezweb/claude-skills) | active |
| [VoltAgent Awesome Agent Skills](https://github.com/VoltAgent/awesome-agent-skills) | A curated collection of 1000+ agent skills from official dev teams and the community, compatible with many coding agents. | [repo](https://github.com/VoltAgent/awesome-agent-skills) | active |

### Domain Skills and Methodologies

Focused skill sets for science, marketing, engineering practice and context engineering.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [Agent Skills for Context Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | Agent skills for context engineering, multi-agent architectures and production agent systems. | [repo](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | active |
| [Claude Scientific Skills](https://github.com/K-Dense-AI/claude-scientific-skills) | A library of validated agent skills for science, covering scientific databases and research workflows. | [repo](https://github.com/K-Dense-AI/claude-scientific-skills) | active |
| [Claude Skills Marketplace (mhattingpete)](https://github.com/mhattingpete/claude-skills-marketplace) | Claude Code skills for software engineering workflows: git automation, testing and code review. | [repo](https://github.com/mhattingpete/claude-skills-marketplace) | active |
| [Compound Engineering Plugin](https://github.com/EveryInc/compound-engineering-plugin) | Official Compound Engineering plugin for Claude Code, Codex, Cursor and more. | [repo](https://github.com/EveryInc/compound-engineering-plugin) | active |
| [Context Engineering Kit](https://github.com/NeoLabHQ/context-engineering-kit) | Hand-crafted Claude Code skills focused on improving agent result quality, compatible with OpenCode, Cursor and Gemini CLI. | [repo](https://github.com/NeoLabHQ/context-engineering-kit) | active |
| [Marketing Skills](https://github.com/coreyhaines31/marketingskills) | Marketing skills for Claude Code and AI agents covering CRO, copywriting, SEO, analytics and growth engineering. | [repo](https://github.com/coreyhaines31/marketingskills) | active |
| [Matt Pocock Skills](https://github.com/mattpocock/skills) | Skills for real engineers, taken from the author .agents directory. | [repo](https://github.com/mattpocock/skills) | active |
| [Superpowers](https://github.com/obra/superpowers) | An agentic skills framework and software development methodology built from composable skills. | [repo](https://github.com/obra/superpowers) | active |

### Registries and Marketplaces

Places to search, compare, version and install skills and plugins, from public indexes to enterprise registries.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [agentskill.sh](https://agentskill.sh) | Directory and marketplace of AI agent skills for Claude Code, Cursor, Copilot, Codex, Windsurf, Zed and more, installable with one command. | - | active |
| [Claude Code Templates](https://github.com/davila7/claude-code-templates) | CLI tool for configuring and monitoring Claude Code with ready-made templates. | [repo](https://github.com/davila7/claude-code-templates) | active |
| [Claude Plugins Official](https://github.com/anthropics/claude-plugins-official) | Official, Anthropic-managed directory of high quality Claude Code plugins. | [repo](https://github.com/anthropics/claude-plugins-official) | active |
| [claudeskills.info](https://claudeskills.info) | Marketplace to browse, discover and download Claude Code skills and agent skills. | - | active |
| [ClawHub](https://clawhub.ai) | Skill and plugin registry for OpenClaw with vector search. | [repo](https://github.com/openclaw/clawhub) | active |
| [JFrog Skills Registry](https://docs.jfrog.com/ai-ml/docs/skills-registry) | Manage versioned skills in the JFrog AI Catalog using a coding agent or the JFrog CLI. | - | active |
| [mdskills](https://www.mdskills.ai) | Free skill.md files, plugins and MCP servers for Claude Code, Cursor, Codex and other agents, installable in one command. | - | active |
| [SkillHub](https://www.skillhub.club) | Search and compare agent skills for Claude Code, Codex, Gemini CLI, OpenCode and OpenClaw, with recommended skill sets. | - | active |
| [Skills Directory](https://www.skillsdirectory.com) | Directory of agent skills for Claude, each scanned for malware, prompt injection and credential theft. | - | active |
| [skills.sh](https://www.skills.sh) | The Agent Skills Directory: discover and install skills for AI agents. | - | active |
| [SkillsMP](https://skillsmp.com) | Marketplace for browsing agent skills from public GitHub repos, including Codex and Claude skills, with source inspection before install. | - | active |
| [Smithery Skills](https://smithery.ai/skills) | Smithery skills directory for connecting agents to tools and services, with auth and sessions handled. | - | active |
| [Superpowers Marketplace](https://github.com/obra/superpowers-marketplace) | Curated Claude Code plugin marketplace. | [repo](https://github.com/obra/superpowers-marketplace) | active |
| [Tech Leads Club Agent Skills](https://github.com/tech-leads-club/agent-skills) | A secure, validated skill registry for professional AI coding agents including Claude Code, Cursor and Copilot. | [repo](https://github.com/tech-leads-club/agent-skills) | active |
| [Tons of Skills](https://github.com/jeremylongshore/tons-of-skills-marketplace) | Model-agnostic agent-skills platform with a canonical layer, verified adapters and the ccpi package manager. | [repo](https://github.com/jeremylongshore/tons-of-skills-marketplace) | active |
| [wshobson Agents](https://github.com/wshobson/agents) | Multi-harness agentic plugin marketplace for Claude Code, Codex, Cursor, OpenCode, GitHub Copilot and more. | [repo](https://github.com/wshobson/agents) | active |

### Installers and Authoring Tools

CLIs, loaders and generators that package, validate and deliver skills to the agent of your choice.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [knack](https://docs.rs/crate/knack/latest) | Rust CLI that packages, validates, versions, publishes, discovers and installs Agent Skills. | [repo](https://github.com/ajac-zero/knack) | early |
| [OpenSkills](https://github.com/numman-ali/openskills) | Universal skills loader for AI coding agents, installed with npm. | [repo](https://github.com/numman-ali/openskills) | active |
| [Skill Seekers](https://github.com/yusufkaraaslan/Skill_Seekers) | Convert documentation websites, GitHub repositories and PDFs into Claude AI skills with automatic conflict detection. | [repo](https://github.com/yusufkaraaslan/Skill_Seekers) | active |
| [SkillPort](https://github.com/gotalab/skillport) | Bring Agent Skills to any AI agent and coding agent via CLI or MCP. | [repo](https://github.com/gotalab/skillport) | active |
| [skills CLI (npx skills)](https://github.com/vercel-labs/skills) | The open agent skills tool, run with npx skills. | [repo](https://github.com/vercel-labs/skills) | active |
| [Skillz](https://github.com/intellectronica/skillz) | An MCP server for loading skills, a shim for clients without native skill support. | [repo](https://github.com/intellectronica/skillz) | active |

### Security and Scanning

Scanners that inspect skills, MCP servers and agent configurations before you trust them.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [Cisco Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner) | Security scanner for Agent Skills from Cisco AI Defense. | [repo](https://github.com/cisco-ai-defense/skill-scanner) | active |
| [Snyk Agent Scan](https://github.com/snyk/agent-scan) | Security scanner for AI agents, MCP servers and agent skills. | [repo](https://github.com/snyk/agent-scan) | active |

### Agent Runtimes with Skills

Agents and harnesses that load skills or plugins natively.

| Project | Description | Source | Status |
| --- | --- | --- | --- |
| [Claude Code](https://github.com/anthropics/claude-code) | Anthropic agentic coding tool for the terminal, with documented support for skills. | [repo](https://github.com/anthropics/claude-code) | active |
| [Deep Agents](https://github.com/langchain-ai/deepagents) | LangChain agent harness with filesystem, sub-agents and skills as reusable behaviors loaded on demand. | [repo](https://github.com/langchain-ai/deepagents) | active |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Open-source AI agent that brings Gemini into the terminal, with Agent Skills support. | [repo](https://github.com/google-gemini/gemini-cli) | active |
| [OpenClaw](https://github.com/openclaw/openclaw) | Open-source AI agent for any OS and platform that extends itself with tools, skills and plugins, with skills shared through ClawHub. | [repo](https://github.com/openclaw/openclaw) | active |

<!-- ENTRIES:END -->

## Using the data

`data/entries.json` is validated against [`data/schema.json`](data/schema.json) and `data/categories.json` defines the category order. Fetch the raw file to power your own site, CLI or agent.

```
npm run validate   # check the data
npm run build      # regenerate the tables above
```

## License

Released under [CC0 1.0 Universal](LICENSE). Listed projects keep their own licenses and trademarks.
