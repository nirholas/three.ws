---
name: browse-loom
description: Browse the public three.ws Loom gallery of community-forged 3D creations, fetch one with its viewer URL and embed snippet, and submit a GLB to share. Use when a task needs example 3D models, inspiration, or publishing a model to the community feed.
---

# Loom gallery

The `@three-ws/loom-mcp` server wraps the public three.ws Loom API (`/api/loom`). Reads and
submissions need no key and no account.

## Setup

The plugin launches `npx -y @three-ws/loom-mcp`. Optional environment variables:

- `THREE_WS_BASE`: API base URL, default `https://three.ws`. Change it only to target a
  self-hosted or preview deployment.
- `THREE_WS_TIMEOUT_MS`: per-request timeout in milliseconds, default 20000.

## Tools

- `get_loom_feed`: newest-first creations. Optional `limit` (1 to 120, default 60) and `before`
  (a millisecond epoch cursor). Returns `creations`, `count`, `nextBefore` and `has_more`. To page
  back, pass the previous `nextBefore` as `before`; a null `nextBefore` is the end.
- `get_creation`: `id` (a UUID from the feed or a submit result). Returns the full record and
  fails with `not_found` for an unknown id.
- `submit_creation`: `prompt` (required, up to 1000 characters), `glbUrl` (required, an https URL
  on a host the server allows; the tool's error names the allowed domains), and optional
  `author` (free text, up to 40 characters, defaults to `anon`), `previewImageUrl`, `tier`,
  `backend`. Limited to about 20 submissions per hour per IP. Re-posting the same `glbUrl`
  returns the existing creation.

Every creation includes `glbUrl`, `previewImageUrl`, `author`, `tier`, `backend`, `createdAt`,
plus `viewer_url` (orbit and AR viewer), `og_image_url` and a paste-ready `iframe_snippet`.

## Public submissions

A submission is visible to everyone and cannot be edited by this server. Submit only when the
user has asked to share that specific model, and show them the prompt, author text and GLB URL
first. Do not put any secret or personal data in the prompt or author fields.

## Example

1. `get_loom_feed` with `limit: 5` to see recent creations.
2. `get_creation` with one of the returned ids to get its `viewer_url` and `iframe_snippet`.
3. After the user agrees, `submit_creation` with `prompt` and `glbUrl` to publish their own model.
