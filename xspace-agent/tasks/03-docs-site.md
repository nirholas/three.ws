# Task 03: Documentation Site

## Context
There are 43 markdown files in `docs/` covering architecture, deployment, API reference, and more. These need to be turned into a searchable, navigable documentation website.

## Requirements

### Setup
- Use **VitePress** (Vue-based static site generator, best for technical docs)
- Initialize in `docs/` directory: `npx vitepress init`
- Configure in `docs/.vitepress/config.ts`
- Add scripts to root `package.json`:
  ```json
  "docs:dev": "vitepress dev docs",
  "docs:build": "vitepress build docs",
  "docs:preview": "vitepress preview docs"
  ```

### Theme & Branding
- Use VitePress default theme with custom CSS overrides to match the landing page aesthetic
- Dark mode as default (with toggle)
- Custom colors matching design tokens: primary `#6366f1`, bg `#060606`
- Add the xspace logo to the nav bar
- Custom hero on the docs home page with "Get Started" and "View on GitHub" buttons

### Navigation Structure
Read all 43 docs and organize into this sidebar structure:

```
Getting Started
  ├── Introduction
  ├── Quick Start
  ├── Installation
  └── Configuration

Core Concepts
  ├── Architecture Overview
  ├── Agent Lifecycle (FSM)
  ├── Audio Pipeline
  ├── Provider System
  └── Intelligence Layer

Guides
  ├── Your First Agent
  ├── Multi-Agent Teams
  ├── Custom Providers
  ├── Middleware & Plugins
  ├── Browser Automation
  └── Deployment

API Reference
  ├── XSpaceAgent
  ├── AgentTeam
  ├── BrowserLifecycle
  ├── AudioPipeline
  ├── ConversationManager
  ├── SelectorEngine
  └── Configuration Options

Packages
  ├── xspace-agent (core)
  ├── @xspace/server
  ├── @xspace/cli
  └── @xspace/widget

Examples
  ├── Basic Join
  ├── Multi-Agent Debate
  ├── Discord Bridge
  └── [all 10 examples]

Contributing
  ├── Development Setup
  ├── Architecture Decisions
  └── Release Process
```

### Content
- Add frontmatter (title, description) to every doc that's missing it
- Add a "Edit this page on GitHub" link to every page footer
- Add prev/next navigation between pages
- Ensure all code blocks have language tags for syntax highlighting
- Add copy buttons to all code blocks (VitePress has this built-in)
- Cross-link between docs where references exist

### Search
- Enable VitePress built-in local search (MiniSearch)
- Or configure Algolia DocSearch if an API key is available (check env)

### Deployment
- Add a GitHub Actions workflow at `.github/workflows/docs.yml` that:
  - Builds docs on push to `main` when `docs/**` changes
  - Deploys to GitHub Pages
- Add `docs/.vitepress/dist` to `.gitignore`

## Files to Create
- `docs/.vitepress/config.ts`
- `docs/.vitepress/theme/index.ts` (custom theme extension)
- `docs/.vitepress/theme/custom.css`
- `docs/index.md` (home page)
- `.github/workflows/docs.yml`

## Files to Modify
- `package.json` (add docs scripts)
- `.gitignore` (add docs build output)
- All 43 files in `docs/` (add frontmatter, fix links)

## Acceptance Criteria
- [ ] `npm run docs:dev` starts a local docs server
- [ ] All 43 existing docs are accessible and properly categorized
- [ ] Search works and returns relevant results
- [ ] Mobile responsive with hamburger nav
- [ ] Dark mode matches project aesthetic
- [ ] Code blocks have syntax highlighting and copy buttons
- [ ] GitHub Pages deployment works via CI


