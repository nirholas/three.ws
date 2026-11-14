# AppSource listing for a Power BI custom visual: three.ws 3D Models

Program: Power BI visuals on Microsoft AppSource, submitted through Partner Center as a "Power BI visual" offer.
Order: 808 (microsoft 08). Shared facts and owner-only inputs: [README.md](./README.md).
Prepared: 2026-11-11. **Status: ready to submit. Nothing has been submitted.** Once submitted it is "in review" until Microsoft publishes it.
Approved partnership wording only: "three.ws and Microsoft have announced a partnership" and "three.ws is live on Microsoft Marketplace".

**Listing type: uncertified.** Certification forbids visuals that access external services or resources. This visual downloads 3D models from `https://three.ws`, so it carries the `WebAccess` privilege and cannot be certified. Do not request certification in Partner Center, and never call the visual certified. Uncertified AppSource visuals still install from AppSource in Power BI Desktop and the Service. They cannot be exported to PowerPoint or included in email subscriptions, and administrators can block uncertified visuals for their organization. Say that in the listing.

## What gets submitted

| Item | Where it comes from |
|---|---|
| `.pbiviz` package | `cd integrations/microsoft/power-bi-visual && npm ci && npm run package` writes `dist/threeWsModels8BB6C69EBE4F4886851A7E3082576E7B.1.0.0.0.pbiviz` |
| Sample report (`sample.pbix`) | Built by the owner in Power BI Desktop with the exact steps in the visual's [README](../../../../integrations/microsoft/power-bi-visual/README.md#building-the-sample-report-samplepbix). It uses three production models: a GLB URL, a model id and a Draco GLB |
| Logo, 300 x 300 PNG | [`marketing/microsoft/media/powerbi/logo-300x300.png`](../../../microsoft/media/powerbi/logo-300x300.png), rendered by `npm run media:microsoft` from the same brand cube as the visual icon (listed under Listing media below) |
| Screenshots, 1366 x 768 PNG, one to five | Taken from `sample.pbix` in Power BI Desktop: grid with the colour measure, single model, turntable gallery with 30 rows, cross-filtering with a bar chart, the landing page |
| Source code link | `https://github.com/nirholas/three.ws/tree/main/integrations/microsoft/power-bi-visual` (also `gitHubUrl` in `pbiviz.json`) |
| Support link | `https://three.ws/support`, contact `support@three.ws` (author in `pbiviz.json`) |
| Privacy policy | `https://three.ws/legal/privacy` |
| End user license agreement | Standard Contract for Microsoft Commercial Marketplace |

## Listing copy

**Name:** three.ws 3D Models

**Summary (100 characters or fewer):** Show interactive 3D models from three.ws in your report, coloured, sized and filtered by your data.

**Description:**

> three.ws 3D Models turns a column of 3D model links into interactive 3D inside your report. Bind a three.ws model id or GLB link to Model, and optionally a label to Category, a measure to Colour by and a measure to Scale by.
>
> One row fills the visual with a single model you can orbit. Several rows form a grid, and larger sets become a turntable gallery. Clicking a model cross-filters the rest of the report, selections in other visuals highlight the matching models, and tooltips show any fields you add.
>
> Format options: background, lighting (studio, soft daylight, dramatic, flat), layout, auto-rotate and speed, colour mode (original materials, colour by measure, single tint) and labels. Keyboard navigation, high-contrast themes and the context menu are supported.
>
> Network access: the visual downloads models only from https://three.ws. No report data is sent anywhere. Model ids are looked up with a public read of https://three.ws/api/forge-creation. Because of this network access the visual is not certified: it cannot be exported to PowerPoint or included in email subscriptions, and your administrator may need to allow uncertified visuals.
>
> Create models for free at https://three.ws.

**Search keywords:** 3D, GLB, model viewer

## Checklist with evidence

| Requirement | State | Evidence |
|---|---|---|
| Package builds with the current tools | Pass | pbiviz 7.2.1, API 5.11.1. `npm run package` succeeded on 2026-11-11 (316,682 bytes) |
| Lint with `eslint-plugin-powerbi-visuals` | Pass | `npm run lint` exits 0 |
| Unit tests with `powerbi-visuals-utils-testutils` | Pass | `npm test`: data-role mapping, selection, landing page, per-tile errors, real production GLB |
| Packaged build works against production | Pass | `npm run verify:live` loads the built `.pbiviz` and renders a GLB URL, a model id and a Draco GLB from three.ws (3 of 3 on 2026-11-11) |
| Rendering events, landing page, high contrast, keyboard, context menu, localization | Pass | Certification table in the visual README; each row is covered by `test/visual.test.ts` |
| `WebAccess` limited to one origin | Pass | `capabilities.json` privileges: `https://three.ws` only |
| Model lookup works from the Power BI origin | Owner | Needs the production deploy carrying commit `3a90bdcc4` (CORS on `/api/forge-creation`). GLB URLs already work; ids need this deploy |
| Sample `.pbix`, logo and screenshots | Owner | Steps in the visual README |
| Partner Center offer created and submitted | Owner | Partner Center, Marketplace offers, New offer, Power BI visual |
