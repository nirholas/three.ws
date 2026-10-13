# LangChain JS integration listing

Per `docs/partners/prospects.md`: LangChain's integration directory is populated from published npm
packages, not hand-written listing PRs ("Publish on npm, then file their 'Integration listing issue'.
Hand-written listing pull requests are now closed automatically"). This file is the issue text to file
against `langchain-ai/langchainjs` once `@three-ws/langchain` is live on npm.

## Owner steps (not automatable here)

1. `npm publish --access public` from `packages/langchain` (after `npm pack --dry-run` is clean).
2. Open an issue on `https://github.com/langchain-ai/langchainjs` using the "Integration request" template
   (or the closest current equivalent) with the title and body below.

## Issue title

Add integration: @three-ws/langchain

## Issue body

**Package**: [`@three-ws/langchain`](https://www.npmjs.com/package/@three-ws/langchain)
**Repo**: https://github.com/nirholas/three.ws/tree/main/packages/langchain

Five `tool()` definitions wrapping three.ws's generative 3D pipeline for any LangChain JS agent:

- `three_ws_forge`: text prompt -> textured GLB (free)
- `three_ws_rig`: static GLB -> humanoid-rigged GLB (free)
- `three_ws_render`: any public GLB -> turntable preview + geometry stats (free)
- `three_ws_animate`: text prompt -> retargeted motion on a rigged GLB (paid, x402)
- `three_ws_agent_chat`: message -> a three.ws agent's reply (free)

All five use `responseFormat: "content_and_artifact"` and are built on `@langchain/core/tools`'s `tool()`
API (peer dependency `@langchain/core >= 0.3.0`). `three_ws_animate` is the one paid tool: it never signs a
payment itself, it surfaces the real x402 `PaymentRequired` challenge as the tool's artifact so the caller's
own x402 client can pay from their own wallet.

Tests run against the live three.ws API (no mocks): see `test/tools.test.js` in the package.

README: https://github.com/nirholas/three.ws/tree/main/packages/langchain#readme
