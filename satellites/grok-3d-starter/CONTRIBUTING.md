# Contributing

This starter is the shortest honest path from a clone to a Grok-made 3D model on a web page.
Changes should keep it that way: small, readable, and runnable with two keys.

1. Fork the repository and create a focused branch.
2. Run `npm ci`, `npm test` and `npm run check`.
3. Exercise the page at 360px and at a desktop width, with and without keys.
4. Open a pull request that says what a learner can now do or understand.

Ground rules:

- Keys stay on the server. Nothing the browser loads may contain one.
- No framework and no build step. Node built-ins, `fetch`, ES modules and `three`.
- Every loading state comes from a real stream event, never a timer.
- Fixtures say where they came from: `captured` for a recorded answer, `documented` (with the
  doc URLs) for a shape assembled from published documentation. Never invent a response.
- Bug fixes start with a failing test that reproduces the bug.
