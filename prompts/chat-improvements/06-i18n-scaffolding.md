# Feature: i18n Scaffolding

## Goal
Add a minimal but real i18n system to the Svelte chat app. This means: a `locales/` folder with JSON translation files, a reactive `t()` Svelte store, a language switcher in `SettingsModal.svelte`, and all user-visible strings in `App.svelte` and key components wired through `t()`. Start with English and Simplified Chinese (both fully translated — no placeholders).

## Success criteria
1. `chat/src/locales/en.json` and `chat/src/locales/zh-CN.json` exist with at minimum 30 real key-value pairs covering the main UI strings.
2. `chat/src/i18n.js` exports a reactive `t` store: `$t('key')` returns the translated string for the current locale, falling back to English if a key is missing.
3. The current locale is persisted in localStorage (`locale` key, default `'en'`).
4. A language dropdown appears in `SettingsModal.svelte` under a new "Language" section. Options: `English` and `中文`.
5. Switching language updates the UI in real time (reactive).
6. At least the following strings in `App.svelte` are wired through `t()`:
   - The "New chat" button label
   - The chat input placeholder
   - The "Send" button
   - Any empty-state messages
7. `npm run build` in `chat/` passes.

## Codebase context

Working directory: `/workspaces/3D-Agent/chat/`

**`src/stores.js`** — uses `persisted(key, default)` from `src/localstorage.js`. The `persisted` helper wraps a Svelte `writable`, syncs to `localStorage`. Add `locale` store there.

**`src/localstorage.js`**:
```js
export function persisted(key, initial) {
  const store = writable(initial);
  // reads from localStorage on init, writes on .set()/.update()
  ...
  return { subscribe, set, update };
}
```

**`src/SettingsModal.svelte`** — modal with tabs (`activeTab`). Currently has tabs: `'api-keys'`, `'brand'`, etc. Add a `'language'` tab or append language selection to an existing tab. Imports from `./stores.js`.

**Existing UI strings to translate** (grep these in `App.svelte` and key components):
- `"New chat"` — new conversation button
- `"Search agents…"` — agent picker placeholder
- `"Remove agent"` — agent picker clear link
- `"+ Create agent"` — agent picker link
- `"My Agents"` — section header
- `"Marketplace"` — section header
- `"Public Library"` — section header (if implemented)
- `"Loading…"` — loading state
- `"No agents found"` — empty state
- `"Send"` — submit button (if text label exists)
- `"Type a message…"` or similar — textarea placeholder
- `"Settings"` — settings button title
- `"History"` — history sidebar
- `"Share"` — share button
- `"Stop"` — stop generation button
- `"Regenerate"` — regenerate button (if exists)

## Implementation

### 1. Create `src/locales/en.json`
```json
{
  "newChat": "New chat",
  "searchAgents": "Search agents…",
  "removeAgent": "Remove agent",
  "createAgent": "+ Create agent",
  "myAgents": "My Agents",
  "marketplace": "Marketplace",
  "publicLibrary": "Public Library",
  "loading": "Loading…",
  "noAgentsFound": "No agents found",
  "send": "Send",
  "typeMessage": "Type a message…",
  "settings": "Settings",
  "history": "History",
  "share": "Share",
  "stop": "Stop",
  "regenerate": "Regenerate",
  "language": "Language",
  "apiKeys": "API Keys",
  "model": "Model",
  "temperature": "Temperature",
  "maxTokens": "Max Tokens Generated",
  "messageHistoryLimit": "Message history limit (0 = unlimited)",
  "reasoningEffort": "Reasoning Effort",
  "agentSettings": "Agent Settings",
  "systemPrompt": "System Prompt",
  "openingMessage": "Opening Message",
  "enabledTools": "Enabled Tools",
  "save": "Save",
  "cancel": "Cancel",
  "install": "Install",
  "installed": "Installed",
  "showingOf": "Showing {shown} of {total} — search to filter"
}
```

### 2. Create `src/locales/zh-CN.json`
All keys must have real Chinese translations — no English fallbacks, no placeholder text:
```json
{
  "newChat": "新对话",
  "searchAgents": "搜索智能体…",
  "removeAgent": "移除智能体",
  "createAgent": "+ 创建智能体",
  "myAgents": "我的智能体",
  "marketplace": "市场",
  "publicLibrary": "公共库",
  "loading": "加载中…",
  "noAgentsFound": "未找到智能体",
  "send": "发送",
  "typeMessage": "输入消息…",
  "settings": "设置",
  "history": "历史",
  "share": "分享",
  "stop": "停止",
  "regenerate": "重新生成",
  "language": "语言",
  "apiKeys": "API 密钥",
  "model": "模型",
  "temperature": "温度",
  "maxTokens": "最大生成 Token 数",
  "messageHistoryLimit": "消息历史限制（0 = 不限）",
  "reasoningEffort": "推理强度",
  "agentSettings": "智能体设置",
  "systemPrompt": "系统提示词",
  "openingMessage": "开场白",
  "enabledTools": "启用的工具",
  "save": "保存",
  "cancel": "取消",
  "install": "安装",
  "installed": "已安装",
  "showingOf": "显示 {shown} / {total} — 搜索筛选"
}
```

### 3. Create `src/i18n.js`
```js
import { derived } from 'svelte/store';
import { locale } from './stores.js';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

const translations = { 'en': en, 'zh-CN': zhCN };

export const t = derived(locale, ($locale) => {
  const dict = translations[$locale] || en;
  return (key, vars = {}) => {
    let str = dict[key] ?? en[key] ?? key;
    // simple {var} interpolation
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, String(v));
    }
    return str;
  };
});
```

### 4. Add `locale` store to `src/stores.js`
```js
export const locale = persisted('locale', 'en');
```

### 5. Wire `t` into components

**`src/App.svelte`** — import `t` from `'./i18n.js'`. Replace hardcoded strings with `$t('key')`. At minimum wire: new chat button, input placeholder, send button, stop button, any empty-state text.

**`src/AgentPicker.svelte`** — wire: `$t('searchAgents')`, `$t('removeAgent')`, `$t('createAgent')`, `$t('myAgents')`, `$t('marketplace')`, `$t('publicLibrary')`, `$t('loading')`, `$t('noAgentsFound')`.

**`src/KnobsSidebar.svelte`** — wire: `$t('temperature')`, `$t('maxTokens')`, `$t('messageHistoryLimit')`, `$t('reasoningEffort')`.

### 6. Language picker in `SettingsModal.svelte`

Add to imports:
```js
import { locale } from './stores.js';
```

Add a "Language" section to the modal (append it to the existing layout — do not add a new tab, just a section at the bottom of one tab):
```svelte
<div class="flex flex-col gap-2">
  <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Language</p>
  <select bind:value={$locale}
    class="rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-700 outline-none focus:border-indigo-400">
    <option value="en">English</option>
    <option value="zh-CN">中文</option>
  </select>
</div>
```

Binding directly to `$locale` works because it's a writable store — changing the select value persists the locale via the `persisted` wrapper.

## Constraints
- JSON locale files must be complete — every key in `en.json` must exist in `zh-CN.json`.
- No external i18n libraries — the `derived` store is sufficient.
- Do not translate strings in server-side code (API responses, etc.) — only client-side UI.
- Run `npm run build` (from `chat/`) and confirm it passes.
