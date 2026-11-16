# PnP gallery samples (staging)

Three samples, one per Microsoft Patterns and Practices (PnP) community gallery. Each folder is a complete gallery sample: copy it into the matching gallery fork under `samples/` and open the pull request. Nothing in here has been sent to Microsoft.

| Sample | Target gallery | Folder to copy | Product |
| --- | --- | --- | --- |
| three.ws 3D Studio declarative agent | [pnp/copilot-pro-dev-samples](https://github.com/pnp/copilot-pro-dev-samples) | `copilot-pro-dev-samples/da-threews-3d-studio` | Microsoft 365 Copilot |
| three.ws 3D models message extension | [pnp/teams-dev-samples](https://github.com/pnp/teams-dev-samples) | `teams-dev-samples/msgext-threews-3d-models-ts` | Teams |
| three.ws 3D viewer web part | [pnp/sp-dev-fx-webparts](https://github.com/pnp/sp-dev-fx-webparts) | `sp-dev-fx-webparts/react-threews-3d-viewer` | SharePoint |

Contributor handle in every README and `assets/sample.json`: [nirholas](https://github.com/nirholas).

## Gallery rules

The rules below are enforced by `scripts/validate-sample-json.mjs`. The metadata schemas in `scripts/schemas` are vendored from each gallery repository; refresh them from the gallery before opening a PR if the gallery changed.

| Rule | Copilot | Teams | SharePoint |
| --- | --- | --- | --- |
| Folder name | `da-` prefix for declarative agents | `msgext-` prefix, `-ts` suffix for TypeScript | `react-` prefix, no `sample` or `webpart` in the name |
| `assets/sample.json` name | `pnp-copilot-pro-dev-<folder>` | `pnp-sp-dev-teams-sample-<folder>` | `pnp-sp-dev-spfx-web-parts-<folder>` |
| `url` | `https://github.com/pnp/<gallery>/tree/main/samples/<folder>` | same pattern | same pattern |
| Extra fields | none | `reponame` and `references` required | metadata `SAMPLE-TYPE`, `CLIENT-SIDE-DEV`, `SPFX-VERSION` |
| Thumbnails | PNG under `assets/`, 1920x1080, alt text | same | same |
| README sections | Summary, Compatibility, Contributors, Version history, Prerequisites, Minimal path to awesome, Features, Help, Disclaimer | Summary, Tools and Frameworks, Prerequisites, Contributors, Version history, Disclaimer, Minimal Path to Awesome, Features | Summary, Compatibility, Applies to, Contributors, Version history, Prerequisites, Minimal path to awesome, Features, Help, Disclaimer |
| README last line | visitor tracker image with the gallery and folder in the URL | same | same |
| Forbidden in a PR | `node_modules`, build output, `.sppkg`, `appPackage/build`, `.localConfigs`, user env files, archives, logs | same | same |

Sources: each gallery's `CONTRIBUTING.md`, README template (`samples/README-template.md`) and sample metadata schema in the repositories linked above, and the PnP sample gallery at [adoption.microsoft.com/sample-gallery](https://adoption.microsoft.com/sample-gallery/).

## Checklist

- [x] Folder names follow each gallery's convention (validator: folder pattern).
- [x] `assets/sample.json` validates against the gallery schema and matches the folder, url, download url and thumbnails.
- [x] README from the gallery template, contributor handle linked, disclaimer present, visitor tracker is the last line.
- [x] Real 1920x1080 screenshots under `assets/`, captured from each sample's own code against live three.ws data (`scripts/capture-screenshots.mjs`).
- [x] No secrets, keys or tenant ids (`scripts/scan-secrets.mjs`).
- [x] No build output, dependencies or packages committed; lockfiles committed (`package-lock.json`).
- [x] Toolchain versions: SPFx 1.24.1 on Node 22, 24 or 26 (`.nvmrc` 24); Microsoft 365 Agents Toolkit layout with manifest 1.30 for the Copilot and Teams samples; Teams AI library v2 for the message extension.
- [x] Each sample builds in a scratch copy (SPFx: `npm ci` then `npm run build` produces `react-threews-3d-viewer.sppkg`; Teams: `npm ci`, `npm run build`, `npm run lint`; the Copilot sample has no build step, its OpenAPI operations and card paths are checked by `verify-live.mjs`, and Agents Toolkit validates the package at provision time).
- [x] Every three.ws call each sample makes succeeds against production (`scripts/verify-live.mjs`).
- [ ] The keyed `listMyAgents` check needs a real three.ws API key in `THREEWS_API_KEY` (owner).
- [ ] A tenant screenshot of the sample running inside Teams, Copilot or SharePoint is optional for the galleries; the staged screenshots render the real cards and web part without a tenant.

## Verify before you open a PR

```
node integrations/microsoft/pnp-samples/scripts/validate-sample-json.mjs
node integrations/microsoft/pnp-samples/scripts/scan-secrets.mjs
THREEWS_API_KEY=<your key> node integrations/microsoft/pnp-samples/scripts/verify-live.mjs
```

All three must exit 0. `verify-live.mjs --generate` also runs one real text-to-3D generation, and `--bot <url>` drives a running Teams bot with real invoke activities.

To refresh the screenshots after changing a sample, build the SPFx package and the Teams `dist` in a scratch copy, then run `node scripts/capture-screenshots.mjs --teams-dist <dir> --sppkg <file> --spfx-dir <dir>`. It needs Playwright and writes into each sample's `assets` folder.

## Owner steps: open the pull requests

Do these once per sample (three times). They are the owner's because they publish to Microsoft-owned repositories under your GitHub identity.

1. Fork the gallery repository on GitHub (for example `pnp/copilot-pro-dev-samples`) and clone your fork.
1. Create a branch, for example `git switch -c add-threews-3d-studio`.
1. Copy the sample folder into `samples/` of the fork, keeping the folder name, for example `cp -r integrations/microsoft/pnp-samples/copilot-pro-dev-samples/da-threews-3d-studio <fork>/samples/`.
1. Re-run the gallery's own checks if it has any (its PR template lists them) and confirm the PR checklist boxes.
1. Commit, push the branch to your fork and open the pull request against `main` of the gallery. Use the sample title as the PR title and fill in the PR template.
1. Answer reviewer comments. Galleries usually merge within a few weeks.

The Copilot sample's `env/.env.dev.user` and the Teams samples' `env/*.user` files hold secrets and are gitignored. Do not add them to a PR.
