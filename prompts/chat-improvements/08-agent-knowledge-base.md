# Feature: Per-Agent Knowledge Base (RAG)

## Goal
Each agent can have a knowledge base: uploaded files (txt, md, pdf text) are chunked, embedded via OpenAI's `text-embedding-3-small` API, and stored in IndexedDB. When a user sends a message, the top-k most similar chunks are retrieved by cosine similarity and injected as context into the system prompt — real retrieval-augmented generation, no mocks.

## Success criteria
1. A "Knowledge" tab in the Agent Settings panel (or a standalone `KnowledgeBaseModal.svelte`) shows uploaded files per agent.
2. Uploading a `.txt` or `.md` file splits it into ~500-token chunks, embeds them via `POST https://api.openai.com/v1/embeddings` (model `text-embedding-3-small`), and stores `{ id, agentId, filename, chunkIndex, text, embedding: Float32Array }` records in a new IndexedDB object store `knowledge`.
3. Before each chat completion, retrieve top-3 chunks for the current user message (by cosine similarity against the stored embeddings), prepend them as a context block into the system message.
4. Works with the user's existing OpenAI API key (already stored in `openaiAPIKey` store).
5. Uploading a file shows progress (chunking → embedding → saved). Errors (no API key, API failure) are surfaced via `notify()`.
6. Files can be deleted (removes all their chunks from IndexedDB).
7. `npm run build` in `chat/` passes.

## Codebase context

Working directory: `/workspaces/3D-Agent/chat/`

**`src/stores.js`**:
```js
export const openaiAPIKey = persisted('openaiAPIKey', '');
export const activeAgent = persisted('activeAgentDetail', null);
export const notify = function(message, type = 'error') { ... };  // in stores.js
```

**`src/App.svelte`** — IndexedDB opened at:
```js
const request = indexedDB.open('threews-chat', 2);
request.onupgradeneeded = (event) => {
  const db = event.target.result;
  if (!db.objectStoreNames.contains('messages')) { ... }
  if (!db.objectStoreNames.contains('conversations')) { ... }
};
```
You must **bump the version from 2 to 3** and add the `knowledge` object store in `onupgradeneeded`.

**`src/convo.js`** — `complete(convo, onupdate, onabort)` is where the message array is built before sending to the provider. This is where retrieved chunks must be injected.

**`src/providers.js`** — `BUILTIN_MODELS` and `providers` array. OpenAI provider:
```js
{ name: 'OpenAI', url: 'https://api.openai.com', ... apiKeyFn: () => get(openaiAPIKey) }
```

## Implementation

### 1. Bump IndexedDB version and add `knowledge` store

In `src/App.svelte`, change:
```js
const request = indexedDB.open('threews-chat', 3);  // was 2
request.onupgradeneeded = (event) => {
  const db = event.target.result;
  if (!db.objectStoreNames.contains('messages')) {
    db.createObjectStore('messages', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('conversations')) {
    db.createObjectStore('conversations', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('knowledge')) {
    const ks = db.createObjectStore('knowledge', { keyPath: 'id' });
    ks.createIndex('agentId', 'agentId', { unique: false });
    ks.createIndex('filename', 'filename', { unique: false });
  }
};
```

### 2. Create `src/knowledge.js`

This module handles all knowledge base operations:

```js
import { get } from 'svelte/store';
import { openaiAPIKey, notify } from './stores.js';

// Chunk text into ~500-word chunks with 50-word overlap
export function chunkText(text, chunkSize = 500, overlap = 50) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}

// Embed an array of strings via OpenAI text-embedding-3-small
// Returns array of Float32Array embeddings in the same order
export async function embedTexts(texts) {
  const apiKey = get(openaiAPIKey);
  if (!apiKey) throw new Error('No OpenAI API key set — add it in Settings.');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Embeddings API error: ${res.status}`);
  }
  const json = await res.json();
  return json.data.map(d => new Float32Array(d.embedding));
}

// Cosine similarity between two Float32Array vectors
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// Get all knowledge chunks for a given agentId from IndexedDB
export function getChunksForAgent(db, agentId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('knowledge', 'readonly');
    const index = tx.objectStore('knowledge').index('agentId');
    const req = index.getAll(agentId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Save a batch of chunk records to IndexedDB
export function saveChunks(db, chunks) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('knowledge', 'readwrite');
    const store = tx.objectStore('knowledge');
    for (const chunk of chunks) store.put(chunk);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Delete all chunks for a filename + agentId
export function deleteChunksForFile(db, agentId, filename) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('knowledge', 'readwrite');
    const index = tx.objectStore('knowledge').index('agentId');
    const req = index.getAll(agentId);
    req.onsuccess = () => {
      const toDelete = req.result.filter(c => c.filename === filename);
      const store = tx.objectStore('knowledge');
      for (const c of toDelete) store.delete(c.id);
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Retrieve top-k chunks most similar to a query string
export async function retrieveTopK(db, agentId, query, k = 3) {
  const [queryEmbedding] = await embedTexts([query]);
  const chunks = await getChunksForAgent(db, agentId);
  if (chunks.length === 0) return [];
  const scored = chunks.map(c => ({
    ...c,
    score: cosineSimilarity(queryEmbedding, new Float32Array(c.embedding)),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// Full pipeline: read file text → chunk → embed → store
// onProgress(stage, done, total) — called for progress updates
export async function ingestFile(db, agentId, file, onProgress) {
  const text = await file.text();
  const chunks = chunkText(text);
  const total = chunks.length;
  onProgress('chunking', total, total);

  const BATCH = 20; // embed in batches to respect API limits
  const records = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const embeddings = await embedTexts(batch);
    for (let j = 0; j < batch.length; j++) {
      records.push({
        id: `${agentId}:${file.name}:${i + j}`,
        agentId,
        filename: file.name,
        chunkIndex: i + j,
        text: batch[j],
        embedding: Array.from(embeddings[j]), // store as plain array for IndexedDB
      });
    }
    onProgress('embedding', i + BATCH, total);
  }
  await saveChunks(db, records);
  onProgress('done', total, total);
}
```

### 3. Create `src/KnowledgeBasePanel.svelte`

A component that shows the knowledge base for the current agent and allows uploading/deleting files. Receives `db` as a prop (passed from App.svelte).

```svelte
<script>
  import { activeAgent, openaiAPIKey, notify } from './stores.js';
  import { ingestFile, getChunksForAgent, deleteChunksForFile } from './knowledge.js';
  import { onMount } from 'svelte';

  export let db;   // IndexedDB database instance from App.svelte

  let files = [];   // { filename, chunkCount }
  let uploading = false;
  let uploadProgress = { stage: '', done: 0, total: 0 };
  let fileInput;

  async function loadFiles() {
    if (!db || !$activeAgent) return;
    const chunks = await getChunksForAgent(db, $activeAgent.id);
    const byFile = {};
    for (const c of chunks) {
      byFile[c.filename] = (byFile[c.filename] || 0) + 1;
    }
    files = Object.entries(byFile).map(([filename, chunkCount]) => ({ filename, chunkCount }));
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !$activeAgent) return;
    if (!$openaiAPIKey) {
      notify('Add an OpenAI API key in Settings to use the knowledge base.', 'error');
      return;
    }
    uploading = true;
    try {
      await ingestFile(db, $activeAgent.id, file, (stage, done, total) => {
        uploadProgress = { stage, done, total };
      });
      notify(`${file.name} ingested (${uploadProgress.total} chunks)`, 'success');
      await loadFiles();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      uploading = false;
      fileInput.value = '';
    }
  }

  async function removeFile(filename) {
    if (!db || !$activeAgent) return;
    await deleteChunksForFile(db, $activeAgent.id, filename);
    await loadFiles();
  }

  $: if (db && $activeAgent) loadFiles();
</script>

<div class="flex flex-col gap-3">
  <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Knowledge Base</p>

  {#if files.length === 0}
    <p class="text-[12px] text-slate-400">No files uploaded yet.</p>
  {:else}
    <ul class="flex flex-col gap-1.5">
      {#each files as f}
        <li class="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
          <div>
            <p class="text-[13px] text-slate-700">{f.filename}</p>
            <p class="text-[11px] text-slate-400">{f.chunkCount} chunks</p>
          </div>
          <button
            class="text-[12px] text-red-400 hover:text-red-600"
            on:click={() => removeFile(f.filename)}
          >Remove</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if uploading}
    <div class="text-[12px] text-slate-500">
      {uploadProgress.stage === 'done'
        ? 'Saved!'
        : `${uploadProgress.stage} — ${uploadProgress.done}/${uploadProgress.total} chunks…`}
    </div>
  {:else}
    <label class="cursor-pointer rounded-lg border border-dashed border-slate-300 px-4 py-3 text-center text-[12px] text-slate-500 hover:border-indigo-400 hover:text-indigo-500 transition">
      Upload .txt or .md file
      <input
        bind:this={fileInput}
        type="file"
        accept=".txt,.md"
        class="hidden"
        on:change={handleUpload}
      />
    </label>
  {/if}
</div>
```

### 4. Wire into App.svelte

Pass `db` to `KnowledgeBasePanel`. Show it in a collapsible panel below the message list when `$activeAgent` is set, OR integrate it as a tab in `AgentSettingsModal.svelte` (if that exists). The simplest placement: add it to a knowledge panel accessible from the agent settings gear button.

Expose `db` from App.svelte's script to the template by making it a reactive variable (it's already `let db` — just pass it as a prop: `<KnowledgeBasePanel {db} />`).

### 5. Inject retrieved chunks into completions

In `src/convo.js`, modify `complete(convo, onupdate, onabort)` to accept an optional `retrievalContext` string, and prepend it into the system message:

In `complete()`, accept a third optional param OR check `convo.retrievalContext` (set by App.svelte before calling):

```js
// At the top of complete(), after building messages:
if (convo.retrievalContext) {
  const sysIdx = messages.findIndex(m => m.role === 'system');
  const contextBlock = `\n\n---\nRelevant context from knowledge base:\n${convo.retrievalContext}\n---\n`;
  if (sysIdx !== -1) {
    messages[sysIdx] = { ...messages[sysIdx], content: messages[sysIdx].content + contextBlock };
  } else {
    messages.unshift({ role: 'system', content: `Relevant context:\n${convo.retrievalContext}` });
  }
}
```

In `src/App.svelte`, in `submitCompletion()`, before calling `complete()`:

```js
async function submitCompletion() {
  // ... existing setup code ...

  // RAG retrieval
  if ($activeAgent?.id && db) {
    try {
      const lastUserMsg = [...convo.messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg?.content) {
        const { retrieveTopK } = await import('./knowledge.js');
        const chunks = await retrieveTopK(db, $activeAgent.id, lastUserMsg.content, 3);
        if (chunks.length > 0) {
          convo.retrievalContext = chunks.map(c => c.text).join('\n\n');
        }
      }
    } catch {}
  }

  // ... existing complete() call ...
  await complete(convo, onupdate, onabort);
  delete convo.retrievalContext;  // clean up after use
}
```

Find `submitCompletion` in App.svelte and add the RAG block just before the `complete(convo, ...)` call.

## Constraints
- Only `.txt` and `.md` files are supported — reject others with `notify()`.
- Embedding calls go directly to `https://api.openai.com/v1/embeddings` using the stored `openaiAPIKey` — no proxy, no new backend routes.
- `convo.retrievalContext` is ephemeral — never persisted to IndexedDB.
- The IndexedDB version bump from 2 to 3 is backward-compatible (the upgrade adds the new store, existing stores are untouched).
- If the agent has no knowledge base (no chunks), skip retrieval silently.
- Run `npm run build` (from `chat/`) and confirm it passes.
