---
name: glb-diff
description: Compare two glTF or GLB models structurally with the glb-diff CLI or @three-ws/glb-diff and gate CI on severity. Use when reviewing a 3D asset change, checking that an optimization or re-export did not break joints, clips or materials, or writing a model regression check.
---

# GLB diff

`@three-ws/glb-diff` (Node 18+, ESM) reports what actually changed between two models: geometry, materials, textures, skeletons and animations, with git-style rename and move detection.

Run without installing: `npx -y @three-ws/glb-diff before.glb after.glb`

## CLI

```
glb-diff <before> <after> [options]
  <before>, <after>   .glb/.gltf path or http(s) URL
  --json              full change set as JSON
  --markdown | --md   Markdown report for a pull-request comment
  --fail-on <level>   exit 1 when severity reaches: cosmetic | minor | major | breaking
  --verbose           include unchanged totals
  --no-color
```

Exit codes: `0` ran and stayed below `--fail-on` (default never fails on changes), `1` severity reached `--fail-on`, `2` the tool could not run (bad args, unreadable or unparseable input).

Severity ladder: `none`, `cosmetic` (metadata only), `minor` (appearance changed, still loads and animates), `major` (geometry or hierarchy changed), `breaking` (something referenced by name is gone, such as a joint, so clips stop moving).

## Library

```js
import { readFile } from 'node:fs/promises';
import { diffModels, formatText, formatMarkdown } from '@three-ws/glb-diff';

const changes = await diffModels(await readFile('v1.glb'), await readFile('v2.glb'), { nameA: 'v1', nameB: 'v2' });
console.log(formatText(changes));
if (changes.severity === 'breaking') process.exit(1);
```

Also exported: `describeModel`, `diffDescriptions`, `readDocument`, `isGLB`, `SEVERITIES`, `atLeast`, `maxSeverity`, `matchEntries`.

## Worked example

```bash
npx -y @three-ws/glb-diff avatar.v1.glb avatar.v2.glb --fail-on breaking
npx -y @three-ws/glb-diff base.glb https://cdn.example.com/live.glb --markdown > diff.md
```

## Guidance

- Use `--fail-on breaking` in CI to catch removed joints after an optimization pass, and `--markdown` to post the report on a pull request.
- Treat exit code 2 as a tooling failure, not a regression.
- The diff runs locally. A URL input is fetched with plain `fetch`.
