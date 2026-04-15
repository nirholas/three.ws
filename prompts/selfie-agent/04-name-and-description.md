# Task: Claim a name + one-line description for the new agent

## Context

Repo: `/workspaces/3D`. Once the selfie pipeline (prompts 01-02) produces a GLB and prompt 03 is ready to pin it + create the `agent_identities` row, the user needs to **name** the agent. A 3D avatar with no name is a toy; a named one is a relationship. The name becomes part of the agent's display string everywhere — home card, share CTA, embeds.

Existing building blocks you'll reuse:

- `slug` zod schema in [api/_lib/validate.js](../../api/_lib/validate.js) — lowercase alphanumeric + `-`/`_`, max 64 chars.
- `agent_identities` table already has a `name` column but no `slug` column. This task **does not** add a column; slug is a derived, per-user-unique string enforced by checking `LOWER(name)` collisions at insert time. A proper slug column + routing is a later migration task.
- Wallet address for the caller is reachable via `/api/auth/me` and the `user_wallets` table (layer 1 — already shipped).
- Display surfaces that read the name: [src/agent-home.js](../../src/agent-home.js), the `agent-home.html` route, and the `.name` getter on [src/agent-identity.js](../../src/agent-identity.js).
- Existing session auth helpers in [api/_lib/auth.js](../../api/_lib/auth.js) (`getSessionUser`) and the standard serverless endpoint shape in [api/CLAUDE.md](../../api/CLAUDE.md).

## Goal

Show the user a two-field form between "avatar preview" (post prompt-02) and persistence (prompt 03):

1. **Name** — required, 2-32 chars (after trim).
2. **One-line description** — optional, max 140 chars.

Validate locally and remotely:

- Name is non-empty / non-whitespace-only.
- Name is not on an in-repo denylist (simple `Set<string>` — **no new runtime dep**, no external moderation API).
- Name's derived slug is not on a reserved-slug list (`admin`, `api`, `agent`, `login`, `create`, etc.).
- Name is unique **per user** — two different users may share a name, but one user cannot have two agents with the same lowercased name.

On submit, hand `{ name, description, slug }` up the call chain so prompt 03 can insert the `agent_identities` row.

## Deliverable

1. **New file: `src/selfie-name-form.js`** — class `SelfieNameForm(rootEl, { onSubmit, initial })` with:
   - Form rendering name + description inputs, character counters, a Continue button.
   - Debounced (300ms) availability check against `GET /api/agents/check-name?slug=…` → `{ available, reason? }`.
   - Inline error messages under the name field: `"Name must be 2-32 characters."`, `"Name contains disallowed characters."`, `"That name isn't allowed."`, `"You already have an agent with that name."`.
   - Continue disabled until the current name is syntactically valid and remotely available.
   - `onSubmit({ name, description, slug })` fires on Continue click.
   - All listeners stored on `this._…` fields for clean `unmount()` (follow the pattern used in [src/avatar-creator.js](../../src/avatar-creator.js)).

2. **New file: `src/selfie-denylist.js`** — export:
   - `DENYLIST: Set<string>` of disallowed substrings (case-insensitive). Keep it short and obvious; stub real slurs with `/* …redacted, fill locally… */` comments if you prefer not to commit the words. Include at minimum `null`, `undefined`, and a handful of common slurs.
   - `RESERVED_SLUGS: Set<string>` — `admin`, `root`, `support`, `api`, `agent`, `agents`, `login`, `logout`, `signin`, `signup`, `create`, `system`, `wallet`, `settings`, `help`, `docs`, `me`, `null`, `undefined`.
   - `isNameAllowed(name): boolean`
   - `isSlugReserved(slug): boolean`
   - `deriveSlug(name): string` — `name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)`.

3. **New API: `api/agents/check-name.js`** — `GET /api/agents/check-name?slug=…`:
   - Auth: session cookie only (`getSessionUser(req)`). No bearer.
   - Validate `slug` via the existing `slug` zod schema from [api/_lib/validate.js](../../api/_lib/validate.js).
   - Call `isSlugReserved(slug)` → if reserved, return `{ available: false, reason: 'reserved' }`.
   - SQL: `SELECT 1 FROM agent_identities WHERE user_id = $1 AND LOWER(name) = $2 AND deleted_at IS NULL LIMIT 1`. The `$2` is the *lowercased original name*, not the slug — reasoning: uniqueness is on the name surface, slug is just a stable identity for the check request. Accept both `?name=` and `?slug=` query params; prefer `name` if present and fall back to deriving.
   - Return `{ available: boolean, reason?: 'reserved'|'taken' }`.
   - Rate-limit via `limits.authIp(clientIp(req))` per [api/CLAUDE.md](../../api/CLAUDE.md).

4. **New file: `api/_lib/agent-names.js`** — exports `assertNameAvailable({ userId, name }): Promise<void>` that throws `{ status: 409, code: 'name_taken', message: '…' }` if the caller already has a live agent with that name. Prompt 03's POST handler will `await` this before insert.

5. **Edit [vercel.json](../../vercel.json)** — add `{ "src": "/api/agents/check-name", "dest": "/api/agents/check-name" }` **above** the existing `/api/agents/([^/]+)` rule so it is not captured as an `:id`.

6. **Edit [public/create.html](../../public/create.html)** — mount `SelfieNameForm` between the "avatar preview" step (from prompt 02) and the persistence step (prompt 03). Seed `initial.name` from `/api/auth/me` `display_name` if present, else empty.

## Audit checklist — must handle all of these

**Name validation (client + server, same rules)**
- Trim input before any check.
- Length 2-32 chars after trim.
- Allowed character class: `[A-Za-z0-9 _'.-]`. Reject anything else.
- Collapse internal whitespace: `name.replace(/\s+/g, ' ')`.
- Derived slug runs through the `slug` zod schema. Empty slug after derivation → rejected as `invalid_name`.

**Denylist**
- Case-insensitive substring match against `DENYLIST`. Any match → `"That name isn't allowed."`. This is a **blunt** instrument on purpose — it's a stopgap, not moderation.
- Reserved slugs are **exact match** against `RESERVED_SLUGS`.

**Uniqueness**
- Per-user, not global. `LOWER(name)` comparison in SQL.
- No fuzzy / trigram match.

**Debounce + race**
- 300ms input debounce.
- Cancel prior in-flight checks via `AbortController`. Only the latest response is surfaced.
- If Continue is pressed while a check is pending, await the pending result before firing `onSubmit`.

**Accessibility**
- `<label>`s linked to inputs via `for`/`id`.
- Inline errors in an `aria-live="polite"` container.
- Continue button gets `aria-busy="true"` while a check or submit is in flight.

**Mobile**
- Inputs scale to full width on a 375px viewport.
- `autocapitalize="words"` on name, `autocapitalize="sentences"` on description.
- Plain `type="text"` — never `type="email"` / `type="tel"`.
- Virtual-keyboard "Done" submits the form when valid.

## Constraints

- No new runtime dependencies. No slugify-lib, no profanity-lib. Use the in-tree `slug` schema and plain JS.
- Do not add a `slug` column on `agent_identities`. Do not add a migration. Uniqueness is derived + enforced via `LOWER(name)`.
- Do not add an LLM name-suggestion feature — explicitly out of scope.
- `check-name` must only reveal collisions for the **caller's** agents. Never leak whether another user owns the same name.

## Verification

1. `node --check` every new / changed `.js` file.
2. `npx vite build` — passes. Pre-existing `@avaturn/sdk` warning is expected; anything new is yours.
3. Manual denylist: type `admin` → inline "That name isn't allowed." within ~300ms.
4. Manual happy path: type a valid name, wait for debounce → Continue enables; press → `onSubmit` fires with `{ name, description, slug }`.
5. Manual duplicate-per-user: have the same session create two agents with the same name in a row → second is blocked at the form, and if the form is bypassed (direct `curl POST /api/agents`) the server returns 409 `name_taken` courtesy of `assertNameAvailable`.
6. Manual cross-user: two test users both pick the same name → both succeed.
7. Manual denied substring embedded in a longer string → blocked.
8. Manual Unicode: `"Émile"` → slug `emile`, accepted.
9. Manual length: 1 char → error; 33 chars → error.
10. Manual description: empty → accepted; 141 chars → blocked client-side; don't rely on server check alone.
11. Manual debounce race: type quickly; in DevTools Network verify only the last request "wins" — earlier ones are aborted or ignored.

## Scope boundaries — do NOT do these

- Do not add a `slug` column or a migration.
- Do not introduce global-unique slugs — uniqueness is per-user.
- Do not integrate an external moderation API.
- Do not build a rename flow for existing agents.
- Do not wire on-chain name registration.
- Do not style-polish the post-creation scene — that's prompt 05.
- Do not re-open the camera or reshape prompts 01/02/03.

## Reporting

Report:
- Files created / edited with line counts.
- The final denylist + reserved-slug contents (so a reviewer can tweak).
- The slug derivation rule you shipped and any edge case you found (e.g. CJK input collapses to empty — how you handled it).
- `node --check` and `npx vite build` output.
- Results of the 11 manual verifications above.
- Any case where client validation and server validation diverged and how you reconciled.
- Any unrelated bug you noticed (do not fix).
