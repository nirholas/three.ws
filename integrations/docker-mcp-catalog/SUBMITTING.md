# Submitting three.ws to the Docker MCP Catalog

Remote servers are listed through a pull request to <https://github.com/docker/mcp-registry> that adds `servers/three-ws/`. Format per that repository's `CONTRIBUTING.md` ("Adding a Remote MCP Server") and the accepted `servers/notion-remote` and `servers/linear` entries, checked 2026-11-28 at docker/mcp-registry `7acac06`.

| Field | Value |
| --- | --- |
| Server name | `three-ws` |
| Title | Three.ws (Docker's validator requires every title word to start with a capital) |
| Category | `ai` |
| Remote | `https://three.ws/mcp`, `streamable-http` |
| Auth | OAuth 2.1, dynamic client registration, PKCE (`oauth.provider: three-ws`, so `dynamic.tools: true`) |
| Icon | `https://three.ws/three-ws-mcp-icon.svg` (served as `image/svg+xml`) |
| License | Apache-2.0 |

## What was validated (2026-11-28)

- Docker's `cmd/validate --name three-ws`: every check passes (name, directory, title, prettier YAML, secrets, icon SVG, remote, OAuth dynamic tools).
- `cmd/build --tools three-ws`: skipped as a remote server, exit 0. `cmd/catalog three-ws` writes a valid test catalog.
- Docker's gateway discovery code (`mcp-gateway-oauth-helpers` `DiscoverOAuthRequirements`, run against production): finds the authorization server, the registration endpoint and PKCE, and **0 scopes**. Against a local server with the `bearerChallenge` fix, its challenge parser reads all 17 advertised scopes. See README "The scope requirement".
- Our registration endpoint accepts Docker's `http://127.0.0.1:{port}/callback` redirect, and authorization matches loopback redirects on any port (RFC 8252 §7.3).

## Owner steps

1. **Deploy first.** The `api/_mcp/auth.js` challenge fix must be live, or a Docker reviewer signs in and gets an `avatars:read` token. `npm run check:integrations -- docker-mcp-catalog` passes only once it is.
2. Run `integrations/docker-mcp-catalog/submit.sh`. It forks docker/mcp-registry to your GitHub account, adds the entry on branch `add-three-ws`, runs Docker's validator, pushes to the fork and opens the pull request with [PR_BODY.md](./PR_BODY.md). It prints each step and asks before pushing.
3. Optional: if a reviewer asks for a test account, send one through Docker's form (<https://forms.gle/6Lw3nsvu2d6nFg8e6>). None is required: the OAuth sign-in page links to free registration.
4. After it merges, flip the `docker-mcp-catalog` entry in `data/listings.json` to `live` with the Docker Hub URL and run `npm run listings:build`.
