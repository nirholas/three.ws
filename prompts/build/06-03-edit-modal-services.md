---
mode: agent
description: 'Add service endpoint editor to the existing on-chain agent edit modal in RegisterUI'
---

# 06-03 · Edit Modal — Service Endpoint Editor

## Context

The `_openEditModal` in `src/erc8004/register-ui.js` (line ~1727) lets owners update name, description, image, GLB, x402Support, and avatar removal. But it does **not** let them edit service endpoints. The `_doUpdateAgent` method (line ~1834) already has logic to **preserve** non-avatar services (`preservedServices`), but there's no way for the user to add, remove, or edit them.

The registration wizard Step 2 (`_renderStepServices`, line ~768) has a fully-working service list editor (add/remove rows, type select, endpoint input). This task ports that same editor pattern into the edit modal.

## Files to modify

- `src/erc8004/register-ui.js` only — `_openEditModal`, `_doUpdateAgent`

## What to build

### 1. Extract a reusable service-list renderer

The service list logic in `_renderStepServices` builds a list of `{ name, type, endpoint }` rows with add/remove buttons. Rather than duplicating that HTML+JS verbatim in the modal, extract it into a private method `_buildServiceEditor(container, initialServices)` that:

- Accepts a parent `HTMLElement` and an array of service objects as the initial state.
- Renders the rows using the same structure as Step 2 (look for the `renderList` closure in `_renderStepServices`).
- Exposes a `.getServices()` method (or closure) to read the current list back out.
- Returns `{ getServices }`.

Then in `_renderStepServices`, call `this._buildServiceEditor(serviceContainer, this.form.services)` and wire the returned `getServices` to update `this.form.services` on next/deploy click (replacing the current inline list-render logic).

**Read `_renderStepServices` carefully** before extracting — the current code around line 768–825 uses:

- `renderList()` — a closure that re-renders rows from a `services` array
- An "add" button (`data-role="add"`)
- Per-row remove buttons (`data-role="rm"`)
- Per-row `<select>` for type (a2a / mcp / web / x402)
- Per-row text input for endpoint

Extract that into `_buildServiceEditor(container, initialServices)`. It should manage its own internal array copy and return `{ getServices: () => [...] }`.

### 2. `_openEditModal` — add service editor section

In `_openEditModal`, find the edit modal HTML template (the `modal.innerHTML = ...` block). After the x402Support checkbox and before the Pinata JWT label, inject a service editor section:

```html
<div class="erc8004-label" style="margin-top:14px">Service endpoints</div>
<p class="erc8004-hint">
	Add or remove A2A / MCP / web endpoints. The 3D avatar service is managed by the "3D Avatar
	(GLB)" field above.
</p>
<div data-role="services-editor"></div>
```

After the modal is appended to `this.el`, wire the service editor:

```js
const nonAvatarServices = (meta?.services || []).filter(
	(s) => s?.name !== 'avatar' && s?.name !== '3D',
);
const { getServices } = this._buildServiceEditor(
	modal.querySelector('[data-role="services-editor"]'),
	nonAvatarServices,
);
```

### 3. Edit modal save handler — read services and pass to `_doUpdateAgent`

In the save handler (around line 1796–1826), currently:

```js
const x402Support = !!modal.querySelector('[name="x402Support"]')?.checked;

await this._doUpdateAgent({
	agentId,
	name,
	description,
	imageUrl: imageUrlInput,
	glbFile,
	removeAvatar,
	x402Support,
	apiToken,
	currentMeta: card._meta,
	say,
});
```

Add services read and pass it through:

```js
const editedServices = getServices();
const x402Support = !!modal.querySelector('[name="x402Support"]')?.checked;

await this._doUpdateAgent({
	agentId,
	name,
	description,
	imageUrl: imageUrlInput,
	glbFile,
	removeAvatar,
	x402Support,
	services: editedServices,
	apiToken,
	currentMeta: card._meta,
	say,
});
```

### 4. `_doUpdateAgent` — use provided services instead of always pulling from metadata

Currently `_doUpdateAgent` (line ~1834) always reconstructs services from `currentMeta`:

```js
const preservedServices = (currentMeta?.services || []).filter(
	(s) => s?.name !== 'avatar' && s?.name !== '3D',
);
```

Add a `services` parameter to `_doUpdateAgent` and use it when provided:

```js
async _doUpdateAgent({
    agentId,
    name,
    description,
    imageUrl,
    glbFile,
    removeAvatar = false,
    x402Support,
    services,       // <-- add this
    apiToken,
    currentMeta,
    say,
}) {
```

Then change the `preservedServices` line:

```js
const preservedServices = Array.isArray(services)
	? services
	: (currentMeta?.services || []).filter((s) => s?.name !== 'avatar' && s?.name !== '3D');
```

This keeps backward compat — callers that don't pass `services` still get the metadata-preserve behavior.

## Service type options (for the editor select)

Use the same set as Step 2:

- `a2a` → label "A2A"
- `mcp` → label "MCP"
- `web` → label "Web"
- `x402` → label "x402"

Look at the existing `<select>` in `_renderStepServices` to match the exact option values and labels.

## Verification

```bash
node --check src/erc8004/register-ui.js
npm run build
```

Both should exit clean. No browser available — note inability to smoke-test in report.

## Important constraints

- The extracted `_buildServiceEditor` must work for both Step 2 and the edit modal. Don't break Step 2 when you refactor.
- The `avatar` and `3D` service entries are auto-managed by GLB fields — never show them in the editor list.
- Don't change `_doRegister` — it already reads from `this.form.services` which `_buildServiceEditor` will update in Step 2.
- ESM only, tabs 4-wide, no TypeScript.

## Out of scope

- Service endpoint validation (URL format check) — future task.
- Reordering services via drag-and-drop.
- Changes to `buildRegistrationJSON` signature — services are already accepted as the `services` array parameter.
