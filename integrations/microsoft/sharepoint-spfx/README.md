# three.ws 3D for SharePoint and Viva Connections

A SharePoint Framework (SPFx 1.24.1) solution that puts three.ws on modern SharePoint pages, Teams tabs and the Viva Connections dashboard. Site owners add it from the page toolbox and pick what to show with a search box. No code, no custom script.

| Component | What it shows |
| --- | --- |
| three.ws Agent web part | A live, animated three.ws agent a visitor can watch and talk to (`<agent-3d agent-id>`). |
| three.ws 3D Model web part | An interactive Forge model, or any https GLB file, rendered with the three.ws viewer. |
| three.ws Agent card (Adaptive Card Extension) | An agent card for Viva Connections: avatar poster, name, live status, a quick view and a link to the agent page. |

Admin and site-owner steps live in [docs/microsoft-sharepoint.md](../../../docs/microsoft-sharepoint.md). The store listing material is in [marketing/growth/submissions/programs/microsoft-sharepoint-spfx.md](../../../marketing/growth/submissions/programs/microsoft-sharepoint-spfx.md).

## Build

SPFx 1.24 needs Node 22.14+ (or 24+), which the package `engines` field enforces. The toolchain is installed inside this folder and never touches the root lockfile.

    cd integrations/microsoft/sharepoint-spfx
    npm ci
    npm run package:sharepoint       # heft test + production build + .sppkg + package validation
    # or, from the repository root:
    npm run package:sharepoint

The package lands in `sharepoint/solution/three-ws-3d.sppkg` (`includeClientSideAssets: true`, so every bundle ships inside it).

| Script | Purpose |
| --- | --- |
| `npm test` | Unit tests for the property pane data layer (`src/lib/threeWsApi.test.ts`). |
| `npm run validate` | Opens the built `.sppkg` and checks manifest ids, versions, bundled assets, theme variants, branding rules and the runtime pin (53 checks). |
| `npm run harness` | Mounts the compiled web parts and the card in Chromium under SharePoint Online's script CSP against live three.ws data. Screenshots land in `harness-output/`. `--serve` only serves `http://localhost:3135`. |
| `npm start` | `heft start` for the SharePoint hosted workbench. |

## How the runtime loads

The bundles load one script, `https://three.ws/agent-3d/1.5.2/agent-3d.js`, with a pinned Subresource Integrity hash (`src/lib/runtime.ts`, mirrored in `scripts/validate-package.mjs` and checked for agreement). SharePoint's script CSP needs one Trusted script sources entry, `https://three.ws/agent-3d/1.5.2/`. When it is missing, the web part names that exact entry in its message. Nothing else leaves three.ws: the agent and Forge lookups are public, credential-less reads of `https://three.ws/api`.

## Layout

| Path | Contents |
| --- | --- |
| `src/webparts/` | The two web parts. |
| `src/adaptiveCardExtensions/threeWsAgentCard/` | The Viva Connections card and quick view. |
| `src/lib/` | Stage (mounts `<agent-3d>`), runtime loader, API client and debounced search picker, theme variants. |
| `scripts/` | `validate-package.mjs`, `harness.mjs` and its SPFx host stand-in. |
| `config/` | SPFx build configuration, including `package-solution.json`. |

## Owner steps

Uploading to a tenant App Catalog, adding the Trusted script sources entry and submitting to AppSource are owner actions, listed with the exact click path in the admin guide.

Microsoft, SharePoint, Viva and Microsoft Teams are trademarks of the Microsoft group of companies. three.ws and Microsoft have announced a partnership. This package is not endorsed by Microsoft.
