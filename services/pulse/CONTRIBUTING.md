# Contributing

1. Node 24 or newer. `npm install`.
2. `npm run typecheck && npm test && npm run build` must pass.
3. Real data only: no mocks or fabricated fixtures in shipped code.
4. Schema changes are new numbered files in `src/db/migrations`.
5. Commit subjects follow `type(scope): what changed and why`.

Open an issue before large changes. Source providers and new MCP tools are the most useful contributions.
