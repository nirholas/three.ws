# 20. Local agent runtime and terminal UI: `three-ws agent`

Read `docs/prompts/README.md` first.

## The problem

Everything an agent does today runs on our servers. There is no way to run a three.ws agent on your own machine or VPS with a real terminal interface, talk to it, let it work on local files and long tasks, and still use the platform's wallet, tools and marketplace through the API. The `three-ws-tty` and `tty-avatar` bins under `packages/` render an avatar in a terminal; `@three-ws/agent-runtime` is the loop the server uses. The strongest open agents ship exactly this: a TUI, sessions, slash commands, subagents, cron, and a gateway process, installable anywhere.

## Build

A new package `packages/agent-cli/` published as `@three-ws/agent`, reachable as `three-ws agent` from the CLI in prompt 01 and as `npx @three-ws/agent`.

- **Runtime:** wraps `@three-ws/agent-runtime` for local execution with the unified MCP endpoint from prompt 17 as its tool source (plus local tools: file read and write, shell in the sandbox from prompt 25, web fetch from the tool gateway in prompt 26). Model access through the account's credits (prompt 16) or any OpenAI-compatible base URL the user sets.
- **TUI:** multiline editor, slash-command autocomplete (`/model`, `/agent`, `/wallet`, `/skills`, `/runs`, `/new`, `/sessions`, `/cron`, `/subagent`, `/help`), streaming tool output, interrupt and redirect, the terminal avatar from `tty-avatar` optional in a pane. Use `ink` or the terminal library already in `packages/`; do not hand-roll a renderer.
- **Sessions:** local SQLite with full-text search over past conversations (`/search`), resume by id, export to JSON.
- **Subagents:** `/subagent <goal>` spawns an isolated child run with its own context and budget, reporting back into the parent.
- **Cron:** `/cron "every weekday 9am" "post the portfolio summary to Telegram"` stores natural-language schedules parsed with a maintained cron-parsing package, executed by a local scheduler or, when the machine is off, by prompt 05 automations on the server (the user picks).
- **Gateway mode:** `three-ws agent gateway` runs the local agent as the backend for the chat gateways in prompts 13 and 24, so messages from Telegram reach the machine the user chose.
- **Install breadth:** Linux, macOS, Windows native (PowerShell installer), WSL, Termux, and a Nix flake; Docker image with a `docker-compose.yml`; a $5 VPS guide.
- **Docs:** `docs/agent-cli.md`, `packages/agent-cli/README.md`, `STRUCTURE.md` row, changelog entry tagged `feature, sdk`.

## Acceptance

- On a clean VPS: install, `three-ws agent`, ask the agent to check its wallet balance and to write a file; both happen.
- `/subagent` runs in parallel with the main session and reports back.
- A cron fires on schedule with the machine on, and hands off to the server when the user picks server mode.
- `npm test` green with TUI component tests and session search tests.
