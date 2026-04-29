# Task 04: README Overhaul

## Context
The README is the #1 factor in whether an open-source project goes viral. It needs to communicate "what this is" and "why you should care" within 5 seconds of landing on the GitHub page.

## Requirements

### Hero Section (above the fold)
```markdown
<!-- Centered banner image: dark gradient with logo + "xspace" wordmark -->
<p align="center">
  <img src="docs/assets/banner.png" width="600" alt="xspace — AI agents that talk in X Spaces">
</p>

<p align="center">
  <!-- Badges row -->
  npm version | license MIT | CI passing | node 18/20/22 | PRs welcome
</p>

<p align="center">
  <b>Open-source TypeScript SDK for AI agents that autonomously join, listen, and speak in X Spaces.</b>
</p>
```

### Demo GIF/Video
- Create or add a placeholder for a 15-20 second GIF showing:
  1. Running `npx create-xspace-agent`
  2. Agent joining a Space
  3. Agent speaking in the Space
  4. The admin dashboard showing the conversation
- Place at `docs/assets/demo.gif`
- If a real recording isn't available, create a terminal recording using `asciinema` or `vhs` showing the CLI flow

### Quick Start (must be copy-pasteable)
```markdown
## Quick Start

# Create a new project
npx create-xspace-agent my-agent
cd my-agent

# Add your credentials
cp .env.example .env
# Edit .env with your X auth tokens + AI API key

# Start your agent
npm start
```

### Feature Grid
A clean table or grid showing key capabilities:
- Multi-LLM (OpenAI, Claude, Groq)
- Real-time voice (STT + TTS)
- Multi-agent teams
- Self-healing browser automation
- Plugin middleware system
- Docker + monitoring ready

### Architecture Diagram
Convert the ASCII diagram from CLAUDE.md into a clean Mermaid diagram or a rendered SVG image. Place at `docs/assets/architecture.svg`.

### Sections (in order)
1. Hero + badges
2. One-line description
3. Demo GIF
4. Quick Start
5. Feature grid
6. Architecture diagram (collapsible `<details>`)
7. Usage examples (3 short code snippets: basic agent, multi-agent team, custom provider)
8. Packages table (core, server, cli, widget with npm badges)
9. Provider support table (LLM, STT, TTS with checkmarks)
10. Documentation link
11. Examples list (link to each of the 10 examples)
12. Contributing section (short, links to CONTRIBUTING.md)
13. License
14. Star history chart (use `star-history.com` embed)

### Create Assets
- `docs/assets/banner.png` — 1200x400 dark gradient with logo and tagline. Can be generated with a simple HTML template + screenshot, or as an SVG.
- `docs/assets/architecture.svg` — Clean rendered architecture diagram

### Tone
- Confident but not arrogant
- Developer-friendly, not corporate
- Show, don't tell — code examples over marketing copy
- No "revolutionary", "game-changing", or "blazing fast" — let the features speak

## Files to Create
- `docs/assets/banner.png` or `.svg`
- `docs/assets/architecture.svg`
- `docs/assets/demo.gif` (placeholder with instructions if no recording available)

## Files to Modify
- `README.md` — complete rewrite

## Acceptance Criteria
- [ ] README renders correctly on GitHub (test in preview)
- [ ] All badges link to correct URLs and show live status
- [ ] Quick Start actually works when followed step by step
- [ ] No broken images or links
- [ ] Fits on ~2 screens of scrolling (not a wall of text)
- [ ] Architecture diagram is readable on both light and dark GitHub themes
- [ ] Mobile GitHub renders correctly (no broken tables)


