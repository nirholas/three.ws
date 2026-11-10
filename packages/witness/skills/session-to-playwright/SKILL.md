---
name: session-to-playwright
description: Add the witness session recorder to a web app and compile a recorded user session into a Playwright spec that fails until the reported bug is fixed. Use when turning a bug report into a reproducible failing test.
---

# Session to Playwright

`@three-ws/witness` records user intent (navigation, clicks, typed-field metadata, failed requests, page errors) in about 2 KB per session, with no pixels and no DOM mutation stream, then compiles it into a Playwright spec. No dependencies, no build step.

## Install and record

```bash
npm install @three-ws/witness
```

```js
import { witness } from '@three-ws/witness';

witness.start();                              // idempotent, one recorder per page
witness.onFailure(() => showFeedbackPrompt()); // ask at the moment of failure
witness.hasFailure();                          // true after a failed request or page error
const trace = witness.trace();                 // { version, recordedMs, environment, events }
witness.stop();                                // restores every patched global
```

## Compile

```js
import { compileToPlaywright } from '@three-ws/witness/compile';

const { filename, source, confidence, steps } = compileToPlaywright(trace, {
  title: 'Export does nothing',   // test name
  baseUrl: 'http://localhost:3000',
  reportId: 'FB-123',             // linked in a header comment
});
```

Write `source` to `filename` under your Playwright tests directory. The test asserts the failure is gone, so it is red until the bug is fixed. `confidence.score` (0 to 100) says how well every step is anchored to a stable handle.

Other exports: `narrate(trace)` (the human step list), `failuresIn(trace)`, `entryRoute(trace)`, `replayConfidence(trace)`.

## Selectors

Each element gets the strongest handle verified unique in the live document: `data-testid` (100), id (95), aria-label (85), role plus name (80), text (70), name (65), placeholder (60), class (40), structural path (10). Add `data-testid` to the controls in a flow to raise confidence. Helpers are on `@three-ws/witness/selector`.

## Privacy

`@three-ws/witness/redact` exports `redactText`, `redactUrl`, `isSensitiveField` and `summarizeInput`. Typed values are summarised by length, not stored, and sensitive fields are never captured. Do not paste real user data into reports.

## Worked example

Given a trace where the visitor opened `/avatar-studio`, clicked Export and saw `POST /api/export -> 500`, the compiled spec visits the route, clicks `getByTestId("export")`, and expects the failed-request list to be empty. Run it with `npx playwright test`, fix the endpoint, run again until green.
