# @nirholas/agent-kit

Ship an **ERC-8004 agent** with on-chain identity, a chat panel, and discoverable `.well-known` endpoints — in minutes.

## Install

```bash
npm install @nirholas/agent-kit ethers
```

`ethers@^6` is a peer dependency (only needed if you call `register()`).

## Quick start

```js
import { AgentKit } from '@nirholas/agent-kit';
import '@nirholas/agent-kit/styles';

const agent = new AgentKit({
  name: 'My Agent',
  description: 'Does cool stuff',
  endpoint: 'https://myapp.com',
  onMessage: async (text) => `You said: ${text}`,
});

agent.mount(document.body);
```

That's it — you now have a floating chat panel with voice I/O in the bottom-left corner.

## Register on-chain

```js
await agent.register({
  ipfsToken: 'your-web3storage-token',
  imageFile: someFile, // optional
  onStatus: (msg) => console.log(msg),
});
```

Needs MetaMask (or any injected wallet) and a [web3.storage](https://web3.storage) API token. Requires a deployed ERC-8004 Identity Registry — set the address in `REGISTRY_DEPLOYMENTS` before calling.

## Generate `.well-known` manifests

```js
const { agentRegistration, agentCard, aiPlugin } = agent.manifests({
  openapiUrl: 'https://myapp.com/.well-known/openapi.yaml',
});
```

Serve these JSON documents from:
- `/.well-known/agent-registration.json` — ERC-8004 discovery
- `/.well-known/agent-card.json` — A2A protocol
- `/.well-known/ai-plugin.json` — OpenAI plugin manifest

## API

### `new AgentKit(options)`

| Option | Type | Description |
|---|---|---|
| `name` | `string` **(required)** | Agent display name |
| `endpoint` | `string` **(required)** | Your agent's public URL |
| `description` | `string` | What the agent does |
| `image` | `string` | Public URL to logo/avatar |
| `version` | `string` | Semver version (default: `1.0.0`) |
| `org` | `string` | Organization name for `agent-card.json` |
| `skills` | `Array` | A2A skill definitions |
| `services` | `Array` | Extra service entries (A2A, MCP endpoints) |
| `onMessage` | `async (text) => string` | Your response handler |
| `welcome` | `string` | Panel welcome message |
| `voice` | `boolean` | Enable TTS on replies (default: `true`) |

### Methods

- `agent.mount(element?)` — attach panel to DOM (default: `document.body`)
- `agent.open()` / `agent.close()` — show/hide the panel
- `agent.addMessage(role, text)` — programmatically add a message (`role`: `'ak-agent'` or `'ak-user'`)
- `agent.register(options)` — ERC-8004 on-chain registration
- `agent.manifests(options)` — generate `.well-known` JSON documents
- `agent.dispose()` — remove panel from DOM

### Low-level exports

For direct control:

```js
import {
  AgentPanel,
  connectWallet,
  registerAgent,
  pinToIPFS,
  buildRegistrationJSON,
  agentRegistration,
  agentCard,
  aiPlugin,
  IDENTITY_REGISTRY_ABI,
  REGISTRY_DEPLOYMENTS,
} from '@nirholas/agent-kit';
```

## Configuring registry addresses

Before calling `register()`, set your Identity Registry address in `sdk/src/erc8004/abi.js`:

```js
export const REGISTRY_DEPLOYMENTS = {
  8453:  { identityRegistry: '0xYourBaseMainnetAddress' },
  84532: { identityRegistry: '0xYourBaseSepoliaAddress' },
};
```

## License

MIT
