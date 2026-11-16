# Teams Store and Copilot validation: reviewer pack for three.ws 3D Studio

Program: Microsoft Teams Store (Microsoft 365 and Copilot apps) through Partner Center, Teams app offer.
Order: 833 (microsoft 33). Shared facts and owner-only inputs: [README.md](./README.md).
Prepared: 2026-11-16. **Status: ready to submit. Nothing has been submitted.**
Approved partnership wording only: "three.ws and Microsoft have announced a partnership".

Every rule below is catalogued in [`validation/rules.json`](../../../../integrations/microsoft/copilot-teams/validation/rules.json). The preflight proves the automatable ones before each submission:

    node scripts/build-microsoft-app-package.mjs --check --store            # with live URL, TLS, header and response-time checks
    node scripts/build-microsoft-app-package.mjs --check --store --offline  # package only
    npx vitest run tests/microsoft-store-rules.test.js
    npx playwright test tests/e2e/microsoft-teams-store.spec.js              # framed tab, theme, contrast, mobile, meeting, sign-in

On 2026-11-16 the offline preflight passes every package rule, including Microsoft's own `atk validate`. The live checks need the production deploy first (see Owner steps).

## Test notes

Paste into the Partner Center "Notes for certification" box. No credentials are needed for any capability except the account-linked ones, which use the demo account described below.

| Capability | How to test | Expected |
|---|---|---|
| Copilot tools (declarative agent) | In Microsoft 365 Copilot choose **three.ws 3D Studio**, ask "make a 3D model of a friendly round robot mascot". | A job id comes back at once, the agent polls it, and a viewer link plus GLB download appear within five minutes. No sign-in. |
| Catalog search | Ask "find a free CC0 chair model". | Results from the three.ws catalog with licence and link. |
| 3D viewer tab (personal) | Open the app in Teams, **3D viewer** tab. | The viewer loads framed inside Teams, follows the Teams theme, works in dark and high contrast. |
| Agents tab (personal) | Open the **Agents** tab. | A live directory of public agents. Open one to see it in 3D. |
| Message extension | In any chat, **+ Apps**, **Agents**, search a name. | Agent cards to share. Pasting a three.ws agent link unfurls a card. |
| Create a 3D model action | Message menu, **Create a 3D model**, enter a prompt. | A card that updates itself when the model is ready. |
| Bot | Message the bot, `help`, then `forge a friendly robot`. | A welcome with the commands and a card with progress. The bot labels AI content, offers feedback and a Report action. |
| Meeting review stage | Add the app to a meeting, open the side panel, choose a model. | One model on the shared stage; presenter camera follow, laser pointer, pinned comments, markdown export. |
| Channels | Add the app to a standard, a shared and a private channel. | Tabs and the bot work in each. |
| Outlook and Microsoft 365 app | Open the app in Outlook on the web and the Microsoft 365 app. | The tab renders and the bot card family switches to Adaptive Cards 1.4. |
| Activity feed | In three.ws notification settings, copy the link code, send `link <code>` to the bot, generate a model. | An activity feed item "3D model ready" arrives for that person only. |

### Demo account

Account-linked features (activity feed, saved agents) need a three.ws sign-in. Partner Center asks for these fields; the owner fills them from the demo tenant and never commits them:

| Field | Value |
|---|---|
| Test account sign-in page | `https://three.ws/login` |
| Username | the demo address created in the owner steps |
| Password | held in the owner's password manager, entered only in Partner Center |
| Extra steps | none; sign in with email and password, no second factor |

## Questionnaire

Answers for the Partner Center store questionnaire.

| Question | Answer |
|---|---|
| Does the app show advertising? | No. |
| Does the app have cryptocurrency features? | No. The Teams app has no wallet, payment or token features. |
| Does the app collect or sell personal data? | It reads the Microsoft Entra object id and tenant id only for sign-in and activity feed delivery. Policy: `https://three.ws/legal/privacy`. Subprocessors: `https://three.ws/trust/subprocessors`. |
| AI features | The bot and Copilot tools generate 3D content. AI output is labelled, has a feedback loop and a Report action; reports are stored and reviewed. |
| Does the app use generative AI content? | Yes, 3D models and text answers, both labelled. |
| Mobile | Tabs and the bot work in the Teams mobile apps; screenshots in the listing assets cover mobile. The listing does not use the word "free". |
| Accessibility | Keyboard operable, follows the Teams theme and high contrast, screen reader labels on every control. Verified by the Playwright spec. |

## Performance

Copilot requires tool calls to answer at p50 2 s, p75 5 s, p99 9 s. Long generation is never held open: `forge_free`, `mesh_forge`, `text_to_avatar` and `rig_mesh` return a job id at once and `check_job` and `get_job` poll it. Read-only tools (`search_catalog`, `get_catalog_item`, `search_docs`, `look_at_model`) answer from the catalogue. The live preflight (`response.time`) measures the framed tab URLs (median of three against a fixed budget); the MCP initialize is checked live too. Tool latency percentiles come from production request logs (`npm run logs`), which the owner attaches if the reviewer asks. All tools carry the read-only hint where they only read (`copilot.mcp-readonly-hint`).

## Listing assets

| Item | Requirement | Source |
|---|---|---|
| Screenshots | 1366 x 768 PNG, at most 1024 KB each, captioned, inside the Teams and Microsoft 365 chrome, showing the Copilot experience | Rendered by `npm run media:microsoft` into [`marketing/microsoft/media/`](../../../microsoft/media). Current behavioural captures are in `integrations/microsoft/copilot-teams/validation/screenshots/` (desktop default, dark, high contrast, framed, mobile, meeting side panel). Final in-chrome captures are taken in the demo tenant by the owner |
| Icons | 192 x 192 colour, 32 x 32 outline | `color.png`, `outline.png`, checked by `icons.color` and `icons.outline` |
| Support page | Answers questions for Teams, Outlook and the Microsoft 365 app | `https://three.ws/support` |
| Privacy and terms | Linked in the manifest and the intro | `https://three.ws/legal/privacy`, `https://three.ws/legal/tos` |
| Long description | Says it works in channels, how to get an account, the activity feed and its limits | `description.full` in the manifest template, checked by `channels.documented`, `auth.way-forward` and `notify.described` |

## Publisher

The Partner Center account behind the Entra app registration must complete Microsoft Publisher Verification before submission, and the manifest `developer.name` must equal the verified publisher name. Owner steps, in order:

1. Partner Center, **Account settings**, **Organization profile**, **Identifiers**: confirm the MPN id is verified.
2. Entra admin center, **App registrations**, the three.ws app, **Branding and properties**, **Publisher domain** (`three.ws`), then **Add MPN ID to verify publisher**.
3. Set the repository variable `MS_PARTNER_CENTER_PUBLISHER_NAME` to the exact publisher name so `developer.publisher-name` stops being skipped in the preflight.
4. Rebuild with `npm run package:microsoft-app`, run `--check --store`, upload the zip in Partner Center, **Marketplace offers**, **New offer**, **Teams app**.

## Owner steps

1. Push and deploy so production carries the current security headers (`copilot.frame-ancestors` and `links.https-200` need them) and the session bar.
2. Run the live preflight until every rule passes.
3. Create the demo account and the demo tenant, take the in-chrome screenshots.
4. Complete Publisher Verification (above) and submit in Partner Center.
