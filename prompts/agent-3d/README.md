# agent-3d framework build-out

Delegate-ready prompts for turning the current `<agent-3d>` scaffold ([src/element.js](../../src/element.js), [specs/](../../specs/)) into a production-grade embodied-agent framework. Each file is a self-contained task — no shared state between tasks unless explicitly noted in "Depends on".

## Reference reading before starting any task

- [specs/AGENT_MANIFEST.md](../../specs/AGENT_MANIFEST.md)
- [specs/SKILL_SPEC.md](../../specs/SKILL_SPEC.md)
- [specs/MEMORY_SPEC.md](../../specs/MEMORY_SPEC.md)
- [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md)
- Existing series that interact with this work: [prompts/embed/](../embed/README.md), [prompts/widget-studio/](../widget-studio/README.md), [prompts/scalability/](../scalability/README.md)

## Rules that apply to all tasks

- Do not modify [src/viewer.js](../../src/viewer.js) unless the task explicitly asks. All agent-specific control lives in [src/runtime/scene.js](../../src/runtime/scene.js).
- No changes to the spec files under [specs/](../../specs/) without bumping the version in the frontmatter of that file.
- `node --check` every new JS file. `npm run build:all` must pass before claiming done.
- Zero new build-time dependencies unless the task authorizes it. Runtime-only deps are fine.
- Respect the kiosk/debug/editor attribute semantics already defined in [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md).
- The custom element tag is currently `agent-3d` — if the final tag name changes, only touch the registration sites, never spread hardcoded tag strings into runtime code (use `Agent3DElement` class references).
- If Anthropic API access is not configured in the dev environment, use `brain="none"` or mock the provider — never block on network credentials.
- If you discover an unrelated bug, note it in "Reporting". Do not fix it in the same change.

## Recommended execution order

Tasks are grouped by readiness and dependency. Within a group they are independent.

### Group A — provider surface (independent, parallelizable)

1. [01-openai-provider.md](./01-openai-provider.md) — OpenAI brain provider.
2. [02-elevenlabs-tts.md](./02-elevenlabs-tts.md) — ElevenLabs TTS provider.
3. [03-whisper-stt.md](./03-whisper-stt.md) — Whisper STT provider.

### Group B — persistence & trust

4. [04-encrypted-memory.md](./04-encrypted-memory.md) — `encrypted-ipfs` memory mode.
5. [05-skill-sandbox.md](./05-skill-sandbox.md) — worker-isolated skill handler execution.
6. [20-memory-embeddings-retrieval.md](./20-memory-embeddings-retrieval.md) — embedding-based memory recall.
7. [24-skill-signature-verification.md](./24-skill-signature-verification.md) — signed skill bundle verification.

### Group C — scene & embodiment

8. [06-multi-agent-scene.md](./06-multi-agent-scene.md) — multiple `<agent-3d>` instances sharing a scene.
9. [11-ar-webxr.md](./11-ar-webxr.md) — WebXR / Quick Look / Scene Viewer.
10. [12-vrm-support.md](./12-vrm-support.md) — VRM rig support alongside Mixamo.
11. [13-animation-retargeting.md](./13-animation-retargeting.md) — Mixamo→Mixamo clip retargeting.

### Group D — distribution & editor

12. [10-responsive-presets.md](./10-responsive-presets.md) — mobile/desktop clamp() preset generator.
13. [18-editor-polish.md](./18-editor-polish.md) — touch, magnetic snap, device preview, undo.
14. [21-agent-home-page.md](./21-agent-home-page.md) — wire `agent-home.html` / `agent-embed.html` to the new editor.
15. [07-manifest-builder-ui.md](./07-manifest-builder-ui.md) — form-based manifest authoring.
16. [15-conversation-persistence.md](./15-conversation-persistence.md) — save/restore chat history per agent.
17. [25-error-ux.md](./25-error-ux.md) — loading + error states worthy of shipping.
18. [28-accessibility-audit.md](./28-accessibility-audit.md) — a11y pass on shadow DOM chrome.
19. [29-onboarding-walkthrough.md](./29-onboarding-walkthrough.md) — first-run tour.

### Group E — platform & infrastructure

20. [08-ipfs-pinning-service.md](./08-ipfs-pinning-service.md) — pluggable pinning (web3.storage, Filebase, Pinata, local IPFS).
21. [09-validator-attestations.md](./09-validator-attestations.md) — signed glTF validator attestations.
22. [16-bundle-optimization.md](./16-bundle-optimization.md) — code-split Three.js loaders behind dynamic imports.
23. [17-cdn-deployment.md](./17-cdn-deployment.md) — versioned CDN release pipeline with SRI.
24. [19-skill-marketplace.md](./19-skill-marketplace.md) — skill discovery index + optional on-chain registry.
25. [22-privy-auth.md](./22-privy-auth.md) — Privy-backed agent ownership / signing.

### Group F — ecosystem adapters

26. [17-react-wrapper.md](./17-react-wrapper.md) — `@3d-agent/react` typed wrapper.
27. [30-framework-wrappers-svelte.md](./30-framework-wrappers-svelte.md) — Vue 3 + Svelte wrappers.
28. [26-typescript-declarations.md](./26-typescript-declarations.md) — published `.d.ts` for the element + public API.

### Group G — quality gates

29. [27-e2e-test-harness.md](./27-e2e-test-harness.md) — Playwright harness.

## Tag naming note

When the framework tag is finalized (currently `agent-3d`), a one-pass `sed` migration is sufficient across specs, element registration, lib entry, editor, and examples. Individual tasks should not introduce hardcoded tag strings into runtime code — reference the element class instead.
