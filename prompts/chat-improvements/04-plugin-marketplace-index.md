# Feature: Plugin/Tool Marketplace JSON Index

## Goal
Add a "Public Library" tab to the existing `SkillsMarketplaceModal.svelte` that fetches plugins from the live LobeHub-compatible plugin index at `https://ai-agent-plugins.vercel.app`. Installing a library plugin fetches its full manifest and adds it to the `toolSchema` store (the same store used by locally-installed skills). The result: users can browse and install 100+ real plugins without a backend.

## Success criteria
1. A "Library" tab appears in `SkillsMarketplaceModal.svelte` alongside the existing "Browse" and "Publish" tabs.
2. The tab fetches the live index and renders plugin cards (name, description, icon).
3. Clicking "Install" on a library plugin fetches the full manifest, extracts the function schema, and appends it to the `toolSchema` store.
4. Already-installed plugins (matching by identifier) show an "Installed" state.
5. Searching the Library tab filters by name/description/tags.
6. `npm run build` in `chat/` passes.

## Codebase context

Working directory: `/workspaces/3D-Agent/chat/`

**File to modify: `src/SkillsMarketplaceModal.svelte`**

Current tabs (line ~7): `'browse'`, `'publish'` (view state stored in `let view`).

**`toolSchema` store** (`src/stores.js`):
```js
export const toolSchema = persisted('toolSchemaGroups', []);
```
Shape:
```js
[
  {
    id: string,           // group id
    name: string,         // display name
    schema: [             // OpenAI function-call tool schema array
      {
        type: 'function',
        function: { name, description, parameters: { type, properties, required } }
      }
    ]
  }
]
```
When the user installs a skill from the existing marketplace (`/api/skills/{id}/install`), the response returns `{ schema }` which is pushed as a group.

**`convo.tools`** — an array of function names (strings) that are enabled for a conversation.

## Live Plugin Index API

**Index** — `GET https://ai-agent-plugins.vercel.app/index.en-US.json`
Response shape:
```json
{
  "plugins": [
    {
      "identifier": "web-search",
      "meta": {
        "avatar": "🔍",
        "title": "Web Search",
        "description": "Search the web for real-time information",
        "tags": ["search","web"],
        "category": "productivity"
      },
      "schemaVersion": 1
    }
  ]
}
```

**Detail** — `GET https://ai-agent-plugins.vercel.app/{identifier}.json`
Response shape:
```json
{
  "identifier": "web-search",
  "meta": { "title": "Web Search", "description": "...", "avatar": "🔍" },
  "manifest": {
    "api": [
      {
        "name": "web_search",
        "description": "Search the web",
        "parameters": {
          "type": "object",
          "properties": { "query": { "type": "string" } },
          "required": ["query"]
        }
      }
    ]
  }
}
```

## Implementation

### 1. Add `pluginLibraryUrl` to `src/stores.js`
```js
export const pluginLibraryUrl = persisted('pluginLibraryUrl', 'https://ai-agent-plugins.vercel.app');
```

### 2. Add Library tab state to `SkillsMarketplaceModal.svelte`

In `<script>`:
```js
import { toolSchema, currentUser, notify, pluginLibraryUrl } from './stores.js';

// Library tab state
let libraryPlugins = [];
let loadingLibrary = false;
let libraryQuery = '';
let libraryInstalling = {};

async function loadPluginLibrary() {
  loadingLibrary = true;
  try {
    const base = $pluginLibraryUrl?.replace(/\/+$/, '');
    const res = await fetch(`${base}/index.en-US.json`);
    if (res.ok) {
      const json = await res.json();
      libraryPlugins = (json.plugins || []).map(p => ({
        identifier: p.identifier,
        name: p.meta?.title || p.identifier,
        description: p.meta?.description || '',
        avatar: p.meta?.avatar || '🔧',
        tags: p.meta?.tags || [],
        category: p.meta?.category || '',
      }));
    }
  } catch {}
  loadingLibrary = false;
}

$: filteredLibraryPlugins = libraryQuery
  ? libraryPlugins.filter(p => {
      const q = libraryQuery.toLowerCase();
      return p.name.toLowerCase().includes(q)
        || p.description.toLowerCase().includes(q)
        || p.tags.some(t => t.toLowerCase().includes(q));
    })
  : libraryPlugins;

function isLibraryPluginInstalled(identifier) {
  return $toolSchema.some(g => g.id === `lib:${identifier}`);
}

async function installLibraryPlugin(plugin) {
  libraryInstalling = { ...libraryInstalling, [plugin.identifier]: true };
  try {
    const base = $pluginLibraryUrl?.replace(/\/+$/, '');
    const res = await fetch(`${base}/${plugin.identifier}.json`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    const api = data.manifest?.api || [];
    if (api.length === 0) {
      notify('Plugin has no callable functions', 'error');
      return;
    }
    const group = {
      id: `lib:${plugin.identifier}`,
      name: plugin.name,
      schema: api.map(fn => ({
        type: 'function',
        function: {
          name: fn.name,
          description: fn.description || '',
          parameters: fn.parameters || { type: 'object', properties: {} },
        },
      })),
    };
    toolSchema.update(groups => {
      // remove if already exists, then add
      return [...groups.filter(g => g.id !== group.id), group];
    });
    notify(`${plugin.name} installed`, 'success');
  } catch (e) {
    notify(`Failed to install ${plugin.name}`, 'error');
  } finally {
    libraryInstalling = { ...libraryInstalling, [plugin.identifier]: false };
  }
}
```

Call `loadPluginLibrary()` when the view switches to `'library'`:
```js
$: if (view === 'library' && libraryPlugins.length === 0) loadPluginLibrary();
```

### 3. Add tab button and panel to template

Add `'library'` as a third tab option next to the existing Browse/Publish tab buttons. Match the exact existing tab button style.

Library panel layout: search input + plugin list. Each plugin row: avatar emoji (or icon), name, description, tags. An "Install" button on the right that shows "Installed" when `isLibraryPluginInstalled(plugin.identifier)` is true.

Use the same Tailwind classes as the existing Browse panel for consistency.

## Constraints
- Do not modify the existing Browse or Publish tabs or their logic.
- Do not add a backend endpoint — this is fully client-side.
- Installed library plugins use `id: 'lib:{identifier}'` to distinguish them from server-installed skills.
- Run `npm run build` (from `chat/`) and confirm it passes.
