# Contributing

Changes must preserve the Action's central contract: one report, one deterministic severity,
and a useful failure message.

1. Run `npm ci`.
2. Run `npm test` and `npm run build`.
3. Commit source and the resulting `dist/index.js` together.
4. Describe the GLB lifecycle or structural case covered by the pull request.

Never log the GitHub token or model bytes. Test behavioral changes against real serialized GLB
documents, not mocked diff responses.
