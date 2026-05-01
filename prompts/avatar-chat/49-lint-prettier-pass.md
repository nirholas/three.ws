# 49 — Lint and Prettier: all modified files pass

## Status
Required — all files modified by the avatar-chat feature must pass ESLint and Prettier without errors or warnings before shipping.

## What to run

```bash
npx prettier --check src/element.js src/runtime/index.js src/runtime/providers.js src/agent-protocol.js
```

If any files fail:
```bash
npx prettier --write src/element.js src/runtime/index.js src/runtime/providers.js src/agent-protocol.js
```

Then:
```bash
npx eslint src/element.js src/runtime/index.js src/runtime/providers.js src/agent-protocol.js
```

## Common issues to expect

### Prettier — tabs vs spaces
The codebase uses **tabs (4-wide)**. All new code must use tabs. If any new code uses spaces, Prettier will reformat it.

### Prettier — trailing commas
The Prettier config likely enforces trailing commas on multi-line objects/arrays. Check the new object literals in the event handlers and CSS string.

### ESLint — no-unused-vars
After removing `_startWalkAnimation` and `_walkReturnTimer` (prompt 03), confirm there are no `no-unused-vars` warnings for those names.

### ESLint — no-undef
If `THREE.Vector3` is used in prompt 13 (head tracking), it must be imported:
```js
import { Vector3 } from 'three';
```
Don't use `new THREE.Vector3()` — import the class directly.

### ESLint — prefer-const
Any new `let` that is never reassigned should be `const`.

## Verification
```bash
npx prettier --check src/element.js src/runtime/index.js src/runtime/providers.js
npx eslint src/element.js src/runtime/index.js src/runtime/providers.js
```
Both commands exit with code 0 and no output.
