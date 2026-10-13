<p align="center">
  <a href="https://three.ws"><img src="https://three.ws/three-ws-mcp-icon.svg" width="72" height="72" alt="three.ws" /></a>
</p>

<h1 align="center">@three-ws/ai-sdk</h1>

<p align="center"><strong>Give any Vercel AI SDK agent the ability to forge, rig, animate, and render 3D models, and talk to a three.ws agent.</strong></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@three-ws/ai-sdk"><img alt="npm" src="https://img.shields.io/npm/v/@three-ws/ai-sdk?logo=npm&color=cb3837"></a>
  <img alt="license" src="https://img.shields.io/npm/l/@three-ws/ai-sdk?color=3b82f6">
  <img alt="node" src="https://img.shields.io/node/v/@three-ws/ai-sdk?color=339933&logo=node.js">
  <a href="https://three.ws"><img alt="three.ws" src="https://img.shields.io/badge/built%20by-three.ws-000"></a>
</p>

---

Five [`tool()`](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) definitions that wrap three.ws's generative 3D pipeline, ready to drop into `generateText`/`streamText`:

| Tool | What it does | Auth |
| --- | --- | --- |
| `forge` | Text prompt → textured GLB | Free |
| `rig` | Static GLB → humanoid-rigged GLB | Free |
| `render` | Any public GLB → turntable preview + geometry stats | Free |
| `animate` | Text prompt → retargeted motion on a rigged GLB | Paid (x402) |
| `agentChat` | Message → a three.ws agent's reply | Free |

`forge`, `rig`, and `render` call three.ws's free, no-key `/api/mcp-studio` server. `agentChat` calls the public `/api/chat` endpoint. `animate` calls the paid, [x402](https://x402.org)-gated `/api/mcp` server: this package never signs a payment for you, it surfaces the real `PaymentRequired` challenge so your own x402 client (e.g. [`x402-fetch`](https://www.npmjs.com/package/x402-fetch)) can pay from your own wallet.

## Install

```bash
npm install @three-ws/ai-sdk ai zod
```

## Quick start

```js
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createThreeWsTools } from '@three-ws/ai-sdk';

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const tools = createThreeWsTools();

const { text, toolResults } = await generateText({
	model: openai('gpt-5.5'),
	tools,
	prompt: 'Forge a low-poly fox, then render a turntable of it so I can see it.',
});

console.log(text);
console.log(toolResults);
```

Run it directly (no model needed) to see the tools call the live API:

```js
import { createThreeWsTools } from '@three-ws/ai-sdk';

const tools = createThreeWsTools();
const forged = await tools.forge.execute({ prompt: 'a friendly round robot mascot', tier: 'draft' });
console.log(forged);
// { ok: true, text: 'Generated this model from your prompt...', raw: {...} }

const rendered = await tools.render.execute({
	glbUrl: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb',
});
console.log(rendered.text);
```

## Paying for `animate`

```js
import { wrapFetchWithPayment } from 'x402-fetch';
import { createThreeWsTools } from '@three-ws/ai-sdk';

// Resolve the x402 challenge with your own wallet, then pass the resulting
// X-PAYMENT header value straight through. This package never spends for you.
const tools = createThreeWsTools();
const unpaid = await tools.animate.execute({ glbUrl: myRiggedGlbUrl, prompt: 'wave hello' });
if (unpaid.paymentRequired) {
	// use your x402 client + wallet against unpaid.challenge, then retry with xPayment set
}
```

## Configuration

```js
createThreeWsTools({
	baseUrl: 'https://three.ws', // override for a self-hosted deployment
	apiKey: process.env.THREE_WS_API_KEY, // only needed for `animate`
});
```

Each tool is also exported individually: `forgeTool`, `rigTool`, `renderTool`, `animateTool`, `agentChatTool`.

## License

Apache-2.0
