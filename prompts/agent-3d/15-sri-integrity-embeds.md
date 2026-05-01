---
id: 15-sri-integrity-embeds
title: Add SRI integrity hashes to embed snippet generator (register-ui.js)
area: security
---

# Add SRI Integrity to Embed Snippets

## Problem

`src/erc8004/register-ui.js` line 1648 generates embed snippets that look like:

```html
<script type="module" src="https://three.ws/agent-3d/latest/agent-3d.js"></script>
<agent-3d chain-id="8453" agent-id="42" ...></agent-3d>
```

The `<script>` tag has no `integrity` attribute. This means:
- Any CDN compromise or MITM can silently serve a tampered bundle
- Users embedding `<agent-3d>` have no protection beyond HTTPS

`scripts/publish-lib.mjs` already computes SHA-384 SRI hashes and writes them to
`dist/agent-3d/versions.json` and `dist/agent-3d/{version}/integrity.json`.
The hashes exist — they just aren't being used by the embed generator.

The hash for `/agent-3d/latest/agent-3d.js` changes on every build, so it can't
be hardcoded. It must be fetched at runtime from `/agent-3d/versions.json`.

## Key files

- `src/erc8004/register-ui.js` line 1648 — embed snippet generator
- `dist/agent-3d/versions.json` — manifest written by publish-lib.mjs, structure:
  ```json
  {
    "latest": "1.5.1",
    "channels": {
      "1.5.1": {
        "integrity": {
          "agent-3d.js": "sha384-<base64>",
          "agent-3d.umd.cjs": "sha384-<base64>"
        },
        "immutable": true
      },
      "1.5": { "tracks": ">=1.5.0 <1.6.0" },
      ...
    },
    "publishedAt": "2026-04-29T00:58:16.123Z"
  }
  ```
- `dist/agent-3d/{version}/integrity.json` — per-version sidecar with same hashes

## Tasks — all must be real, no placeholders

### Task 1 — Add a fetchAgentIntegrity helper

In `src/erc8004/register-ui.js`, add a helper function that fetches
`/agent-3d/versions.json` and returns the SRI hash for `agent-3d.js` at the
`latest` channel's pinned version.

Real implementation requirements:
- Use `fetch('/agent-3d/versions.json')` — real network call, no mock
- Parse the JSON response
- Resolve the pinned version: `data.latest` (e.g. `"1.5.1"`)
- Return `data.channels[pinnedVersion].integrity['agent-3d.js']` (e.g. `"sha384-abc..."`)
- If the fetch fails or the field is missing, return `null` (fail open — no integrity attribute is better than a broken embed)
- Cache the result in a module-level variable so repeated opens of the embed modal don't refetch

```js
let _cachedIntegrity = undefined; // undefined = not yet fetched, null = fetch failed

async function fetchAgentIntegrity() {
  if (_cachedIntegrity !== undefined) return _cachedIntegrity;
  try {
    const res = await fetch('/agent-3d/versions.json');
    if (!res.ok) { _cachedIntegrity = null; return null; }
    const data = await res.json();
    const ver = data.latest;
    _cachedIntegrity = data?.channels?.[ver]?.integrity?.['agent-3d.js'] ?? null;
  } catch {
    _cachedIntegrity = null;
  }
  return _cachedIntegrity;
}
```

### Task 2 — Update the embed snippet generator

Find the function in `src/erc8004/register-ui.js` that builds the HTML snippet string
containing the `<script src="...agent-3d.js">` tag (around line 1648).

Make it async and call `fetchAgentIntegrity()`. Update the `<script>` tag:

- If integrity is available:
  ```html
  <script type="module"
    src="https://three.ws/agent-3d/latest/agent-3d.js"
    integrity="sha384-..."
    crossorigin="anonymous"></script>
  ```
- If integrity is null (fetch failed):
  ```html
  <script type="module"
    src="https://three.ws/agent-3d/latest/agent-3d.js"></script>
  ```

`crossorigin="anonymous"` is required for SRI to work on cross-origin resources —
always include it when `integrity` is present.

### Task 3 — Show the integrity hash in the UI

Find the embed modal UI in `src/erc8004/register-ui.js` (wherever it renders the
`<script>` snippet for users to copy). After you make the snippet generation async,
ensure the rendered snippet in the UI reflects the live integrity hash, not a stale one.

If the UI renders a static string synchronously, convert it to update after the async
fetch resolves. The pattern doesn't matter (state update, DOM replace, etc.) — what
matters is the user sees the full `integrity="sha384-..."` in the copyable snippet.

### Task 4 — Test with a real browser

1. Ensure `dist/agent-3d/versions.json` exists and contains a real SRI hash for `agent-3d.js`
   (run `node scripts/publish-lib.mjs` if needed).
2. Start a local server serving the project (or use the dev server).
3. Open the embed modal in `register-ui.js`.
4. Verify the generated `<script>` tag includes `integrity="sha384-..."` and `crossorigin="anonymous"`.
5. Copy the snippet into a standalone HTML file and open it in a browser.
6. In Network tab, confirm the script loads and shows a green integrity check (no errors).
7. Manually change one character in the hash in your test HTML → confirm browser blocks the load with an integrity error.

## Success criteria

- [ ] `fetchAgentIntegrity()` makes a real `fetch('/agent-3d/versions.json')` call
- [ ] Module-level cache prevents duplicate fetches on repeated modal opens
- [ ] Returned hash is the SHA-384 from `versions.json` for the `latest` pinned version
- [ ] Generated `<script>` tag includes `integrity=` and `crossorigin="anonymous"` when hash is available
- [ ] Generated `<script>` tag omits `integrity=` (does not break) when fetch fails
- [ ] User-visible snippet in the UI reflects the live hash, not a hardcoded placeholder
- [ ] Test in browser confirms script loads with integrity validation passing
- [ ] Tampered hash in test HTML → browser blocks load (confirmed manually)

## Do not

- Do not hardcode any SRI hash value — it must come from `versions.json` at runtime
- Do not change `scripts/publish-lib.mjs` — it already computes and writes the correct hashes
- Do not add `integrity=` to the UMD `<script>` fallback tag if one exists — only the ES module tag
- Do not make `fetchAgentIntegrity` retry indefinitely — one attempt, then cache `null` and move on
- Do not break the embed modal if `/agent-3d/versions.json` returns 404 (graceful degradation required)
