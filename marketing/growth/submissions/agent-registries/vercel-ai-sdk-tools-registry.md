# Vercel AI SDK tools registry (vercel/ai)

**Status: not sent.** Owner order 938, item 1. Re-verified 2026-11-14.

Target: `https://github.com/vercel/ai`, file `content/tools-registry/registry.ts`, listed at
`https://ai-sdk.dev/resources/tools`. Repository license Apache-2.0. Intake is a pull request per
`contributing/add-new-tool-to-registry.md` (read 2026-11-14).

## The guide's three prerequisites

| Prerequisite | State on 2026-11-14 |
| --- | --- |
| Package published to npm | **Not yet.** `https://registry.npmjs.org/@three-ws%2fai-sdk` answers 404. Owner step 1 below. |
| Tested with the current AI SDK | Done. `ai` 7.0.166: `generateText` with `isStepCount(3)` and the `render` tool, driven by `nvidia/nemotron-3.5-lightning-30b-a3b` over an OpenAI-compatible endpoint, called production on the Khronos Duck GLB and answered "4,212 triangles" (correct). `npm test` in `packages/ai-sdk`: 0 failures. |
| Documentation on our website about the AI SDK integration | Written: `docs/ai-sdk.md`, served at `https://three.ws/docs/ai-sdk` after the next production deploy. Confirm it answers 200 before opening the PR. |

## Owner steps

1. `cd packages/ai-sdk && npm publish --access public`, then confirm
   `npm view @three-ws/ai-sdk version` prints `0.1.0`.
2. Confirm `curl -s -o /dev/null -w '%{http_code}' https://three.ws/docs/ai-sdk` prints 200 (it
   needs the next deploy).
3. Fork `vercel/ai`, create branch `feat/add-tool-three-ws`, and add the entry below to the `tools`
   array in `content/tools-registry/registry.ts` (append it after the last entry; the array is not
   sorted).
4. Commit with `feat(tools-registry): add three-ws` and open the PR with the same title and the
   body below.
5. Log the PR URL and date in the `Vercel AI SDK tools registry` row of
   `marketing/growth/opportunities.csv`.

## Entry

```typescript
  {
    slug: 'three-ws',
    name: 'three.ws 3D',
    description:
      'Generate, rig, render, and animate 3D models from an agent. Forge a textured GLB from a text prompt, auto-rig it with a humanoid skeleton, render turntable previews with geometry stats, and chat with a three.ws agent. Forge, rig, render, and chat are free with no API key.',
    packageName: '@three-ws/ai-sdk',
    tags: ['3d', 'generation', 'glb', 'animation'],
    installCommand: {
      pnpm: 'pnpm add @three-ws/ai-sdk',
      npm: 'npm install @three-ws/ai-sdk',
      yarn: 'yarn add @three-ws/ai-sdk',
      bun: 'bun add @three-ws/ai-sdk',
    },
    codeExample: `import { generateText, isStepCount } from 'ai';
import { createThreeWsTools } from '@three-ws/ai-sdk';

const { forge, rig, render } = createThreeWsTools();

const { text } = await generateText({
  model: 'openai/gpt-5-mini',
  prompt: 'Forge a low-poly fox, rig it, then render a turntable so I can see it.',
  tools: { forge, rig, render },
  stopWhen: isStepCount(5),
});

console.log(text);`,
    docsUrl: 'https://three.ws/docs/ai-sdk',
    websiteUrl: 'https://three.ws',
    npmUrl: 'https://www.npmjs.com/package/@three-ws/ai-sdk',
  },
```

No `apiKeyEnvName` or `apiKeyUrl`: the free tools need no key, and the guide marks both fields
optional.

## PR body

> Adds three.ws to the tools registry.
>
> `@three-ws/ai-sdk` exports AI SDK `tool()` definitions for 3D: `forge` (text to textured GLB),
> `rig` (humanoid auto-rig), `render` (turntable previews and geometry stats) and `agentChat`, all
> free with no API key, plus a paid `animate`.
>
> - npm: https://www.npmjs.com/package/@three-ws/ai-sdk
> - AI SDK docs page: https://three.ws/docs/ai-sdk
> - Source (Apache-2.0): https://github.com/nirholas/three.ws/tree/main/packages/ai-sdk
>
> Tested against `ai` 7 with `generateText` and `isStepCount`.
