# Listing the three.ws extension in the Gemini CLI gallery

The extension in [`three-ws/`](three-ws/) is ready to ship. Publishing it creates a
public repository under the project's GitHub account, so that step is an owner
action. Everything before it is built and checked, and the publish itself is one
command.

## How the gallery and Gemini CLI find an extension

From geminicli.com/docs/extensions and the gemini-cli 0.71.1 source:

- There is no submission form. A daily crawler lists any public GitHub repository
  that has the `gemini-cli-extension` topic, a `gemini-extension.json` at the
  repository root and at least one release tag. It finds new repositories through
  GitHub code search, so a brand-new repository shows up once GitHub has indexed it
  (usually within a day) and the next crawl has run.
- `gemini extensions install https://github.com/<owner>/<repo>` downloads the
  repository's **Latest** release. When that release has assets, Gemini CLI picks
  one (a `{platform}.{arch}.` or `{platform}.` match, or the only asset) and unpacks
  it as the extension. When it has none, it downloads the tag's source tarball. So
  the release must have **no assets**: an attached `gemini-extension.json` would be
  downloaded as the "archive" and every install would fail.
- A subfolder of a larger repository cannot be listed, and the three.ws monorepo's
  own weekly releases are marked Latest with no extension at the root. That is why
  the extension gets a repository of its own, generated from this folder by
  [`scripts/export-plugin-repo.mjs`](../../scripts/export-plugin-repo.mjs) (the same
  exporter the Cursor and Grok Build plugins use).

## Step 1: check it locally (no owner approval needed)

```bash
npm run gemini:extension-validate                  # the repository's own validator
node scripts/check-integrations.mjs gemini         # real Gemini CLI: validate, install, list
npm run gemini:extension-publish -- --dry-run      # read-only plan of what step 2 will do
npx vitest run tests/gemini-extension.test.js
```

The dry run prints the repository it will create, the commit and tag it will push,
the release it will create and the topics it will set. It does not write anything.

## Step 2: publish (owner-gated)

```bash
npm run gemini:extension-publish
```

What it does, in order (`scripts/publish-gemini-extension.mjs`):

1. Exports and validates the extension.
2. Creates `nirholas/three-ws-gemini-extension` (public) if it does not exist, and
   sets its description, homepage (`https://three.ws/docs/mcp`) and topics:
   `gemini-cli-extension`, `gemini-cli`, `mcp`, `mcp-server`, `text-to-3d`, `3d`,
   `glb`, `avatar`, `threejs`.
3. Pushes the exported tree to `main`. On later runs it commits on top of the
   existing `main` (a fast-forward, never a force push) and pushes nothing when the
   tree has not changed.
4. Pushes the tag `v<version>` from `gemini-extension.json` and creates the GitHub
   release for it, marked Latest, with no assets.
5. Runs the checks in `--check` below and prints the code-search status.

It needs `gh` signed in to the account that owns the repository (`gh auth status`).

## Step 3: confirm

```bash
npm run gemini:extension-publish -- --check
gemini extensions install https://github.com/nirholas/three-ws-gemini-extension
```

`--check` confirms the repository is public, carries the topic, has a Latest release
at the current version with no assets, and serves `gemini-extension.json` from the
root of that tag. It also reports whether GitHub code search has indexed the
manifest yet; the gallery picks the repository up on the first daily crawl after
that. Then, inside Gemini CLI, `/mcp auth three-ws` signs in and
`/make-3d a small wooden three-legged stool` should return a GLB.

## Shipping an update

Edit the extension in this folder, bump `version` in
[`three-ws/gemini-extension.json`](three-ws/gemini-extension.json), and run
`npm run gemini:extension-publish` again. It refuses to move an existing tag, so a
change without a version bump stops with a message instead of rewriting a published
release. Users get the new version with `gemini extensions update three-ws`.

## After the listing is live

- Add `gemini extensions install https://github.com/nirholas/three-ws-gemini-extension`
  to the "Gemini CLI" section of [`docs/mcp.md`](../../docs/mcp.md), which today
  documents adding the server with `gemini mcp add`.
- Add a `data/changelog.json` entry ("three.ws is in the Gemini CLI extension
  gallery") and run `npm run build:pages`.
