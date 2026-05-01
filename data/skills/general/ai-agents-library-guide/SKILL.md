---
name: ai-agents-library-guide
description: Guide to the AI Agents Library — a curated collection of 300+ production-grade AI agent system prompts ready for import. Covers DeFi, crypto, trading, research, coding, writing, and more. Each prompt is optimized for GPT-4, Claude, Gemini, and other frontier models.
license: MIT
metadata:
  category: general
  difficulty: beginner
  author: nich
  tags: [general, ai-agents-library-guide]
---

# AI Agents Library Guide

A curated collection of 300+ production-grade AI agent system prompts. Each prompt is battle-tested, optimized for frontier LLMs, and ready for import into SperaxOS or any agent framework.

## Library Structure

```
AI-Agents-Library/
├── crypto/           # 60+ crypto/DeFi agents
├── trading/          # 40+ trading strategy agents
├── research/         # 30+ research/analysis agents
├── coding/           # 25+ software development agents
├── writing/          # 20+ content creation agents
├── defi/             # 35+ DeFi-specific agents
├── security/         # 15+ security audit agents
├── data/             # 20+ data analysis agents
├── social/           # 15+ social media agents
├── education/        # 20+ teaching/tutoring agents
├── productivity/     # 20+ workflow/GTD agents
└── niche/            # 30+ specialized agents
```

## Prompt Format

Each agent follows a consistent structure:

```markdown
# Agent Name

## Identity
You are [Agent Name], a specialized AI agent that...

## Capabilities
- Capability 1
- Capability 2
- ...

## Instructions
1. Always...
2. When asked about X, do Y...
3. Never...

## Knowledge Base
- Protocol docs
- API references
- Domain expertise

## Output Format
Structured response format with...

## Examples
<example>
User: ...
Agent: ...
</example>
```

## Categories Deep Dive

### Crypto Agents (60+)

| Agent | Specialty |
|-------|----------|
| **DeFi Analyst** | Protocol TVL, APY, risk analysis |
| **Token Researcher** | Tokenomics, team, roadmap evaluation |
| **On-chain Detective** | Wallet tracking, flow analysis |
| **Whale Watcher** | Large transaction monitoring |
| **Airdrop Hunter** | Eligibility checking, farming guides |
| **Gas Optimizer** | Transaction timing, gas strategies |
| **NFT Valuator** | NFT pricing, rarity, market trends |
| **DAO Governance** | Proposal analysis, voting recommendations |
| **MEV Specialist** | MEV explanation, protection strategies |
| **Stablecoin Expert** | USDs, USDC, DAI comparison and yield |

### Trading Agents (40+)

| Agent | Strategy |
|-------|---------|
| **Technical Analyst** | Chart patterns, indicators, signals |
| **Sentiment Trader** | Social sentiment → trade signals |
| **Swing Trader** | Multi-day position management |
| **Scalper** | Short-term, high-frequency signals |
| **Quant Researcher** | Factor models, backtesting |
| **Risk Manager** | Position sizing, stop losses |
| **Market Structure** | Order flow, liquidity analysis |

### DeFi Agents (35+)

| Agent | Focus |
|-------|-------|
| **Yield Optimizer** | Find best yields across protocols |
| **LP Advisor** | Liquidity pool selection and management |
| **Lending Strategist** | Supply/borrow optimization |
| **Bridge Advisor** | Cross-chain transfer recommendations |
| **Sperax Specialist** | USDs yield, SPA staking, Farms |

## Importing into SperaxOS

### Method 1: Direct Import
1. Copy the system prompt from the library
2. Use the Agent Builder tool in SperaxOS
3. Paste as the agent's system prompt
4. Configure model and tools

### Method 2: Seeding Script
```bash
# Use the agent-seeding skill
bun run scripts/seed-agents.ts --source AI-Agents-Library/crypto/
```

### Method 3: Marketplace
Published agents from the library are available in the SperaxOS skill marketplace under the "Community" section.

## Quality Standards

Every prompt in the library meets these criteria:

| Standard | Requirement |
|----------|------------|
| **Tested** | Verified on GPT-4, Claude, Gemini |
| **Structured** | Follows consistent format |
| **Safe** | No harmful instructions |
| **Useful** | Solves a real problem |
| **Complete** | Self-contained, no external dependencies |
| **Maintained** | Updated as models evolve |

## Contributing

1. Fork the repository
2. Add your agent prompt following the template
3. Test with at least 2 different LLMs
4. Submit a PR with example conversations

## Links

- GitHub: https://github.com/nirholas/AI-Agents-Library
- SperaxOS Agent Marketplace: https://app.sperax.io/agents
- Agent Seeding Skill: `.agents/skills/agent-seeding/SKILL.md`
