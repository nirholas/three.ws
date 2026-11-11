# three.ws Accessibility Conformance Report

WCAG Edition, based on the ITI VPAT 2.x template (VPAT is a registered service mark of the Information Technology Industry Council).

## Name of Product/Version

three.ws web application, version 1.5.2 (`package.json`), served at https://three.ws.

## Report Date

2026-11-11

## Product Description

three.ws is a browser platform for making and using 3D AI agents: an OS-style home desktop, a text and photo to 3D model generator (Forge), an agent builder, agent profile pages with a live 3D body, an embeddable agent widget, sign-in, and the Microsoft Teams tab and Microsoft 365 activation pages.

## Contact Information

- Accessibility feedback and support: support@three.ws, or the support page at https://three.ws/support
- Public statement: https://three.ws/accessibility

## Notes

**Scope.** This report covers the 18 page types that make up the core journeys, evaluated in both colour themes (dark and light) at a 1366px desktop viewport and a 400px phone viewport:

| Group | Pages |
| --- | --- |
| Top-priority pages (the 12 highest-priority entries in `data/pages.json`) | `/` (home desktop), `/start`, `/agi`, `/discover`, `/sign-language`, `/everything`, `/prompts`, `/create`, `/genesis`, `/create-agent`, `/create/prompt`, `/image-to-3d` |
| Enterprise | `/login`, `/microsoft/activate`, `/microsoft/teams-tab` |
| Product | `/forge`, an agent profile (`/agents/{id}`), the agent embed (`/agent/{id}/embed`) |

The wallet pages (`/wallet`, `/agent-wallet`, `/claim-wallet`, `/vaults`) are held to the same rules by a separate test suite (`tests/e2e/a11y-top-pages.spec.js`, `tests/e2e/w3ag-wallet.spec.js`) and are documented in [../accessibility.md](../accessibility.md). Pages outside this scope (labs, games, the 3D world at `/play`, developer tools) have not been evaluated for this report and are not covered by its claims.

**Content users create.** Agents, avatars, 3D models and their names and descriptions are written by users. This report rates the product's own interface and the way it presents that content. It does not rate whether a given user's text is meaningful.

## Evaluation Methods Used

1. **Automated testing.** `npm run audit:a11y` ([scripts/audit-a11y.mjs](../../scripts/audit-a11y.mjs)) runs axe-core 4.14 through Playwright in Chromium against every page above in 4 configurations (2 themes x 2 viewports, reduced motion emulated) with the WCAG 2.0, 2.1 and 2.2 A and AA rule tags. Baseline on 2026-11-11: 104 serious or critical violations. After remediation: 0. Reports: [reports/axe-latest.md](reports/axe-latest.md).
2. **Keyboard-only walkthrough.** Every page walked with Tab and Shift+Tab, checking focus order, visible focus, keyboard traps, the skip link, and that focus is never hidden under sticky bars. Scripted by [scripts/a11y-manual-probe.mjs](../../scripts/a11y-manual-probe.mjs); results in [reports/manual-probe.json](reports/manual-probe.json).
3. **Screen reader.** Orca 46.1 on Linux (GNOME accessibility stack, AT-SPI) with Chromium 145, using browse-mode navigation by heading, landmark, form field, button and graphic, plus Tab. Transcripts and findings in [walkthroughs.md](walkthroughs.md).
4. **Zoom and reflow.** Browser zoom at 200% and 400% (400% is equivalent to a 320 CSS pixel viewport), checked for horizontal scrolling and clipped content.
5. **Text spacing.** The WCAG 1.4.12 spacing bookmarklet values (line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em) injected on every page.
6. **Forced colours.** Chromium `forced-colors: active` emulation, checking that focus indicators and control boundaries survive.

## Applicable Standards/Guidelines

| Standard/Guideline | Included In Report |
| --- | --- |
| Web Content Accessibility Guidelines 2.0 | Level A (Yes), Level AA (Yes), Level AAA (No) |
| Web Content Accessibility Guidelines 2.1 | Level A (Yes), Level AA (Yes), Level AAA (No) |
| Web Content Accessibility Guidelines 2.2 | Level A (Yes), Level AA (Yes), Level AAA (No) |

## Terms

- **Supports**: The functionality of the product has at least one method that meets the criterion without known defects or meets with equivalent facilitation.
- **Partially Supports**: Some functionality of the product does not meet the criterion.
- **Does Not Support**: The majority of product functionality does not meet the criterion.
- **Not Applicable**: The criterion is not relevant to the product.

## WCAG 2.x Report

### Table 1: Success Criteria, Level A

| Criteria | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| 1.1.1 Non-text Content (Level A) | Partially Supports | Images, icons and controls have text alternatives; decorative images use empty `alt`. Every 3D viewer canvas is named with the agent or model name and a short description plus how to orbit it with the keyboard ([src/shared/viewer-description.js](../../src/shared/viewer-description.js)). Exception: the geometry of a 3D model has no long description. A screen reader user hears the model's name and the prompt or description its creator wrote, not a description of its shape. |
| 1.2.1 Audio-only and Video-only (Prerecorded) (Level A) | Not Applicable | The evaluated pages contain no prerecorded audio-only or video-only media. |
| 1.2.2 Captions (Prerecorded) (Level A) | Not Applicable | The evaluated pages contain no prerecorded synchronized media. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) (Level A) | Not Applicable | The evaluated pages contain no prerecorded synchronized media. |
| 1.3.1 Info and Relationships (Level A) | Supports | Headings, lists, tables and landmarks are marked up semantically. Form fields have programmatic labels. Every evaluated page exposes a main landmark (the home desktop gained one during this evaluation). axe reports no violations. |
| 1.3.2 Meaningful Sequence (Level A) | Supports | DOM order matches the visual reading order on every evaluated page at both viewports. |
| 1.3.3 Sensory Characteristics (Level A) | Supports | Instructions do not rely on shape, size, position or sound alone. |
| 1.4.1 Use of Color (Level A) | Supports | Status, errors and selected states carry text or an icon in addition to colour. Links inside text are underlined. |
| 1.4.2 Audio Control (Level A) | Supports | No audio plays automatically. Agent speech starts only after the user sends a message or presses a play control, and can be stopped. |
| 2.1.1 Keyboard (Level A) | Supports | All functionality is operable by keyboard. 3D viewers orbit with the arrow keys and zoom with plus, minus, Page Up and Page Down once focused ([src/viewer.js](../../src/viewer.js)). Collapsed navigation menus are removed from the Tab order and open with Enter or Space. |
| 2.1.2 No Keyboard Trap (Level A) | Supports | No keyboard traps were found. Modal dialogs trap focus on purpose while open and release it on Escape or close ([src/shared/focus-trap.js](../../src/shared/focus-trap.js)). |
| 2.1.4 Character Key Shortcuts (Level A) | Partially Supports | Some pages (for example `/prompts` and `/everything`) use a single-character shortcut, `/`, to move focus to the search field. It is ignored while typing in a text field, carries no modifier, and only moves focus, so an accidental trigger changes nothing. Exception: the shortcut cannot be turned off or remapped, and it is active whenever focus is outside a text field. |
| 2.2.1 Timing Adjustable (Level A) | Supports | No evaluated flow imposes a time limit on reading or completing a task. Sign-in sessions persist across visits; long-running generation jobs continue if the user leaves and returns. |
| 2.2.2 Pause, Stop, Hide (Level A) | Partially Supports | Auto-rotating 3D previews and animated backgrounds stop when the operating system's reduced-motion setting is on. Avatar profiles whose model carries animation clips show a "Pause animation" button. Exception: on some pages (for example the `/discover` grid and agent profile turntables) there is no on-page control to pause the rotation for a user who has not set reduced motion. |
| 2.3.1 Three Flashes or Below Threshold (Level A) | Supports | No content flashes more than three times per second. |
| 2.4.1 Bypass Blocks (Level A) | Supports | Every page with the shared header has a "Skip to content" link that targets the main landmark (a broken target on `/agi` was fixed during this evaluation). Pages without the shared header (home desktop, `/start`, the Teams tab, the embed) expose a main landmark; the home desktop and the embed gained theirs during this evaluation. |
| 2.4.2 Page Titled (Level A) | Supports | Every page has a unique, descriptive `<title>`. |
| 2.4.3 Focus Order (Level A) | Supports | Focus order follows the visual order. Links inside collapsed menus no longer receive focus. Dialogs move focus in and return it to the opener on close. |
| 2.4.4 Link Purpose (In Context) (Level A) | Supports | Link text, or link text with its surrounding sentence or list item, describes the destination. Icon-only links have accessible names. |
| 2.5.1 Pointer Gestures (Level A) | Partially Supports | All controls work with a single pointer without a path. Exception: on touch screens, zooming a 3D viewer uses a two-finger pinch with no on-screen zoom buttons. A keyboard (plus and minus) and a mouse wheel can zoom, and the model is fully visible at the default zoom. |
| 2.5.2 Pointer Cancellation (Level A) | Supports | Actions fire on pointer up (native `click`). No action completes on pointer down. |
| 2.5.3 Label in Name (Level A) | Supports | Accessible names contain the visible label text. axe reports no `label-content-name-mismatch` violations. The home desktop clock was announced as a full locale date string instead of the time it shows; its name now starts with the visible time (`00cd2491c`, with an e2e test). |
| 2.5.4 Motion Actuation (Level A) | Supports | No function is triggered by device motion. |
| 3.1.1 Language of Page (Level A) | Supports | Every page declares `<html lang>`, and the language switcher updates it when the interface language changes ([src/i18n.js](../../src/i18n.js)). |
| 3.2.1 On Focus (Level A) | Supports | Receiving focus never changes context. |
| 3.2.2 On Input (Level A) | Supports | Changing a field or selecting an option does not navigate or submit without warning. Filters update results in place. |
| 3.2.6 Consistent Help (Level A) | Supports | The Support, documentation and status links are in the same place in the shared footer on every page that has it. |
| 3.3.1 Error Identification (Level A) | Supports | Input errors are described in text next to the field and announced, for example the sign-in form's invalid email message. |
| 3.3.2 Labels or Instructions (Level A) | Supports | Every field has a visible label or a visible placeholder backed by a programmatic label, plus hints where the format matters (for example the tag field: "Press Enter or comma to add"). |
| 3.3.7 Redundant Entry (Level A) | Supports | Multi-step flows (`/start`, `/create-agent`) keep entered values when moving back and forward between steps. |
| 4.1.1 Parsing (Level A) | Not Applicable | Obsolete and removed in WCAG 2.2; treated as always satisfied for WCAG 2.0 and 2.1 per the W3C errata. |
| 4.1.2 Name, Role, Value (Level A) | Supports | Native controls are used wherever possible. Custom controls expose role, name and state (for example `aria-expanded` on menu buttons, `aria-pressed` on toggles, `aria-selected` on tabs). Orca announced "Build collapsed push button" and "Email address entry" as expected. The agent's idle thought bubble was announced as "Agent is thinking" before anyone spoke; it now leaves the accessibility tree while idle and returns as a live status region when the agent is working. |

### Table 2: Success Criteria, Level AA

| Criteria | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| 1.2.4 Captions (Live) (Level AA) | Not Applicable | The evaluated pages contain no live synchronized media. |
| 1.2.5 Audio Description (Prerecorded) (Level AA) | Not Applicable | The evaluated pages contain no prerecorded synchronized media. |
| 1.3.4 Orientation (Level AA) | Supports | No page locks orientation. Every page works in portrait and landscape. |
| 1.3.5 Identify Input Purpose (Level AA) | Supports | Fields that collect the user's own data carry the matching `autocomplete` token, for example `email` and `current-password` on sign-in. |
| 1.4.3 Contrast (Minimum) (Level AA) | Supports | All text meets 4.5:1 (3:1 for large text) in both themes; axe reports no contrast violations across 72 page configurations. Light-theme palettes were added to `/discover` and `/agents` during this evaluation. |
| 1.4.4 Resize Text (Level AA) | Supports | Text scales to 200% with browser zoom without loss of content or function. |
| 1.4.5 Images of Text (Level AA) | Supports | Text is real text. The only images of text are logos. |
| 1.4.10 Reflow (Level AA) | Supports | At 400% zoom (320 CSS pixels) every evaluated page reflows to one column without horizontal scrolling, except content that needs two dimensions: 3D viewers and data tables, which scroll inside their own region. |
| 1.4.11 Non-text Contrast (Level AA) | Supports | Field boundaries, focus indicators and control icons meet 3:1 against adjacent colours in both themes. The sign-in fields and the footer newsletter field were strengthened during this evaluation. |
| 1.4.12 Text Spacing (Level AA) | Supports | With the WCAG text-spacing values applied, no content is clipped or overlapped on any evaluated page. |
| 1.4.13 Content on Hover or Focus (Level AA) | Supports | Tooltips and glossary definitions can be dismissed with Escape without moving the pointer, stay open while hovered, and remain until dismissed or focus leaves ([public/glossary.js](../../public/glossary.js)). |
| 2.4.5 Multiple Ways (Level AA) | Supports | Pages can be reached through the header navigation, site search, the footer, the sitemap at `/sitemap.xml`, and the home desktop's Start menu. |
| 2.4.6 Headings and Labels (Level AA) | Supports | Headings describe their sections and every full page has exactly one level 1 heading. The embed widget has none on purpose, so it does not compete with the outline of the page that hosts it. Labels describe their fields. |
| 2.4.7 Focus Visible (Level AA) | Supports | Every focusable element shows a visible indicator, including under forced colours. The prompt search, genesis fields, create-agent inputs, sign-language spell field and footer newsletter field gained a visible ring or boundary during this evaluation, and invisible controls (the avatar profile's Pause button before any clip loads, the Teams tab stage before the agent is ready) were taken out of the Tab order. |
| 2.4.11 Focus Not Obscured (Minimum) (Level AA) | Supports | Sticky headers and toolbars never fully cover the focused element. The `/prompts` sticky toolbar now reserves scroll padding so keyboard focus stays clear of it (`tests/e2e/enterprise-a11y.spec.js`). |
| 2.5.7 Dragging Movements (Level AA) | Partially Supports | Sliders and drop zones have click or keyboard alternatives (file pickers, arrow keys). Exception: orbiting a 3D viewer with a pointer is drag-only; the single-pointer alternative is keyboard orbit, and there are no on-screen rotate buttons. |
| 2.5.8 Target Size (Minimum) (Level AA) | Supports | Targets are at least 24 by 24 CSS pixels or have the required spacing; touch layouts raise icon controls to 44 pixels. axe reports no `target-size` violations. |
| 3.1.2 Language of Parts (Level AA) | Supports | The interface is translated as a whole; proper names, code and wallet addresses are marked `translate="no"`. Text that users write in another language is not marked up by language. |
| 3.2.3 Consistent Navigation (Level AA) | Supports | The shared header and footer appear in the same order on every page that uses them. |
| 3.2.4 Consistent Identification (Level AA) | Supports | Components with the same function share the same name and icon across pages (for example Sign in, Search, theme toggle). |
| 3.3.3 Error Suggestion (Level AA) | Supports | Error messages say how to fix the problem, for example the expected email format, the size limit for an upload, or how long to wait after a rate limit. |
| 3.3.4 Error Prevention (Legal, Financial, Data) (Level AA) | Supports | Paid actions show a review step with what is being bought, the amount and the token, and require an explicit confirmation before a wallet is asked to sign. Deleting an agent or avatar from the dashboard asks for confirmation first. |
| 3.3.8 Accessible Authentication (Minimum) (Level AA) | Supports | Sign-in accepts a password manager (fields allow paste and carry `autocomplete`), an emailed one-time code that can be pasted, wallet sign-in, and single sign-on with Microsoft Entra ID or Google. When the identity provider requires a CAPTCHA it is Cloudflare Turnstile, which does not ask the user to solve a puzzle, and the alternative methods remain available. |
| 4.1.3 Status Messages (Level AA) | Supports | Progress, results and errors that appear without a focus change are announced through `role="status"`, `role="alert"` or `aria-live` regions (for example Forge generation progress and the footer newsletter result). |

## Legal Disclaimer

This report describes the accessibility of three.ws version 1.5.2 as evaluated on 2026-11-11 using the methods listed above. It is provided for information. three.ws continues to improve accessibility and will update this report as the product changes.
