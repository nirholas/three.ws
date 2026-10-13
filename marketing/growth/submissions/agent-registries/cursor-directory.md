# cursor.directory MCP listing submission

Target: `https://cursor.directory/mcp`.

Not fully confirmed: cursor.directory rate-limited (HTTP 429) every direct fetch attempted in this session
(both the homepage and a guessed `/submit` path, via `curl` and via `WebFetch`), so the exact current
submission mechanism (a form, a GitHub repo PR, or an account-gated dashboard) could not be verified live.
cursor.directory is a community-run directory (not an official Cursor/Anysphere product); its public
listings historically accept submissions either through a logged-in "Submit" button on the site or through
its companion GitHub repo, but which applies today is unconfirmed as of 2026-10-13. Flagging this
transparently rather than guessing at a mechanism this session couldn't verify.

## What ships (listing copy, ready to paste into whichever form the owner finds)

- Name: three.ws
- Category: 3D / Generative AI
- URL: https://three.ws
- Description: "Forge a textured 3D model from a text prompt, auto-rig it for animation, and render a
  turntable preview, all through one free MCP server. No API key required."
- MCP connection (streamable HTTP, no auth): `https://three.ws/api/mcp-studio`
- Config snippet:
  ```json
  {
    "mcpServers": {
      "three-ws": {
        "url": "https://three.ws/api/mcp-studio"
      }
    }
  }
  ```

## Owner steps (not automatable here)

1. Visit `https://cursor.directory/mcp` directly (not rate-limited from a real browser session) and locate
   the current submission entry point.
2. Paste the listing copy above into whatever form or PR process it presents.
