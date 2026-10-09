# Contributing to three.ws Forge

three.ws Forge lives in the three.ws repository, so it follows the repo-wide
[contributing guide](../../CONTRIBUTING.md): the same issue tracker, branch
flow, commit style and pre-push checks. This page covers what is specific to
the desktop app.

## Where things go

| Change | Where to send it |
|---|---|
| A bug or feature in three.ws Forge, including the three.ws sign-in, Publish, library and cloud nodes | [three.ws issues](https://github.com/nirholas/three.ws/issues) |
| A bug that also exists in an unmodified Modly (the generators, the node editor, the Python engine) | [Modly issues](https://github.com/lightningpixel/modly/issues) as well, so the fix can reach both apps |
| A new local model | Its own GitHub repository with a Modly-compatible `manifest.json`; Forge installs it from the **Models** tab |

[Your first contribution](../../docs/first-contribution.md) walks through
claiming an issue and opening a pull request.

## Run it

```bash
cd apps/forge-desktop
npm install
npm run prepare-resources   # standalone Python for your platform
npm run dev
```

The app has three layers: the Electron main process in `electron/main/`, the
React renderer in `src/`, and the FastAPI engine in `api/` on
`127.0.0.1:8765`. The [user guide](../../docs/forge-desktop.md) describes what
each screen does.

## Before you open a pull request

```bash
npm run lint
npm run test        # Node tests, then the Python engine tests
npm run build       # typechecks and bundles main, preload and renderer
```

From the repo root, `npm run check:rules -- --paths <files you changed>` checks
your added lines against the house rules the pre-push hook enforces.

Open the pull request against `main` with `Closes #<issue-number>` in the
description. Keep it to one change: a fix to the three.ws integration and an
upstream sync are reviewed separately.

## License

Forge is based on [Modly](https://github.com/lightningpixel/modly) by Lightning
Pixel, used under the MIT license ([LICENSE](./LICENSE), [NOTICE](./NOTICE)).
Keep both files and the About screen credit intact.
