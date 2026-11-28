# AIBase MCP listing kit

AIBase ([mcp.aibase.com](https://mcp.aibase.com)) is an MCP server directory that gives each server its own page. It only takes remote servers. Submitting is free; the "Cooperation" button on the form is AIBase's paid promotion packages and is not needed.

The submission needs a Google sign-in at AIBase, so the owner files it. Everything below is ready to paste. It takes about two minutes.

## Which server to submit

Submit the free 3D Studio server, `https://three.ws/api/mcp-studio`. It is the only hosted three.ws server that answers a directory crawler without credentials:

- `initialize` returns HTTP 200 with server `three-ws-3d-studio-free` 1.0.1.
- `tools/list` returns 21 tools anonymously. Catalog search, docs search and job status work without an account. Generating, rigging or rendering a model returns a sign-in link until the user signs in (OAuth) or sends a three.ws API key.
- `/api/mcp`, `/api/mcp-3d`, `/api/mcp-agent` and `/api/mcp-bazaar` answer an anonymous call with HTTP 401 and an x402 payment challenge. A directory health check would read that as a broken server, so do not submit them here.

Verified 2026-11-28 with anonymous `initialize` and `tools/list` calls against each endpoint. An empty `Authorization` header (the shape AIBase's own example uses) also returns HTTP 200 on `/api/mcp-studio`.

## Form values

Go to [mcp.aibase.com/submit](https://mcp.aibase.com/submit), choose "Join Now", sign in with Google, then fill in:

- **Name:** `three.ws 3D Studio`
- **Type:** `MCP Server`
- **URL:** `https://three.ws/docs/mcp`
- **MCP logo:** upload `public/pwa-512x512.png` (512x512 PNG, 336 KB, under the 500 KB limit; also served at https://three.ws/pwa-512x512.png).
- **Service Configuration:** paste the JSON below. The form rejects anything without a top-level `type` and a `config.mcpServers` object.

```json
{
  "type": "streamableHttp",
  "config": {
    "mcpServers": {
      "three-ws-3d-studio": {
        "type": "streamableHttp",
        "url": "https://three.ws/api/mcp-studio",
        "headers": {
          "Authorization": ""
        }
      }
    }
  }
}
```

The `Authorization` header is left empty on purpose: the listing shows anyone who copies the config that they can add `Bearer <three.ws API key>` to generate without the OAuth sign-in. Clients that support OAuth (Claude, ChatGPT, Cursor) sign in on their own and ignore the empty value.

Leave **Cooperation** alone and press **Submit**. AIBase answers "Submitted, we'll process it ASAP" and tracks review status under User Center, then My Servers.

## Description, if AIBase asks for one later

AIBase builds the server page from the URL and the live server, but the review sometimes asks for a summary. Use this:

> Free 3D studio over MCP. Turn a text prompt or a photo into a textured 3D model (GLB) or a rigged, animation-ready avatar, auto-rig an existing GLB, refine a model by describing the change, render it from several angles, and search thousands of ready-made CC0 3D assets and motion clips. Every result comes back with a GLB link and a browser viewer link. Catalog and docs search need no account; generating needs a free three.ws account (OAuth sign-in or API key). It never spends money.

## After it is approved

1. Open the AIBase page, confirm it shows the three.ws name, logo and config, and copy its URL.
2. In `data/listings.json`, set the `aibase-mcp` entry to `live` with that URL and the evidence, then run `npm run listings:verify -- --id aibase-mcp` and `npm run listings:build`.
3. Add the row to the MCP Directories table in [listings.md](./listings.md).

## Related directory: MCP Market

The same thread recommends [MCP Market](https://mcpmarket.com). three.ws is already listed there from the public GitHub repo, so nothing needs submitting: [mcpmarket.com/server/three-ws](https://mcpmarket.com/server/three-ws) plus separate pages for the Avatar, Vision, Activity and Copy Trading servers. The pages are unclaimed. Claiming one ("Claim this listing" on the page, signed in as the GitHub owner of `nirholas/three.ws`) lets us edit the copy and categories.
