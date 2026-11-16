# deepmerge 4.3.1, patched (vendored)

The SPFx build toolchain pulls in `deepmerge` through
`@microsoft/spfx-web-build-rig` -> `@rushstack/heft-jest-plugin` -> `jest-config`.
Every published release, up to and including the latest (4.3.1), is affected by
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
(prototype poisoning in `mergeObject()`), and upstream has not shipped a fix.

`index.js` is the published `deepmerge@4.3.1` `dist/cjs.js` build with one change.
Every write into the merged result goes through `setOwn()`, which defines a key
named `__proto__` as an own data property instead of assigning it through the
`__proto__` setter. Before the patch, an object with an own `__proto__` key
(normal `JSON.parse` output) could replace the result's prototype. The merge
behaviour is otherwise unchanged. `index.d.ts` and `license.txt` (MIT) are
copied verbatim.

## How it is wired

`../../package.json` declares `"deepmerge": "file:./vendor/deepmerge"` as a
devDependency and overrides every transitive copy with `"deepmerge": "$deepmerge"`.
Use the `$` reference. A bare `file:` path inside `overrides` gets resolved
relative to the dependent package, and npm then writes a dangling link into
the lockfile.

Regression test: `tests/sharepoint-spfx-deepmerge.test.js` at the repo root.

Delete this directory, the devDependency and the override once upstream ships a
fixed `deepmerge` release and `jest-config` picks it up.
