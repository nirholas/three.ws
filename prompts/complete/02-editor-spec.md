# 02 — EDITOR_SPEC.md

## Why

[specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) references a future `EDITOR_SPEC.md` that never got written. The editor surface (`src/editor/*`, `public/studio/`, the `agent-edit.html` route) is 90% shipped but has no public contract. Writing the spec freezes the interface so downstream integrations (Studio, CLI, external hosts) can depend on it.

**This is a documentation-only task.** No code changes.

## What to write

Create [specs/EDITOR_SPEC.md](../../specs/EDITOR_SPEC.md) covering:

### 1. Identity

- Format ID: `agent-editor/0.1`
- Stability: draft
- Relationship to `EMBED_SPEC` (the embed plays, the editor writes)

### 2. Attached editor contract

Document how `<agent-3d editor>` activates the editor panel. List every editor-only attribute that exists on [src/element.js](../../src/element.js) — read the file and enumerate them. Required and optional attrs.

### 3. Editor panels (one subsection each)

Walk [src/editor/](../../src/editor/) and document each panel's public interface:
- `material-editor.js` — what it edits, what events it fires, what state it owns.
- `scene-explorer.js` — tree shape, selection semantics, mesh visibility toggle.
- `texture-inspector.js` — read-only? mutating? export path.
- `glb-export.js` — export format, options, what's included vs. stripped.
- `publish.js` — R2 presign flow, API endpoints called, auth requirements.

For each: inputs (what data it reads), outputs (what it writes), events (bus or DOM), and failure modes.

### 4. Permission model

- Who can edit which fields (anonymous / authed / owner-only).
- How the editor checks ownership (reference [src/account.js](../../src/account.js) + `/api/auth/me`).
- What happens on save for an unauthed user (redirect → `/login?next=...`).

### 5. Events

Table of CustomEvents emitted on the editor host — names, detail shapes, when they fire. Mirror the style of the protocol-bus table in [src/CLAUDE.md](../../src/CLAUDE.md).

### 6. Extension points

- Custom panels — how a third-party dev would add one.
- Custom exporters — shape of the exporter plugin contract (even if you recommend against doing it today, document the seam).

### 7. Security

- What's sanitized before upload (see `api/avatars/presign` + `api/avatars` — read them, don't speculate).
- Max file size, allowed mimetypes.
- SSRF protections (the presign flow doesn't fetch, but the `fetch-model` helper does — note which paths are fetchable).

### 8. Versioning

- Breaking vs non-breaking change policy for this spec.
- How to check which version an `<agent-3d editor>` element speaks (hint: add a `data-editor-version` attr or an event).

## Files you own

- Create: `specs/EDITOR_SPEC.md`

## Files off-limits

- Everything in `src/editor/`, `src/element.js`, `api/` — read only. Do not modify to make the spec cleaner. If you find a bug worth fixing, note it in reporting.

## Acceptance

- `specs/EDITOR_SPEC.md` exists and every claim cites an exact file path + line number from the current codebase.
- No API invented. If `src/editor/foo.js` doesn't export `bar`, the spec doesn't say it does.
- At least one subsection explicitly documents current pre-1.0 inconsistencies so readers aren't misled.

## Reporting

Word count, number of file citations, list of pre-1.0 rough edges called out, any API invented and then removed during review.
