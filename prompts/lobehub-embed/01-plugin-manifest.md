# Task 01 — LobeHub plugin manifest for three.ws

## Context

Repo: `/workspaces/3D`. LobeHub is the primary host-integration target (see [series README](./README.md)). A LobeHub plugin is defined by a JSON manifest that LobeHub's plugin loader fetches from a public URL. The manifest declares:

- Plugin identity (name, author, homepage, version, description, tags)
- The UI surface — an iframe URL that LobeHub renders inside a chat message
- Optional API surface — tool schemas the chat model can call

Our iframe page already exists: [public/agent/embed.html](../../public/agent/embed.html). It renders a GLB avatar, attaches [AgentAvatar](../../src/agent-avatar.js) (the Empathy Layer), and exposes a `postMessage` bridge. This task wraps it into a LobeHub-compatible plugin.

We already publish an A2A-style card at `.well-known/agent-card.json` ([agent-card.json](../../public/.well-known/agent-card.json)) which enumerates the skills we expose. Do **not** assume LobeHub auto-consumes that — the plugin manifest is a separate format.

## Goal

Produce a LobeHub plugin manifest, hosted at a stable public URL under this deployment, that lets any LobeHub instance install the three.ws plugin and get an embodied avatar in chat.

## Deliverable

1. **Manifest file** at `public/.well-known/lobehub-plugin.json` (served at `https://<host>/.well-known/lobehub-plugin.json`) that declares:
    - `identifier` — kebab-case, e.g. `3d-agent`
    - `meta` — `{ title, description, avatar, tags }`
    - `author`, `homepage`, `version` (read from `package.json`'s version at build if trivial; otherwise hard-code `0.1.0` and note)
    - `ui.url` — absolute URL to our iframe (e.g. `https://<host>/agent/{AGENT_ID}/embed?host=lobehub`). Use a placeholder token if LobeHub supports runtime interpolation; otherwise require the user to edit.
    - `ui.height` — default iframe height (e.g. `520`)
    - `api` — tool schemas the chat model can call, each with `name`, `description`, `parameters` (JSON Schema). Start with:
        - `render_agent({ agentId })` — mount the avatar for a given agent id
        - `speak({ text, sentiment? })` — make the avatar speak with emotional valence
        - `gesture({ name, duration? })` — trigger a named gesture (wave, nod, point, shrug)
        - `emote({ trigger, weight? })` — inject an emotion (`concern`, `celebration`, `patience`, `curiosity`, `empathy`)
    - `systemRole` — optional priming text so the LobeHub chat model knows an embodied agent is present
2. **Vercel route** — add a route to `vercel.json` that serves the manifest with `Content-Type: application/json` and `Cache-Control: public, max-age=300`. Place the route in the existing `.well-known/*` block if present; otherwise add it grouped with other well-known entries.
3. **Served copy for discovery** — if LobeHub reads from `.well-known/` specifically, no extra work. If not, also link it from the top of `.well-known/agent-card.json` via a non-breaking `lobehub_plugin_url` field.

## Audit checklist

- `identifier` must be URL-safe, lowercase, stable — do **not** regenerate per request
- Every `api.*.parameters` JSON Schema must validate with a standard validator (`ajv`) — test this mentally, don't ship broken schemas
- `ui.url` must resolve to the embed page, not the top-level agent page. The embed page handles transparent-bg and hides UI chrome.
- The manifest must be a static JSON file — no runtime generation. LobeHub may cache it aggressively.
- `tags` include: `3d`, `avatar`, `agent`, `embodied`, `empathy`, `erc-8004`
- If the LobeHub spec requires a field we're unsure about (e.g. `openapi` link vs. inline `api` array, `locale` mapping), **flag it in a top-of-file comment** with "// TODO(lobehub-spec): confirm against https://lobehub.com/docs/usage/plugins/development" rather than guessing.

## Constraints

- **No new runtime dependencies.** The manifest is static JSON.
- Do **not** hard-code a specific agent id. The plugin is generic; per-agent binding happens via the handshake (see [02-iframe-handshake.md](./02-iframe-handshake.md)).
- Do **not** disable the Empathy Layer in the embed. The plugin's whole value is embodied emotion.
- Keep the manifest small — LobeHub will render its description in its plugin marketplace UI.

## Verification

1. `node --check` is not applicable (JSON). Run `node -e "JSON.parse(require('fs').readFileSync('public/.well-known/lobehub-plugin.json','utf8'))"` to confirm parseable.
2. `npx vite build` succeeds and copies the file to `dist/.well-known/lobehub-plugin.json`.
3. `curl -I https://localhost:5173/.well-known/lobehub-plugin.json` (or deployed URL) returns `Content-Type: application/json`.
4. Load it in a LobeHub dev instance — see [05-plugin-submission.md](./05-plugin-submission.md) for the full flow. For this task, you may stop at schema validity.
5. `ajv validate` each `api.*.parameters` against its own schema with a sample payload.

## Scope boundaries — do NOT do these

- Do **not** implement the `postMessage` handshake inside the embed. That is task [02](./02-iframe-handshake.md).
- Do **not** implement host auth. That is task [03](./03-host-auth-handoff.md).
- Do **not** wire the tool-call relay. That is task [04](./04-action-passthrough.md).
- Do **not** package or submit to the marketplace. That is task [05](./05-plugin-submission.md).
- Do **not** modify [src/element.js](../../src/element.js) — that is the browser-native web component, unrelated to LobeHub plugin surface.

## Files off-limits

- [public/agent/embed.html](../../public/agent/embed.html) — task 02 owns the handshake code inside it
- `public/.well-known/agent-card.json` — only add the non-breaking `lobehub_plugin_url` field if explicitly needed; do not restructure

## Reporting

- Path + line count of the manifest file
- The vercel route block added (verbatim)
- Any field you flagged as "confirm against current LobeHub docs" — enumerate each
- `ajv` results for each tool parameter schema
- Whether `vite build` copies `.well-known/` to `dist/` (it should; if not, flag it)
- Any unrelated bugs noticed — note, don't fix
