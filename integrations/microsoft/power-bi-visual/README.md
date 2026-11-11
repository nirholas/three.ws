# three.ws 3D Models: a custom visual for Power BI

Turn a column of GLB URLs or three.ws model ids into interactive 3D inside a Power BI report. One row fills the visual with a single model. Several rows form a grid, and more than fit become a turntable gallery. Models are coloured or sized by a measure, a click cross-filters the rest of the report, and hovering shows tooltips.

- Visual name: `three.ws 3D Models` (`threeWsModels8BB6C69EBE4F4886851A7E3082576E7B`, version 1.0.0.0)
- API: `powerbi-visuals-api` 5.11.1, built with `powerbi-visuals-tools` (pbiviz) 7.2.1
- Rendering: three.js 0.187.0 bundled into the package, with the meshopt decoder and the Draco decoder (WebAssembly, run in a Blob worker) bundled too. Nothing is loaded from a CDN at runtime.
- Network: only `https://three.ws` (the `WebAccess` privilege). Model files come from the three.ws CDN, and model ids resolve through the public read `GET https://three.ws/api/forge-creation?id=<uuid>` documented in [docs/api-reference.md](../../../docs/api-reference.md).

## Fields (data roles)

| Field | Kind | What goes in it |
|---|---|---|
| Category | Grouping, optional | A label per model, such as a product or site. A click on a model selects this row and cross-filters the report. Without it, the model's own name is used. |
| Model | Grouping, required | A GLB URL on `https://three.ws` (for example `https://three.ws/cdn/forge/nvidia/36643bd7-cc78-45ea-a0c1-f7da283d8f63.glb`), a model page link (`https://three.ws/m/<uuid>`) or a bare model id (`18656b0c-796d-4518-9e6e-07c6e22a2d29`). |
| Colour by | Measure, optional | Maps onto the low to high colour ramp when Colour mode is "Colour by measure". |
| Scale by | Measure, optional | Sizes each model relative to the largest absolute value. Zero and negatives get the minimum size (35%); blanks keep full size. |
| Tooltips | Measures, any number | Extra fields shown on hover, after Category, Colour by and Scale by. |

The data view is reduced to the first 100 rows (`top` reduction). When Power BI reduces the data, the visual says "Showing the first 100 rows".

Values that are not usable are reported on that tile only: a host other than three.ws, plain `http://`, an empty cell, text that is neither a URL nor an id, an unknown id, a 404 or 403 from the CDN, a broken file. Each message says what is wrong, and network failures have a Retry button.

## Format pane

| Card | Setting | Default |
|---|---|---|
| Scene | Background (empty means transparent, so the report page shows through) | empty |
| Scene | Lighting: Studio, Soft daylight, Dramatic, Flat | Studio |
| Scene | Layout: Auto (grid up to 24 models while tiles stay at least 96 px, then the turntable gallery), Grid, Turntable gallery | Auto |
| Scene | Auto-rotate, and rotation speed in degrees per second (1 to 180) | on, 20 |
| Colours | Colour mode: Original materials, Colour by measure, Single tint | Original materials |
| Colours | Low value colour, high value colour, tint colour | #2B6CB0, #E53E3E, #118DFF |
| Labels | Show labels, text size (8 to 32), text colour | on, 12, #252423 |

## Interaction

- Click selects a model through the selection manager, and Ctrl, Cmd or Shift click adds or removes one. Clicking empty space or pressing Escape clears the selection. Selections made in other visuals and cross-highlights fade the models that are not part of them.
- Right-click opens the Power BI context menu for the model (or the visual, on empty space).
- Drag orbits a model. The open button on a ready tile launches the model in three.ws through `host.launchUrl`.
- Keyboard: every tile is focusable. Arrow keys, Home and End move between tiles (or turn the gallery), Enter and Space select.
- Rendering events: `renderingStarted` fires on every update; `renderingFinished` fires once every visible tile has drawn or failed and a frame is on screen; `renderingFailed` fires when the visual cannot draw at all (no WebGL, or an exception). A superseded update is finished before the next one starts.
- With no fields bound, a landing page explains each field with example values. With only Category bound, it points at the Model field.

## Build, test, package

```bash
cd integrations/microsoft/power-bi-visual
npm ci
npm run lint            # eslint-plugin-powerbi-visuals, the rule set certification uses
npm run typecheck       # visual and tests
npm test                # unit tests in headless Chromium with powerbi-visuals-utils-testutils
npm run package         # writes dist/threeWsModels8BB6C69EBE4F4886851A7E3082576E7B.1.0.0.0.pbiviz
npm run verify:live     # packages, then loads the compiled .pbiviz against production three.ws models
npm run audit:certification
```

Every script first runs `prepare:generated`: `scripts/embed-decoders.mjs` writes the Draco decoder (wrapper and wasm from the installed three.js) into `src/generated/`, and `scripts/build-strings.mjs` regenerates `stringResources/en-US/resources.resjson` from `src/strings.ts`.

`npm test` covers the data-role mapping, selection (click, multi-select, background clear, report selections, highlights, hosts that disallow interaction), the landing page states, the per-tile error path (blocked host, a real 404 from the CDN with Retry, web access turned off by an administrator), the gallery, rendering events, high contrast, the format pane and a real production GLB that draws pixels.

`npm run verify:live` unpacks the built `.pbiviz`, injects its compiled `visual.js` and CSS into Chromium, creates the visual through `window.powerbi.visuals.plugins[guid]` with a testutils host and renders a GLB URL, a model id (meshopt and WebP web GLB) and a Draco GLB from production. Screenshots go to `test/live/out/` (git-ignored).

## Try it in a report

**Power BI Desktop:** Visualizations pane, the three dots, "Import a visual from a file", then pick the `.pbiviz` from `dist/`.

**Power BI Service, developer mode:** turn on "Develop a visual" under Settings, Developer, then run `npx pbiviz install-cert` once and `npm start` (serves the visual on `https://localhost:8080`). Add the "Developer visual" from the Visualizations pane in a report in edit mode.

### Building the sample report (sample.pbix)

1. Open Power BI Desktop and choose Blank report.
2. Home, Enter data. Name the table `Models` and enter these columns and rows:

   | Product | Model | Sales | Units |
   |---|---|---|---|
   | Sculpture | https://three.ws/cdn/forge/nvidia/36643bd7-cc78-45ea-a0c1-f7da283d8f63.glb | 1200 | 40 |
   | Desk lamp | 18656b0c-796d-4518-9e6e-07c6e22a2d29 | 3400 | 90 |
   | Mannequin | https://three.ws/api/avatar/optimize?src=https://three.ws/avatars/cesium-man.glb&draco=1 | 2100 | 65 |

   Set the data type of Sales and Units to Whole number, then Load.
3. Import the visual: Visualizations pane, the three dots, Import a visual from a file, `dist/threeWsModels8BB6C69EBE4F4886851A7E3082576E7B.1.0.0.0.pbiviz`. Accept the prompt.
4. Add "three.ws 3D Models" to the page and size it to roughly half the page width.
5. Drag `Product` to Category, `Model` to Model, `Sum of Sales` to Colour by, `Sum of Units` to Scale by.
6. Format pane: Colours, Colour mode, Colour by measure. Scene, Lighting, Studio.
7. Add a Clustered bar chart with `Product` on the Y-axis and `Sales` as the value, beside the 3D visual. Clicking a bar highlights the matching model; clicking a model filters the bar chart.
8. Add a page title text box: "three.ws 3D Models sample".
9. File, Save as, `sample.pbix`. For AppSource, also export a PDF or screenshots of the page for the listing.

## Certification requirements and how each is met

The visual is submitted as an **uncertified** AppSource visual. Certification forbids visuals that access external services or resources, and this visual's purpose is to load 3D models from three.ws, so it cannot pass that one rule. Everything else on the certification list is met so the visual behaves as well as a certified one.

| Requirement (Microsoft's certified visual list) | Status | How |
|---|---|---|
| No access to external services or resources | Not met, by design | Models are downloaded from `https://three.ws`. The `WebAccess` privilege is declared with that single origin, `npm run audit:certification` reports exactly the three `fetch` call sites, and any other host is refused with a message before a request is made. |
| Source in a public repository, reviewable | Met | `gitHubUrl` in `pbiviz.json` points at this folder. |
| Built with the latest `powerbi-visuals-tools` and API | Met | pbiviz 7.2.1, API 5.11.1. |
| Passes `npm run lint` with `eslint-plugin-powerbi-visuals` | Met | `npm run lint` exits 0. |
| `pbiviz package` builds without errors | Met | `npm run package`. |
| Rendering events API | Met | Started, finished and failed as described under Interaction, covered by tests. |
| No unsafe DOM or code execution (`innerHTML` with data, `eval`, `new Function`) | Met | DOM is built with `createElement` and `textContent` (`src/dom.ts`). The Draco decoder runs from a Blob worker created from bundled code. |
| No cookies, local storage or session storage | Met | The visual keeps no state outside the report. Lookups use `credentials: "omit"`. |
| Works in Power BI Service, Desktop and mobile, in all browsers | Met | Standard DOM and WebGL. Without WebGL the visual says so and fires `renderingFailed`. Hosts that block web access get a specific message. |
| Context menu | Met | `selectionManager.showContextMenu` on tiles and on empty space. |
| Selection, highlight and multi-visual selection | Met | `supportsHighlight`, `supportsMultiVisualSelection`; tested. |
| Tooltips | Met | Default and canvas tooltips with the Tooltips role. |
| Keyboard navigation and focus | Met | `supportsKeyboardFocus`, focusable tiles, arrow keys, Enter, Space, Escape, visible focus rings. |
| High-contrast mode | Met | Uses `colorPalette.isHighContrast` and the palette's foreground, background and selected colours for every surface the visual draws. Measure tints are switched off in high contrast because the palette has no ramp colours; model materials keep their shading. |
| Localization | Met | Every string is in `stringResources/en-US/resources.resjson`; roles, cards, settings and enum items use `displayNameKey`. Translators add `stringResources/<locale>/resources.resjson`. |
| Landing page | Met | `supportsLandingPage` and `supportsEmptyDataView`. |
| Format pane with the formatting model API | Met | `powerbi-visuals-utils-formattingmodel` 7.1.0, localized. |
| Resize and high-DPI | Met | The canvas follows the viewport on every update at `devicePixelRatio` (capped at 2); tiles are reused across resizes so models are not downloaded again. |
| Handles errors without breaking the report | Met | Per-tile messages, Retry for network failures, WebGL context loss handled, a superseded update is finished before the next. |

## Licenses

The visual's source is part of the three.ws repository. Bundled third-party code: three.js (MIT), the Power BI visuals API and utility packages (MIT), the Draco decoder shipped with three.js (Apache 2.0), meshoptimizer's decoder shipped with three.js (MIT). The license texts live in each package under `node_modules/` after `npm ci`.

Microsoft and Power BI are trademarks of the Microsoft group of companies. three.ws and Microsoft have announced a partnership; this visual is not certified by Microsoft.
