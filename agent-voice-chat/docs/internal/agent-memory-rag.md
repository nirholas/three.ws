> **Internal Planning Document** — Not part of the public documentation.

# Prompt: Agent Memory & RAG (Retrieval-Augmented Generation)

## Why This Is a Killer Feature
Right now, agents are goldfish — they forget everything when the server restarts, and they can't access external knowledge. Adding memory and RAG makes the agent genuinely useful:

- **Memory**: "Last time we talked you mentioned building a DEX on Solana — how's that going?"
- **RAG**: Agent can reference docs, whitepapers, project wikis while talking in the Space

This is the feature that makes people say "holy shit" when they see it work.

## Architecture

```
┌─────────────────────────────────────────────┐
│                Agent Brain                   │
│                                             │
│  ┌─ Short-Term Memory ───────────────────┐  │
│  │ Current conversation (in-context)      │  │
│  │ Last 20 messages per agent             │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌─ Long-Term Memory ───────────────────┐  │
│  │ Persisted facts extracted from convos  │  │
│  │ Stored in local JSON or SQLite         │  │
│  │ Retrieved by semantic similarity       │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌─ Knowledge Base (RAG) ───────────────┐  │
│  │ User-provided docs (markdown, PDF)     │  │
│  │ Chunked, embedded, indexed             │  │
│  │ Retrieved by query similarity          │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  Before each LLM call:                      │
│  1. Search long-term memory for relevant    │
│     facts about current speaker/topic       │
│  2. Search knowledge base for relevant docs │
│  3. Inject into system prompt as context    │
└─────────────────────────────────────────────┘
```

## Memory System

### Memory Types

**Episodic Memory** — facts about specific conversations:
```json
{
  "id": "mem_001",
  "type": "episodic",
  "content": "User @cryptodude is building a DEX on Solana, mentioned having trouble with anchor framework",
  "speaker": "@cryptodude",
  "createdAt": "2026-03-23T14:00:00Z",
  "spaceUrl": "https://x.com/i/spaces/...",
  "embedding": [0.123, -0.456, ...]
}
```

**Semantic Memory** — general knowledge learned:
```json
{
  "id": "mem_002",
  "type": "semantic",
  "content": "The community prefers discussing Solana over Ethereum in morning Spaces",
  "createdAt": "2026-03-23T14:00:00Z",
  "embedding": [0.789, -0.012, ...]
}
```

**User Profiles** — what we know about repeat speakers:
```json
{
  "id": "user_cryptodude",
  "username": "@cryptodude",
  "facts": [
    "Building a DEX on Solana",
    "Has experience with Rust and Anchor",
    "Prefers technical discussions",
    "Usually joins the morning crypto Space"
  ],
  "firstSeen": "2026-03-20",
  "lastSeen": "2026-03-23",
  "interactions": 12
}
```

### Memory Extraction
After each conversation exchange, extract memorable facts:

```typescript
async function extractMemories(exchange: { speaker: string, text: string, response: string }): Promise<Memory[]> {
  // Use LLM to extract structured facts
  const extraction = await llm.generate({
    systemPrompt: `Extract factual information worth remembering from this conversation exchange.
      Focus on: personal details about the speaker, projects they mention, preferences, opinions.
      Return as JSON array of strings. Return empty array if nothing memorable.`,
    messages: [{
      role: 'user',
      content: `Speaker ${exchange.speaker} said: "${exchange.text}"\nAgent responded: "${exchange.response}"`
    }]
  })

  const facts = JSON.parse(extraction)
  return facts.map(fact => ({
    type: 'episodic',
    content: fact,
    speaker: exchange.speaker,
    createdAt: new Date()
  }))
}
```

### Memory Retrieval
Before each LLM call, find relevant memories:

```typescript
async function getRelevantMemories(currentContext: string, speaker: string): Promise<string> {
  // 1. Get user profile if we know this speaker
  const profile = await memoryStore.getUserProfile(speaker)

  // 2. Search episodic memories by similarity to current context
  const memories = await memoryStore.search(currentContext, { limit: 5, speaker })

  // 3. Format as context injection
  let context = ''
  if (profile) {
    context += `\n## What you know about ${speaker}:\n`
    context += profile.facts.map(f => `- ${f}`).join('\n')
  }
  if (memories.length) {
    context += `\n## Relevant past conversations:\n`
    context += memories.map(m => `- ${m.content}`).join('\n')
  }
  return context
}
```

### Storage Backend

**Option A: Local JSON + simple embedding (no dependencies)**
```
memory/
├── episodic.json        ← All episodic memories
├── users.json           ← User profiles
└── embeddings.json      ← Pre-computed embeddings
```
Use OpenAI's embedding API (`text-embedding-3-small`) for similarity search.
Simple cosine similarity — no vector database needed for <10K memories.

**Option B: SQLite + better-sqlite3 (better for larger scale)**
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT,
  content TEXT,
  speaker TEXT,
  embedding BLOB,
  created_at DATETIME
);

CREATE TABLE user_profiles (
  username TEXT PRIMARY KEY,
  facts TEXT,  -- JSON array
  first_seen DATETIME,
  last_seen DATETIME,
  interactions INTEGER
);
```

**Recommendation**: Start with Option A (JSON files). Migrate to SQLite when memory exceeds ~1000 entries.

## Knowledge Base (RAG)

### How It Works
Users drop documents into a `knowledge/` directory. The system chunks, embeds, and indexes them. During conversations, relevant chunks are retrieved and injected into the agent's context.

### Supported Formats
- Markdown (.md)
- Plain text (.txt)
- PDF (.pdf) — using pdf-parse
- JSON (.json) — structured data

### Ingestion Pipeline
```
knowledge/
├── project-whitepaper.md
├── tokenomics.md
├── faq.md
└── team-bios.txt
         │
         ▼
   ┌─ Chunker ─┐
   │ Split into │
   │ ~500 token │
   │ chunks     │
   └─────┬─────┘
         │
         ▼
   ┌─ Embedder ──┐
   │ OpenAI       │
   │ text-embed-  │
   │ 3-small      │
   └─────┬───────┘
         │
         ▼
   ┌─ Index ─────┐
   │ Store chunks │
   │ + embeddings │
   │ in JSON/SQL  │
   └──────────────┘
```

### Usage in SDK

```typescript
const agent = new XSpaceAgent({
  // ... other config
  knowledge: {
    directory: './knowledge',       // Path to documents
    chunkSize: 500,                 // Tokens per chunk
    chunkOverlap: 50,              // Overlap between chunks
    maxRetrievedChunks: 3,         // Max chunks per query
    embeddingModel: 'text-embedding-3-small'
  },
  memory: {
    enabled: true,
    extractionModel: 'gpt-4o-mini', // Model for memory extraction
    maxMemories: 1000,
    storagePath: './memory'
  }
})
```

### Retrieval Flow (integrated into pipeline)
```
User speaks: "Tell me about the tokenomics"
         │
         ▼
    STT: "Tell me about the tokenomics"
         │
    ┌────┴────┐
    │         │
    ▼         ▼
 Memory    Knowledge
 Search    Search
    │         │
    │    "tokenomics.md chunk 2:
    │     Total supply is 1B tokens..."
    │         │
    └────┬────┘
         │
         ▼
    System prompt + memory context + knowledge context
         │
         ▼
    LLM generates informed response:
    "The total supply is 1 billion tokens, with..."
```

### Admin UI — Knowledge Manager
```
┌─ KNOWLEDGE BASE ─────────────────────────────┐
│                                               │
│  [Upload Documents]  [Reindex All]            │
│                                               │
│  ┌─ project-whitepaper.md ──────────────────┐│
│  │ Chunks: 24 | Last indexed: 2h ago        ││
│  │ [View] [Remove] [Reindex]                ││
│  └──────────────────────────────────────────┘│
│                                               │
│  ┌─ tokenomics.md ─────────────────────────┐ │
│  │ Chunks: 8 | Last indexed: 2h ago         │ │
│  │ [View] [Remove] [Reindex]                │ │
│  └──────────────────────────────────────────┘│
│                                               │
│  Total: 3 documents, 42 chunks               │
│                                               │
│  ── AGENT MEMORY ──                           │
│  Memories: 47 episodic, 12 semantic          │
│  Known users: 8                               │
│  [View Memories] [Clear All]                  │
└───────────────────────────────────────────────┘
```

## New Dependencies
```json
{
  "dependencies": {
    "openai": "^4.0.0"     // already included — for embeddings
  },
  "optionalDependencies": {
    "pdf-parse": "^1.1.1",
    "better-sqlite3": "^11.0.0"
  }
}
```

## Implementation Steps
1. Build memory store (JSON-based, CRUD for memories)
2. Build embedding module (OpenAI text-embedding-3-small)
3. Build memory extraction (LLM-powered fact extraction after each exchange)
4. Build knowledge base ingestion (chunk + embed documents)
5. Build retrieval module (cosine similarity search)
6. Integrate into LLM pipeline (inject context before each call)
7. Build user profile system (track repeat speakers)
8. Add admin UI for knowledge/memory management
9. Add to SDK config interface

## Validation
- [ ] Agent remembers facts from previous conversations after restart
- [ ] Agent references knowledge base documents in responses
- [ ] User profiles accumulate facts across conversations
- [ ] Memory extraction correctly identifies memorable facts
- [ ] Retrieval returns relevant results (not random)
- [ ] Knowledge base supports markdown and text files
- [ ] Admin can view and manage memories
- [ ] Performance: retrieval adds < 500ms to pipeline


