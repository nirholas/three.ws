# Handle `memory="remote"` in `<agent-3d>` loader

## Symptom

```
agent-3d.js:68935 [agent-3d] boot failed
Error: Unknown memory mode: remote
    at Ws.load (agent-3d.js:53866:11)
    at HTMLElement._boot (agent-3d.js:68848:37)
```

## Cause

The component is being instantiated with `memory="remote"` (or a config that resolves to `remote`), but the memory loader's switch only handles known modes (likely `local`, `session`, `none`).

## Task

1. Find the loader (`Ws.load` in the bundle; source likely lives near memory/storage helpers under [src/](../../src/)).
2. Decide:
   - If `remote` should be supported — implement the branch (fetch/POST against the agent's remote memory endpoint).
   - If it should not — coerce unknown modes to a safe default (e.g. `local`) with a single `console.warn`, instead of throwing.
3. Document supported memory modes in the component's README / JSDoc.
4. Add a unit test for each accepted mode and one for the fallback path.

## Acceptance

- No `Unknown memory mode: remote` error when loading `https://three.ws/chat`.
- Either remote memory works end-to-end, or unsupported values fall back gracefully without breaking `_boot`.
