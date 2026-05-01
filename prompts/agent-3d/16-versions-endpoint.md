---
id: 16-versions-endpoint
title: Add /api/agent-3d/versions API endpoint and live version badge
area: api
---

# Add /api/agent-3d/versions API endpoint

## Problem

`dist/agent-3d/versions.json` is a static file deployed with the CDN bundle.
It is only updated when `npm run publish:lib` runs and Vercel redeploys.

There is no programmatic way for client-side code to:
- Know what version is currently live without fetching the static file
- Get the current SRI hash for use in embed code
- Check if a user's pinned version is still supported

Additionally, the dashboard and docs pages have no live version badge — users
cannot see which version of `agent-3d` is deployed without reading source code.

## Goal

1. Create a Vercel serverless API route `/api/agent-3d/versions` that reads
   `dist/agent-3d/versions.json` and returns it with proper CORS and cache headers.
2. Add a small version badge component to `public/dashboard/dashboard.js` that
   fetches this endpoint and displays the current version.
3. Ensure the endpoint is registered in `vercel.json`.

## Key files

- `dist/agent-3d/versions.json` — source of truth; structure:
  ```json
  {
    "latest": "1.5.1",
    "channels": {
      "1.5.1": { "integrity": { "agent-3d.js": "sha384-..." }, "immutable": true },
      "1.5": { "tracks": ">=1.5.0 <1.6.0" },
      "1":   { "tracks": ">=1.0.0 <2.0.0" },
      "latest": { "tracks": "*" }
    },
    "publishedAt": "2026-04-29T00:58:16.123Z"
  }
  ```
- `api/` directory — where Vercel serverless functions live (check existing files for conventions)
- `vercel.json` — routes config; existing `/agent-3d/versions.json` static route is at line 257
- `public/dashboard/dashboard.js` — single-file app, no framework

## Tasks — all must be real, no placeholders

### Task 1 — Examine the api/ directory structure

Read several existing files under `api/` to understand:
- Are they CommonJS (`module.exports`) or ESM (`export default`)?
- What is the typical export signature? (`(req, res) => void` or `Request => Response`?)
- Are there shared utilities (CORS headers, auth middleware) you should reuse?

Match the existing convention exactly in the new endpoint.

### Task 2 — Create api/agent-3d/versions.js (or .ts)

Create a Vercel serverless function at `api/agent-3d/versions.js` (use `.ts` if the
rest of `api/` uses TypeScript).

The handler must:

1. Read `dist/agent-3d/versions.json` from the filesystem using `node:fs` (`readFileSync`
   or `readFile`). The file path relative to the project root is `dist/agent-3d/versions.json`.
   Use `process.cwd()` or `path.resolve(__dirname, '../../dist/agent-3d/versions.json')`
   to get an absolute path — do not hardcode `/workspaces/3D-Agent/…`.

2. Parse the JSON. If the file does not exist or cannot be parsed, return:
   ```json
   { "error": "versions.json not found — run npm run publish:lib" }
   ```
   with status 503.

3. Return the parsed JSON with status 200 and these headers:
   ```
   Content-Type: application/json
   Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300
   Access-Control-Allow-Origin: *
   Access-Control-Allow-Methods: GET, HEAD, OPTIONS
   ```

4. Handle `OPTIONS` preflight: return 204 with the same CORS headers.

### Task 3 — Register the route in vercel.json

Add a route entry in `vercel.json` for the new endpoint. Place it **before** the
existing static `/agent-3d/versions.json` route (line 257) so the API takes priority:

```json
{
  "src": "/api/agent-3d/versions",
  "dest": "/api/agent-3d/versions"
}
```

Do not change or remove the existing static route.

### Task 4 — Add a version badge to the dashboard

In `public/dashboard/dashboard.js`, find where the page header or sidebar is rendered
(search for `document.querySelector` calls that set header/nav content, or look for
where the agent name or version is displayed).

Add a small badge that:
1. Calls `fetch('/api/agent-3d/versions')` on page load
2. Parses the response to get `data.latest` (e.g. `"1.5.1"`)
3. Creates a DOM element (a `<span>` or `<a>`) with text `v1.5.1` linking to
   `https://three.ws/agent-3d/versions.json`
4. Appends it near an appropriate location (footer, header, or the agent preview section)
5. If the fetch fails, renders nothing — no broken UI

Use only native DOM APIs (no framework). The dashboard is a plain JS single-file app.

### Task 5 — Test locally

1. Run `node scripts/publish-lib.mjs` to ensure `dist/agent-3d/versions.json` exists.
2. Start a local Vercel dev server: `npx vercel dev`
3. Hit `http://localhost:3000/api/agent-3d/versions` in the browser or with curl.
4. Verify: status 200, content-type `application/json`, body contains `latest` field.
5. Open `http://localhost:3000/dashboard` and confirm the version badge appears.
6. Delete `dist/agent-3d/versions.json` temporarily and confirm the endpoint returns 503
   with the error message, not a crash.

## Success criteria

- [ ] `api/agent-3d/versions.js` (or `.ts`) exists and matches the existing api/ convention
- [ ] Returns real JSON from `dist/agent-3d/versions.json` (not hardcoded)
- [ ] Returns 503 with clear error message if the file is missing
- [ ] Returns correct CORS and cache headers on 200 responses
- [ ] Handles OPTIONS preflight with 204
- [ ] Route registered in `vercel.json` before the static fallback
- [ ] Version badge appears in the dashboard and shows the live version number
- [ ] Badge gracefully renders nothing if the fetch fails
- [ ] `npx vercel dev` serves the endpoint at `/api/agent-3d/versions` with a real response

## Do not

- Do not hardcode the version string anywhere — always read from `versions.json`
- Do not use any npm packages not already in `package.json` — use only Node built-ins and Vercel runtime
- Do not return HTML from the API endpoint — JSON only
- Do not change the static `/agent-3d/versions.json` route in vercel.json — both should coexist
- Do not add authentication to this endpoint — version info is public
