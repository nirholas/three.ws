# Task: LobeHub plugin package — drop-in agent sidecar

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md) first.

LobeHub is a self-hostable chat UI fork. We want to publish a standalone plugin under `chat-plugin/` that users can install into their Lobe fork to get a three.ws pane that reacts to assistant messages. Today the dashboard only shows a copy-paste React snippet — insufficient for a real plugin.

This is a **new top-level package**, fully isolated from the rest of the monorepo. It does not need to be published to npm in this task; just produce a working, locally-installable TS-React package with a manifest.

## Files you own (exclusive — all new, under `chat-plugin/`)

```
chat-plugin/
├── package.json
├── tsconfig.json
├── manifest.json           # Lobe plugin manifest
├── README.md
├── src/
│   ├── index.ts
│   ├── AgentPane.tsx
│   ├── bridge.ts           # postMessage wrapper around /agent/:id/embed
│   └── config-schema.ts    # plugin settings schema
└── dist/                   # gitignored; produced by build
```

**Do not edit** any other file in the repo.

## Plugin behavior

- **Settings:** `agentId` (string, required) and `apiOrigin` (defaults to `https://three.ws/`). Expose these via `config-schema.ts`.
- **Render:** a fixed 320×420 pane (sidebar or floating — Lobe decides) containing an `<iframe>` pointing at `${apiOrigin}/agent/${agentId}/embed`.
- **Bridge:** on Lobe's assistant-message event, call `bridge.speak(text)` which posts `{ __agent: agentId, type: 'action', action: { type: 'speak', payload: { text } } }` to the iframe — matching the FROZEN v1 bridge in [public/agent/embed.html](../../public/agent/embed.html).
- **Lobe hooks used:** `usePluginStore`, `onAssistantMessage`. If the exact API differs, write against what's published in `@lobehub/ui@latest` or `chat-plugin-sdk` — if neither exists at time of writing, mock the hooks with clear TODO comments and document in README.
- **TypeScript**, strict. Tabs 4-wide, single quotes (match the rest of the repo style even though this is a TS package).

## `manifest.json` shape

```json
{
	"identifier": "3dagent",
	"schemaVersion": 1,
	"meta": {
		"title": "three.ws",
		"description": "Render a 3D avatar that reacts to the chat.",
		"avatar": "https://three.ws/favicon.ico",
		"tags": ["avatar", "3d", "agent"]
	},
	"ui": {
		"position": "right",
		"size": { "width": 320, "height": 420 }
	},
	"settings": [
		{ "name": "agentId", "type": "string", "required": true, "title": "Agent ID" },
		{ "name": "apiOrigin", "type": "string", "default": "https://three.ws/" }
	]
}
```

## `package.json`

- `name: "@3dagent/chat-plugin"`
- `private: true` (for now).
- `scripts`: `build` uses `tsc` + a bundler of your choice (esbuild or vite — pick the lighter one). `dev` runs the bundler in watch.
- `devDependencies`: TypeScript, React types, the bundler. No new prod deps beyond React.

## Out of scope

- Do not publish to npm.
- Do not wire this into the repo root `package.json` scripts.
- Do not make it depend on anything in the parent repo's `src/` (it's fully standalone).
- Do not implement memory / skills / wallet features — this plugin is a viewer + speak bridge only.

## Verification

```bash
cd chat-plugin
npm install
npm run build
ls -la dist/
cd ..
```

Note: the root `npm run build` is unaffected because this package is not part of the root Vite build.

## Report back

Files created, build output, which Lobe SDK API you wrote against (and whether you mocked it), a copy of the README you wrote.
