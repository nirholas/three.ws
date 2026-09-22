# 23. three.ws inside every agent framework: distributions, plugins and skins

Read `docs/prompts/README.md` first.

## The problem

The Claude plugin marketplace exists (`.claude-plugin/marketplace.json`) and `.mcp.json` shows the manual path. Nothing else meets users inside the agent they already run. The most effective growth pattern in this space is a downstream distribution of a popular open-source agent with the platform pre-wired: one command, the platform's theme, the skill installed, the MCP authorized.

## Build

For each of Claude Code, Codex CLI, Gemini CLI, Hermes Agent, OpenHands, Goose, Cline and Continue:

- A first-class install path: plugin, extension, or config recipe, whichever the framework supports, published where that framework's users look (its marketplace or registry), that installs the unified MCP endpoint from prompt 17, the model-facing skill from prompt 03, and the setup command from prompt 01.
- Where the framework supports distributions or skins (Hermes-style), publish `three-ws-agent` as a downstream distribution repository under the `nirholas` org: upstream unchanged, our MCP and skill pre-wired, our theme default, `<agent> three-ws setup` and `<agent> three-ws login` subcommands, with upstream credit and license preserved. Keep it in sync with upstream through a scheduled Cloud Build job, never GitHub Actions.
- Each distribution has a README with the one-line install, and the platform's `/install` page (in `data/pages.json`) lists every framework with its command, detecting the visitor's likely client.
- Docs: `docs/install-everywhere.md` linked from `docs/start-here.md` and `docs/mcp.md`; changelog entry tagged `feature, docs`.

## Acceptance

- Each framework, from a clean install, reaches a three.ws tool call in under two minutes following only the README.
- The distribution repository builds and tracks upstream automatically.
- Repository creation and publishing are push-gated: prepare everything and list the commands.
