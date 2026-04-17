---
mode: agent
description: 'Add supportedTrust multi-select to the ERC-8004 registration wizard and edit modal'
---

# 06-01 · supportedTrust Multi-Select in ERC-8004 Wizard

## Context

The ERC-8004 registration wizard (`src/erc8004/register-ui.js`) currently hardcodes `supportedTrust: ['reputation']` in `buildRegistrationJSON` (`src/erc8004/agent-registry.js:186`). The ERC-8004 spec allows three trust modes: `reputation`, `validation`, and `stake`. There is no UI for the user to choose.

The wizard has 3 steps. Step 2 renders service endpoints and already has a working x402Support checkbox (wired end-to-end). This task follows that exact pattern to add a `supportedTrust` multi-checkbox group in the same step.

## Files to modify

- `src/erc8004/agent-registry.js` — `buildRegistrationJSON`
- `src/erc8004/register-ui.js` — form init, `_renderStepServices`, `_doRegister`, `_doUpdateAgent`, `_openEditModal`, template click handler

## What to build

### 1. `buildRegistrationJSON` — accept `supportedTrust` param

In `src/erc8004/agent-registry.js`, find `buildRegistrationJSON` (line ~147). It currently has:

```js
export function buildRegistrationJSON({
    name,
    description,
    imageUrl,
    glbUrl,
    agentId,
    chainId,
    registryAddr,
    services = [],
    x402Support = false,
}) {
```

And the `json` object sets:

```js
supportedTrust: ['reputation'],
```

Change to accept `supportedTrust = ['reputation']` in the destructuring, and use it in the output:

```js
export function buildRegistrationJSON({
    name,
    description,
    imageUrl,
    glbUrl,
    agentId,
    chainId,
    registryAddr,
    services = [],
    x402Support = false,
    supportedTrust = ['reputation'],
}) {
```

In the `json` object, replace the hardcoded line with:

```js
supportedTrust: Array.isArray(supportedTrust) && supportedTrust.length > 0
    ? supportedTrust
    : ['reputation'],
```

### 2. Form initializers — add `supportedTrust` field

There are two form objects in `src/erc8004/register-ui.js`:

**Primary form init** (around line 270 in the constructor, after `x402Support: false`):

```js
services: [],
x402Support: false,
apiToken: '',
```

Add `supportedTrust: ['reputation'],` after `x402Support: false`.

**Scratch reset** (around line 680, inside `_resetWizard` when `mode === 'scratch'`):

```js
services: [],
x402Support: false,
apiToken: this.form.apiToken || '',
```

Add `supportedTrust: ['reputation'],` after `x402Support: false`.

### 3. `_renderStepServices` — add checkbox group

In `_renderStepServices`, find the x402 checkbox block:

```html
<label class="erc8004-checkbox" style="margin-top:12px">
    <input type="checkbox" data-role="x402" ${this.form.x402Support ? 'checked' : ''} />
    Accept x402 payments (HTTP-native micropayments)
</label>
```

Add a trust multi-select block immediately after it:

```html
<fieldset class="erc8004-fieldset" style="margin-top:14px;border:1px solid var(--erc8004-border,#333);border-radius:6px;padding:10px 12px">
    <legend class="erc8004-label" style="padding:0 4px">Trust models</legend>
    <p class="erc8004-hint" style="margin:2px 0 8px">How other agents can verify yours. Select all that apply.</p>
    ${['reputation','validation','stake'].map(t => `
        <label class="erc8004-checkbox" style="margin-bottom:4px">
            <input type="checkbox" data-role="trust-${t}" ${(this.form.supportedTrust || []).includes(t) ? 'checked' : ''} />
            ${t.charAt(0).toUpperCase() + t.slice(1)}
        </label>
    `).join('')}
</fieldset>
```

Then in the JS wiring section of `_renderStepServices` (after the x402 change listener), add listeners for each trust checkbox:

```js
['reputation', 'validation', 'stake'].forEach((t) => {
	body.querySelector(`[data-role="trust-${t}"]`).addEventListener('change', () => {
		const checked = ['reputation', 'validation', 'stake'].filter(
			(x) => body.querySelector(`[data-role="trust-${x}"]`)?.checked,
		);
		this.form.supportedTrust = checked.length > 0 ? checked : ['reputation'];
	});
});
```

### 4. `_doRegister` — pass `supportedTrust` to `registerAgent`

In `_doRegister` (line ~1347), find the `registerAgent` call:

```js
return await registerAgent({
	name,
	description,
	glbFile: glbFile || undefined,
	glbUrl: glbUrl || undefined,
	imageUrl: imageUrl || undefined,
	apiToken: apiToken || undefined,
	services: extraServices,
	x402Support: !!this.form.x402Support,
	onStatus: say,
});
```

`registerAgent` calls `buildRegistrationJSON` internally. Look at how `registerAgent` is defined in `src/erc8004/agent-registry.js` (around line 218+) — add `supportedTrust` to its destructured params and forward it to `buildRegistrationJSON`. Then pass `supportedTrust: this.form.supportedTrust || ['reputation']` in the `registerAgent` call from `_doRegister`.

In `src/erc8004/agent-registry.js`, the `registerAgent` function (around line 218+):

```js
export async function registerAgent({
    name,
    description,
    glbFile,
    glbUrl,
    imageUrl,
    apiToken,
    chainId: preferredChainId,
    services = [],
    x402Support = false,
    onStatus = () => {},
}) {
```

Add `supportedTrust = ['reputation'],` to the destructuring. Then find the `buildRegistrationJSON` call inside it (around line 321) and add `supportedTrust` to that call:

```js
const registrationJSON = buildRegistrationJSON({
	name,
	description,
	imageUrl,
	glbUrl,
	agentId,
	chainId,
	registryAddr,
	services,
	x402Support,
	supportedTrust,
});
```

### 5. `_doUpdateAgent` — preserve or override `supportedTrust`

In `_doUpdateAgent` (line ~1895), find the `buildRegistrationJSON` call:

```js
const registrationJSON = buildRegistrationJSON({
	name,
	description,
	imageUrl: newImageUrl || '',
	glbUrl,
	agentId,
	chainId,
	registryAddr,
	services: preservedServices,
	x402Support:
		typeof x402Support === 'boolean'
			? x402Support
			: !!(currentMeta?.x402Support || currentMeta?.x402),
});
```

Add `supportedTrust` similarly — use it when provided (from the edit modal), otherwise fall back to whatever was in the existing metadata:

```js
supportedTrust: Array.isArray(supportedTrust) && supportedTrust.length > 0
    ? supportedTrust
    : Array.isArray(currentMeta?.supportedTrust) && currentMeta.supportedTrust.length > 0
        ? currentMeta.supportedTrust
        : ['reputation'],
```

Add `supportedTrust` to the `_doUpdateAgent` destructured params (alongside `x402Support`).

### 6. `_openEditModal` — read `supportedTrust` from existing metadata + add checkboxes

In `_openEditModal` (line ~1727), find the x402 checkbox in the modal HTML:

```html
<label class="erc8004-checkbox">
    <input type="checkbox" name="x402Support" ${currentMeta?.x402Support || currentMeta?.x402 ? 'checked' : ''} />
    Accept x402 payments (HTTP-native micropayments)
</label>
```

Add the same trust fieldset immediately after it:

```html
<fieldset class="erc8004-fieldset" style="margin-top:14px;border:1px solid var(--erc8004-border,#333);border-radius:6px;padding:10px 12px">
    <legend class="erc8004-label" style="padding:0 4px">Trust models</legend>
    ${['reputation','validation','stake'].map(t => `
        <label class="erc8004-checkbox" style="margin-bottom:4px">
            <input type="checkbox" name="trust-${t}" ${(meta?.supportedTrust || ['reputation']).includes(t) ? 'checked' : ''} />
            ${t.charAt(0).toUpperCase() + t.slice(1)}
        </label>
    `).join('')}
</fieldset>
```

In the modal save handler (where `x402Support` is read), add:

```js
const supportedTrust = ['reputation', 'validation', 'stake'].filter(
	(t) => !!modal.querySelector(`[name="trust-${t}"]`)?.checked,
);
```

Pass `supportedTrust` into `_doUpdateAgent`.

### 7. Template click handler — do NOT copy `supportedTrust` from templates

Templates don't define `supportedTrust`. When a template is selected (around line ~2068), the handler currently copies `services` and `x402Support`. Leave `supportedTrust` at its current form value (default `['reputation']`) — don't reset it. No change needed here.

## Verification

```bash
node --check src/erc8004/register-ui.js
node --check src/erc8004/agent-registry.js
npm run build
```

Both should exit clean. No browser environment available — note inability to smoke-test in report.

## Out of scope

- Changing what the contracts actually enforce for trust (on-chain only reads the URI).
- Adding explanatory copy about what each trust model means (future UX task).
- `_renderBatchTab` — batch deploys are separate and not in scope here.
