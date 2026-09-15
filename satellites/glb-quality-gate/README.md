# three.ws GLB Quality Gate

A GitHub Action that explains what changed inside every `.glb` modified by a pull request. It
distinguishes harmless re-exports from changed materials, geometry, hierarchy, skeletons, and
animation clips, then comments the result and writes the same report to the workflow summary.

## Use it

```yaml
name: Review 3D models

on:
  pull_request:
    paths:
      - "**/*.glb"

permissions:
  contents: read
  pull-requests: write

jobs:
  glb-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: nirholas/glb-quality-gate@v1
        with:
          fail-on: breaking
```

No checkout step is required. The Action reads both model versions through the GitHub API,
which also avoids incomplete shallow-clone comparisons.

## Severity

| Level | Meaning |
| --- | --- |
| `none` | The models are structurally identical. |
| `cosmetic` | Metadata changed without an observable rendering change. |
| `minor` | Appearance changed while the model's structure remained usable. |
| `major` | Geometry or hierarchy changed and dependent content should be checked. |
| `breaking` | A named mesh, material, joint, or animation dependency disappeared. |

Added files are `minor`; removed files are `breaking`. Renames compare the previous path with
the new path. The default threshold fails only at `breaking`.

## Inputs and outputs

| Name | Default | Purpose |
| --- | --- | --- |
| `github-token` | `github.token` | Reads the base/head files and creates or updates the report comment. |
| `fail-on` | `breaking` | First severity that fails the job. |
| `max-files` | `20` | Review cap for a single pull request, from 1 to 100. |
| output `severity` | | Highest severity across reviewed models. |
| output `files-checked` | | Number of GLB files included in the report. |

Pull requests from forks may receive a read-only token. The Action still writes the workflow
summary and applies the gate; it emits a warning when GitHub refuses the comment.

## Development

```bash
npm ci
npm test
npm run build
```

`dist/index.js` is committed because JavaScript Actions execute the bundled file. The diff
engine is the published [`@three-ws/glb-diff`](https://www.npmjs.com/package/@three-ws/glb-diff)
package, the same engine used by the [visual model diff](https://three.ws/diff).

## Release

After tests and the bundle pass, tag a release and move the stable major tag:

```bash
git tag -a v1.0.0 -m "three.ws GLB Quality Gate v1.0.0"
git tag -f v1 v1.0.0
git push origin v1.0.0
git push --force origin v1
```

The dedicated public repository and root `action.yml` make it eligible for publication in the
[GitHub Marketplace](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace).

## License

Apache-2.0
