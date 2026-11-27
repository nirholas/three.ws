# 458 grok-fix-08: All six Grok examples and a Grok Build model turn, passing live

**How to run:** paste this whole file into a fresh Claude Code chat opened at `/home/nich/three.ws`. Read `CLAUDE.md` before step 0.

**Operating clause (binding):** finish 100% in this session; do not ask the owner questions; no mocks, fake data, TODOs or stubs; never write the em-dash or en-dash character; bug fixes are test-first; stage explicit paths only and commit promptly with a message that describes the diff. Deploys and pushes are owner-gated: this order never deploys. This order is independent of orders 451 to 457; it does not wait for the production deploy.

**Dev server port:** `npm run dev -- --port 4458 --strictPort`. Never take port 3000.

## Why

On 2026-11-27, with the owner's key, four of the six examples in `examples/grok-*` passed live (`grok-node-responses`, `grok-x-search-to-3d`, `grok-agent-avatar`, `grok-build-workflow`) and two failed:

- `grok-curl` (`examples/grok-curl/run.sh`): production answered xAI with the tool-schema 400 (fixed on `main` in `a99f32c10`, not deployed), and then `run.sh` crashed inside `jq` parsing xAI's error body instead of printing it.
- `grok-python-mcp`: the same 400, and the devbox lacks `python3-venv`.

Separately, the Grok Build plugin (`integrations/grok/three-ws`) was installed and its MCP connection checked, but no Grok model turn ever ran through it ("No GROK_API_KEY on this machine, so no model turn was run"). Public copy has claimed Grok Build works; this order makes that true or records exactly why not.

## The xAI key

The owner's key is in `~/.config/three-ws/xai-local.key` (chmod 600, outside the repo). Pass it to one command at a time: `XAI_API_KEY="$(cat ~/.config/three-ws/xai-local.key)" <command>`. Never print it, never copy it into the repo, a `.env` file, a doc, a log, a README capture, Secret Manager or Cloud Run, never run `npm run setup:xai-key`. Users must not be able to spend these credits. Proof-sized runs only (each example once, plus reruns after a fix). If the file is missing, do every step that does not need it and say so in one line.

## Step 0

1. `git log --oneline -8 -- examples/ scripts/grok-examples-smoke.mjs integrations/grok` and read `examples/README.md` if it exists, `scripts/grok-examples-smoke.mjs` and each `examples/grok-*/README.md`.
2. Is production fixed? Run:
   ```bash
   curl -s https://three.ws/api/mcp-studio -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s.replace(/^data: /m,""));console.log(m.result.tools.filter(t=>{const r=t.inputSchema||{};return r.type!=="object"||["anyOf","oneOf","allOf","not","if","then","else","enum","const"].some(k=>k in r)}).map(t=>t.name))})'
   ```
   `[]` means production is fixed: run the examples against production. Anything else means xAI's cloud must reach a fixed server some other way: use a public tunnel to a local dev server on `main` (task 2).
3. `dpkg -s python3-venv >/dev/null 2>&1 || sudo apt-get install -y python3-venv` (passwordless sudo works on the devbox).

## Tasks

1. **`grok-curl` survives an xAI error.** Test first: add a case to the smoke suite (or a small `tests/grok-curl-errors.test.js` that runs `run.sh` against a local node:http server answering xAI's documented error body `{"code":"invalid_client_tool_schema","error":"..."}` with HTTP 400, using an `XAI_BASE`-style override if the script has one; add the override if it does not, defaulting to `https://api.x.ai/v1`). Confirm it fails (the `jq` crash). Fix `run.sh` to check the HTTP status and an `error` field before reading output items, print `error    xAI answered HTTP <status>: <message>` and exit 1. Rerun.
2. **A public URL for a fixed server, when production is not fixed.** xAI calls remote MCP from its cloud, so `localhost` is unreachable. Start the dev server on port 4458, then open a quick tunnel: install `cloudflared` from its official GitHub release `.deb` if missing (free, no account for `trycloudflare.com` quick tunnels) and run `cloudflared tunnel --url http://localhost:4458`. Confirm `tools/list` through the tunnel URL returns `[]` rejected roots with the step 0.2 check. Point the examples at it with their documented override env vars (`THREE_WS_MCP_URL`, `THREE_WS_API`, or whatever each README names; add an override to any example that hardcodes the production URL, defaulting to production). Stop the tunnel when done; never leave it running.
3. **Run all six live.** `XAI_API_KEY="$(cat ~/.config/three-ws/xai-local.key)" npm run grok:examples-smoke` (with the overrides from task 2 if needed; extend the smoke script to pass a base URL through if it cannot). Every example must pass. Each failure is a real bug: reproduce, fix test-first, rerun. Replace each README's captured output with the real capture from this run (mask the key and any account token; never invent output). Note in each README the date and whether it ran against production or a tunnel.
4. **Grok Build model turn.** Install the Grok Build CLI per xAI's docs (`https://docs.x.ai/build/` and the pages linked from `pages/grok.html`'s source note; fetch `.md` variants). Install the plugin from this repo: `grok plugin install ./integrations/grok/three-ws --trust` (or the headless form in `integrations/grok/three-ws/README.md`: `grok agent --no-leader --plugin-dir ./integrations/grok/three-ws stdio`). Point its MCP server at production if fixed, otherwise at the tunnel. Authenticate the CLI with the local key through the environment only. Run one real model turn that calls a three.ws tool (for example "find a wooden chair in the three.ws catalog and show me its viewer link") and capture the transcript. If Grok Build cannot authenticate with an API key at all (for example it requires an interactive subscription login), record the exact message and the doc URL that says so, and run the same turn through the headless `grok agent ... stdio` path if that accepts a key. Add the real capture to `integrations/grok/three-ws/README.md` (key masked), dated.
5. **Docs and changelog.** If an example changed behaviour or gained an override, its README says so. Append one `data/changelog.json` entry if users of the examples would notice (tags `fix` or `docs`, link `/grok#build-examples`), then `npm run build:pages`.
6. `npm test` once before close-out. `git grep -nE "xai-[A-Za-z0-9]{20,}"` prints nothing.

## Definition of done

- [ ] `grok-curl` exits cleanly with xAI's message on an error body; its test failed before and passes after.
- [ ] All six examples pass live with the local key, against production or a tunnel to `main`, with real captures in their READMEs.
- [ ] A real Grok Build model turn called a three.ws tool, captured in the plugin README, or the exact documented reason it cannot run on an API key.
- [ ] No tunnel or dev server left running; nothing deployed or pushed; key nowhere in the repo.
- [ ] One entry appended to `prompts/finish/_context/grok-fix-PROGRESS.md`.

## Never blocked

- `cloudflared` download blocked: try `npx localtunnel --port 4458` or `ssh -R 80:localhost:4458 nokey@localhost.run`; any free public tunnel that needs no account will do.
- An xAI outage: retry once after 60 s; check `https://status.x.ai`; record and continue with the rest.
- The dev server will not start: read its error, fix the root cause if it is in your path, otherwise run `node server/index.mjs` with `PORT=4458`.

## Report format

Each example and the Grok Build turn: PASS/FAIL, target (production or tunnel), one line of evidence. Bugs fixed with their tests. Commit hashes.
