# Task: Harden authentication on the MCP endpoint

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

**What exists:**

- `api/mcp.js` — ~40KB file. The MCP (Model Context Protocol) 2025-06-18 endpoint over HTTP. Exposed at `/api/mcp`. Tools: `list_my_avatars`, `get_avatar`, `search_public_avatars`, `render_avatar`, `delete_avatar`, `validate_model`, `inspect_model`, `optimize_model`. Has per-tool rate limits.

**Read `api/mcp.js` in full before starting.** The file is large and complex — understand what it does before making any changes.

**The concern:** MCP endpoints are a common attack vector because:
1. They're designed to be called by AI agents (automated, not human)
2. They operate on behalf of users (accessing their avatars, potentially deleting data)
3. Rate limits need to be tight enough to prevent enumeration and abuse

**Potential issues to look for in the current implementation:**
- Does `delete_avatar` require explicit confirmation or just a single call?
- Are rate limits enforced per authenticated user, or just per IP?
- Does the endpoint validate that the requested avatar belongs to the authenticated user before operating on it?
- Is there a maximum on the `search_public_avatars` result set to prevent bulk enumeration?
- Are error messages informative enough to be useful but not so verbose they leak internals?

---

## What to audit

Read `api/mcp.js` and check for these specific issues:

### 1. Ownership checks on destructive operations

Every tool that modifies or deletes a specific avatar must verify ownership:
```js
// For tools that take an avatar ID:
const avatar = await sql`SELECT owner_id FROM avatars WHERE id = ${avatarId}`;
if (!avatar[0] || avatar[0].owner_id !== userId) {
  return toolError('not_found', 'Avatar not found');
}
```

If this check is missing for `delete_avatar` or `render_avatar` (which could be expensive), add it.

### 2. Per-user rate limits, not just per-IP

MCP clients send an `Authorization: Bearer <api_key>` header. Rate limits should be based on the API key / user ID, not the IP address — otherwise all requests from a shared cloud provider IP share the same bucket.

Check if `limits.authIp` is used (mixes auth+IP) or if there's a separate `limits.authUser`. If limits are IP-only, add a user-level rate limit for authenticated requests.

### 3. delete_avatar guard

Destructive operations should require a confirmation parameter or at minimum log an audit trail:

```js
// In the delete_avatar tool handler:
if (!args.confirm) {
  return toolError('confirmation_required', 
    'Set confirm: true to permanently delete this avatar');
}
// Log the deletion
await sql`INSERT INTO audit_log (user_id, action, resource_id, created_at)
          VALUES (${userId}, 'delete_avatar', ${args.avatarId}, now())`;
```

### 4. Search enumeration limit

`search_public_avatars` should cap results and prevent cursor-based full enumeration by anonymous callers. If unauthenticated, limit to 10 results with no pagination.

### 5. Error message hygiene

MCP tool errors should not expose internal error messages (SQL errors, stack traces). All errors should go through a sanitizer:

```js
function toolError(code, message) {
  return { error: code, error_description: message };
  // Never return e.message from a caught exception directly
}
```

---

## What to fix

After reading the file, fix the specific issues you find. Typical fixes:
- Add ownership checks where missing
- Add `confirm: true` guard to `delete_avatar`
- Add audit log insert for destructive operations (check if `audit_log` table exists in schema; if not, just add a comment noting it's needed)
- Tighten search pagination for unauthenticated callers
- Sanitize error messages

---

## Files to edit

**Edit:**
- `api/mcp.js` — targeted hardening fixes

**Do not touch:**
- The MCP protocol framing (request/response format)
- Any tool that doesn't have a security issue
- Rate limit configuration for non-destructive read tools

---

## Acceptance criteria

1. `DELETE_AVATAR` with no `confirm` parameter returns an error asking for confirmation.
2. Requesting another user's avatar via any tool returns `not_found` (not `forbidden` — don't leak the existence of other users' avatars).
3. Rate limits are enforced per user (not just per IP) for authenticated requests.
4. `search_public_avatars` without authentication returns at most 10 results.
5. No SQL error messages appear in MCP tool responses.
6. `npx vite build` passes. `node --check api/mcp.js` passes.
7. Existing MCP tool functionality is unaffected for legitimate authenticated use.

## Constraints

- Surgical changes only — this is a security hardening pass, not a refactor.
- Don't change the tool names, input schemas, or output shapes — MCP clients depend on these.
- Don't add new tools in this task.
- Follow the API pattern in `api/CLAUDE.md` for any new DB queries.
