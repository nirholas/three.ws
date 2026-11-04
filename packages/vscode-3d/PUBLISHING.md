# Publishing three.ws 3D

How to release `threews.vscode-3d` to the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/vscode) and to
[Open VSX](https://open-vsx.org) (the registry VSCodium, Cursor, Windsurf,
Gitpod and other VS Code forks install from). Official references:
[Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
and the [Open VSX publishing guide](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions).

This file is excluded from the `.vsix` by `.vscodeignore`.

## Where things stand

- **Publisher identity is resolved.** `package.json` declares
  `"publisher": "threews"`. That publisher already exists on the Visual Studio
  Marketplace (display name "three.ws", verified, with another three.ws
  extension live under it), so no new publisher has to be created. The
  `threews` namespace also already exists on Open VSX.
- **The package is ready.** `npm run package` builds a production bundle and
  writes `vscode-3d-0.2.0.vsix`: 15 files, about 694 KB. It has been installed
  into a real VS Code 1.138.0 server build with
  `code-server --install-extension`, and `--list-extensions` reports
  `threews.vscode-3d@0.2.0`.
- **Release is one command.** `npm run release` (see below) wraps the preflight,
  both publishes and the post-publish listing check. Re-verified 2026-11-04: 71
  extension tests plus 7 release-preflight tests pass, the packaged file list
  matches exactly, and the gallery query for `threews.vscode-3d` still returns
  no listing.
- **What only the owner has:** a Marketplace token for the `threews` publisher
  and an Open VSX token for the `threews` namespace. Neither is stored on this
  machine.

## Fast path: `npm run release`

Set the two tokens and run one command. It runs the tests, packages, asserts the
file list below exactly, checks the `CHANGELOG.md` section and that the version
is greater than anything on the Marketplace, publishes to each registry whose
token is set (`VSCE_PAT` for the Marketplace, `OVSX_PAT` for Open VSX; an unset
token skips that registry with a message), then polls the gallery until the new
version is listed. With no tokens it only runs the preflight and exits 0. Token
values are never printed. The manual steps below remain the fallback.

```bash
cd packages/vscode-3d
VSCE_PAT=<marketplace token> OVSX_PAT=<open vsx token> npm run release
```

## 0. Preflight (one minute)

```bash
cd packages/vscode-3d
npm ci
npm test                      # 71 tests, must all pass
npm run package               # builds and writes vscode-3d-<version>.vsix
npx --yes @vscode/vsce ls --no-dependencies   # the exact file list that ships
```

The list must be `CHANGELOG.md`, `LICENSE`, `README.md`, `package.json`,
`dist/extension.cjs`, `media/icon.png`, `media/cube.svg`, `media/viewer.css`,
`media/viewer.js`, and the four decoder files under `media/vendor/`. Anything
else (sources, tests, source maps, `node_modules`) means `.vscodeignore` has
regressed. Delete the `.vsix` afterwards; it is gitignored and never committed.

Marketplace rules the package already satisfies, worth keeping when editing:
the icon is a 128x128 PNG (SVG icons are rejected), the README uses only
absolute `https` links and no SVG images, `repository`, `bugs`, `homepage`,
`license`, `pricing`, `galleryBanner`, `categories` and `keywords` are set, and
`engines.vscode` matches `@types/vscode`. A version can be published only once:
bump `version` in `package.json` and add a `CHANGELOG.md` section for every
release after 0.2.0.

## 1. Visual Studio Marketplace

### 1a. Get access to the `threews` publisher

1. Sign in at <https://marketplace.visualstudio.com/manage> with the Microsoft
   account that owns the `threews` publisher. If you are a different account,
   the owner adds you under **threews > Members** with the **Contributor** role.
2. Only if the publisher were ever missing: **Create publisher** on the same
   page, ID `threews`, name `three.ws`. The ID must equal the `publisher` field.

### 1b. Create a Personal Access Token

1. Open <https://dev.azure.com>. Any Azure DevOps organization under the same
   Microsoft account works; create one if the account has none.
2. User settings (top right) > **Personal access tokens** > **New Token**.
3. **Organization: All accessible organizations.** A token scoped to one
   organization fails with a 401 at publish time.
4. **Scopes: Custom defined > Show all scopes > Marketplace > Manage.**
5. Pick an expiry, create, and copy the token.

### 1c. Log in and publish

```bash
cd packages/vscode-3d
npx --yes @vscode/vsce login threews        # paste the token when prompted
npx --yes @vscode/vsce verify-pat threews   # optional sanity check
npm run publish:marketplace
```

`publish:marketplace` runs `vsce publish --no-dependencies`, which runs the
production build (`vscode:prepublish`), packages, and uploads. The bundles
already contain every runtime dependency, so `--no-dependencies` is correct.

Non-interactive alternative: `VSCE_PAT=<token> npm run publish:marketplace`.
If the account signs in through Microsoft Entra ID instead of a token:
`az login`, then `npx --yes @vscode/vsce publish --no-dependencies --azure-credential`.

## 2. Open VSX (free second listing)

1. Sign in at <https://open-vsx.org> with the GitHub account that is a member of
   the `threews` namespace (the account that published the existing three.ws
   extension there). The Eclipse Foundation publisher agreement must be signed
   under **Settings**; it already is if that account published before.
2. **Settings > Access Tokens > Generate New Token**, copy it.
3. Publish:

```bash
cd packages/vscode-3d
OVSX_PAT=<token> npm run publish:openvsx
```

`publish:openvsx` runs `ovsx publish --no-dependencies`, which builds and
packages the same way. To upload the exact file already published to the
Marketplace instead: `npx --yes ovsx publish vscode-3d-0.2.0.vsix -p <token>`.

The namespace is currently unverified on Open VSX, so the listing shows a
warning badge. To remove it, claim the namespace by opening an issue at
<https://github.com/EclipseFdn/open-vsx.org/issues> (template "Claim namespace
ownership"). This is optional and does not block publishing.

## 3. Verify the release

Marketplace listings pass an automated scan first, usually within a few
minutes, before the page and install work.

```bash
# Marketplace: the gallery API returns the published version
curl -s -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json;api-version=7.2-preview.1' \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"threews.vscode-3d"}]}],"flags":1}' \
  | grep -o '"version":"[^"]*"' | head -1

# Open VSX: the registry API returns the published version
curl -s https://open-vsx.org/api/threews/vscode-3d | grep -o '"version":"[^"]*"'

# A real install into a clean profile
code --user-data-dir /tmp/vsc3d-profile --extensions-dir /tmp/vsc3d-ext \
  --install-extension threews.vscode-3d
code --user-data-dir /tmp/vsc3d-profile --extensions-dir /tmp/vsc3d-ext \
  --list-extensions --show-versions
```

Then check by hand:

1. <https://marketplace.visualstudio.com/items?itemName=threews.vscode-3d>
   shows the icon, the dark banner, the README with working links, and the
   changelog tab.
2. <https://open-vsx.org/extension/threews/vscode-3d> shows the same.
3. In VS Code, open any `.glb` (for example a model from
   <https://three.ws>): it renders in the **three.ws 3D Viewer** tab, the
   **three.ws 3D** activity bar icon lists workspace models, and
   **3D: Generate a Model from Text** returns a model.

## 4. After the first publish

- In `docs/vscode.md`, replace the "not on the Marketplace yet" install section
  with the Marketplace and Open VSX install, matching this package's README.
- Add a `data/changelog.json` entry announcing the listing (tags `feature`,
  `sdk`) and run `npm run build:pages` from the repository root.
- Set the "VS Code Marketplace: three.ws 3D" row in
  `marketing/growth/opportunities.csv` to `live`, with the listing URL as
  evidence.
