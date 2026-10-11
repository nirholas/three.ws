# Shipping the three.ws Cloud extension to Modly users

Today the extension installs by linking a local folder (see [README.md](README.md)).
Two further steps make it a one-click install with Modly's "trusted" badge.
Both publish under the project's name on GitHub, so both are owner-approved
actions; nothing here runs automatically.

## How Modly installs and trusts extensions

Read from Modly's own source (`electron/main/ipc-handlers.ts`):

- **Install from GitHub** takes `https://github.com/<owner>/<repo>`, downloads
  `https://api.github.com/repos/<owner>/<repo>/tarball/HEAD`, and requires
  `manifest.json` (and, for a model extension, `generator.py`) at the root of
  that tarball. A subfolder of a larger repository is not accepted, which is
  why the extension needs a repository of its own.
- On install Modly overwrites the manifest's `source` with the repository URL
  it downloaded from.
- **Trust** is a lookup: Modly fetches
  `https://raw.githubusercontent.com/lightningpixel/modly-official-extension/main/registry.json`
  (cached five minutes), whose shape is
  `{"trusted_repos": ["https://github.com/<owner>/<repo>", ...]}`, and marks an
  extension trusted when its `source` is in that list.

## Step 1: a public repository for the extension (owner-gated)

Split the folder out with its history, so the new repository's root is the
extension:

```bash
git subtree split --prefix=integrations/modly/three-ws -b modly-three-ws-ext
gh repo create nirholas/modly-three-ws --public \
  --description "three.ws Cloud for Modly: image, text and sketch to 3D, auto-rig, remesh and publish on hosted GPUs"
git push https://github.com/nirholas/modly-three-ws.git modly-three-ws-ext:main
git branch -D modly-three-ws-ext
```

Then, in this repository, set `source` in
[`three-ws/manifest.json`](three-ws/manifest.json) to
`https://github.com/nirholas/modly-three-ws` so a linked local copy and a
GitHub install report the same origin.

Check the result from a clean Modly: **Models**, **Install from GitHub**,
paste `https://github.com/nirholas/modly-three-ws`. All six nodes should load
with no download step.

To ship an update later, re-run the split and push; it fast-forwards because
the split is deterministic for the same history.

## Step 2: ask to be listed as trusted (owner-gated)

Open a pull request against
[lightningpixel/modly-official-extension](https://github.com/lightningpixel/modly-official-extension)
adding one line to `registry.json`:

```json
"https://github.com/nirholas/modly-three-ws"
```

Suggested description for the pull request:

> three.ws Cloud adds hosted 3D generation to Modly for users without a large
> GPU: image, text and sketch to 3D, a humanoid auto-rigger, a quad remesher and
> publishing to a shareable page. It is a direct-mode extension (no setup.py,
> no venv, no weights; stdlib-only Python), so installing it runs no install
> scripts. Generation is free and needs no account. Source and tests:
> https://github.com/nirholas/three.ws/tree/main/integrations/modly

Merging that is Lightning Pixel's decision; until then the extension installs
from GitHub without the trusted badge.

## The standalone publish node

[`three-ws-publish/`](three-ws-publish/) can follow the same two steps under
its own repository name (for example `nirholas/modly-three-ws-publish`) with
`--prefix=integrations/modly/three-ws-publish`.
