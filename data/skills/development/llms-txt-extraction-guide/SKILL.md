---
name: llms-txt-extraction-guide
description: Guide to llm.energy — extract llms.txt and install.md documentation from any website for AI agents, LLMs, and automation workflows. Features MCP server, REST API, batch processing, and multiple export formats. The documentation extraction standard for AI-ready content.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, llms-txt-extraction-guide]
---

# llms.txt Documentation Extraction Guide

llm.energy extracts documentation from websites implementing the llms.txt and install.md standards. It transforms raw documentation into structured, agent-ready formats optimized for LLMs.

## Standards

| Standard | Purpose | Specification |
|----------|---------|--------------|
| **llms.txt** | Machine-readable documentation | [llmstxt.org](https://llmstxt.org) |
| **install.md** | LLM-executable installation instructions | [installmd.org](https://installmd.org) |

## What It Does

```
Input: https://docs.chat.sperax.io
    │
    ▼
Auto-detects:
  ├── /llms.txt (summary)
  ├── /llms-full.txt (full docs)
  └── /install.md (setup instructions)
    │
    ▼
Output:
  ├── Individual markdown files per section
  ├── Single concatenated document
  ├── JSON structured output
  └── MCP-compatible tool responses
```

## Quick Start

### Web Interface
Visit [llm.energy](https://llm.energy), paste a URL, and extract.

### CLI
```bash
npx @llm-energy/cli extract https://docs.chat.sperax.io
```

### MCP Server
```json
{
  "mcpServers": {
    "llm-energy": {
      "command": "npx",
      "args": ["@llm-energy/mcp-server"]
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `extractDocs` | Extract llms.txt from a URL |
| `extractFull` | Extract llms-full.txt (complete documentation) |
| `extractInstall` | Extract install.md (setup instructions) |
| `detectStandards` | Check which standards a site supports |
| `batchExtract` | Extract from multiple URLs at once |

## REST API

```bash
# Extract documentation
curl https://llm.energy/api/extract?url=https://docs.chat.sperax.io

# Detect standards support
curl https://llm.energy/api/detect?url=https://docs.chat.sperax.io

# Batch extract
curl -X POST https://llm.energy/api/batch \
  -d '{"urls": ["https://docs.chat.sperax.io", "https://docs.aave.com"]}'
```

## Export Formats

| Format | Best For |
|--------|---------|
| **Markdown** | Human reading, GitHub, documentation sites |
| **JSON** | Programmatic consumption, databases |
| **Plain text** | LLM context windows, RAG pipelines |
| **Split files** | Individual section storage |

## Use Cases

### Build a Knowledge Base
Extract docs from multiple DeFi protocols to create a comprehensive AI knowledge base:
```bash
llm-energy batch \
  https://docs.chat.sperax.io \
  https://docs.aave.com \
  https://docs.uniswap.org \
  --output ./defi-knowledge/
```

### Agent Documentation
Give AI agents up-to-date documentation for any tool or protocol they need to use.

### SperaxOS Integration
llm.energy powers the documentation extraction in SperaxOS's knowledge base tool, enabling agents to ingest any protocol's docs on-demand.

## Adding llms.txt to Your Site

To make your site AI-friendly, add these files:

### `/llms.txt` (Summary)
```
# My Protocol

> One-line description

## Docs
- [Getting Started](https://docs.example.com/start)
- [API Reference](https://docs.example.com/api)
```

### `/llms-full.txt` (Full Content)
Concatenation of all documentation pages in a single markdown file.

### `/install.md` (Setup)
Step-by-step installation instructions that an LLM can execute.

## Links

- Website: https://llm.energy
- GitHub: https://github.com/nirholas/extract-llms-docs
- npm: https://www.npmjs.com/package/@llm-energy/mcp-server
- llms.txt spec: https://llmstxt.org
- install.md spec: https://installmd.org
