# three-ws

The unscoped command for the three.ws CLI. Every hosted three.ws MCP server answers an unauthenticated call with `Run npx three-ws setup`; this package is what that command installs.

    npx three-ws setup

It is a thin launcher: it depends on [`@three-ws/cli`](../three-ws-cli/README.md) at an exact version and runs its `main()` with your arguments, so `npx three-ws <command>` and `npx @three-ws/cli <command>` are the same program. Docs: https://three.ws/docs/cli

## Publishing

Publish `@three-ws/cli` first, then bump this package's `version` and its pinned dependency to match and run `npm publish` from this directory. The first publish of a new npm name sits behind a `0.0.0-stage` placeholder for a few minutes; poll `npm view three-ws dist-tags` until the real version is `latest`.
