# cursor.directory MCP listing submission

Target: `https://cursor.directory/mcp`.

Re-verified 2026-11-14: cursor.directory still returns HTTP 429 to scripted fetches (homepage, /mcp, robots.txt),
so the live site could not be read. The mechanism is now confirmed from the source repo instead
(`https://github.com/pontusab/cursor.directory`, not archived, 4024 stars, last push 2026-11-05): its README says
all content is submitted through the website, no pull requests. Submission is a plugin: sign in with GitHub or
Google at `https://cursor.directory/plugins/new`, paste a GitHub repo URL, and the site auto-detects components
(an MCP server comes from a `.mcp.json` in the repo). Submissions are auto-scanned by an agent. This repo
already has a root `.mcp.json` and `mcp-server/plugins/three-ws-mcp-server/.mcp.json`. The older `/mcp`
submit-button idea is superseded.

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

1. In a real browser, open `https://cursor.directory/plugins/new` and sign in with GitHub or Google.
2. Paste `https://github.com/nirholas/three.ws` (or the plugin subfolder repo URL if the form wants a plugin
   root) and submit. Use the listing copy above for any name or description field it asks for.
3. Wait for the automated scan verdict; fix anything it flags.
