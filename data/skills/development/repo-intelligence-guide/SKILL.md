---
name: repo-intelligence-guide
description: Guide to Lyra Intel — an intelligence platform for analyzing repositories of any size, from small projects to enterprise monorepos with millions of lines of code. 70+ analysis components including security scanning, AI integration, dependency mapping, and code quality metrics.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, repo-intelligence-guide]
---

# Lyra Intel — Repository Intelligence Guide

Lyra Intel is a deep repository analysis platform with 70+ analysis components. It handles everything from small projects to enterprise monorepos with millions of lines of code.

## Analysis Categories

| Category | Components | What It Checks |
|----------|-----------|---------------|
| **Security** | 12 | Vulnerabilities, secrets, dependencies |
| **Code Quality** | 10 | Complexity, duplication, patterns |
| **AI Readiness** | 8 | AGENTS.md, llms.txt, MCP support |
| **Architecture** | 8 | Structure, coupling, layering |
| **Dependencies** | 7 | Outdated, vulnerable, license issues |
| **Documentation** | 6 | README, API docs, inline comments |
| **Testing** | 6 | Coverage, quality, patterns |
| **Performance** | 5 | Build time, bundle size, hot paths |
| **CI/CD** | 4 | Pipeline quality, deployment |
| **Community** | 4 | Contributing, COC, issue templates |

## Quick Start

```bash
# Install
pip install lyra-intel

# Analyze a repo
lyra-intel analyze https://github.com/nirholas/sperax

# Analyze local directory
lyra-intel analyze ./my-project

# Analyze with specific focus
lyra-intel analyze ./my-project --focus security,ai-readiness
```

## Security Scanning

### What It Detects

| Issue | Severity | Example |
|-------|----------|---------|
| **Hardcoded secrets** | Critical | API keys, private keys in code |
| **SQL injection** | High | Unsanitized database queries |
| **XSS vulnerabilities** | High | Unsafe HTML rendering |
| **Vulnerable deps** | Variable | Known CVEs in node_modules |
| **Insecure crypto** | Medium | Weak hashing algorithms |
| **Path traversal** | High | Unsanitized file paths |
| **SSRF** | High | Unvalidated URLs in requests |

### Example Output
```
Security Score: 87/100

Critical:
  ❌ Hardcoded API key in src/config.ts:15
  ❌ Private key pattern in .env.example

High:
  ⚠️ 3 vulnerable dependencies (npm audit)
  ⚠️ SQL injection in server/queries.ts:42

Medium:
  ℹ️ Missing Content-Security-Policy
  ℹ️ CORS allows all origins
```

## AI Readiness Analysis

Lyra Intel checks how well a repo supports AI agent integration:

| Check | Description |
|-------|-------------|
| **AGENTS.md** | Has AI agent instructions? |
| **CLAUDE.md** | Has Claude-specific guidelines? |
| **llms.txt** | Has machine-readable documentation? |
| **MCP Support** | Has MCP server configuration? |
| **API Surface** | OpenAPI/GraphQL specs available? |
| **Type Safety** | TypeScript/typed language? |
| **Test Coverage** | Enough tests for AI to validate changes? |
| **CI Pipeline** | Automated checks for AI-generated PRs? |

## Architecture Analysis

```
Project Structure Score: 91/100

├── src/
│   ├── app/         ✅ Clear separation (Next.js convention)
│   ├── store/       ✅ Centralized state management
│   ├── services/    ✅ Service layer pattern
│   ├── server/      ✅ Server-side logic separated
│   └── components/  ✅ UI components isolated
├── packages/        ✅ Monorepo packages
└── tests/           ✅ Test directory

Issues:
  ⚠️ 2 circular dependencies detected
  ⚠️ src/utils/ has 45 files (consider splitting)
```

## MCP Server

```json
{
  "mcpServers": {
    "lyra-intel": {
      "command": "lyra-intel",
      "args": ["serve"]
    }
  }
}
```

Tools:
- `analyzeRepo` — Full repo analysis
- `securityScan` — Security-focused scan
- `getScore` — Quick quality score
- `getDependencyReport` — Dependency health
- `getArchitectureMap` — Architecture visualization

## Report Formats

- **Terminal** — Colorful CLI output with score badges
- **JSON** — Machine-readable for CI/CD pipelines
- **Markdown** — GitHub-ready report
- **HTML** — Visual dashboard with charts

## Links

- GitHub: https://github.com/nirholas/lyra-intel
- Lyra Registry: https://github.com/nirholas/lyra-registry
- SperaxOS: https://github.com/nirholas/sperax
